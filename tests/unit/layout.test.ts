import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FormEngine } from '../../src/engine/dom';
import { collectLayout } from '../../src/engine/layout';
import type { PlanItem } from '../../src/engine/types';

function plan(id: string, value = '虚构姓名'): PlanItem {
  return { id, value, path: 'personal.name', confidence: 1, selected: true, source: 'AI' };
}
beforeEach(() => {
  document.body.innerHTML = '';
  history.replaceState({}, '', '/');
});

describe('independent layout capture', () => {
  it('includes deep cross-column text without label association or resume rules', () => {
    document.body.innerHTML =
      '<form><div><div><div><div><div><span>毕业院校</span></div></div></div></div></div><aside><div><input></div></aside><div>非简历词典中的问题</div><input></form>';
    const scan = new FormEngine().scanLayout();
    expect(scan.fields.map((field) => field.label)).toEqual(['待识别字段 1', '待识别字段 2']);
    expect(scan.layout.texts.map((text) => text.text)).toEqual(['毕业院校', '非简历词典中的问题']);
    expect(scan.layout.containers.length).toBeGreaterThan(5);
    for (const control of scan.layout.controls)
      expect(scan.layout.containers.some((container) => container.id === control.parentId)).toBe(
        true,
      );
    expect(scan.layout.controls[0]!.order).toBeLessThan(scan.layout.controls[1]!.order);
  });
  it('keeps separate repeated entries and date range text with their ancestry', () => {
    document.body.innerHTML =
      '<main><h2>教育经历</h2><section><div>第一段</div><span>开始</span><input type="month"><span>结束</span><input type="month"></section><section><div>第二段</div><span>开始</span><input type="month"><span>结束</span><input type="month"></section></main>';
    const { layout } = collectLayout();
    expect(layout.controls).toHaveLength(4);
    expect(layout.controls[0]!.parentId).toBe(layout.controls[1]!.parentId);
    expect(layout.controls[0]!.parentId).not.toBe(layout.controls[2]!.parentId);
    expect(layout.texts.map((text) => text.text)).toEqual([
      '教育经历',
      '第一段',
      '开始',
      '结束',
      '第二段',
      '开始',
      '结束',
    ]);
  });
  it('retains interleaved text and control order within the same wrapper', () => {
    document.body.innerHTML = '<form><div>姓名<input>城市<input></div></form>';
    const { layout } = collectLayout();
    expect(layout.texts[0]!.order).toBeLessThan(layout.controls[0]!.order);
    expect(layout.controls[0]!.order).toBeLessThan(layout.texts[1]!.order);
    expect(layout.texts[1]!.order).toBeLessThan(layout.controls[1]!.order);
  });
  it('captures text inside display:contents wrappers without an element box', () => {
    document.body.innerHTML =
      '<form><div style="display:contents"><span style="display:contents">学校</span></div><input></form>';
    const { layout } = collectLayout();
    expect(layout.texts.map((text) => text.text)).toEqual(['学校']);
  });
  it('excludes selected labels associated by for and never returns password values', () => {
    document.body.innerHTML =
      '<form><label for="picked">private-selected-choice</label><input id="picked" type="radio" checked><input type="password" value="private-password"></form>';
    const scan = new FormEngine().scanLayout();
    expect(JSON.stringify(scan.layout)).not.toContain('private-');
    expect(JSON.stringify(scan.fields)).not.toContain('private-password');
    expect(scan.layout.controls[1]).toMatchObject({ kind: 'unsupported', writable: false });
  });
  it('never exposes values, selected widget contents, attributes or hidden text in layout', () => {
    document.body.innerHTML =
      '<form><span>姓名</span><input id="secret-id" name="secret-name" placeholder="secret-placeholder" value="secret-name-value"><textarea>secret-body</textarea><select><option selected>secret-school</option></select><div role="combobox" aria-controls="menu">secret-city</div><div id="menu" role="listbox"><div role="option">secret-option</div></div><div contenteditable="true">secret-editable</div><div hidden>secret-hidden</div><label><input type="radio" checked>secret-selected-label</label><script>secret-script</script></form>';
    const scan = new FormEngine().scanLayout();
    const payload = JSON.stringify(scan.layout);
    expect(payload).not.toContain('secret');
    expect(scan.fields.some((field) => field.value === 'secret-name-value')).toBe(true);
    expect(scan.fields.some((field) => field.value === 'secret-editable')).toBe(true);
    expect(scan.layout.controls.some((control) => control.occupied)).toBe(true);
  });
  it('distinguishes unsupported controls without losing unnamed candidates', () => {
    document.body.innerHTML =
      '<form><input><input readonly value="read-only"><div contenteditable="true"></div><div role="checkbox"></div><input disabled></form>';
    const scan = new FormEngine().scanLayout();
    expect(scan.fields).toHaveLength(5);
    expect(scan.layout.controls[0]).toMatchObject({ kind: 'text', writable: true });
    expect(
      scan.layout.controls
        .slice(1)
        .every((control) => control.kind === 'unsupported' && !control.writable && control.reason),
    ).toBe(true);
  });
  it('groups native choices without using business field labels', () => {
    document.body.innerHTML =
      '<form><fieldset><legend>性别</legend><label><input type="radio" name="g" value="male">男</label><label><input type="radio" name="g" value="female">女</label></fieldset></form>';
    const { layout, candidates } = collectLayout();
    expect(layout.controls).toHaveLength(1);
    expect(candidates[0]!.nodes).toHaveLength(2);
    expect(layout.texts.map((text) => text.text)).toContain('性别');
  });
  it('does not scan iframe or shadow contents and states the scope', () => {
    document.body.innerHTML = '<input><iframe></iframe><div id="host"></div>';
    document.getElementById('host')!.attachShadow({ mode: 'open' }).innerHTML = '<input>';
    const { layout } = collectLayout();
    expect(layout.controls).toHaveLength(1);
    expect(layout.limitations.join('')).toContain('iframe');
    expect(layout.limitations.join('')).toContain('Shadow DOM');
  });
  it('rejects more than 500 candidates rather than silently truncating', () => {
    document.body.innerHTML = '<form>' + '<input>'.repeat(501) + '</form>';
    expect(() => collectLayout()).toThrow('500');
  });
});

