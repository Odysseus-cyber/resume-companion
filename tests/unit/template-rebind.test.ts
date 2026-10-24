import { beforeEach, describe, expect, it } from 'vitest';
import { FormEngine } from '../../src/engine/dom';
import type { PlanItem } from '../../src/engine/types';

const item = (id: string, value = '虚构姓名'): PlanItem => ({
  id,
  value,
  path: 'personal.name',
  confidence: 1,
  selected: true,
  source: '模板',
});

beforeEach(() => {
  document.body.innerHTML =
    '<form><div><label for="person">姓名</label><input id="person"></div><div><label for="city">城市</label><input id="city"></div></form>';
  history.replaceState({}, '', '/');
});

describe('guarded native control replacement during template execution', () => {
  it('rebinds an empty uniquely labelled replacement under the surviving parent and undoes it', async () => {
    const engine = new FormEngine();
    const scan = engine.scanTemplate();
    const original = document.querySelector<HTMLInputElement>('#person')!;
    const replacement = original.cloneNode() as HTMLInputElement;
    original.replaceWith(replacement);
    const results = await engine.fillTemplate(scan.token, [item('f0')]);
    expect(results[0]!.status).toBe('filled');
    expect(replacement.value).toBe('虚构姓名');
    expect((await engine.undo())[0]!.status).toBe('filled');
    expect(replacement.value).toBe('');
  });

  it('continues after a prior write replaces a later control and preserves user edits on undo', async () => {
    const first = document.querySelector<HTMLInputElement>('#person')!;
    first.addEventListener(
      'input',
      () => {
        const city = document.querySelector<HTMLInputElement>('#city')!;
        city.replaceWith(city.cloneNode());
      },
      { once: true },
    );
    const engine = new FormEngine();
    const scan = engine.scanTemplate();
    const results = await engine.fillTemplate(scan.token, [item('f0'), item('f1', '虚构城市')]);
    expect(results.map((result) => result.status)).toEqual(['filled', 'filled']);
    const city = document.querySelector<HTMLInputElement>('#city')!;
    expect(city.value).toBe('虚构城市');
    city.value = '用户后来修改的城市';
    await engine.undo();
    expect(first.value).toBe('');
    expect(city.value).toBe('用户后来修改的城市');
  });

  it.each(['label', 'kind', 'duplicate', 'value', 'parent', 'disabled', 'shape'])(
    'does not fill a replacement with changed %s',
    async (change) => {
      const engine = new FormEngine();
      const scan = engine.scanTemplate();
      const original = document.querySelector<HTMLInputElement>('#person')!;
      const replacement = original.cloneNode() as HTMLInputElement;
      original.replaceWith(replacement);
      if (change === 'label') document.querySelector('label')!.firstChild!.textContent = '电话';
      if (change === 'kind') replacement.type = 'email';
      if (change === 'duplicate') replacement.after(replacement.cloneNode());
      if (change === 'value') replacement.value = '用户已填写';
      if (change === 'disabled') replacement.disabled = true;
      if (change === 'shape') replacement.name = 'other-question';
      if (change === 'parent') {
        const parent = replacement.parentElement!;
        parent.replaceWith(parent.cloneNode(true));
      }
      const results = await engine.fillTemplate(scan.token, [item('f0')]);
      expect(results[0]!.status).toBe('review');
      expect(document.querySelector<HTMLInputElement>('#person')!.value).toBe(
        change === 'value' ? '用户已填写' : '',
      );
    },
  );

  it('never uses position alone for an unnamed replaced field', async () => {
    document.body.innerHTML = '<form><div><input></div></form>';
    const engine = new FormEngine();
    const scan = engine.scanTemplate();
    const original = document.querySelector('input')!;
    original.replaceWith(original.cloneNode());
    expect((await engine.fillTemplate(scan.token, [item('f0')]))[0]!.status).toBe('review');
    expect(document.querySelector('input')!.value).toBe('');
  });

  it('rejects a new empty control replacing one that already contained data at scan time', async () => {
    document.querySelector<HTMLInputElement>('#person')!.value = '原有资料';
    const engine = new FormEngine();
    const scan = engine.scanTemplate();
    const original = document.querySelector<HTMLInputElement>('#person')!;
    const replacement = original.cloneNode() as HTMLInputElement;
    replacement.value = '';
    original.replaceWith(replacement);
    expect((await engine.fillTemplate(scan.token, [item('f0')]))[0]!.status).toBe('review');
    expect(replacement.value).toBe('');
  });

  it('stops on repeated section insertion even when the target survives unchanged', async () => {
    document.body.innerHTML =
      '<form><section data-section="education"><h2>教育经历</h2><div><label>学校<input></label></div></section></form>';
    const engine = new FormEngine();
    const scan = engine.scanTemplate();
    const section = document.querySelector('section')!;
    section.after(section.cloneNode(true));
    const result = await engine.fillTemplate(scan.token, [item('f0', '虚构学校')]);
    expect(result[0]!.status).toBe('review');
    expect(result[0]!.reason).toContain('经历结构');
    expect([...document.querySelectorAll('input')].every((input) => !input.value)).toBe(true);
  });

  it('rejects changed section semantics despite identical controls', async () => {
    document.body.innerHTML =
      '<form><section data-section="education"><h2>教育经历</h2><div><label>学校<input></label></div></section></form>';
    const engine = new FormEngine();
    const scan = engine.scanTemplate();
    document.querySelector('section')!.setAttribute('data-section', 'experience');
    expect((await engine.fillTemplate(scan.token, [item('f0')]))[0]!.status).toBe('review');
    expect(document.querySelector('input')!.value).toBe('');
  });

  it('keeps fillLayout strict and does not leak rebind permission across calls', async () => {
    const engine = new FormEngine();
    const scan = engine.scanTemplate();
    await engine.fillTemplate(scan.token, []);
    const original = document.querySelector<HTMLInputElement>('#person')!;
    original.replaceWith(original.cloneNode());
    expect((await engine.fillLayout(scan.token, [item('f0')]))[0]!.status).toBe('review');
    expect(document.querySelector<HTMLInputElement>('#person')!.value).toBe('');
  });

  it('does not rebind a field replaced after writing it', async () => {
    const original = document.querySelector<HTMLInputElement>('#person')!;
    original.addEventListener('input', () => original.replaceWith(original.cloneNode()));
    const engine = new FormEngine();
    const scan = engine.scanTemplate();
    const results = await engine.fillTemplate(scan.token, [item('f0')]);
    expect(results[0]!.status).toBe('failed');
    expect(results[0]!.reason).toContain('重新渲染');
  });

  it('rejects navigation, old tokens and non-template scans before any write', async () => {
    const engine = new FormEngine();
    const first = engine.scanTemplate();
    const current = engine.scanTemplate();
    await expect(engine.fillTemplate(first.token, [item('f0')])).rejects.toThrow('变化');
    history.replaceState({}, '', '/next-step');
    await expect(engine.fillTemplate(current.token, [item('f0')])).rejects.toThrow('变化');
    const layout = engine.scanLayout();
    await expect(engine.fillTemplate(layout.token, [item('f0')])).rejects.toThrow('模板扫描');
    expect(document.querySelector<HTMLInputElement>('#person')!.value).toBe('');
  });
});
