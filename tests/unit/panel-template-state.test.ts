import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Panel } from '../../src/ui/Panel';
import { defaultDatabase, type Database } from '../../src/domain/model';
import type { LayoutScan } from '../../src/engine/types';
import { resolveTemplates } from '../../src/engine/templates';
import { requestLayoutMappings } from '../../src/ai/layout';

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  send: vi.fn(),
  changed: new Set<() => void>(),
}));
vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      onChanged: {
        addListener: (fn: () => void) => mocks.changed.add(fn),
        removeListener: (fn: () => void) => mocks.changed.delete(fn),
      },
    },
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 1, url: 'https://fictional.zhiye.com/form' }]),
      get: vi.fn().mockResolvedValue({ id: 1, url: 'https://fictional.zhiye.com/form' }),
      sendMessage: mocks.send,
      onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
      onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    scripting: { executeScript: vi.fn().mockResolvedValue([]) },
    permissions: { request: vi.fn().mockResolvedValue(true) },
    runtime: { openOptionsPage: vi.fn() },
  },
}));
vi.mock('../../src/domain/storage', () => ({
  loadDatabase: mocks.load,
  saveDatabase: mocks.save,
  readSessionKey: vi.fn().mockResolvedValue('fictional-key'),
  updateTemplates: vi.fn(),
}));
vi.mock('../../src/engine/templates', async (original) => ({
  ...(await original<typeof import('../../src/engine/templates')>()),
  resolveTemplates: vi.fn(),
}));
vi.mock('../../src/ai/layout', async (original) => ({
  ...(await original<typeof import('../../src/ai/layout')>()),
  requestLayoutMappings: vi.fn(),
}));

let root: Root;
let host: HTMLDivElement;
let db: Database;
let scan: LayoutScan;

function button(name: string) {
  const element = [...host.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === name,
  );
  if (!element) throw new Error(`Missing ${name}`);
  return element;
}
async function click(name: string) {
  await act(async () => button(name).click());
}
const fills = () => mocks.send.mock.calls.filter(([, message]) => /^FILL_/.test(message.type));
async function refresh() {
  await act(async () => {
    for (const listener of mocks.changed) listener();
  });
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  db = defaultDatabase();
  db.profiles[0]!.personal.name = '虚构申请人';
  db.profiles[0]!.personal.city = '虚构城市';
  db.settings = { aiEnabled: false, endpoint: 'https://fixture.invalid/v1', model: 'fixture' };
  db.templates = [
    {
      version: 1,
      id: 'saved',
      name: '虚构模板',
      adapter: 'beisen',
      origin: 'https://fictional.zhiye.com',
      enabled: true,
      createdAt: '2026-10-24T00:00:00.000Z',
      updatedAt: '2026-10-24T00:00:00.000Z',
      fields: [
        {
          id: 'name',
          label: '姓名',
          path: 'personal.name',
          index: 0,
          anchors: ['姓名'],
          kind: 'text',
          confirmed: true,
        },
      ],
    },
  ];
  const rect = { x: 150, y: 30, width: 200, height: 30 };
  scan = {
    token: 'snapshot',
    url: 'https://fictional.zhiye.com/form',
    origin: 'https://fictional.zhiye.com',
    adapter: 'beisen',
    fields: ['姓名', '现居住地'].map((label, index) => ({
      id: `f${index}`,
      signature: `sig${index}`,
      label,
      kind: 'text',
      value: '',
      options: [],
      autocomplete: '',
      index: 0,
      blocked: false,
    })),
    layout: {
      containers: [{ id: 'c0', parentId: null, order: 0, rect }],
      texts: ['姓名', '现居住地'].map((text, index) => ({
        id: `t${index}`,
        text,
        parentId: 'c0',
        order: index * 2,
        rect: { ...rect, x: 0, y: 30 + index * 60 },
      })),
      controls: [0, 1].map((index) => ({
        id: `f${index}`,
        parentId: 'c0',
        order: index * 2 + 1,
        rect: { ...rect, y: 30 + index * 60 },
        kind: 'text',
        writable: true,
        occupied: false,
      })),
      limitations: [],
    },
  };
  mocks.load.mockImplementation(async () => structuredClone(db));
  mocks.send.mockImplementation(async (_id, message) => ({
    ok: true,
    data: message.type === 'SCAN_TEMPLATE' ? scan : [],
  }));
  vi.mocked(resolveTemplates).mockReturnValue({
    status: 'partial',
    templateId: 'saved',
    crossOrigin: false,
    plan: [
      {
        id: 'f0',
        path: 'personal.name',
        value: '虚构申请人',
        source: '已验证表单模板',
        confidence: 1,
        selected: true,
        evidence: ['t0'],
      },
    ],
    labels: { f0: '姓名' },
    details: { f0: '已复用模板' },
    unresolvedIds: ['f1'],
    reused: 1,
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(Panel)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('template operation snapshots in the side panel', () => {
  it.each(['template', 'mapping'] as const)(
    'rejects a local plan after another page changes a %s',
    async (kind) => {
      await click('识别并填写');
      if (kind === 'template') db.templates[0]!.enabled = false;
      else
        db.mappings.push({
          origin: scan.origin,
          signature: 'sig0',
          path: 'personal.city',
          label: '姓名',
        });
      await refresh();
      const fill = [...host.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('填写已选'),
      )!;
      await act(async () => fill.click());
      expect(fills()).toEqual([]);
      expect(host.textContent).toContain('变化');
    },
  );

  it.each(['template', 'mapping'] as const)(
    'discards an AI response after a %s changes during the request',
    async (kind) => {
      db.settings.aiEnabled = true;
      await refresh();
      let deliver!: (value: Awaited<ReturnType<typeof requestLayoutMappings>>) => void;
      vi.mocked(requestLayoutMappings).mockImplementation(
        () =>
          new Promise((resolve) => {
            deliver = resolve;
          }),
      );
      await click('识别并填写');
      await click('确认识别并填写');
      expect(requestLayoutMappings).toHaveBeenCalledTimes(1);
      if (kind === 'template') db.templates = [];
      else
        db.mappings.push({
          origin: scan.origin,
          signature: 'sig0',
          path: 'personal.city',
          label: '姓名',
        });
      await refresh();
      await act(async () =>
        deliver([
          {
            id: 'f1',
            label: '现居住地',
            key: 'personal.city',
            status: 'matched',
            evidence: ['t1'],
          },
        ]),
      );
      expect(fills()).toEqual([]);
      expect(host.textContent).toContain('过期');
    },
  );

  it('requires explicit cross-site approval before executing the local plan', async () => {
    vi.mocked(resolveTemplates).mockReturnValue({
      status: 'full',
      templateId: 'saved',
      crossOrigin: true,
      plan: [
        {
          id: 'f0',
          path: 'personal.name',
          value: '虚构申请人',
          source: '已验证表单模板',
          confidence: 1,
          selected: true,
          evidence: ['t0'],
        },
      ],
      labels: { f0: '姓名' },
      details: {},
      unresolvedIds: [],
      reused: 1,
    });
    await click('识别并填写');
    expect(fills()).toEqual([]);
    const fill = [...host.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('填写已选'),
    )!;
    await act(async () => fill.click());
    expect(fills()).toEqual([]);
    expect(host.textContent).toContain('请先核对并确认跨站点复用');
    await click('已核对，确认跨站点复用');
    await act(async () => fill.click());
    expect(fills()).toHaveLength(1);
  });
});
