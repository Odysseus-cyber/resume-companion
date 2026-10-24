import { describe, expect, it } from 'vitest';
import { addMissingFields } from '../../src/domain/missing-fields';
import { emptyProfile, facts } from '../../src/domain/model';
import type { LayoutMapping } from '../../src/ai/layout';
import type { LayoutScan } from '../../src/engine/types';

const mapping = (id = 'f0', label = '政治面貌'): LayoutMapping => ({
  id,
  label,
  key: null,
  status: 'unmatched',
  evidence: ['t0'],
});
const scan: LayoutScan = {
  token: 'token',
  url: 'https://example.com',
  origin: 'https://example.com',
  adapter: 'test',
  fields: ['f0', 'f1'].map((id) => ({
    id,
    signature: id,
    label: '',
    kind: 'text',
    value: '',
    options: [],
    autocomplete: '',
    index: 0,
    blocked: false,
  })),
  layout: { controls: [], texts: [], containers: [], limitations: [] },
};
describe('missing local profile fields', () => {
  it('creates only a blank field without changing the source and reuses it on subsequent scans', () => {
    const original = emptyProfile();
    const added = addMissingFields(original, scan, [mapping()], new Map());
    expect(original.custom).toEqual([]);
    expect(added.profile.custom).toMatchObject([{ label: '政治面貌', value: '' }]);
    expect(added.supplements.f0?.path).toBe(`custom.${added.profile.custom[0]!.id}`);
    const again = addMissingFields(added.profile, scan, [mapping()], new Map());
    expect(again.profile.custom).toEqual(added.profile.custom);
    expect(again.supplements).toEqual(added.supplements);
  });
  it('does not create a duplicate when an existing standard or custom field is equivalent', () => {
    const profile = emptyProfile();
    profile.custom.push({ id: 'mobile', label: '联系电话', value: '' });
    expect(
      addMissingFields(profile, scan, [mapping('f0', '手机号')], new Map()).profile.custom,
    ).toHaveLength(1);
    expect(
      addMissingFields(profile, scan, [mapping('f0', '最高教育程度')], new Map()).profile.custom,
    ).toHaveLength(1);
  });
  it('does not create from invalid, uncertain, ungrounded or unknown controls', () => {
    for (const item of [
      { ...mapping(), reason: 'invalid' },
      { ...mapping(), status: 'uncertain' as const },
      { ...mapping(), evidence: [] },
      mapping('unknown'),
    ])
      expect(addMissingFields(emptyProfile(), scan, [item], new Map()).profile.custom).toHaveLength(
        0,
      );
  });
  it('does not merge repeated contexts or exceed custom field limits', () => {
    expect(
      addMissingFields(emptyProfile(), scan, [mapping(), mapping('f1')], new Map()).profile.custom,
    ).toHaveLength(0);
    const full = emptyProfile();
    full.custom = Array.from({ length: 100 }, (_, i) => ({
      id: `${i}`,
      label: `其他字段${i}`,
      value: '',
    }));
    expect(addMissingFields(full, scan, [mapping()], new Map()).notes.f0).toContain('最多 100');
  });
  it('exposes an empty matched custom value for local entry, not a nonempty one', () => {
    const profile = emptyProfile();
    profile.custom.push({ id: 'politics', label: '政治面貌', value: '' });
    const catalog = new Map([['custom.slot0', facts(profile).at(-1)!]]);
    const matched = { ...mapping(), key: 'custom.slot0', status: 'matched' as const };
    expect(addMissingFields(profile, scan, [matched], catalog).supplements.f0).toBeDefined();
    catalog.get('custom.slot0')!.value = '用户填写';
    expect(addMissingFields(profile, scan, [matched], catalog).supplements.f0).toBeUndefined();
  });
});
