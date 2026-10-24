// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { demoProfile, emptyEntry } from '../../src/domain/model';
import { createTemplate, resolveTemplates } from '../../src/engine/templates';
import type { LayoutScan, PlanItem } from '../../src/engine/types';

function fixture(names = ['姓名', '邮箱']): LayoutScan {
  const rect = { x: 0, y: 0, width: 100, height: 30 };
  return {
    token: 'private-token',
    url: 'https://one.zhiye.com/form?user=secret',
    origin: 'https://one.zhiye.com',
    adapter: 'beisen',
    fields: names.map((name, index) => ({
      id: `f${index}`,
      signature: `sig-${name}`,
      label: name,
      kind: 'text',
      value: '',
      options: [],
      autocomplete: '',
      index: 0,
      blocked: false,
    })),
    layout: {
      containers: [
        { id: 'c0', parentId: null, order: 0, rect },
        ...names.map((_, i) => ({
          id: `c${i + 1}`,
          parentId: 'c0',
          order: i * 3 + 1,
          rect: { ...rect, y: i * 60 },
        })),
      ],
      texts: names.map((name, i) => ({
        id: `t${i}`,
        parentId: `c${i + 1}`,
        order: i * 3 + 2,
        rect: { ...rect, y: i * 60 },
        text: name,
      })),
      controls: names.map((_, i) => ({
        id: `f${i}`,
        parentId: `c${i + 1}`,
        order: i * 3 + 3,
        rect: { ...rect, x: 120, y: i * 60 },
        kind: 'text',
        writable: true,
        occupied: false,
      })),
      limitations: [],
    },
  };
}
const item = (id: string, path: string): PlanItem => ({
  id,
  path,
  value: 'must-not-persist',
  source: 'AI',
  selected: true,
  confidence: 1,
});
const profile = () => demoProfile();
function save(scan = fixture(), paths = ['personal.name', 'personal.email']) {
  return createTemplate(
    scan,
    profile(),
    paths.map((path, i) => item(`f${i}`, path)),
    Object.fromEntries(scan.fields.map((field) => [field.id, field.label])),
    scan.fields.map((field) => field.id),
  );
}
describe('local learned form templates', () => {
  it('stores metadata only and reloads values from the current profile', () => {
    const template = save(),
      p = profile();
    const serialized = JSON.stringify(template);
    for (const secret of [
      'must-not-persist',
      'private-token',
      '?user=',
      p.personal.name,
      p.personal.email,
    ])
      expect(serialized).not.toContain(secret);
    expect(template).not.toHaveProperty('url');
    p.personal.name = '新虚构姓名';
    const result = resolveTemplates(fixture(), p, [JSON.parse(serialized)], []);
    expect(result.plan[0]?.value).toBe('新虚构姓名');
  });
  it('reuses after persistence without depending on scan IDs or order', () => {
    const template = save(),
      scan = fixture(['邮箱', '姓名']),
      p = profile();
    p.personal.name = '更新的虚构姓名';
    const result = resolveTemplates(scan, p, [JSON.parse(JSON.stringify(template))], []);
    expect(result.status).toBe('full');
    expect(result.plan.map((entry) => [entry.id, entry.path, entry.value])).toEqual([
      ['f1', 'personal.name', p.personal.name],
      ['f0', 'personal.email', p.personal.email],
    ]);
    expect(result.plan.every((entry) => entry.evidence?.length)).toBe(true);
  });
  it('keeps unchanged fields when controls are inserted or removed', () => {
    const template = save();
    const added = resolveTemplates(fixture(['民族', '姓名', '邮箱']), profile(), [template], []);
    expect(added.status).toBe('partial');
    expect(added.unresolvedIds).toEqual(['f0']);
    expect(added.plan.map((entry) => entry.path)).toEqual(['personal.name', 'personal.email']);
    const removed = resolveTemplates(fixture(['姓名']), profile(), [template], []);
    expect(removed.status).toBe('full');
    expect(removed.reused).toBe(1);
  });
  it('uses conservative semantic aliases rather than literal-only field text', () => {
    expect(
      resolveTemplates(fixture(['真实姓名', '电子邮箱']), profile(), [save()], []).status,
    ).toBe('full');
  });
  it('does not bind a globally present label to unrelated control', () => {
    const template = save(),
      scan = fixture(['联系电话', '邮箱']);
    scan.layout.texts.push({ ...scan.layout.texts[0]!, id: 't8', parentId: null, text: '姓名' });
    const result = resolveTemplates(scan, profile(), [template], []);
    expect(result.plan.some((entry) => entry.path === 'personal.name')).toBe(false);
  });
  it('skips duplicated target names instead of guessing by coordinates', () => {
    const result = resolveTemplates(fixture(['姓名', '姓名', '邮箱']), profile(), [save()], []);
    expect(result.status).toBe('ambiguous');
    expect(result.plan.map((entry) => entry.path)).toEqual(['personal.email']);
  });
  it('does not store redacted text or names containing profile/current-page values', () => {
    const scan = fixture(['姓名', '邮箱']),
      p = profile();
    scan.fields[0]!.value = '网页已有隐私';
    scan.layout.texts[0]!.text = `姓名 ${p.personal.name} 网页已有隐私`;
    const template = createTemplate(
      scan,
      p,
      [item('f0', 'personal.name'), item('f1', 'personal.email')],
      { f0: '姓名', f1: '邮箱' },
      ['f0', 'f1'],
    );
    expect(template.fields).toHaveLength(1);
    expect(template.fields[0]!.path).toBe('personal.email');
    expect(JSON.stringify(template)).not.toContain('[已隐藏]');
    expect(() =>
      createTemplate(fixture(), p, [item('f0', 'personal.name')], { f0: p.personal.name }, ['f0']),
    ).toThrow('没有可保存');
  });
  it('keeps missing, occupied and unsupported outcomes separate from recognition', () => {
    const template = save(),
      scan = fixture(),
      p = profile();
    p.personal.name = '';
    scan.fields[1]!.value = '已有内容';
    scan.layout.controls[1]!.occupied = true;
    const result = resolveTemplates(scan, p, [template], []);
    expect(result.status).toBe('full');
    expect(result.labels).toEqual({ f0: '姓名', f1: '邮箱' });
    expect(result.plan.every((entry) => !entry.selected)).toBe(true);
    expect(result.details.f0).toBe('缺少资料');
    expect(result.details.f1).toContain('保留');
    scan.fields[0]!.blocked = true;
    expect(resolveTemplates(scan, p, [template], []).details.f0).toContain('不支持');
  });
  it('rejects conflicts with manual mappings and other templates', () => {
    const scan = fixture(),
      template = save();
    const manual = [
      { origin: scan.origin, signature: 'sig-姓名', path: 'personal.phone', label: '姓名' },
    ];
    const result = resolveTemplates(scan, profile(), [template], manual);
    expect(result.status).toBe('ambiguous');
    expect(result.plan).toHaveLength(1);
    const competing = structuredClone(template);
    competing.id = 'other';
    competing.fields[0]!.path = 'personal.phone';
    const multi = resolveTemplates(scan, profile(), [template, competing], []);
    expect(multi.status).toBe('ambiguous');
    expect(multi.labels.f0).toBeUndefined();
  });
  it('requires cross-origin preview and never shares generic adapters across sites', () => {
    const scan = fixture(),
      template = save();
    scan.origin = 'https://two.zhiye.com';
    expect(resolveTemplates(scan, profile(), [template], []).crossOrigin).toBe(true);
    scan.adapter = 'generic';
    template.adapter = 'generic';
    expect(resolveTemplates(scan, profile(), [template], []).status).toBe('none');
    template.enabled = false;
    scan.origin = template.origin;
    expect(resolveTemplates(scan, profile(), [template], []).status).toBe('none');
  });
  it('scopes custom IDs to the profile and requires the key still exists', () => {
    const p = profile();
    p.custom = [{ id: 'private-custom-id', label: '到岗时间', value: '下月' }];
    const scan = fixture(['到岗时间']);
    const template = createTemplate(
      scan,
      p,
      [item('f0', 'custom.private-custom-id')],
      { f0: '到岗时间' },
      ['f0'],
    );
    expect(resolveTemplates(scan, p, [template], []).reused).toBe(1);
    expect(resolveTemplates(scan, { ...p, id: 'another' }, [template], []).reused).toBe(0);
    p.custom = [];
    expect(resolveTemplates(scan, p, [template], []).reused).toBe(0);
  });
  it('parameterizes repeated fields only with verified section and index', () => {
    const scan = fixture(['学校', '学校']),
      p = profile();
    p.education.push({ ...emptyEntry(), organization: '第二示例大学' });
    scan.fields.forEach((field, index) => {
      field.section = 'education';
      field.index = index;
    });
    const template = createTemplate(
      scan,
      p,
      [item('f0', 'education.0.organization'), item('f1', 'education.1.organization')],
      { f0: '学校', f1: '学校' },
      ['f0', 'f1'],
    );
    expect(template.fields.map((field) => field.path)).toEqual([
      'education.{index}.organization',
      'education.{index}.organization',
    ]);
    expect(resolveTemplates(scan, p, [template], []).plan.map((entry) => entry.path)).toEqual([
      'education.0.organization',
      'education.1.organization',
    ]);
    const inserted = fixture(['学校', '学校', '学校']);
    inserted.fields.forEach((field, index) => {
      field.section = 'education';
      field.index = index;
    });
    expect(resolveTemplates(inserted, p, [template], []).reused).toBe(0);
    delete scan.fields[0]!.section;
    expect(() =>
      createTemplate(scan, p, [item('f0', 'education.0.organization')], { f0: '学校' }, ['f0']),
    ).toThrow();
  });
  it('refuses duplicate scalar paths and invalid dates', () => {
    expect(() => save(fixture(['姓名', '中文姓名']), ['personal.name', 'personal.name'])).toThrow();
    const scan = fixture(['出生日期']);
    scan.fields[0]!.kind = 'date';
    scan.layout.controls[0]!.kind = 'date';
    const p = profile(),
      template = createTemplate(scan, p, [item('f0', 'personal.birthday')], { f0: '出生日期' }, [
        'f0',
      ]);
    p.personal.birthday = '明年';
    expect(resolveTemplates(scan, p, [template], []).plan[0]!.selected).toBe(false);
  });
  it('uses geometry within a shared container and survives deep label wrappers', () => {
    const scan = fixture();
    scan.layout.controls.forEach((control, index) => {
      control.parentId = 'c0';
      control.rect.x = 120 + index * 500;
      control.rect.y = 0;
    });
    scan.layout.texts.forEach((text, index) => {
      text.parentId = 'c0';
      text.rect.x = index * 500;
      text.rect.y = 0;
    });
    const template = save(scan);
    expect(resolveTemplates(scan, profile(), [template], []).status).toBe('full');
    const wrapped = fixture();
    wrapped.layout.containers.push({ ...wrapped.layout.containers[1]!, id: 'c9', parentId: 'c1' });
    wrapped.layout.texts[0]!.parentId = 'c9';
    expect(resolveTemplates(wrapped, profile(), [template], []).status).toBe('full');
  });
  it('saves supported names independently from unsupported execution and only checked fields', () => {
    const scan = fixture();
    scan.fields[0]!.kind = 'unsupported';
    scan.layout.controls[0]!.kind = 'unsupported';
    scan.layout.controls[0]!.writable = false;
    const template = createTemplate(
      scan,
      profile(),
      [item('f0', 'personal.name'), item('f1', 'personal.email')],
      { f0: '姓名', f1: '邮箱' },
      ['f0'],
    );
    expect(template.fields).toHaveLength(1);
    const result = resolveTemplates(scan, profile(), [template], []);
    expect(result.labels.f0).toBe('姓名');
    expect(result.plan[0]!.selected).toBe(false);
    expect(result.unresolvedIds).toEqual(['f1']);
  });
  it('does not reuse personal names in an emergency contact region', () => {
    const personal = fixture();
    personal.fields.forEach((field) => {
      field.region = ['个人信息'];
    });
    const template = save(personal);
    expect(template.fields[0]!.regionAnchors).toEqual(['个人信息']);
    expect(resolveTemplates(personal, profile(), [template], []).status).toBe('full');
    const emergency = fixture();
    emergency.fields.forEach((field) => {
      field.region = ['紧急联系人'];
    });
    expect(resolveTemplates(emergency, profile(), [template], []).reused).toBe(0);
    expect(resolveTemplates(emergency, profile(), [save()], []).reused).toBe(0);
    const noRegion = fixture();
    expect(resolveTemplates(noRegion, profile(), [template], []).reused).toBe(0);
  });
  it('does not erase a region boundary containing private values', () => {
    const scan = fixture(),
      p = profile();
    scan.fields.forEach((field) => {
      field.region = [`个人信息 ${p.personal.name}`];
    });
    expect(() =>
      createTemplate(scan, p, [item('f0', 'personal.name')], { f0: '姓名' }, ['f0']),
    ).toThrow();
    const original = fixture();
    original.fields.forEach((field) => {
      field.region = ['个人信息'];
    });
    expect(resolveTemplates(scan, p, [save(original)], []).reused).toBe(0);
  });
  it('reviews lower-coverage same-origin templates that disagree on a field', () => {
    const template = save(),
      partial = structuredClone(template);
    partial.id = 'partial';
    partial.fields = [partial.fields[0]!];
    partial.fields[0]!.path = 'personal.phone';
    const result = resolveTemplates(fixture(), profile(), [template, partial], []);
    expect(result.status).toBe('ambiguous');
    expect(result.plan.map((entry) => entry.path)).toEqual(['personal.email']);
    expect(result.details.f0).toContain('多个模板');
  });
});
