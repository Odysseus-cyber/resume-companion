// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  prepareLayoutRequest,
  requestLayoutMappings,
  resolveLayoutPlan,
  type LayoutMapping,
} from '../../src/ai/layout';
import { demoProfile, emptyEntry, facts } from '../../src/domain/model';
import { findEquivalentFacts } from '../../src/domain/field-semantics';
import type { LayoutScan } from '../../src/engine/types';
const config = { endpoint: 'https://api.example.com/v1', model: 'layout-model' };
const rect = { x: 0, y: 0, width: 100, height: 30 };
function scan(): LayoutScan {
  return {
    token: 'private-token',
    url: 'https://example.com/form?user=private-user',
    origin: 'https://example.com',
    adapter: 'fixture',
    fields: [0, 1].map((i) => ({
      id: `f${i}`,
      signature: `private-signature-${i}`,
      label: '',
      kind: 'text',
      value: '',
      options: [],
      autocomplete: '',
      index: 0,
      blocked: false,
    })),
    layout: {
      containers: [{ id: 'c0', parentId: null, order: 0, rect }],
      texts: [
        { id: 't0', parentId: 'c0', order: 1, rect, text: '姓名' },
        { id: 't1', parentId: 'c0', order: 2, rect: { ...rect, y: 50 }, text: '邮箱' },
      ],
      controls: [0, 1].map((i) => ({
        id: `f${i}`,
        parentId: 'c0',
        order: i + 3,
        rect: { ...rect, x: 120, y: i * 50 },
        kind: 'text',
        writable: true,
        occupied: false,
      })),
      limitations: ['仅处理已展开的顶层表单'],
    },
  };
}
const matched = (id = 'f0', key = 'personal.name'): LayoutMapping => ({
  id,
  label: '姓名',
  key,
  status: 'matched',
  evidence: ['t0'],
});
function mockResponse(result: unknown) {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] })),
    );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
