import { facts, type Fact, type Profile } from './model';
import { findEquivalentFacts } from './field-semantics';
import type { LayoutMapping } from '../ai/layout';
import type { LayoutScan } from '../engine/types';

export interface Supplement {
  path: string;
  label: string;
  evidence: string[];
}

/** Creates only blank local fields; never invents a resume value or stores a site mapping. */
export function addMissingFields(
  original: Profile,
  scan: LayoutScan,
  mappings: LayoutMapping[],
  catalog: Map<string, Fact>,
) {
  const profile = { ...original, custom: [...original.custom] };
  const supplements: Record<string, Supplement> = {};
  const notes: Record<string, string> = {};
  const normalized = (label: string) => label.normalize('NFKC').replace(/\s/g, '').toLowerCase();
  for (const mapping of mappings) {
    const field = scan.fields.find((f) => f.id === mapping.id);
    if (!field || !mapping.label || mapping.reason || !mapping.evidence.length) continue;
    // Do not create profile entries for passwords, attachments or consent controls.
    if (/敏感|确认字段|此控件需/.test(field.supportReason || '')) continue;
    let fact = mapping.status === 'matched' && mapping.key ? catalog.get(mapping.key) : undefined;
    if (mapping.status === 'unmatched' && mapping.key === null) {
      if (
        mappings.filter((other) => normalized(other.label) === normalized(mapping.label)).length > 1
      ) {
        notes[mapping.id] = '同名字段出现多次，需要区分所属经历或区域后再添加';
        continue;
      }
      const equivalents = findEquivalentFacts(mapping.label, facts(profile));
      if (equivalents.length > 1) {
        notes[mapping.id] = '存在多个语义相近的资料字段，请核对后绑定';
        continue;
      }
      fact = equivalents[0];
      if (!fact) {
        if (profile.custom.length >= 100 || mapping.label.length > 100) {
          notes[mapping.id] = '无法自动添加：自定义字段最多 100 项，名称最长 100 字';
          continue;
        }
        const created = { id: crypto.randomUUID(), label: mapping.label, value: '' };
        profile.custom.push(created);
        fact = { path: `custom.${created.id}`, label: created.label, value: '' };
        notes[mapping.id] = '已新增空资料字段，请输入一次并保存';
      }
    }
    if (fact?.path.startsWith('custom.') && !fact.value.trim()) {
      supplements[mapping.id] = { path: fact.path, label: fact.label, evidence: mapping.evidence };
      notes[mapping.id] ||= '对应资料为空，可在下方输入一次并保存';
    }
  }
  return { profile, supplements, notes };
}