describe('layout snapshots and local filling', () => {
  it('continues filling after its own radio selection and can undo the whole batch', async () => {
    document.body.innerHTML =
      '<form><fieldset><legend>性别</legend><input id="m" type="radio" name="g" value="male"><label for="m">男</label><input id="f" type="radio" name="g" value="female"><label for="f">女</label></fieldset><span>姓名</span><input id="person"></form>';
    const engine = new FormEngine();
    const scan = engine.scanLayout();
    const result = await engine.fillLayout(scan.token, [plan('f0', '女'), plan('f1', '虚构姓名')]);
    expect(result.map((r) => r.status)).toEqual(['filled', 'filled']);
    expect((document.querySelector('#f') as HTMLInputElement).checked).toBe(true);
    expect((document.querySelector('#person') as HTMLInputElement).value).toBe('虚构姓名');
    await engine.undo();
    expect((document.querySelector('#f') as HTMLInputElement).checked).toBe(false);
    expect((document.querySelector('#person') as HTMLInputElement).value).toBe('');
  });
  it('fills local values, verifies, and preserves later user edits on undo', async () => {
    document.body.innerHTML = '<form><span>姓名</span><input><span>城市</span><input></form>';
    const engine = new FormEngine();
    const scan = engine.scanLayout();
    expect(engine.validateLayout(scan.token)).toEqual({ valid: true });
    const results = await engine.fillLayout(scan.token, [plan('f0'), plan('f1', '虚构城市')]);
    expect(results.map((result) => result.status)).toEqual(['filled', 'filled']);
    const inputs = document.querySelectorAll('input');
    inputs[0]!.value = '手动编辑';
    await engine.undo();
    expect(inputs[0]!.value).toBe('手动编辑');
    expect(inputs[1]!.value).toBe('');
  });
  it.each(['text', 'node', 'value', 'navigation', 'type'])(
    'rejects stale %s before any write',
    async (change) => {
      document.body.innerHTML = '<form><span>姓名</span><input><input></form>';
      const engine = new FormEngine();
      const scan = engine.scanLayout();
      const input = document.querySelector('input')!;
      if (change === 'text') document.querySelector('span')!.textContent = '电话';
      if (change === 'node') input.replaceWith(input.cloneNode());
      if (change === 'value') input.value = '新填写';
      if (change === 'navigation') history.replaceState({}, '', '/changed?step=2');
      if (change === 'type') input.type = 'email';
      expect(() => engine.validateLayout(scan.token)).toThrow('变化');
      if (change === 'navigation') {
        await expect(engine.fillLayout(scan.token, [plan('f0')])).rejects.toThrow('变化');
      } else {
        expect((await engine.fillLayout(scan.token, [plan('f0')]))[0]!.status).toBe('review');
      }
      expect(document.querySelectorAll('input')[1]!.value).toBe('');
    },
  );
  it('stops later writes if a page handler replaces a field during the batch', async () => {
    document.body.innerHTML = '<form><input><input></form>';
    const inputs = document.querySelectorAll('input');
    inputs[0]!.addEventListener('input', () => inputs[1]!.replaceWith(inputs[1]!.cloneNode()));
    const engine = new FormEngine();
    const scan = engine.scanLayout();
    const result = await engine.fillLayout(scan.token, [plan('f0'), plan('f1')]);
    expect(result.map((item) => item.status)).toEqual(['filled', 'review']);
    expect(document.querySelectorAll('input')[1]!.value).toBe('');
  });
  it('does not report a detached written control as verified while continuing other targets', async () => {
    document.body.innerHTML = '<form><div>姓名<input></div><div>城市<input></div></form>';
    const first = document.querySelector('input')!;
    first.addEventListener('input', () => first.replaceWith(first.cloneNode()));
    const engine = new FormEngine();
    const scan = engine.scanLayout();
    const results = await engine.fillLayout(scan.token, [plan('f0'), plan('f1', '虚构城市')]);
    expect(results.map((r) => r.status)).toEqual(['failed', 'filled']);
    expect(results[0]!.reason).toContain('重新渲染');
    await engine.undo();
    expect(document.querySelectorAll('input')[1]!.value).toBe('');
  });
  it('accepts geometry drift when the same controls and semantic anchors remain', () => {
    document.body.innerHTML = '<form><input></form>';
    const input = document.querySelector('input')!;
    const measure = vi
      .spyOn(input, 'getBoundingClientRect')
      .mockReturnValue({ x: 10, y: 20, width: 100, height: 20 } as DOMRect);
    const engine = new FormEngine();
    const scan = engine.scanLayout();
    measure.mockReturnValue({ x: 200, y: 20, width: 100, height: 20 } as DOMRect);
    expect(engine.validateLayout(scan.token)).toEqual({ valid: true });
  });
  it('ignores new validation hints, cosmetic attributes and layout shifts during filling', async () => {
    document.body.innerHTML =
      '<form><div><span>姓名</span><input></div><div><span>城市</span><input></div></form>';
    const inputs = document.querySelectorAll('input');
    inputs[0]!.addEventListener('input', () => {
      const hint = document.createElement('p');
      hint.textContent = '已通过校验';
      inputs[0]!.parentElement!.append(hint);
      inputs[0]!.className = 'valid';
      inputs[0]!.setAttribute('aria-invalid', 'false');
      inputs[1]!.style.marginTop = '20px';
    });
    const engine = new FormEngine();
    const scan = engine.scanLayout();
    const results = await engine.fillLayout(scan.token, [
      { ...plan('f0'), evidence: ['t0'] },
      { ...plan('f1', '虚构城市'), evidence: ['t1'] },
    ]);
    expect(results.map((r) => r.status)).toEqual(['filled', 'filled']);
    await engine.undo();
    expect(Array.from(inputs, (input) => input.value)).toEqual(['', '']);
  });
  it.each(['replacement', 'label', 'value', 'disabled', 'options'])(
    'skips only a changed %s target and continues independent fields',
    async (change) => {
      document.body.innerHTML =
        '<form><div><span>姓名</span><input></div><div><span>城市</span><select><option value=""></option><option>虚构城市</option></select></div><div><span>邮箱</span><input></div></form>';
      const controls = document.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
        'input,select',
      );
      controls[0]!.addEventListener('input', () => {
        const target = controls[1] as HTMLSelectElement;
        if (change === 'replacement') target.replaceWith(target.cloneNode(true));
        if (change === 'label')
          target.parentElement!.querySelector('span')!.textContent = '户籍城市';
        if (change === 'value') target.value = '虚构城市';
        if (change === 'disabled') target.disabled = true;
        if (change === 'options') target.options[1]!.text = '其他城市';
      });
      const engine = new FormEngine();
      const scan = engine.scanLayout();
      const results = await engine.fillLayout(scan.token, [
        plan('f0'),
        plan('f1', '虚构城市'),
        plan('f2', 'fake@example.test'),
      ]);
      expect(results.map((r) => r.status)).toEqual(['filled', 'review', 'filled']);
      expect(controls[2]!.value).toBe('fake@example.test');
      await engine.undo();
      expect(controls[0]!.value).toBe('');
      expect(controls[2]!.value).toBe('');
      if (change === 'value') expect(controls[1]!.value).toBe('虚构城市');
    },
  );
  it('ignores changes to an unrelated occupied value during a batch', async () => {
    document.body.innerHTML =
      '<form><div>姓名<input></div><div>城市<input></div><div>已有内容<input value="原内容"></div></form>';
    const inputs = document.querySelectorAll('input');
    inputs[0]!.addEventListener('input', () => {
      inputs[2]!.value = '用户新内容';
    });
    const engine = new FormEngine();
    const scan = engine.scanLayout();
    const results = await engine.fillLayout(scan.token, [plan('f0'), plan('f1', '虚构城市')]);
    expect(results.map((r) => r.status)).toEqual(['filled', 'filled']);
    expect(inputs[2]!.value).toBe('用户新内容');
  });
  it('skips a choice group when a new option appears without changing original nodes', async () => {
    document.body.innerHTML =
      '<form><fieldset><legend>性别</legend><label><input type="radio" name="gender" value="male">男</label><label><input type="radio" name="gender" value="female">女</label></fieldset><div>姓名<input></div></form>';
    const engine = new FormEngine();
    const scan = engine.scanLayout();
    const option = document.createElement('input');
    option.type = 'radio';
    option.name = 'gender';
    option.value = 'unknown';
    option.checked = true;
    document.querySelector('fieldset')!.append(option);
    const result = await engine.fillLayout(scan.token, [plan('f0', '女'), plan('f1')]);
    expect(result.map((r) => r.status)).toEqual(['review', 'filled']);
    expect(option.checked).toBe(true);
  });
  it('validates AI evidence outside the target row without applying it to unrelated rows', async () => {
    document.body.innerHTML =
      '<form><h2>教育经历</h2><div>学校<input></div><div>城市<input></div></form>';
    const engine = new FormEngine();
    const scan = engine.scanLayout();
    document.querySelector('h2')!.firstChild!.textContent = '工作经历';
    const results = await engine.fillLayout(scan.token, [
      { ...plan('f0'), evidence: ['t0', 't1'] },
      { ...plan('f1', '虚构城市'), evidence: ['t2'] },
    ]);
    expect(results.map((r) => r.status)).toEqual(['review', 'filled']);
  });
  it.each(['reorder', 'reparent'])(
    'skips moved repeated experience controls after %s while filling unchanged fields',
    async (change) => {
      document.body.innerHTML =
        '<form><div id="first">学校<input></div><div id="second">学校<input></div><div>姓名<input></div></form>';
      const engine = new FormEngine();
      const scan = engine.scanLayout();
      const first = document.getElementById('first')!;
      const second = document.getElementById('second')!;
      if (change === 'reorder') first.before(second);
      else second.append(first.querySelector('input')!);
      const results = await engine.fillLayout(scan.token, [plan('f0'), plan('f1'), plan('f2')]);
      expect(results[0]!.status).toBe('review');
      if (change === 'reorder') expect(results[1]!.status).toBe('review');
      expect(results[2]!.status).toBe('filled');
    },
  );
  it('preserves existing values and never fills blocked unsupported controls', async () => {
    document.body.innerHTML =
      '<form><input value="existing"><input readonly><input name="password"><input type="checkbox"></form>';
    const engine = new FormEngine();
    const scan = engine.scanLayout();
    const result = await engine.fillLayout(
      scan.token,
      scan.fields.map((field) => plan(field.id)),
    );
    expect(result.every((item) => item.status !== 'filled')).toBe(true);
    expect(document.querySelector('input')!.value).toBe('existing');
  });
});
