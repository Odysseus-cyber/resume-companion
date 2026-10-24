// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { endpointUrl, mappingPayload, suggestMappings } from '../../src/ai/client';
import { demoProfile, facts } from '../../src/domain/model';
import type { Field } from '../../src/engine/types';
const config = { endpoint: 'https://api.example.com/v1', model: 'example-model' };
const fields: Field[] = [
  {
    id: 'f0',
    signature: 's0',
    label: '姓名',
    kind: 'text',
    value: '',
    options: [],
    autocomplete: '',
    index: 0,
    blocked: false,
  },
];
const payload = () =>
  mappingPayload(fields, [{ path: 'personal.name', label: '姓名', value: '林知夏' }]);
function mockResponse(content: unknown) {
  return vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }),
        { status: 200 },
      ),
    );
}
afterEach(() => {
  vi.unstubAllGlobals();
});
describe('optional AI boundaries', () => {
  it('appends the compatible chat endpoint', () => {
    expect(endpointUrl(config.endpoint).href).toBe('https://api.example.com/v1/chat/completions');
  });
  it.each([
    'http://api.example.com',
    'https://key@api.example.com',
    'https://api.example.com?key=secret',
    'https://api.example.com#secret',
  ])('rejects unsafe endpoint %s', (endpoint) => {
    expect(() => endpointUrl(endpoint)).toThrow();
  });
  it('excludes sensitive and already populated controls from payload', () => {
    expect(
      mappingPayload(
        [
          ...fields,
          { ...fields[0]!, id: 'blocked', blocked: true },
          { ...fields[0]!, id: 'filled', value: 'existing' },
        ],
        [],
      ).fields.map((f) => f.id),
    ).toEqual(['f0']);
  });
  it('rejects missing credentials before any network request', async () => {
    const fetch = mockResponse([]);
    vi.stubGlobal('fetch', fetch);
    await expect(suggestMappings(config, '', payload())).rejects.toThrow('API Key');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('sends a value-free catalog with credentials omitted and redirects rejected', async () => {
    const fetch = mockResponse([{ id: 'f0', slot: 's0' }]);
    vi.stubGlobal('fetch', fetch);
    expect(await suggestMappings(config, 'fictional-key', payload())).toEqual([
      { id: 'f0', slot: 's0' },
    ]);
    const request = fetch.mock.calls[0]![1] as RequestInit;
    expect(request.credentials).toBe('omit');
    expect(request.redirect).toBe('error');
    const body = JSON.parse(request.body as string);
    expect(JSON.parse(body.messages[1].content)).toEqual(payload());
    expect(request.body).not.toContain('fictional-key');
    expect(request.body).not.toContain('林知夏');
    expect(request.body).not.toContain('personal.name');
    expect(payload().slots).toEqual([{ id: 's0', label: '姓名' }]);
  });
  it('filters unknown IDs, paths and duplicate suggestions', async () => {
    vi.stubGlobal(
      'fetch',
      mockResponse([
        { id: 'unknown', slot: 's0' },
        { id: 'f0', slot: 'invented' },
        { id: 'f0', slot: 's0' },
        { id: 'f0', slot: 's0' },
      ]),
    );
    expect(await suggestMappings(config, 'fictional-key', payload())).toEqual([
      { id: 'f0', slot: 's0' },
    ]);
  });
  it('rejects executable text instead of evaluating it', async () => {
    vi.stubGlobal('fetch', mockResponse('alert(document.cookie)'));
    await expect(suggestMappings(config, 'fictional-key', payload())).rejects.toThrow();
  });
  it('reports HTTP failures without including the key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 429 })));
    await expect(suggestMappings(config, 'fictional-key', payload())).rejects.toThrow('HTTP 429');
  });
  it('propagates aborted requests so local features can continue', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new DOMException('Timed out', 'TimeoutError')),
    );
    await expect(suggestMappings(config, 'fictional-key', payload())).rejects.toThrow('Timed out');
  });
  it('redacts local values embedded in labels and omits option values, signatures and custom IDs', () => {
    const profile = demoProfile();
    profile.custom.push({ id: 'private-custom-id', label: '推荐人 林知夏', value: '保密推荐人' });
    const local = facts(profile);
    const result = mappingPayload(
      [
        {
          ...fields[0]!,
          label: '姓名 林知夏 zhixia@example.com 13800000000',
          signature: 'private-signature',
          context: ['获奖经历 林知夏', '网页中已填写的秘密', 'other@example.com'],
          options: [{ label: '私密选项', value: 'private-option' }],
        },
        { ...fields[0]!, id: 'f1', value: '网页中已填写的秘密' },
        { ...fields[0]!, id: 'f2', label: '联系人 网页中已填写的秘密 other@example.com' },
      ],
      local,
    );
    const encoded = JSON.stringify(result);
    for (const secret of [
      '林知夏',
      'zhixia@example.com',
      '13800000000',
      'private-custom-id',
      'private-signature',
      'private-option',
      '私密选项',
      '网页中已填写的秘密',
      'other@example.com',
      '保密推荐人',
      '示例大学',
      '示例科技',
    ])
      expect(encoded).not.toContain(secret);
    expect(result.fields.map((f) => f.id)).toEqual(['f0', 'f2']);
    expect(result.fields[0]!.context[0]).toContain('获奖经历');
    expect(encoded).not.toContain('"value"');
  });
  it('transmits the same request for different values with identical schema and empty controls', () => {
    const a = demoProfile();
    const b = structuredClone(a);
    b.personal.name = '另一位同学';
    b.personal.phone = '13999999999';
    b.education[0]!.organization = '另一所大学';
    expect(mappingPayload(fields, facts(a))).toEqual(mappingPayload(fields, facts(b)));
  });
  it('rejects model-supplied scripts, selectors and values even alongside a valid location', async () => {
    vi.stubGlobal(
      'fetch',
      mockResponse([{ id: 'f0', slot: 's0', value: 'invented', script: 'alert(1)' }]),
    );
    await expect(suggestMappings(config, 'fictional-key', payload())).rejects.toThrow();
  });
});