afterEach(() => vi.unstubAllGlobals());
describe('layout-driven value-free AI', () => {
  it('sends geometry and separate texts even when every control has no extracted label', () => {
    const { payload } = prepareLayoutRequest(scan(), facts(demoProfile()));
    expect(payload.layout.controls).toHaveLength(2);
    expect(payload.layout.texts.map((t) => t.text)).toEqual(['姓名', '邮箱']);
    expect(payload.layout.controls[0]).not.toHaveProperty('label');
    expect(payload.keys.find((k) => k.key === 'education.0.organization')?.label).toContain(
      '学校名称',
    );
    expect(payload.keys.find((k) => k.key === 'experience.0.organization')?.label).toContain(
      '公司',
    );
    expect(payload.keys.find((k) => k.key === 'projects.0.organization')?.label).toContain(
      '项目名称',
    );
  });
  it('redacts known local values and copied current page values including custom ids before sending', async () => {
    const page = scan(),
      profile = demoProfile();
    profile.custom.push({ id: 'private-custom-id', label: '推荐人 林知夏', value: '保密推荐人' });
    page.fields[1]!.value = '页面秘密';
    page.layout.texts[0]!.text =
      '姓名 林知夏 示范其他地址 other@example.com https://example.org/?key=secret 13812345678 页面秘密 private-custom-id 示例大学 保密推荐人';
    const { payload, catalog } = prepareLayoutRequest(page, facts(profile));
    const fetch = mockResponse([matched()]);
    await requestLayoutMappings(config, 'private-api-key', payload);
    const req = fetch.mock.calls[0]![1] as RequestInit;
    for (const secret of [
      '林知夏',
      'other@example.com',
      '13812345678',
      '页面秘密',
      'private-custom-id',
      '示例大学',
      '保密推荐人',
      'private-token',
      'private-user',
      'private-signature',
      'private-api-key',
      'key=secret',
    ])
      expect(req.body).not.toContain(secret);
    expect(req.body).not.toContain('"value"');
    expect(req.credentials).toBe('omit');
    expect(req.redirect).toBe('error');
    expect(catalog.get('custom.slot0')?.path).toBe('custom.private-custom-id');
    expect(catalog.get('personal.name')?.value).toBe('林知夏');
  });
  it('does not serialize selected options or extra attributes accidentally present on nodes', () => {
    const page = scan();
    Object.assign(page.layout.controls[0]!, {
      value: 'secret',
      selectedLabel: 'secret option',
      html: '<input>',
      url: 'private',
    });
    Object.assign(page.layout.texts[0]!, { value: 'secret' });
    expect(JSON.stringify(prepareLayoutRequest(page, []).payload)).not.toContain('secret');
  });
  it('returns identical payloads for identical layouts and schema with different values', () => {
    const a = demoProfile(),
      b = structuredClone(a);
    b.personal.name = '另一人';
    b.education[0]!.organization = '另一学校';
    expect(prepareLayoutRequest(scan(), facts(a)).payload).toEqual(
      prepareLayoutRequest(scan(), facts(b)).payload,
    );
  });
  it('rejects oversized control lists without silently truncating', () => {
    const page = scan();
    page.layout.controls = Array.from({ length: 501 }, (_, i) => ({
      ...page.layout.controls[0]!,
      id: `f${i}`,
    }));
    expect(() => prepareLayoutRequest(page, [])).toThrow('500');
  });
  it('counts UTF-8 bytes of the complete model/messages envelope before fetching', async () => {
    const { payload } = prepareLayoutRequest(scan(), facts(demoProfile()));
    payload.layout.texts[0]!.text = '汉'.repeat(67000);
    const fetch = mockResponse([]);
    await expect(
      requestLayoutMappings({ ...config, model: 'm'.repeat(5000) }, 'key', payload),
    ).rejects.toThrow('200 KB');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects extra value/selector/script fields even with a valid match', async () => {
    const { payload } = prepareLayoutRequest(scan(), facts(demoProfile()));
    mockResponse([{ ...matched(), script: 'alert(1)', value: 'invented' }]);
    await expect(requestLayoutMappings(config, 'key', payload)).rejects.toThrow();
  });
  it.each([
    { response: [matched(), matched()], reason: '重复' },
    {
      response: [matched('f0', 'personal.name'), matched('f1', 'personal.name')],
      reason: '多个控件',
    },
    { response: [{ ...matched(), key: 'personal.invented' }], reason: '未知资料' },
    { response: [{ ...matched(), evidence: ['invented'] }], reason: '未知页面文字' },
    { response: [{ ...matched(), evidence: [] }], reason: '依据' },
  ])('downgrades unsafe matches: $reason', async ({ response, reason }) => {
    const { payload, catalog } = prepareLayoutRequest(scan(), facts(demoProfile()));
    mockResponse(response);
    const mappings = await requestLayoutMappings(config, 'key', payload);
    expect(mappings.every((m) => m.status === 'uncertain' && m.label === '')).toBe(true);
    expect(mappings[0]?.reason).toContain(reason);
    expect(resolveLayoutPlan(scan(), mappings, catalog).plan).toHaveLength(0);
  });
  it('filters unknown control ids and rejects unknown status', async () => {
    const { payload } = prepareLayoutRequest(scan(), facts(demoProfile()));
    mockResponse([matched('invented')]);
    expect(await requestLayoutMappings(config, 'key', payload)).toEqual(
      ['f0', 'f1'].map((id) => ({
        id,
        label: '',
        key: null,
        status: 'uncertain',
        evidence: [],
        reason: '模型未返回此字段',
      })),
    );
    mockResponse([{ ...matched(), status: 'execute' }]);
    await expect(requestLayoutMappings(config, 'key', payload)).rejects.toThrow();
  });
  it('locally resolves only clear matches to actual values', () => {
    const page = scan(),
      { catalog } = prepareLayoutRequest(page, facts(demoProfile()));
    const result = resolveLayoutPlan(page, [matched()], catalog);
    expect(result.plan).toMatchObject([
      { id: 'f0', path: 'personal.name', value: '林知夏', selected: true },
    ]);
    expect(result.results).toMatchObject([{ id: 'f1', status: 'review' }]);
  });
  it('skips occupied, unsupported, missing and incompatible controls', () => {
    const page = scan(),
      { catalog } = prepareLayoutRequest(page, facts(demoProfile()));
    page.layout.controls[0]!.occupied = true;
    expect(resolveLayoutPlan(page, [matched()], catalog).results[0]?.reason).toContain('已有内容');
    page.layout.controls[0]!.occupied = false;
    page.layout.controls[0]!.kind = 'unsupported';
    expect(resolveLayoutPlan(page, [matched()], catalog).results[0]?.reason).toContain('不支持');
    page.layout.controls[0]!.kind = 'date';
    expect(resolveLayoutPlan(page, [matched()], catalog).results[0]?.reason).toContain('不兼容');
    page.layout.controls[0]!.kind = 'text';
    catalog.get('personal.name')!.value = '';
    expect(resolveLayoutPlan(page, [matched()], catalog).results[0]?.reason).toBe('缺少资料');
  });

  it('includes empty new personal keys with explicit meanings and never sends their values', async () => {
    const profile = demoProfile();
    Object.assign(profile.personal, {
      highestEducation: '学历秘密甲',
      studyMode: '形式秘密乙',
      householdLocation: '户籍秘密丙',
      ethnicity: '民族秘密丁',
    });
    const page = scan();
    page.layout.texts[1]!.text += ' 学历秘密甲 形式秘密乙 户籍秘密丙 民族秘密丁';
    const prepared = prepareLayoutRequest(page, facts(profile));
    for (const key of ['highestEducation', 'studyMode', 'householdLocation', 'ethnicity'])
      expect(prepared.payload.keys.some((entry) => entry.key === `personal.${key}`)).toBe(true);
    const fetch = mockResponse([matched()]);
    await requestLayoutMappings(config, 'key', prepared.payload);
    for (const secret of ['学历秘密甲', '形式秘密乙', '户籍秘密丙', '民族秘密丁'])
      expect(fetch.mock.calls[0]![1].body).not.toContain(secret);
    Object.assign(profile.personal, {
      highestEducation: '',
      studyMode: '',
      householdLocation: '',
      ethnicity: '',
    });
    expect(prepareLayoutRequest(scan(), facts(profile)).payload.keys).toEqual(
      prepared.payload.keys,
    );
    const prompt = JSON.parse(fetch.mock.calls[0]![1].body).messages[0].content;
    expect(prompt).toContain('EVERY supplied control');
    expect(prompt).toContain('personal.highestEducation');
    expect(prompt).toContain('personal.studyMode');
    expect(prompt).toContain('not a complete street address');
  });
  it('preserves evidence-supported names independently of key availability, data and operability', async () => {
    const page = scan();
    const { catalog, payload } = prepareLayoutRequest(page, facts(demoProfile()));
    mockResponse([{ ...matched(), label: '最高学历', key: null, status: 'unmatched' }]);
    const response = await requestLayoutMappings(config, 'key', payload);
    expect(response[0]).toMatchObject({ label: '最高学历', key: null, status: 'unmatched' });
    expect(response[1]?.reason).toBe('模型未返回此字段');
    expect(resolveLayoutPlan(page, response, catalog).results[1]?.reason).toBe('模型未返回此字段');
    catalog.get('personal.name')!.value = '';
    let resolved = resolveLayoutPlan(page, [matched()], catalog);
    expect(resolved.mappings[0]?.label).toBe('姓名');
    expect(resolved.results[0]?.reason).toBe('缺少资料');
    page.layout.controls[0]!.writable = false;
    resolved = resolveLayoutPlan(page, [matched()], catalog);
    expect(resolved.mappings[0]?.label).toBe('姓名');
    expect(resolved.results[0]?.reason).toContain('不支持');
    page.layout.controls[0]!.writable = true;
    page.layout.controls[0]!.occupied = true;
    resolved = resolveLayoutPlan(page, [matched()], catalog);
    expect(resolved.mappings[0]?.label).toBe('姓名');
    expect(resolved.results[0]?.reason).toContain('已有内容');
  });
  it.each([
    { ...matched(), key: null, status: 'unmatched' as const, evidence: [] },
    { ...matched(), key: null, status: 'unmatched' as const, evidence: ['invalid'] },
    { ...matched(), label: '   ' },
  ])('does not expose a confirmed name without valid evidence', async (mapping) => {
    const { payload, catalog } = prepareLayoutRequest(scan(), facts(demoProfile()));
    mockResponse([mapping]);
    const response = await requestLayoutMappings(config, 'key', payload);
    expect(response[0]?.label).toBe('');
    expect(resolveLayoutPlan(scan(), response, catalog).plan).toHaveLength(0);
  });
  it('does not treat redacted-only text as evidence', async () => {
    const page = scan();
    page.layout.texts[0]!.text = '林知夏';
    const { payload, catalog } = prepareLayoutRequest(page, facts(demoProfile()));
    mockResponse([matched()]);
    const response = await requestLayoutMappings(config, 'key', payload);
    expect(response[0]?.label).toBe('');
    expect(resolveLayoutPlan(page, [matched()], catalog).plan).toHaveLength(0);
  });
  it('requires review when a standard and custom field have the same meaning', async () => {
    const profile = demoProfile();
    profile.custom.push({ id: 'duplicate-name', label: '姓名', value: '自定义姓名秘密' });
    const { payload, catalog } = prepareLayoutRequest(scan(), facts(profile));
    mockResponse([matched()]);
    const response = await requestLayoutMappings(config, 'key', payload);
    expect(response[0]).toMatchObject({
      label: '',
      status: 'uncertain',
      reason: '标准字段与自定义字段含义重复，需核对',
    });
    expect(resolveLayoutPlan(scan(), [matched()], catalog).plan).toHaveLength(0);
    expect(catalog.get('custom.slot0')?.value).toBe('自定义姓名秘密');
  });
  it('accepts date values only for compatible date keys', () => {
    const page = scan(),
      { catalog } = prepareLayoutRequest(page, facts(demoProfile()));
    page.layout.controls[0]!.kind = 'date';
    expect(
      resolveLayoutPlan(page, [matched('f0', 'personal.birthday')], catalog).plan[0]?.value,
    ).toBe('2003-05-12');
    catalog.get('personal.birthday')!.value = 'yesterday';
    expect(resolveLayoutPlan(page, [matched('f0', 'personal.birthday')], catalog).plan).toEqual([]);
  });
});

