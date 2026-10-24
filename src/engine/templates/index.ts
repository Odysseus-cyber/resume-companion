import { prepareLayoutRequest } from '../../ai/layout';
import { findEquivalentFacts } from '../../domain/field-semantics';
import { facts, type Mapping, type Profile } from '../../domain/model';
import { formTemplateSchema, type FormTemplate, type TemplateField } from '../../domain/templates';
import type { Field, LayoutControl, LayoutScan, LayoutText, PlanItem } from '../types';

export interface TemplateResolution {
  status: 'full' | 'partial' | 'none' | 'ambiguous';
  templateId?: string;
  crossOrigin: boolean;
  plan: PlanItem[];
  labels: Record<string, string>;
  details: Record<string, string>;
  unresolvedIds: string[];
  reused: number;
}
const normalized = (text: string) =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s*:：·]/g, '');
const usable = (text: string) =>
  !!normalized(text) && !text.includes('[已隐藏]') && text.length <= 300;

/** Only text uniquely related to one control may become its persistent anchor. */
function anchors(scan: LayoutScan, profile: Profile): Map<string, LayoutText[]> {
  const layout = prepareLayoutRequest(scan, facts(profile)).payload.layout;
  const parents = new Map(layout.containers.map((node) => [node.id, node.parentId]));
  const ancestry = new Map<string | null, string[]>();
  function ancestors(id: string | null) {
    const cached = ancestry.get(id);
    if (cached) return cached;
    const original = id;
    const result: string[] = [];
    while (id && !result.includes(id)) {
      result.push(id);
      id = parents.get(id) || null;
    }
    ancestry.set(original, result);
    return result;
  }
  const controlCounts = new Map<string, number>();
  for (const control of layout.controls)
    for (const id of ancestors(control.parentId))
      controlCounts.set(id, (controlCounts.get(id) || 0) + 1);
  function distance(text: LayoutText, control: LayoutControl) {
    const a = ancestors(text.parentId),
      b = ancestors(control.parentId);
    const common = a.findIndex((id) => b.includes(id));
    if (common < 0) return Infinity;
    const depth = common + b.indexOf(a[common]!);
    const t = text.rect,
      c = control.rect;
    const sameRow =
      Math.abs(t.y + t.height / 2 - c.y - c.height / 2) <= Math.max(t.height, c.height) / 2;
    const left = t.x + t.width <= c.x + 8;
    const above = t.y + t.height <= c.y + 8 && t.y + t.height >= c.y - 120;
    const aligned = t.x < c.x + c.width && t.x + t.width > c.x;
    const exclusive = controlCounts.get(a[common]!) === 1;
    // A dedicated row/container works without geometry (e.g. display:contents).
    if (!exclusive && !((sameRow && left) || (above && aligned))) return Infinity;
    const gap = Math.hypot(Math.max(0, c.x - t.x - t.width), Math.abs(c.y - t.y));
    if (!exclusive && gap > 320) return Infinity;
    return depth * 1000 + gap;
  }
  const result = new Map<string, { text: LayoutText; distance: number }[]>();
  for (const text of layout.texts.filter((text) => usable(text.text))) {
    const candidates = layout.controls
      .map((control) => ({ control, score: distance(text, control) }))
      .filter((candidate) => Number.isFinite(candidate.score))
      .sort((a, b) => a.score - b.score);
    const best = candidates[0];
    if (!best || candidates[1]?.score === best.score) continue;
    const list = result.get(best.control.id) || [];
    list.push({ text, distance: best.score });
    result.set(best.control.id, list);
  }
  return new Map(
    [...result].map(([id, entries]) => [
      id,
      entries
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 16)
        .map((entry) => entry.text),
    ]),
  );
}
function safeLabel(label: string, scan: LayoutScan, profile: Profile) {
  const text =
    prepareLayoutRequest(
      {
        ...scan,
        layout: {
          ...scan.layout,
          texts: [
            {
              id: 't0',
              parentId: null,
              order: 0,
              rect: { x: 0, y: 0, width: 0, height: 0 },
              text: label,
            },
          ],
        },
      },
      facts(profile),
    ).payload.layout.texts[0]?.text.trim() || '';
  return usable(text) && text.length <= 200 ? text : '';
}
/** Redacted headings cannot be discarded: that would erase a safety boundary. */
function regionAnchors(field: Field, scan: LayoutScan, profile: Profile): string[] | null {
  const regions = field.region || [];
  if (regions.length > 8) return null;
  const safe = regions.map((region) => safeLabel(region, scan, profile));
  return safe.some((region) => !region) ? null : safe;
}
function sameRegion(saved: TemplateField, current: string[] | null) {
  const expected = saved.regionAnchors || [];
  return (
    current !== null &&
    expected.length === current.length &&
    expected.every((region, index) => normalized(region) === normalized(current[index]!))
  );
}
function materialize(field: TemplateField, target: Field) {
  return field.path.replace('{index}', String(target.index));
}
function parameterize(path: string) {
  return path.replace(/^(education|experience|projects)\.\d+\./, '$1.{index}.');
}

