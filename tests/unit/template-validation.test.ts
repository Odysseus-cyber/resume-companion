import { beforeEach, describe, expect, it } from 'vitest';
import { FormEngine } from '../../src/engine/dom';
import { createTemplate, resolveTemplates } from '../../src/engine/templates';
import { demoProfile } from '../../src/domain/model';

beforeEach(() => {
  document.body.innerHTML =
    '<form><section><h2>个人信息</h2><div><span>姓名</span><input></div></section></form>';
  history.replaceState({}, '', '/form');
});

describe('template scan and save validation', () => {
  it('retains unannotated sensitive controls as blocked candidates and cannot fill them', async () => {
    document.body.innerHTML =
      '<form><div><span>护照号码</span><input></div><div><span>姓名</span><input></div></form>';
    const engine = new FormEngine(),
      scan = engine.scanTemplate();
    expect(scan.fields).toHaveLength(2);
    expect(scan.layout.controls).toHaveLength(2);
    expect(scan.fields[0]).toMatchObject({ label: '护照号码', blocked: true });
    expect(scan.layout.controls[0]).toMatchObject({ writable: false });
    expect(scan.layout.controls[0]!.reason).toContain('手动');
    expect(scan.layout.controls[1]!.writable).toBe(true);
    const result = await engine.fillTemplate(scan.token, [
      {
        id: 'f0',
        path: 'personal.name',
        value: '虚构内容',
        source: '模板',
        confidence: 1,
        selected: true,
      },
    ]);
    expect(result[0]!.status).toBe('skipped');
    expect(document.querySelector('input')!.value).toBe('');
  });

  it('allows metadata-only save after user edits a value but execution validation still rejects it', () => {
    const engine = new FormEngine(),
      scan = engine.scanTemplate(),
      p = demoProfile();
    document.querySelector('input')!.value = '用户后来手动填写';
    expect(engine.validateLayout(scan.token, false)).toEqual({ valid: true });
    expect(() => engine.validateLayout(scan.token)).toThrow('内容已变化');
    const template = createTemplate(
      scan,
      p,
      [
        {
          id: 'f0',
          path: 'personal.name',
          value: p.personal.name,
          source: '手动',
          confidence: 1,
          selected: false,
        },
      ],
      { f0: '姓名' },
      ['f0'],
    );
    expect(JSON.stringify(template)).not.toContain('用户后来手动填写');
    const fresh = engine.scanTemplate();
    const resolved = resolveTemplates(fresh, p, [template], []);
    expect(resolved.plan[0]!.selected).toBe(false);
    expect(resolved.details.f0).toContain('保留原值');
  });

  it.each(['label', 'heading', 'parent', 'node', 'kind', 'disabled', 'navigation'])(
    'metadata-only save rejects changed %s even when value checking is disabled',
    (change) => {
      const engine = new FormEngine(),
        scan = engine.scanTemplate();
      const input = document.querySelector('input')!;
      input.value = '用户后来手动填写';
      if (change === 'label')
        document.querySelector('span')!.firstChild!.textContent = '紧急联系人姓名';
      if (change === 'heading')
        document.querySelector('h2')!.firstChild!.textContent = '紧急联系人';
      if (change === 'parent') {
        const wrapper = document.createElement('div');
        input.replaceWith(wrapper);
        wrapper.append(input);
      }
      if (change === 'node') input.replaceWith(input.cloneNode());
      if (change === 'kind') input.type = 'email';
      if (change === 'disabled') input.disabled = true;
      if (change === 'navigation') history.replaceState({}, '', '/other');
      expect(() => engine.validateLayout(scan.token, false)).toThrow('变化');
    },
  );
});
