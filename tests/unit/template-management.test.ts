import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dashboard } from '../../src/ui/Dashboard';
import { defaultDatabase, type Database } from '../../src/domain/model';
import type { FormTemplate } from '../../src/domain/templates';
import { loadDatabase, saveDatabase } from '../../src/domain/storage';

vi.mock('wxt/browser', () => ({
  browser: { runtime: { getManifest: () => ({ version: '0.3.0' }) } },
}));
vi.mock('../../src/domain/storage', () => ({
  loadDatabase: vi.fn(),
  saveDatabase: vi.fn(),
  readSessionKey: vi.fn().mockResolvedValue(''),
  saveSessionKey: vi.fn(),
}));
vi.mock('../../src/domain/import', () => ({ draftFromText: vi.fn(), extractText: vi.fn() }));

const fixture = (): FormTemplate => ({
  version: 1,
  id: 'fictional-template',
  name: '虚构校招模板',
  adapter: 'beisen',
  origin: 'https://fictional.zhiye.com',
  enabled: true,
  createdAt: '2026-10-24T00:00:00.000Z',
  updatedAt: '2026-10-24T00:00:00.000Z',
  fields: [
    {
      id: 'school',
      label: '毕业院校',
      path: 'education.{index}.organization',
      section: 'education',
      index: 0,
      anchors: ['教育经历', '毕业院校'],
      kind: 'text',
      confirmed: true,
    },
  ],
});

let host: HTMLDivElement;
let root: Root;
let database: Database;

function button(text: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === text,
  );
  if (!match) throw new Error(`Missing button: ${text}`);
  return match;
}

async function click(text: string) {
  await act(async () => button(text).click());
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  database = defaultDatabase();
  database.templates = [fixture()];
  vi.mocked(loadDatabase).mockImplementation(async () => structuredClone(database));
  vi.mocked(saveDatabase).mockImplementation(async (next) => {
    database = structuredClone(next);
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(Dashboard)));
  await click('表单模板');
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('local template management', () => {
  it('shows confirmed fields, parameterized paths and regions without resume values', () => {
    expect(host.textContent).toContain('毕业院校');
    expect(host.textContent).toContain('education.{index}.organization');
    expect(host.textContent).toContain('区域：教育经历');
    expect(host.querySelector('details')).not.toBeNull();
  });

  it('renames a template while preserving changes made by another extension page', async () => {
    database.profiles[0]!.personal.name = '虚构的新资料';
    database.settings.aiEnabled = true;
    database.templates.push({ ...fixture(), id: 'other', name: '另一个模板' });
    const input = host.querySelector('input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        input,
        '核对后的模板',
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click('保存名称');
    expect(database.templates[0]!.name).toBe('核对后的模板');
    expect(database.templates[1]!.id).toBe('other');
    expect(database.profiles[0]!.personal.name).toBe('虚构的新资料');
    expect(database.settings.aiEnabled).toBe(true);
  });

  it('can disable, enable and delete only the intended template', async () => {
    await click('停用模板');
    expect(database.templates[0]!.enabled).toBe(false);
    await click('启用模板');
    expect(database.templates[0]!.enabled).toBe(true);
    const profiles = structuredClone(database.profiles);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await click('删除模板');
    expect(database.templates).toEqual([]);
    expect(database.profiles).toEqual(profiles);
    expect(host.textContent).toContain('会出现在这里');
  });

  it('does not recreate a template removed by another extension page', async () => {
    database.templates = [];
    await click('停用模板');
    expect(saveDatabase).not.toHaveBeenCalled();
    expect(host.textContent).toContain('此模板已被删除');
  });

  it('does not mutate saved templates while viewing the fictional demo', async () => {
    await click('看看虚构演示');
    await click('表单模板');
    expect(button('停用模板').disabled).toBe(true);
    expect(button('删除模板').disabled).toBe(true);
  });
});
