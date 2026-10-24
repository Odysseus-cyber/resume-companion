import type { Section } from '../domain/model';
import type { Field, FieldKind, FillResult, LayoutScan, PlanItem, Scan } from './types';
import { collectLayout, visibleText, type LayoutCollection } from './layout';
import { getAdapter } from './adapters';
import { matchField, normalize } from './matcher';
import { labelInfo, labelOf, staticText, visible } from './labels';

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLElement;
interface Ref {
  nodes: Control[];
  field: Field;
}
interface Undo {
  ref: Ref;
  before: string[];
  after: string[];
}
const sensitive =
  /密码|验证码|身份证|证件号|护照|银行卡|隐私|同意|承诺|声明|条款|password|captcha|consent|agreement|passport|ssn|one-time-code|verification.?code/i;
const controlSelector = 'input,textarea,select,[role="combobox"]';
function headingOf(parent: Element): string {
  const candidates = Array.from(
    parent.querySelectorAll('legend,h1,h2,h3,h4,h5,h6,[role="heading"]'),
  ).filter((heading) => {
    let branch = heading;
    for (let depth = 0; depth < 3; depth++) {
      if (branch.parentElement === parent) {
        return !branch.matches(controlSelector) && !branch.querySelector(controlSelector);
      }
      if (!branch.parentElement) break;
      branch = branch.parentElement;
    }
    return false;
  });
  // Multiple section headings in a broad wrapper are not evidence that all of
  // its fields belong to the first section.
  return candidates.length === 1 ? staticText(candidates[0]!) : '';
}
function isChoiceGroup(element: Element): boolean {
  const controls = Array.from(element.querySelectorAll('input,textarea,select,[role="combobox"]'));
  return (
    controls.length > 0 &&
    controls.every((n) => n instanceof HTMLInputElement && ['radio', 'checkbox'].includes(n.type))
  );
}
function sectionOf(el: Control, selectors: string[]): { section?: Section; group?: Element } {
  let parent: Element | null = el.parentElement;
  while (parent && parent !== document.body) {
    const name = parent.getAttribute('data-section') || headingOf(parent) || '';
    const section: Section | undefined = /education|教育|学历/.test(name)
      ? 'education'
      : /experience|实习|工作/.test(name)
        ? 'experience'
        : /projects|项目/.test(name)
          ? 'projects'
          : undefined;
    if (section && !isChoiceGroup(parent)) {
      // A nested radio/checkbox fieldset represents one question, not another resume entry.
      let group = el.parentElement;
      while (group && group !== parent) {
        if (group.matches(selectors.join(',')) && !isChoiceGroup(group)) return { section, group };
        group = group.parentElement;
      }
      return { section, group: parent };
    }
    parent = parent.parentElement;
  }
  return {};
}
function raw(el: Control): string {
  if (el instanceof HTMLInputElement && ['radio', 'checkbox'].includes(el.type))
    return el.checked ? '1' : '0';
  if (el instanceof HTMLSelectElement && el.multiple)
    return JSON.stringify(Array.from(el.selectedOptions, (o) => o.value));
  return el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
    ? el.value
    : el.textContent?.trim() || '';
}
function current(ref: Ref): string {
  if (ref.field.kind === 'radio' || ref.field.kind === 'checkbox')
    return ref.nodes
      .filter((n) => (n as HTMLInputElement).checked)
      .map((n) => labelOf(n))
      .join(', ');
  return raw(ref.nodes[0]!);
}
function signal(el: Control) {
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
}
function setRaw(el: Control, value: string) {
  if (el instanceof HTMLInputElement && ['radio', 'checkbox'].includes(el.type)) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')!.set!.call(
      el,
      value === '1',
    );
  } else if (el instanceof HTMLSelectElement && el.multiple) {
    const values: string[] = JSON.parse(value);
    for (const o of el.options) o.selected = values.includes(o.value);
  } else if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  ) {
    const proto =
      el instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : el instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  } else {
    throw new Error('此控件无法直接恢复，请在网页中手动修改');
  }
  signal(el);
}
function equivalent(a: string, b: string): boolean {
  const map: Record<string, string> = {
    学士: '本科',
    bachelor: '本科',
    硕士研究生: '硕士',
    master: '硕士',
    博士研究生: '博士',
    phd: '博士',
    male: '男',
    female: '女',
  };
  return (map[normalize(a)] || normalize(a)) === (map[normalize(b)] || normalize(b));
}
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));

