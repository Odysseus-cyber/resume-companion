// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dbSchema, defaultDatabase, migrate } from '../../src/domain/model';
import { formTemplateSchema, type FormTemplate } from '../../src/domain/templates';
import { encryptBackup, restoreBackup } from '../../src/domain/backup';

const storage = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: { storage: { local: storage } } }));
import { DATA_KEY, updateTemplates } from '../../src/domain/storage';

function template(): FormTemplate {
  return {
    version: 1,
    id: 'fictional-template',
    name: '虚构招聘表单',
    adapter: 'generic',
    origin: 'https://fictional.example',
    enabled: true,
    createdAt: '2026-10-24T00:00:00.000Z',
    updatedAt: '2026-10-24T00:00:00.000Z',
    fields: [
      {
        id: 'persistent-field',
        label: '学校',
        path: 'education.{index}.organization',
        section: 'education',
        index: 0,
        anchors: ['教育经历', '学校'],
        kind: 'text',
        confirmed: true,
      },
    ],
  };
}

describe('persistent template metadata', () => {
  it('round-trips current database JSON and encrypted backups with templates', async () => {
    const db = { ...defaultDatabase(), templates: [template()] };
    expect(migrate(JSON.parse(JSON.stringify(db)))).toEqual(db);
    expect(
      await restoreBackup(await encryptBackup(db, 'fictional-password'), 'fictional-password'),
    ).toEqual(db);
  });

  it('rejects value payloads, arbitrary operations and URLs with personal parameters', () => {
    const base = template();
    for (const extra of [
      { value: 'fictional private value' },
      { html: '<input value="private">' },
      { selector: '#private-input' },
      { script: 'alert(1)' },
    ]) {
      expect(() => formTemplateSchema.parse({ ...base, ...extra })).toThrow();
      expect(() =>
        formTemplateSchema.parse({ ...base, fields: [{ ...base.fields[0], ...extra }] }),
      ).toThrow();
    }
    for (const origin of [
      'https://fictional.example/form?userId=123',
      'https://fictional.example/form',
      'https://user:password@fictional.example',
      'javascript:alert(1)',
    ]) {
      expect(() => formTemplateSchema.parse({ ...base, origin })).toThrow();
    }
  });

  it('accepts local custom references only when scoped to a profile', () => {
    const base = template();
    const field = { ...base.fields[0]!, path: 'custom.fictional-id' };
    expect(() => formTemplateSchema.parse({ ...base, fields: [field] })).toThrow();
    expect(
      formTemplateSchema.parse({
        ...base,
        fields: [{ ...field, customProfileId: 'local-profile' }],
      }).fields[0]?.customProfileId,
    ).toBe('local-profile');
  });

  it('rejects provisional templates, invalid driver kinds and non-parameterized repeated paths', () => {
    const base = template();
    for (const change of [
      { confirmed: false },
      { kind: 'execute-script' },
      { path: 'education.0.organization' },
      { path: 'document.body' },
      { anchors: [] },
    ]) {
      expect(() =>
        formTemplateSchema.parse({ ...base, fields: [{ ...base.fields[0], ...change }] }),
      ).toThrow();
    }
  });

  it('enforces limits and unique template and field identifiers', () => {
    const base = template();
    expect(() => dbSchema.parse({ ...defaultDatabase(), templates: [base, base] })).toThrow(
      '模板 ID',
    );
    expect(() =>
      formTemplateSchema.parse({ ...base, fields: [base.fields[0], base.fields[0]] }),
    ).toThrow('字段 ID');
    expect(() =>
      dbSchema.parse({
        ...defaultDatabase(),
        templates: Array.from({ length: 201 }, (_, i) => ({ ...base, id: `${i}` })),
      }),
    ).toThrow();
    expect(() =>
      formTemplateSchema.parse({
        ...base,
        fields: Array.from({ length: 501 }, (_, i) => ({ ...base.fields[0], id: `${i}` })),
      }),
    ).toThrow();
  });
});

describe('template updates', () => {
  beforeEach(() => {
    storage.get.mockReset();
    storage.set.mockReset();
  });

  it('reads latest profiles, settings and mappings when updating templates', async () => {
    const latest = defaultDatabase();
    latest.profiles[0]!.personal.name = '刚刚编辑的虚构姓名';
    latest.settings.model = 'latest-model';
    latest.mappings = [
      {
        origin: 'https://fictional.example',
        signature: 'field',
        path: 'personal.name',
        label: '姓名',
      },
    ];
    storage.get.mockResolvedValue({ [DATA_KEY]: latest });
    const result = await updateTemplates((templates) => [...templates, template()]);
    expect(result).toEqual({ ...latest, templates: [template()] });
    expect(storage.set).toHaveBeenCalledWith({ [DATA_KEY]: result });
  });

  it('validates updates before persistence', async () => {
    storage.get.mockResolvedValue({ [DATA_KEY]: defaultDatabase() });
    await expect(updateTemplates(() => [template(), template()])).rejects.toThrow('模板 ID');
    expect(storage.set).not.toHaveBeenCalled();
  });
});
