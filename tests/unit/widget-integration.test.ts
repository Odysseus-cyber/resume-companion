import { beforeEach, describe, expect, it } from 'vitest';
import { FormEngine } from '../../src/engine/dom';
import { collectLayout } from '../../src/engine/layout';
import type { PlanItem } from '../../src/engine/types';

const plan = (id: string, value: string, path = 'personal.highestEducation'): PlanItem => ({
  id,
  value,
  path,
  selected: true,
  source: 'AI',
  confidence: 1,
});
beforeEach(() => {
  document.body.innerHTML = '';
  history.replaceState({}, '', '/');
});
function fixture(wrapper = false) {
  document.body.innerHTML = `<form><div><label id="degree-label" for="degree">最高学历</label>${wrapper ? '<div id="degree" role="combobox" aria-labelledby="degree-label" aria-controls="choices"><input readonly></div>' : '<input id="degree" readonly role="combobox" aria-controls="choices">'}</div><div id="choices" role="listbox" hidden><button type="button">清空选择</button></div><div><label for="ethnicity">民族</label><input id="ethnicity"></div></form>`;
  const trigger = document.getElementById('degree')!;
  const input = (wrapper ? trigger.querySelector('input') : trigger) as HTMLInputElement;
  const popup = document.getElementById('choices')!;
  trigger.addEventListener('click', () => {
    popup.hidden = false;
    setTimeout(() => {
      if (popup.querySelector('[role=option]')) return;
      const option = document.createElement('div');
      option.setAttribute('role', 'option');
      option.textContent = '大学本科';
      option.addEventListener('click', () => {
        input.value = '大学本科';
        popup.hidden = true;
      });
      popup.append(option);
    }, 50);
  });
  popup.querySelector('button')!.addEventListener('click', () => {
    input.value = '';
    popup.hidden = true;
  });
  return { trigger, input, popup };
}
describe('custom choice engine integration', () => {
  it('captures readonly choices once, keeps ordinary readonly fields unsupported, and excludes open popup UI', () => {
    const { popup } = fixture(true);
    popup.hidden = false;
    popup.insertAdjacentHTML(
      'beforeend',
      '<input type="search" value="private-query"><div role="option">private-option</div><p>private-selection-summary</p>',
    );
    document.body.insertAdjacentHTML('beforeend', '<input readonly aria-label="不可修改">');
    const scan = new FormEngine().scanLayout();
    expect(scan.fields).toHaveLength(3);
    expect(scan.layout.controls[0]).toMatchObject({
      kind: 'combobox',
      writable: true,
      occupied: false,
    });
    expect(scan.layout.controls[2]).toMatchObject({ kind: 'unsupported', writable: false });
    expect(JSON.stringify(scan.layout)).not.toContain('private-');
    expect(scan.layout.texts.map((x) => x.text)).toContain('最高学历');
  });
  it.each([false, true])(
    'fills asynchronously, continues after popup mutations, and restores widget state (wrapper=%s)',
    async (wrapper) => {
      const { input } = fixture(wrapper);
      const engine = new FormEngine();
      const scan = engine.scanLayout();
      const results = await engine.fillLayout(scan.token, [
        plan('f0', '本科'),
        plan('f1', '虚构民族', 'personal.ethnicity'),
      ]);
      expect(results.map((x) => x.status)).toEqual(['filled', 'filled']);
      expect(input.value).toBe('大学本科');
      expect(results[0]!.reason).not.toContain('手动');
      expect((await engine.undo()).map((x) => x.status)).toEqual(['filled', 'filled']);
      expect(input.value).toBe('');
      expect((document.getElementById('ethnicity') as HTMLInputElement).value).toBe('');
    },
  );
  it('offline scan also treats a wrapper and its value input as one field', async () => {
    const { input } = fixture(true);
    const engine = new FormEngine();
    const scan = engine.scan();
    expect(scan.fields).toHaveLength(2);
    expect(scan.fields[0]).toMatchObject({ kind: 'combobox', label: '最高学历' });
    expect((await engine.fill(scan.token, [plan('f0', '本科')]))[0]!.status).toBe('filled');
    expect(input.value).toBe('大学本科');
  });
  it('refuses a replaced inner value input without rebinding to it', async () => {
    const { trigger } = fixture(true);
    const engine = new FormEngine();
    const scan = engine.scanLayout();
    trigger.querySelector('input')!.replaceWith(document.createElement('input'));
    const results = await engine.fillLayout(scan.token, [
      plan('f0', '本科'),
      plan('f1', '虚构民族', 'personal.ethnicity'),
    ]);
    expect(results.map((x) => x.status)).toEqual(['review', 'filled']);
    expect(trigger.querySelector('input')!.value).toBe('');
  });
  it('stops delayed selection when the question changes, while later fields continue', async () => {
    const { trigger, input } = fixture();
    const engine = new FormEngine();
    const scan = engine.scanLayout();
    trigger.addEventListener('click', () => {
      document.getElementById('degree-label')!.textContent = '其他问题';
    });
    const results = await engine.fillLayout(scan.token, [
      plan('f0', '本科'),
      plan('f1', '虚构民族', 'personal.ethnicity'),
    ]);
    expect(results.map((x) => x.status)).toEqual(['failed', 'filled']);
    expect(input.value).toBe('');
  });
  it('keeps externally populated values while waiting for options', async () => {
    const { trigger, input } = fixture();
    const engine = new FormEngine();
    const scan = engine.scanLayout();
    trigger.addEventListener('click', () => {
      input.value = '网页后来填写';
    });
    expect((await engine.fillLayout(scan.token, [plan('f0', '本科')]))[0]!.status).toBe('failed');
    expect(input.value).toBe('网页后来填写');
  });
  it('preserves existing selections and later edits when undoing', async () => {
    const { input } = fixture();
    const engine = new FormEngine();
    let scan = engine.scanLayout();
    await engine.fillLayout(scan.token, [plan('f0', '本科')]);
    input.value = '后来手动选择';
    expect((await engine.undo())[0]!.status).toBe('skipped');
    expect(input.value).toBe('后来手动选择');
    scan = engine.scanLayout();
    expect((await engine.fillLayout(scan.token, [plan('f0', '本科')]))[0]!.status).toBe('skipped');
  });
  it('supports explicit popup-trigger inputs without role, but blocks submit triggers', () => {
    document.body.innerHTML =
      '<form><input readonly aria-haspopup="listbox" aria-controls="items"><button aria-haspopup="dialog" aria-controls="dialog">提交</button><div id="items" hidden></div><div id="dialog" hidden></div></form>';
    const { layout } = collectLayout();
    expect(layout.controls[0]).toMatchObject({ kind: 'combobox', writable: true });
    expect(layout.controls[1]).toMatchObject({ kind: 'unsupported', writable: false });
  });
});