const normalizedText = (node: Node) => node.textContent?.replace(/\s+/g, ' ').trim() || '';
function ancestors(node: Node): Element[] {
  const result: Element[] = [];
  for (let parent = node.parentElement; parent; parent = parent.parentElement) result.push(parent);
  return result;
}
function sameAncestors(node: Node, original: Element[]): boolean {
  const current = ancestors(node);
  return current.length === original.length && current.every((parent, i) => parent === original[i]);
}
/** Semantic/state attributes only: validation classes, geometry and aria-invalid may change. */
function controlShape(node: Control): string {
  return JSON.stringify([
    node.tagName,
    ...[
      'type',
      'name',
      'id',
      'autocomplete',
      'placeholder',
      'role',
      'aria-label',
      'aria-labelledby',
      'aria-controls',
      'aria-owns',
      'aria-disabled',
      'aria-readonly',
      'contenteditable',
      'min',
      'max',
      'step',
      'pattern',
      'multiple',
    ].map((name) => node.getAttribute(name)),
    node.matches(':disabled'),
    (node as HTMLInputElement).readOnly,
    node instanceof HTMLSelectElement
      ? Array.from(node.options, (option) => [option.text, option.value, option.disabled])
      : null,
    node instanceof HTMLInputElement && ['radio', 'checkbox'].includes(node.type)
      ? [node.value, Array.from(node.labels || [], normalizedText)]
      : null,
  ]);
}
interface LayoutAnchor {
  parents: Element[];
  text: string;
}
interface LayoutTarget {
  parents: Element[][];
  shapes: string[];
  evidence: string[];
}
function localEvidence(collection: LayoutCollection, nodes: Control[]): string[] {
  const node = nodes[0]!;
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    const nearby = collection.textNodes
      .map((text, index) => ({ text, id: `t${index}` }))
      .filter(({ text }) => parent.contains(text));
    if (!nearby.length) continue;
    const otherControls = collection.candidates.some((candidate) =>
      candidate.nodes.some((other) => !nodes.includes(other) && parent.contains(other)),
    );
    if (!otherControls) return nearby.map(({ id }) => id);
    // A flat form may interleave labels and fields without row wrappers.
    // AI evidence supplements this conservative nearest-original-text fallback.
    const before = nearby.filter(
      ({ text }) => text.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
    return [(before.at(-1) || nearby[0])!.id];
  }
  return [];
}