describe('semantic local key reuse', () => {
  const unmatched = (label: string, id = 'f0'): LayoutMapping => ({
    id,
    label,
    key: null,
    status: 'unmatched',
    evidence: ['t0'],
  });
  it.each([
    ['毕业院校', 'education.0.organization'],
    ['毕业时间', 'education.0.end'],
    ['入学时间', 'education.0.start'],
    ['手机号', 'personal.phone'],
    ['联系电话', 'personal.phone'],
    ['工作单位', 'experience.0.organization'],
  ])('reuses the unique semantic key for %s after validation', (label, path) => {
    const page = scan();
    page.layout.texts[0]!.text = label;
    const { catalog } = prepareLayoutRequest(page, facts(demoProfile()));
    const result = resolveLayoutPlan(page, [unmatched(label)], catalog);
    expect(result.mappings[0]).toMatchObject({ status: 'matched', key: path, label });
    expect(result.plan[0]).toMatchObject({ path, evidence: ['t0'] });
  });
  it('reuses custom aliases locally without exposing private IDs', () => {
    const profile = demoProfile();
    profile.custom.push({ id: 'internal-secret', label: '户籍所在地补充说明', value: '本地内容' });
    const { catalog } = prepareLayoutRequest(scan(), facts(profile));
    const result = resolveLayoutPlan(scan(), [unmatched('户籍所在地补充说明')], catalog);
    expect(result.mappings[0]?.key).toBe('custom.slot0');
    expect(result.plan[0]).toMatchObject({ path: 'custom.internal-secret', value: '本地内容' });
  });
  it('preserves ambiguity across repeated entries and honors explicit section/index context', () => {
    const profile = demoProfile();
    profile.education.push({ ...emptyEntry(), organization: '第二所虚构学校' });
    const local = facts(profile);
    expect(findEquivalentFacts('毕业院校', local).map((fact) => fact.path)).toEqual([
      'education.0.organization',
      'education.1.organization',
    ]);
    expect(findEquivalentFacts('教育经历 2 · 毕业院校', local).map((fact) => fact.path)).toEqual([
      'education.1.organization',
    ]);
    const { catalog } = prepareLayoutRequest(scan(), local);
    expect(resolveLayoutPlan(scan(), [unmatched('毕业院校')], catalog).plan).toEqual([]);
  });
  it('does not substitute related but distinct concepts', () => {
    const local = facts(demoProfile());
    expect(findEquivalentFacts('最高学历', local).map((fact) => fact.path)).toEqual([
      'personal.highestEducation',
    ]);
    expect(findEquivalentFacts('学历', local).map((fact) => fact.path)).toEqual([
      'education.0.degree',
    ]);
    expect(findEquivalentFacts('学历', local).map((fact) => fact.path)).not.toContain(
      'personal.highestEducation',
    );
    expect(findEquivalentFacts('现居住地详细地址', local)).toEqual([]);
    expect(findEquivalentFacts('籍贯', local)).toEqual([]);
    expect(findEquivalentFacts('学位', local)).toEqual([]);
  });
  it.each([
    { ...unmatched('手机号'), status: 'uncertain' as const },
    { ...unmatched('手机号'), evidence: ['invalid'] },
    { ...unmatched('手机号'), evidence: [] },
    { ...unmatched('手机号'), key: 'invented' },
  ])('never recovers uncertain or invalid responses', (mapping) => {
    const { catalog } = prepareLayoutRequest(scan(), facts(demoProfile()));
    expect(resolveLayoutPlan(scan(), [mapping], catalog).plan).toEqual([]);
  });
  it('rechecks collisions between recovered matches and model matches', () => {
    const { catalog } = prepareLayoutRequest(scan(), facts(demoProfile()));
    const result = resolveLayoutPlan(
      scan(),
      [unmatched('手机号'), matched('f1', 'personal.phone')],
      catalog,
    );
    expect(result.plan).toEqual([]);
    expect(result.mappings.every((mapping) => mapping.status === 'uncertain')).toBe(true);
  });
  it('does not reuse a standard key when a custom synonym has the same meaning', async () => {
    const profile = demoProfile();
    profile.custom.push({ id: 'alternate-phone', label: '联系电话', value: '另一号码' });
    const { catalog, payload } = prepareLayoutRequest(scan(), facts(profile));
    expect(findEquivalentFacts('手机号', facts(profile))).toHaveLength(2);
    expect(resolveLayoutPlan(scan(), [unmatched('手机号')], catalog).plan).toEqual([]);
    mockResponse([matched('f0', 'personal.phone')]);
    expect((await requestLayoutMappings(config, 'key', payload))[0]?.status).toBe('uncertain');
  });
});