export function createTemplate(
  scan: LayoutScan,
  profile: Profile,
  items: PlanItem[],
  labels: Record<string, string>,
  checkedIds: string[],
  existing?: FormTemplate,
): FormTemplate {
  const nearby = anchors(scan, profile),
    local = facts(profile);
  const fields: TemplateField[] = [];
  for (const id of new Set(checkedIds)) {
    const field = scan.fields.find((field) => field.id === id);
    const matches = items.filter((item) => item.id === id);
    const item = matches.length === 1 ? matches[0] : undefined;
    const related = nearby.get(id) || [];
    if (!field || !item || !local.some((fact) => fact.path === item.path) || !related.length)
      continue;
    const label = safeLabel(labels[id] || field.label, scan, profile);
    const regions = regionAnchors(field, scan, profile);
    if (!label || regions === null) continue;
    const preferred = related.filter((text) => equivalent(label, text.text));
    const evidence = related.filter((text) => item.evidence?.includes(text.id));
    const ordered = [...new Set([...preferred, ...evidence, ...related])];
    const repeated = item.path.match(/^(education|experience|projects)\.(\d+)\./);
    if (repeated && (field.section !== repeated[1] || field.index !== Number(repeated[2])))
      continue;
    fields.push({
      id: crypto.randomUUID(),
      label,
      path: parameterize(item.path),
      section: field.section,
      regionAnchors: regions,
      index: field.index,
      anchors: [...new Set(ordered.map((text) => text.text))],
      kind: field.kind,
      confirmed: true,
      ...(item.path.startsWith('custom.') ? { customProfileId: profile.id } : {}),
    });
  }
  // Never silently persist two competing meanings for one scalar/entry value.
  const unique = fields.filter(
    (field) =>
      fields.filter((other) => other.path === field.path && other.index === field.index).length ===
      1,
  );
  if (!unique.length)
    throw new Error('没有可保存的已核对字段；需要有效资料对应关系及明确的页面文字依据');
  const now = new Date().toISOString();
  return formTemplateSchema.parse({
    version: 1,
    id: existing?.origin === scan.origin ? existing.id : crypto.randomUUID(),
    name: existing?.name || `${new URL(scan.origin).hostname} 表单`,
    adapter: scan.adapter,
    origin: scan.origin,
    enabled: true,
    createdAt: existing?.origin === scan.origin ? existing.createdAt : now,
    updatedAt: now,
    fields: unique,
  });
}
function emptyResolution(scan: LayoutScan): TemplateResolution {
  return {
    status: 'none',
    crossOrigin: false,
    plan: [],
    labels: {},
    details: {},
    unresolvedIds: scan.fields.map((field) => field.id),
    reused: 0,
  };
}
function equivalent(a: string, b: string) {
  return (
    normalized(a) === normalized(b) ||
    findEquivalentFacts(a, [{ path: 'custom.anchor', label: b, value: '' }]).length === 1
  );
}