export class FormEngine {
  private refs = new Map<string, Ref>();
  private history: Undo[] = [];
  private token = '';
  private busy = false;
  private layoutState?: {
    url: string;
    collection: LayoutCollection;
    values: Map<string, string[]>;
    targets: Map<string, LayoutTarget>;
    anchors: Map<string, LayoutAnchor>;
    order: Map<Node, number>;
  };
  scanLayout(): LayoutScan {
    if (this.busy) throw new Error('正在填写，请稍后再识别');
    const collection = collectLayout();
    this.refs.clear();
    this.token = crypto.randomUUID();
    const values = new Map<string, string[]>();
    const targets = new Map<string, LayoutTarget>();
    collection.candidates.forEach((candidate, index) => {
      const id = `f${index}`;
      const node = candidate.nodes[0]!;
      const blocked =
        !!candidate.reason ||
        sensitive.test(
          [
            node.getAttribute('name'),
            node.getAttribute('autocomplete'),
            node.getAttribute('aria-label'),
            node.closest('label')?.textContent,
          ]
            .filter(Boolean)
            .join(' '),
        ) ||
        (candidate.kind === 'checkbox' && candidate.nodes.length === 1);
      const field: Field = {
        id,
        signature: `layout:${this.token}:${id}`,
        label: `待识别字段 ${index + 1}`,
        bindingStable: false,
        kind: candidate.kind,
        value: '',
        options: [],
        autocomplete: '',
        index: 0,
        blocked,
        supportReason: candidate.reason || (blocked ? '敏感或确认字段需手动填写' : undefined),
      };
      const ref: Ref = { nodes: candidate.nodes, field };
      field.value =
        node instanceof HTMLInputElement && ['password', 'file'].includes(node.type)
          ? ''
          : current(ref);
      if (field.value === '[]') field.value = '';
      values.set(id, candidate.nodes.map(raw));
      targets.set(id, {
        parents: candidate.nodes.map(ancestors),
        shapes: candidate.nodes.map(controlShape),
        evidence: localEvidence(collection, candidate.nodes),
      });
      this.refs.set(id, ref);
      if (blocked) {
        collection.layout.controls[index]!.writable = false;
        collection.layout.controls[index]!.reason = field.supportReason;
      }
    });
    const anchors = new Map(
      collection.textNodes.map((node, index) => [
        `t${index}`,
        { parents: ancestors(node), text: normalizedText(node) },
      ]),
    );
    const ordered = [
      ...collection.textNodes,
      ...collection.candidates.flatMap((c) => c.nodes),
    ].sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    this.layoutState = {
      url: location.href,
      collection,
      values,
      targets,
      anchors,
      order: new Map(ordered.map((node, index) => [node, index])),
    };
    return {
      token: this.token,
      url: location.href,
      origin: location.origin,
      adapter: 'AI 页面布局',
      fields: Array.from(this.refs.values(), (ref) => ref.field),
      layout: collection.layout,
    };
  }
  validateLayout(token: string): { valid: true } {
    const state = this.layoutSession(token);
    // Request-time checks reject semantic changes to the submitted snapshot, but
    // do not compare positions or newly inserted validation messages.
    for (const id of state.anchors.keys()) this.validateAnchor(id);
    for (const id of this.refs.keys()) this.validateLayoutTarget(token, id);
    return { valid: true };
  }
  private layoutSession(token: string) {
    const state = this.layoutState;
    if (token !== this.token || !state || state.url !== location.href)
      throw new Error('页面已变化，请重新使用 AI 识别');
    return state;
  }
  private validateAnchor(id: string, target?: Node) {
    const state = this.layoutState!;
    const anchor = state.anchors.get(id);
    const node = state.collection.textNodes[Number(id.slice(1))];
    if (
      !anchor ||
      !node ||
      !node.isConnected ||
      !sameAncestors(node, anchor.parents) ||
      normalizedText(node) !== anchor.text ||
      !node.parentElement ||
      !visibleText(node, node.parentElement)
    )
      throw new Error('字段参考文字已变化，请重新识别');
    if (target) this.validateOrder(node, target);
  }
  private validateOrder(first: Node, second: Node) {
    if (first === second) return;
    const order = this.layoutState!.order;
    const wasBefore = order.get(first)! < order.get(second)!;
    const isBefore = !!(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (wasBefore !== isBefore) throw new Error('字段排列顺序已变化，请重新识别');
  }
  private validateLayoutTarget(token: string, id: string, evidence: string[] = []) {
    const state = this.layoutSession(token);
    const ref = this.refs.get(id);
    const target = state.targets.get(id);
    if (!ref || !target) throw new Error('字段已变化，请重新识别');
    const first = ref.nodes[0]!;
    if (
      first instanceof HTMLInputElement &&
      ['radio', 'checkbox'].includes(first.type) &&
      first.name
    ) {
      const group = first.closest('fieldset,[role="group"],[role="radiogroup"]');
      const currentMembers = Array.from(
        document.querySelectorAll<HTMLInputElement>('input'),
      ).filter(
        (node) =>
          visible(node) &&
          node.type === first.type &&
          node.name === first.name &&
          node.form === first.form &&
          node.closest('fieldset,[role="group"],[role="radiogroup"]') === group,
      );
      if (
        currentMembers.length !== ref.nodes.length ||
        currentMembers.some((node) => !ref.nodes.includes(node))
      )
        throw new Error('字段选项已变化，请重新识别');
    }
    ref.nodes.forEach((node, index) => {
      if (
        !node.isConnected ||
        !visible(node) ||
        !sameAncestors(node, target.parents[index]!) ||
        controlShape(node) !== target.shapes[index]
      )
        throw new Error('字段结构或状态已变化，请重新识别');
      for (const peer of state.collection.candidates.flatMap((candidate) => candidate.nodes)) {
        // Replaced unrelated fields do not invalidate a surviving target. We never
        // rebind to their replacements, even if an id or selector looks identical.
        if (peer.isConnected) this.validateOrder(peer, node);
      }
    });
    if (JSON.stringify(ref.nodes.map(raw)) !== JSON.stringify(state.values.get(id)))
      throw new Error('字段内容已变化，已保留网页当前内容');
    for (const textId of new Set([...target.evidence, ...evidence]))
      this.validateAnchor(textId, ref.nodes[0]!);
  }
  async fillLayout(token: string, items: PlanItem[]): Promise<FillResult[]> {
    this.layoutSession(token);
    return this.fill(token, items, true);
  }
  scan(url = location.href): Scan {
    if (this.busy) throw new Error('正在填写，请稍后再识别');
    this.refs.clear();
    this.layoutState = undefined;
    this.token = crypto.randomUUID();
    const adapter = getAdapter(url);
    const groups: Record<Section, Element[]> = { education: [], experience: [], projects: [] };
    const candidates = Array.from(
      document.querySelectorAll<Control>('input,textarea,select,[role="combobox"]'),
    ).filter(
      (el) =>
        visible(el) &&
        !(el as HTMLInputElement).disabled &&
        !(el as HTMLInputElement).readOnly &&
        !el.closest('[data-resume-companion]'),
    );
    const consumed = new Set<Control>();
    const signatures = new Map<string, number>();
    for (const el of candidates) {
      if (consumed.has(el)) continue;
      if (
        el instanceof HTMLInputElement &&
        ['hidden', 'submit', 'button', 'reset', 'file', 'password', 'search'].includes(el.type)
      )
        continue;
      let kind: FieldKind =
        el instanceof HTMLTextAreaElement
          ? 'textarea'
          : el instanceof HTMLSelectElement
            ? 'select'
            : el.getAttribute('role') === 'combobox'
              ? 'combobox'
              : el instanceof HTMLInputElement &&
                  ['date', 'month', 'radio', 'checkbox'].includes(el.type)
                ? (el.type as FieldKind)
                : 'text';
      let nodes = [el];
      const info = labelInfo(el);
      let label = info.label;
      if (kind === 'radio' || kind === 'checkbox') {
        const name = el.getAttribute('name');
        const fieldset = el.closest('fieldset,[role="group"],[role="radiogroup"]');
        if (name)
          nodes = candidates.filter(
            (n) =>
              n instanceof HTMLInputElement &&
              n.type === kind &&
              n.name === name &&
              n.form === (el as HTMLInputElement).form &&
              n.closest('fieldset,[role="group"],[role="radiogroup"]') === fieldset,
          );
        const labelledBy = fieldset?.getAttribute('aria-labelledby');
        const groupLabel =
          staticText(fieldset?.querySelector(':scope > legend') || null) ||
          fieldset?.getAttribute('aria-label') ||
          labelledBy
            ?.split(/\s+/)
            .map((id) => staticText(document.getElementById(id)))
            .join(' ');
        if (groupLabel) {
          label = groupLabel.trim();
          info.bindingStable = true;
        }
      }
      nodes.forEach((n) => consumed.add(n));
      const { section, group } = sectionOf(el, adapter.sectionSelectors);
      let index = 0;
      if (section && group) {
        if (!groups[section].includes(group)) groups[section].push(group);
        index = groups[section].indexOf(group);
      }
      if (el instanceof HTMLSelectElement && el.multiple) kind = 'select';
      const options =
        el instanceof HTMLSelectElement
          ? Array.from(el.options, (o) => ({ label: o.text, value: o.value }))
          : ['radio', 'checkbox'].includes(kind)
            ? nodes.map((n) => ({ label: labelOf(n), value: (n as HTMLInputElement).value }))
            : [];
      const form = el.closest('form');
      const formContext = form
        ? [form.id, form.getAttribute('name'), form.getAttribute('aria-label')]
            .filter(Boolean)
            .join(':')
        : '';
      const base = `${new URL(url).pathname}:${formContext}:${section || 'personal'}:${index}:${kind}:${normalize(label)}:${el.getAttribute('name') || ''}`;
      const occurrence = signatures.get(base) || 0;
      signatures.set(base, occurrence + 1);
      const field: Field = {
        id: `f${this.refs.size}`,
        signature: `${base}:${occurrence}`,
        label: label.slice(0, 200),
        context: info.context,
        bindingStable: info.bindingStable,
        kind,
        value: '',
        options,
        autocomplete: el.getAttribute('autocomplete')?.split(' ').pop() || '',
        section,
        index,
        blocked:
          sensitive.test(
            [label, ...info.context, el.getAttribute('name'), el.getAttribute('autocomplete')]
              .filter(Boolean)
              .join(' '),
          ) ||
          (kind === 'checkbox' && nodes.length === 1),
      };
      const ref = { nodes, field };
      field.value = current(ref);
      // Empty multi-select is empty, not a populated value.
      if (field.value === '[]') field.value = '';
      this.refs.set(field.id, ref);
    }
    const fields = Array.from(this.refs.values(), (r) => r.field);
    const inferred = new Map<string, Field[]>();
    for (const field of fields) {
      const { path } = matchField(field, { origin: new URL(url).origin, facts: [], mappings: [] });
      if (/^(education|experience|projects)\./.test(path))
        inferred.set(path, [...(inferred.get(path) || []), field]);
    }
    for (const duplicates of inferred.values()) {
      if (duplicates.length > 1)
        duplicates.forEach((field) => {
          field.reviewReason = '重复经历归属不明确，请手动绑定对应条目';
        });
    }
    return { token: this.token, url, origin: new URL(url).origin, adapter: adapter.name, fields };
  }
  locate(token: string, id: string): { id: string } {
    if (this.busy) throw new Error('正在填写，请稍后定位');
    if (token !== this.token) throw new Error('页面已变化，请重新识别');
    const ref = this.refs.get(id);
    if (!ref || ref.nodes.some((node) => !node.isConnected || !visible(node)))
      throw new Error('字段已变化或不可见，请重新识别');
    ref.nodes[0]!.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
    for (const node of ref.nodes) {
      node.animate(
        [
          { outline: '3px solid #dd8a22', outlineOffset: '4px' },
          { outline: '3px solid #dd8a22', outlineOffset: '4px', offset: 0.85 },
          { outline: '3px solid transparent', outlineOffset: '4px' },
        ],
        { duration: 2600 },
      );
    }
    return { id };
  }
  async fill(token: string, items: PlanItem[], verifyLayout = false): Promise<FillResult[]> {
    if (this.busy) throw new Error('正在填写');
    if (token !== this.token) throw new Error('页面已变化，请重新识别');
    this.busy = true;
    const results: FillResult[] = [];
    const batch: Undo[] = [];
    try {
      for (const item of items.filter((i) => i.selected)) {
        if (verifyLayout) {
          try {
            this.validateLayoutTarget(token, item.id, item.evidence);
          } catch (error) {
            results.push({
              id: item.id,
              status: 'review',
              reason: error instanceof Error ? error.message : '字段已变化，请重新识别',
            });
            continue;
          }
        }
        const ref = this.refs.get(item.id);
        if (
          !ref ||
          ref.nodes.some(
            (n) =>
              !n.isConnected ||
              !visible(n) ||
              (n as HTMLInputElement).disabled ||
              (n as HTMLInputElement).readOnly,
          )
        ) {
          results.push({ id: item.id, status: 'review', reason: '字段已变化，请重新识别' });
          continue;
        }
        if (ref.field.blocked || !item.value) {
          results.push({ id: item.id, status: 'skipped', reason: '需在网页中手动确认' });
          continue;
        }
        const value = current(ref);
        if (value && value !== '[]') {
          results.push({ id: item.id, status: 'skipped', reason: '保留网页已有内容' });
          continue;
        }
        const before = ref.nodes.map(raw);
        try {
          await this.write(ref, item.value);
          if (ref.nodes.some((node) => !node.isConnected))
            throw new Error('填写后字段已重新渲染，请在网页中核对当前值');
          const after = ref.nodes.map(raw);
          if (JSON.stringify(before) === JSON.stringify(after))
            throw new Error('网页没有接受填写值');
          batch.push({ ref, before, after });
          results.push({
            id: item.id,
            status: 'filled',
            reason:
              ref.field.kind === 'combobox'
                ? '已填写并回读；自定义下拉撤销需手动恢复'
                : '已填写并回读，请核对',
          });
        } catch (error) {
          const after = ref.nodes.map(raw);
          if (JSON.stringify(before) !== JSON.stringify(after)) batch.push({ ref, before, after });
          results.push({
            id: item.id,
            status: 'failed',
            reason: error instanceof Error ? error.message : '填写失败',
          });
        } finally {
          // Preserve our own write for later checks; validate each remaining
          // target independently so one changed widget does not stop the batch.
          if (verifyLayout) this.layoutState?.values.set(item.id, ref.nodes.map(raw));
        }
      }
      // Preserve prior undo when a second click did not change anything.
      if (batch.length) this.history = batch;
      return results;
    } finally {
      this.busy = false;
    }
  }
  private async write(ref: Ref, input: string) {
    const el = ref.nodes[0]!;
    if (ref.field.kind === 'combobox') {
      el.click();
      await tick(100);
      const popupId = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
      const popup = popupId ? document.getElementById(popupId) : null;
      if (!popup) throw new Error('无法确认下拉菜单范围，请手动选择');
      const options = Array.from(popup.querySelectorAll<HTMLElement>('[role="option"]')).filter(
        (o) => visible(o) && equivalent(o.textContent || '', input),
      );
      if (options.length !== 1) throw new Error('下拉选项不唯一或未找到');
      options[0]!.click();
      await tick(100);
      if (!equivalent(raw(el), input)) throw new Error('自定义下拉需人工核对');
    } else if (el instanceof HTMLSelectElement) {
      const wanted = el.multiple
        ? input
            .split(/[,，、;；]/)
            .map((s) => s.trim())
            .filter(Boolean)
        : [input];
      const values = wanted.map((v) => {
        const matches = Array.from(el.options).filter(
          (o) => !o.disabled && (equivalent(o.text, v) || equivalent(o.value, v)),
        );
        if (matches.length !== 1) throw new Error('没有唯一匹配的下拉选项');
        return matches[0]!.value;
      });
      setRaw(el, el.multiple ? JSON.stringify(values) : values[0]!);
      await tick();
      const actual = Array.from(el.selectedOptions, (o) => o.value);
      if (JSON.stringify([...actual].sort()) !== JSON.stringify([...values].sort()))
        throw new Error('网页未保留下拉选项');
    } else if (['radio', 'checkbox'].includes(ref.field.kind)) {
      const wanted =
        ref.field.kind === 'checkbox' ? input.split(/[,，、;；]/).map((s) => s.trim()) : [input];
      const chosen = wanted.map((v) => {
        const hits = ref.nodes.filter(
          (n) => equivalent(labelOf(n), v) || equivalent((n as HTMLInputElement).value, v),
        );
        if (hits.length !== 1) throw new Error('没有唯一匹配的选项');
        return hits[0]!;
      });
      chosen.forEach((n) => {
        if (!(n as HTMLInputElement).checked) n.click();
      });
      await tick();
      if (chosen.some((n) => !(n as HTMLInputElement).checked)) throw new Error('网页未保留选择');
    } else {
      let value = input;
      if (ref.field.kind === 'month') value = input.slice(0, 7);
      if (ref.field.kind === 'date' && /^\d{4}-\d{2}$/.test(value))
        throw new Error('日期缺少具体日，请在网页中补充');
      if (el instanceof HTMLInputElement && el.maxLength > 0 && value.length > el.maxLength)
        throw new Error('内容超过字段长度限制');
      setRaw(el, value);
      await tick();
      if (raw(el) !== value) throw new Error('网页未保留完整填写值');
      if (
        (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) &&
        !el.checkValidity()
      )
        throw new Error('已填写，但网页校验未通过');
    }
  }
  async undo(): Promise<FillResult[]> {
    if (this.busy) throw new Error('正在填写');
    this.busy = true;
    const results: FillResult[] = [];
    try {
      for (const h of [...this.history].reverse()) {
        if (
          h.ref.nodes.some((n) => !n.isConnected) ||
          JSON.stringify(h.ref.nodes.map(raw)) !== JSON.stringify(h.after)
        ) {
          results.push({
            id: h.ref.field.id,
            status: 'skipped',
            reason: '保留用户后续修改或已变化的字段',
          });
          continue;
        }
        try {
          if (h.ref.field.kind === 'combobox') throw new Error('自定义下拉需手动恢复');
          h.ref.nodes.forEach((n, i) => setRaw(n, h.before[i]!));
          await tick();
          if (JSON.stringify(h.ref.nodes.map(raw)) !== JSON.stringify(h.before))
            throw new Error('网页未接受恢复值');
          results.push({ id: h.ref.field.id, status: 'filled', reason: '已恢复填写前的值' });
        } catch {
          results.push({
            id: h.ref.field.id,
            status: 'review',
            reason: '请在网页中手动恢复此控件',
          });
        }
      }
      this.history = [];
      return results;
    } finally {
      this.busy = false;
    }
  }
}
