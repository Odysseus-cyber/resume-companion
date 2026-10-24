import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  layoutPayloadSchema,
  prepareIncrementalRequest,
  requestLayoutMappings,
  resolveLayoutPlan,
  selectLayoutRegion,
} from '../../src/ai/layout';
import { demoProfile, facts } from '../../src/domain/model';
import { FormEngine } from '../../src/engine/dom';

const privateOutside = '页面其他区域已有的虚构秘密';
function fixture() {
  document.body.innerHTML = `
    <form>
      <section><h2>个人信息</h2>
        <div><label for="name">姓名</label><div><input id="name" value="${privateOutside}"></div></div>
      </section>
      <section><h2>联系方式</h2>
        <div><div><label for="mail">邮箱</label></div><div><input id="mail"></div>
          <p>已有资料摘要：${privateOutside}</p>
          <p>简历摘要：林知夏 示例大学 内部标识 private-custom-id</p>
        </div>
        <div><label for="phone">手机号码</label><div><input id="phone"></div></div>
      </section>
    </form>`;
  const scan = new FormEngine().scanTemplate();
  const profile = demoProfile();
  profile.custom = [
    { id: 'private-custom-id', label: '自定义问题 private-custom-id', value: '私有自定义答案' },
  ];
  return { scan, profile };
}
const config = { endpoint: 'https://api.example.com/v1', model: 'fixture-model' };
beforeEach(() => {
  document.body.innerHTML = '';
  history.replaceState({}, '', '/form?private-user=secret');
});
afterEach(() => vi.unstubAllGlobals());

describe('incremental layout requests', () => {
  it('contains only requested live controls while retaining labels and complete ancestor references', () => {
    const { scan, profile } = fixture();
    const { payload } = prepareIncrementalRequest(scan, facts(profile), ['f1', 'f1']);
    expect(layoutPayloadSchema.parse(payload)).toEqual(payload);
    expect(payload.layout.controls.map((control) => control.id)).toEqual(['f1']);
    expect(payload.layout.texts.some((text) => text.text === '邮箱')).toBe(true);
    expect(payload.layout.texts.some((text) => text.text === '姓名')).toBe(false);
    const containers = new Set(payload.layout.containers.map((container) => container.id));
    for (const node of [
      ...payload.layout.containers,
      ...payload.layout.controls,
      ...payload.layout.texts,
    ]) {
      if (node.parentId !== null) expect(containers.has(node.parentId)).toBe(true);
    }
    const originalText = new Set(scan.layout.texts.map((text) => text.id));
    expect(payload.layout.texts.every((text) => originalText.has(text.id))).toBe(true);
    expect(selectLayoutRegion(scan, ['f1']).fields.map((field) => field.id)).toEqual(['f1']);
  });

  it('redacts values outside the requested region before filtering and aliases custom IDs', () => {
    const { scan, profile } = fixture();
    // The sensitive string occurs in a static summary beside f1 but its source
    // value belongs to excluded f0. Filtering first would lose the redaction key.
    expect(
      selectLayoutRegion(scan, ['f1']).fields.some((field) => field.value === privateOutside),
    ).toBe(false);
    const prepared = prepareIncrementalRequest(scan, facts(profile), ['f1']);
    const body = JSON.stringify(prepared.payload);
    for (const secret of [
      privateOutside,
      profile.personal.name,
      profile.education[0]!.organization,
      'private-custom-id',
      '私有自定义答案',
      'private-user',
    ])
      expect(body).not.toContain(secret);
    expect(body).toContain('[已隐藏]');
    expect(prepared.payload.keys.some((key) => key.key === 'custom.slot0')).toBe(true);
    expect(prepared.catalog.get('custom.slot0')?.path).toBe('custom.private-custom-id');
    expect(prepared.catalog.get('custom.slot0')?.value).toBe('私有自定义答案');
  });

  it('keeps private data and the session key out of the actual outbound request body', async () => {
    const { scan, profile } = fixture();
    const { payload } = prepareIncrementalRequest(scan, facts(profile), ['f1']);
    const textId = payload.layout.texts.find((text) => text.text === '邮箱')!.id;
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify([
                  {
                    id: 'f1',
                    label: '邮箱',
                    key: 'personal.email',
                    status: 'matched',
                    evidence: [textId],
                  },
                ]),
              },
            },
          ],
        }),
      ),
    );
    vi.stubGlobal('fetch', fetch);
    await requestLayoutMappings(config, 'session-key-not-body', payload);
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = String(fetch.mock.calls[0]![1].body);
    for (const secret of [
      privateOutside,
      profile.personal.name,
      profile.personal.email,
      profile.personal.phone,
      profile.education[0]!.organization,
      'private-custom-id',
      '私有自定义答案',
      'session-key-not-body',
    ])
      expect(body).not.toContain(secret);
    const request = JSON.parse(body);
    expect(
      JSON.parse(request.messages[1].content).layout.controls.map(
        (control: { id: string }) => control.id,
      ),
    ).toEqual(['f1']);
  });

  it('resolves model output only for the selected controls using current local values', () => {
    const { scan, profile } = fixture();
    const { payload, catalog } = prepareIncrementalRequest(scan, facts(profile), ['f1']);
    const evidence = payload.layout.texts.find((text) => text.text === '邮箱')!.id;
    const result = resolveLayoutPlan(
      selectLayoutRegion(scan, ['f1']),
      [
        { id: 'f1', label: '邮箱', key: 'personal.email', status: 'matched', evidence: [evidence] },
        { id: 'f0', label: '姓名', key: 'personal.name', status: 'matched', evidence: [evidence] },
      ],
      catalog,
    );
    expect(result.plan).toHaveLength(1);
    expect(result.plan[0]).toMatchObject({
      id: 'f1',
      path: 'personal.email',
      value: profile.personal.email,
    });
    expect(result.mappings.map((mapping) => mapping.id)).toEqual(['f1']);
    expect(result.results).toEqual([]);
  });

  it('rejects text evidence from outside the selected context', async () => {
    const { scan, profile } = fixture();
    const { payload, catalog } = prepareIncrementalRequest(scan, facts(profile), ['f1']);
    const excludedText = scan.layout.texts.find((text) => text.text === '姓名')!.id;
    expect(payload.layout.texts.some((text) => text.id === excludedText)).toBe(false);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify([
                    {
                      id: 'f1',
                      label: '邮箱',
                      key: 'personal.email',
                      status: 'matched',
                      evidence: [excludedText],
                    },
                  ]),
                },
              },
            ],
          }),
        ),
      ),
    );
    const mappings = await requestLayoutMappings(config, 'fixture-key', payload);
    expect(mappings[0]).toMatchObject({ id: 'f1', status: 'uncertain', label: '' });
    expect(resolveLayoutPlan(selectLayoutRegion(scan, ['f1']), mappings, catalog).plan).toEqual([]);
  });

  it('does not invent targets for unknown IDs or change the original scan', () => {
    const { scan, profile } = fixture();
    const before = structuredClone(scan);
    const { payload } = prepareIncrementalRequest(scan, facts(profile), ['f999']);
    expect(payload.layout.controls).toEqual([]);
    expect(payload.layout.texts).toEqual([]);
    expect(payload.layout.containers).toEqual([]);
    expect(scan).toEqual(before);
  });
});