export function resolveTemplates(
  scan: LayoutScan,
  profile: Profile,
  templates: FormTemplate[],
  mappings: Mapping[],
): TemplateResolution {
  const nearby = anchors(scan, profile),
    local = facts(profile);
  const regions = new Map(
    scan.fields.map((field) => [field.id, regionAnchors(field, scan, profile)]),
  );
  const candidates = templates.filter(
    (template) =>
      template.enabled &&
      template.adapter === scan.adapter &&
      (template.origin === scan.origin || !['generic', 'layout'].includes(scan.adapter)),
  );
  const resolutions = candidates.map((template) => {
    const result = {
      ...emptyResolution(scan),
      templateId: template.id,
      crossOrigin: template.origin !== scan.origin,
    };
    const proposals: { field: Field; saved: TemplateField; evidence: string[]; path: string }[] =
      [];
    let ambiguous = false;
    const changedSections = new Set<string>();
    for (const section of ['education', 'experience', 'projects']) {
      const expected = [
        ...new Set(
          template.fields.filter((field) => field.section === section).map((field) => field.index),
        ),
      ]
        .sort()
        .join(',');
      const actual = [
        ...new Set(
          scan.fields.filter((field) => field.section === section).map((field) => field.index),
        ),
      ]
        .sort()
        .join(',');
      if (expected && expected !== actual) changedSections.add(section);
    }
    for (const saved of template.fields) {
      const eligible = scan.fields.filter(
        (field) =>
          field.kind === saved.kind &&
          sameRegion(saved, regions.get(field.id) ?? null) &&
          field.section === saved.section &&
          (!saved.section || field.index === saved.index),
      );
      const matching = eligible.filter((field) =>
        (nearby.get(field.id) || []).some((text) => equivalent(saved.anchors[0]!, text.text)),
      );
      if (matching.length !== 1) {
        if (matching.length > 1) {
          ambiguous = true;
          matching.forEach((field) => {
            result.details[field.id] = '模板对应多个控件，待核对';
          });
        }
        continue;
      }
      const field = matching[0]!;
      result.labels[field.id] = saved.label;
      if (saved.section && changedSections.has(saved.section)) {
        result.details[field.id] = '经历结构已变化，请重新核对对应顺序';
        continue;
      }
      const path = materialize(saved, field);
      if (saved.path.includes('{index}') && saved.path.split('.')[0] !== field.section) continue;
      if (
        path.startsWith('custom.') &&
        (saved.customProfileId !== profile.id || !local.some((fact) => fact.path === path))
      ) {
        result.details[field.id] = '自定义资料已删除或属于其他简历，待核对';
        continue;
      }
      const evidence = (nearby.get(field.id) || [])
        .filter((text) => saved.anchors.some((anchor) => equivalent(anchor, text.text)))
        .map((text) => text.id);
      proposals.push({ field, saved, evidence, path });
    }
    for (const proposal of proposals) {
      const { field, saved, evidence, path } = proposal;
      if (
        proposals.filter((other) => other.field.id === field.id || other.path === path).length > 1
      ) {
        ambiguous = true;
        delete result.labels[field.id];
        result.details[field.id] = '模板存在重复目标或资料对应冲突，待核对';
        continue;
      }
      const manual = mappings.filter(
        (mapping) => mapping.origin === scan.origin && mapping.signature === field.signature,
      );
      if (manual.some((mapping) => mapping.path !== path)) {
        ambiguous = true;
        delete result.labels[field.id];
        result.details[field.id] = '模板与已保存的手动映射冲突，待核对';
        continue;
      }
      const fact = local.find((fact) => fact.path === path);
      if (!fact) {
        result.details[field.id] = '未找到对应资料 key';
        continue;
      }
      const control = scan.layout.controls.find((control) => control.id === field.id);
      if (!control) continue;
      let reason = '';
      if (field.blocked || !control.writable || field.kind === 'unsupported')
        reason = control.reason || field.supportReason || '控件暂不支持自动填写';
      else if (field.value || control.occupied) reason = '已有内容，保留原值';
      else if (!fact.value.trim()) reason = '缺少资料';
      else if (
        ['date', 'month'].includes(field.kind) &&
        (!/^(personal\.birthday|(education|experience|projects)\.\d+\.(start|end))$/.test(path) ||
          !/^\d{4}-\d{2}(?:-\d{2})?$/.test(fact.value))
      )
        reason = '日期资料类型或格式无法安全填写';
      result.labels[field.id] = saved.label;
      result.details[field.id] =
        reason || (result.crossOrigin ? '跨网站模板候选，请核对后填写' : '已复用模板');
      result.plan.push({
        id: field.id,
        path,
        value: fact.value,
        evidence,
        source: '已验证表单模板',
        confidence: 1,
        selected: !reason,
      });
    }
    result.reused = result.plan.length;
    result.unresolvedIds = scan.fields
      .filter((field) => !result.plan.some((item) => item.id === field.id))
      .map((field) => field.id);
    result.status = ambiguous
      ? 'ambiguous'
      : result.reused
        ? result.unresolvedIds.length
          ? 'partial'
          : 'full'
        : 'none';
    return result;
  });
  // Prefer a verified origin-specific instance; a foreign template cannot override it.
  resolutions.sort((a, b) => Number(a.crossOrigin) - Number(b.crossOrigin) || b.reused - a.reused);
  const best =
    resolutions.find((result) => result.reused > 0) ||
    resolutions.find((result) => result.status === 'ambiguous') ||
    resolutions.find((result) => Object.keys(result.details).length > 0);
  if (!best) return emptyResolution(scan);
  const peers = resolutions.filter(
    (result) => result !== best && result.crossOrigin === best.crossOrigin,
  );
  const conflictIds = new Set(
    peers.flatMap((peer) =>
      peer.plan
        .filter((item) =>
          best.plan.some((other) => other.id === item.id && other.path !== item.path),
        )
        .map((item) => item.id),
    ),
  );
  if (conflictIds.size) {
    best.plan = best.plan.filter((item) => !conflictIds.has(item.id));
    for (const id of conflictIds) {
      delete best.labels[id];
      best.details[id] = '多个模板提供了冲突对应关系，待核对';
    }
    best.reused = best.plan.length;
    best.unresolvedIds = scan.fields
      .filter((field) => !best.plan.some((item) => item.id === field.id))
      .map((field) => field.id);
    best.status = 'ambiguous';
  }
  return best;
}
