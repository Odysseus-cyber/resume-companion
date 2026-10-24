import { beforeEach, describe, expect, it } from 'vitest';
import { FormEngine } from '../../src/engine/dom';
import { matchField } from '../../src/engine/matcher';
import { getAdapter } from '../../src/engine/adapters';
import { demoProfile, facts } from '../../src/domain/model';
import type { Field, MatchContext, PlanItem } from '../../src/engine/types';

const origin = 'https://jobs.example.com';
const ctx = (): MatchContext => ({ facts: facts(demoProfile()), mappings: [], origin });
function field(label: string, overrides: Partial<Field> = {}): Field {
  return {
    id: 'f0',
    signature: 'test',
    label,
    kind: 'text',
    value: '',
    options: [],
    autocomplete: '',
    index: 0,
    blocked: false,
    ...overrides,
  };
}
function fixture(html: string) {
  document.body.innerHTML = html;
  const engine = new FormEngine();
  const scan = engine.scan(origin);
  return { engine, scan };
}
function plan(id: string, value: string): PlanItem {
  return { id, value, path: 'personal.name', confidence: 1, selected: true, source: '测试' };
}
beforeEach(() => {
  document.body.innerHTML = '';
});

describe('field matching with fictional profiles', () => {
  it.each([
    ['姓名', 'personal.name'],
    ['电子邮件', 'personal.email'],
    ['手机号码', 'personal.phone'],
    ['现居城市', 'personal.city'],
    ['性别', 'personal.gender'],
    ['出生日期', 'personal.birthday'],
    ['GitHub 地址', 'personal.github'],
    ['自我评价', 'personal.summary'],
    ['技能特长', 'personal.skills'],
    ['获奖情况', 'personal.awards'],
    ['毕业院校', 'education.0.organization'],
    ['所学专业', 'education.0.major'],
    ['最高学历', 'education.0.degree'],
    ['入学日期', 'education.0.start'],
    ['预计毕业时间', 'education.0.end'],
    ['实习单位', 'experience.0.organization'],
    ['实习岗位', 'experience.0.role'],
    ['工作内容', 'experience.0.description'],
    ['项目名称', 'projects.0.organization'],
    ['项目角色', 'projects.0.role'],
    ['项目介绍', 'projects.0.description'],
  ])('matches %s to %s', (label, path) => {
    const result = matchField(field(label), ctx());
    expect(result.path).toBe(path);
    expect(result.selected).toBe(true);
  });
  it('prioritizes learned mappings over dictionary and autocomplete', () => {
    const context = ctx();
    context.mappings = [{ origin, signature: 'test', path: 'personal.city', label: '测试' }];
    expect(matchField(field('姓名', { autocomplete: 'email' }), context)).toMatchObject({
      path: 'personal.city',
      source: '你的映射',
    });
  });
  it('does not leak mappings across origins', () => {
    const context = ctx();
    context.mappings = [
      {
        origin: 'https://other.example.com',
        signature: 'test',
        path: 'personal.city',
        label: '测试',
      },
    ];
    expect(matchField(field('姓名'), context).path).toBe('personal.name');
  });
  it('ignores stale mappings referencing deleted facts', () => {
    const context = ctx();
    context.mappings = [{ origin, signature: 'test', path: 'custom.deleted', label: '测试' }];
    expect(matchField(field('姓名'), context).path).toBe('personal.name');
  });
  it('uses autocomplete before text labels', () => {
    expect(matchField(field('未知字段', { autocomplete: 'email' }), ctx()).path).toBe(
      'personal.email',
    );
  });
  it('leaves fuzzy matches unselected', () => {
    expect(matchField(field('请填写您的电子邮箱地址'), ctx())).toMatchObject({
      path: 'personal.email',
      selected: false,
    });
  });
  it('does not select empty profile data', () => {
    const context = ctx();
    context.facts[0]!.value = '';
    expect(matchField(field('姓名'), context).selected).toBe(false);
  });
  it('does not select blocked or populated fields', () => {
    expect(matchField(field('姓名', { blocked: true }), ctx()).selected).toBe(false);
    expect(matchField(field('姓名', { value: '已填' }), ctx()).selected).toBe(false);
  });
  it('matches a uniquely labelled custom fact', () => {
    const context = ctx();
    context.facts.push({ path: 'custom.language', label: '外语水平', value: 'CET6' });
    expect(matchField(field('外语水平'), context)).toMatchObject({
      path: 'custom.language',
      value: 'CET6',
      selected: true,
    });
  });
  it('requires review for ambiguous custom labels', () => {
    const context = ctx();
    context.facts.push(
      { path: 'custom.a', label: '外语水平', value: 'CET6' },
      { path: 'custom.b', label: '外语水平', value: 'CET4' },
    );
    expect(matchField(field('外语水平'), context).selected).toBe(false);
  });
});

describe('scan and grouping', () => {
  it('reads aria-labelledby, associated label and placeholder', () => {
    const { scan } = fixture(
      '<span id="label">姓名</span><input aria-labelledby="label"><label for="mail">邮箱</label><input id="mail"><input placeholder="手机号码">',
    );
    expect(scan.fields.map((f) => f.label)).toEqual(['姓名', '邮箱', '手机号码']);
  });
  it('excludes hidden, disabled, readonly, file, password, search and extension UI', () => {
    const { scan } = fixture(
      '<input hidden><input disabled><input readonly><input type="file"><input type="password"><input type="search"><div data-resume-companion><input></div><input aria-label="姓名">',
    );
    expect(scan.fields).toHaveLength(1);
  });
  it.each(['身份证号码', '验证码', '银行卡', '隐私条款', '同意招聘声明', 'passport', 'consent'])(
    'blocks %s',
    (label) => {
      expect(fixture(`<input aria-label="${label}">`).scan.fields[0]!.blocked).toBe(true);
    },
  );
  it('blocks one-time-code fields even with a generic visible label', () => {
    expect(
      fixture('<input aria-label="请输入" autocomplete="one-time-code">').scan.fields[0]!.blocked,
    ).toBe(true);
  });
  it('blocks generic document-number labels', () => {
    expect(fixture('<input aria-label="证件号">').scan.fields[0]!.blocked).toBe(true);
  });
  it('blocks standalone checkboxes', () => {
    expect(fixture('<label><input type="checkbox">订阅通知</label>').scan.fields[0]!.blocked).toBe(
      true,
    );
  });
  it('indexes repeated education cards and matches each profile entry', () => {
    const { scan } = fixture(
      '<section data-section="education"><fieldset><input aria-label="学校名称"><input aria-label="开始日期"></fieldset><fieldset><input aria-label="学校名称"><input aria-label="开始日期"></fieldset></section>',
    );
    const context = ctx();
    context.facts.push(
      { path: 'education.1.organization', label: '第二学校', value: '示例第二大学' },
      { path: 'education.1.start', label: '第二入学', value: '2026-09' },
    );
    expect(scan.fields.map((f) => matchField(f, context).path)).toEqual([
      'education.0.organization',
      'education.0.start',
      'education.1.organization',
      'education.1.start',
    ]);
  });
  it('keeps same-name radio groups in separate fieldsets', () => {
    const { scan } = fixture(
      '<fieldset><legend>第一组</legend><label><input type="radio" name="a" value="1">甲</label></fieldset><fieldset><legend>第二组</legend><label><input type="radio" name="a" value="2">乙</label></fieldset>',
    );
    expect(scan.fields).toHaveLength(2);
    expect(scan.fields[0]!.options).toHaveLength(1);
  });
  it('creates stable unique signatures on rescan', () => {
    const { engine, scan } = fixture('<input aria-label="姓名"><input aria-label="姓名">');
    expect(new Set(scan.fields.map((f) => f.signature)).size).toBe(2);
    expect(engine.scan(origin).fields.map((f) => f.signature)).toEqual(
      scan.fields.map((f) => f.signature),
    );
  });
  it('recognizes newly inserted dynamic controls on rescan', () => {
    const { engine, scan } = fixture('<input aria-label="姓名">');
    document.body.insertAdjacentHTML('beforeend', '<input aria-label="邮箱">');
    expect(scan.fields).toHaveLength(1);
    expect(engine.scan(origin).fields).toHaveLength(2);
  });
  it.each([
    ['https://campus.mokahr.com', 'moka'],
    ['https://test.zhiye.com', 'beisen'],
    ['https://test.italent.cn', 'beisen'],
    ['https://jobs.feishu.cn', 'feishu'],
    ['https://jobs.larkoffice.com', 'feishu'],
    ['https://mokahr.com.evil.example', 'generic'],
  ])('detects domain %s', (url, id) => {
    expect(getAdapter(url).id).toBe(id);
  });
});

describe('fill verification and undo', () => {
  it('uses the native setter so controlled-input trackers receive changes', async () => {
    const { engine, scan } = fixture('<input aria-label="姓名">');
    const input = document.querySelector('input')!;
    let tracker = '';
    let state = '';
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
    Object.defineProperty(input, 'value', {
      configurable: true,
      get() {
        return descriptor.get!.call(this);
      },
      set(value: string) {
        tracker = value;
        descriptor.set!.call(this, value);
      },
    });
    input.addEventListener('input', () => {
      if (input.value !== tracker) {
        state = input.value;
        tracker = input.value;
      }
    });
    expect((await engine.fill(scan.token, [plan('f0', '林知夏')]))[0]!.status).toBe('filled');
    expect(state).toBe('林知夏');
  });
  it('detects a controlled field that rejects the new value', async () => {
    const { engine, scan } = fixture('<input aria-label="姓名">');
    const input = document.querySelector('input')!;
    input.addEventListener('input', () => {
      input.value = '';
    });
    expect((await engine.fill(scan.token, [plan('f0', '林知夏')]))[0]!.status).toBe('failed');
  });
  it('fills textarea and restores it', async () => {
    const { engine, scan } = fixture('<textarea aria-label="自我介绍"></textarea>');
    expect((await engine.fill(scan.token, [plan('f0', '第一行\n第二行')]))[0]!.status).toBe(
      'filled',
    );
    expect((await engine.undo())[0]!.status).toBe('filled');
    expect(document.querySelector('textarea')!.value).toBe('');
  });
  it('preserves existing text even when plan explicitly selects it', async () => {
    const { engine, scan } = fixture('<input value="已有姓名" aria-label="姓名">');
    expect((await engine.fill(scan.token, [plan('f0', '林知夏')]))[0]!.status).toBe('skipped');
    expect(document.querySelector('input')!.value).toBe('已有姓名');
  });
  it('preserves text entered after the scan', async () => {
    const { engine, scan } = fixture('<input aria-label="姓名">');
    document.querySelector('input')!.value = '用户输入';
    expect((await engine.fill(scan.token, [plan('f0', '林知夏')]))[0]!.status).toBe('skipped');
  });
  it('preserves edits made after autofill when undoing', async () => {
    const { engine, scan } = fixture('<input aria-label="姓名">');
    await engine.fill(scan.token, [plan('f0', '林知夏')]);
    document.querySelector('input')!.value = '新姓名';
    expect((await engine.undo())[0]!.status).toBe('skipped');
    expect(document.querySelector('input')!.value).toBe('新姓名');
  });
  it('retains undo after a no-op second fill', async () => {
    const { engine, scan } = fixture('<input aria-label="姓名">');
    await engine.fill(scan.token, [plan('f0', '林知夏')]);
    await engine.fill(scan.token, [plan('f0', '林知夏')]);
    expect((await engine.undo())[0]!.status).toBe('filled');
    expect(document.querySelector('input')!.value).toBe('');
  });
  it('serializes undo against fill and scan', async () => {
    const { engine, scan } = fixture('<input aria-label="姓名">');
    await engine.fill(scan.token, [plan('f0', '林知夏')]);
    const restoring = engine.undo();
    expect(() => engine.scan(origin)).toThrow('正在填写');
    await expect(engine.fill(scan.token, [plan('f0', '新值')])).rejects.toThrow('正在填写');
    await restoring;
    expect(document.querySelector('input')!.value).toBe('');
  });
  it('rejects stale scan tokens', async () => {
    const { engine, scan } = fixture('<input>');
    engine.scan(origin);
    await expect(engine.fill(scan.token, [plan('f0', 'x')])).rejects.toThrow('重新识别');
  });
  it('skips removed fields', async () => {
    const { engine, scan } = fixture('<input>');
    document.body.innerHTML = '';
    expect((await engine.fill(scan.token, [plan('f0', 'x')]))[0]!.status).toBe('review');
  });
  it('skips fields made readonly after scan', async () => {
    const { engine, scan } = fixture('<input>');
    document.querySelector('input')!.readOnly = true;
    expect((await engine.fill(scan.token, [plan('f0', 'x')]))[0]!.status).toBe('review');
  });
  it('does not write blocked sensitive fields', async () => {
    const { engine, scan } = fixture('<input aria-label="身份证">');
    expect((await engine.fill(scan.token, [plan('f0', 'fictional')]))[0]!.status).toBe('skipped');
  });
  it.each([
    ['date', '2003-05-12', '2003-05-12'],
    ['month', '2022-09-01', '2022-09'],
  ])('fills %s values', async (type, value, expected) => {
    const { engine, scan } = fixture(`<input type="${type}">`);
    expect((await engine.fill(scan.token, [plan('f0', value)]))[0]!.status).toBe('filled');
    expect(document.querySelector('input')!.value).toBe(expected);
  });
  it('does not invent a day for month-only dates', async () => {
    const { engine, scan } = fixture('<input type="date">');
    expect((await engine.fill(scan.token, [plan('f0', '2022-09')]))[0]!.status).toBe('failed');
    expect(document.querySelector('input')!.value).toBe('');
  });
  it('rejects values exceeding max length', async () => {
    const { engine, scan } = fixture('<input maxlength="2">');
    expect((await engine.fill(scan.token, [plan('f0', '林知夏')]))[0]!.status).toBe('failed');
  });
  it('reports native validity failures', async () => {
    const { engine, scan } = fixture('<input type="email">');
    expect((await engine.fill(scan.token, [plan('f0', '无效邮件')]))[0]!.status).toBe('failed');
  });
  it('selects degree synonyms and restores the placeholder', async () => {
    const { engine, scan } = fixture(
      '<select><option value="">请选择</option><option value="bachelor">学士</option></select>',
    );
    expect((await engine.fill(scan.token, [plan('f0', '本科')]))[0]!.status).toBe('filled');
    expect(document.querySelector('select')!.value).toBe('bachelor');
    await engine.undo();
    expect(document.querySelector('select')!.value).toBe('');
  });
  it('rejects ambiguous dropdown options without changing selection', async () => {
    const { engine, scan } = fixture(
      '<select><option value="">请选择</option><option value="a">本科</option><option value="b">学士</option></select>',
    );
    expect((await engine.fill(scan.token, [plan('f0', '本科')]))[0]!.status).toBe('failed');
    expect(document.querySelector('select')!.value).toBe('');
  });
  it('fills and undoes multiple select values', async () => {
    const { engine, scan } = fixture(
      '<select multiple><option value="ts">TypeScript</option><option value="py">Python</option></select>',
    );
    expect(scan.fields[0]!.value).toBe('');
    expect((await engine.fill(scan.token, [plan('f0', 'TypeScript，Python')]))[0]!.status).toBe(
      'filled',
    );
    expect(document.querySelector('select')!.selectedOptions.length).toBe(2);
    await engine.undo();
    expect(document.querySelector('select')!.selectedOptions.length).toBe(0);
  });
  it('fills and undoes radio choices', async () => {
    const { engine, scan } = fixture(
      '<fieldset><legend>性别</legend><label><input type="radio" name="gender" value="male">男</label><label><input type="radio" name="gender" value="female">女</label></fieldset>',
    );
    expect((await engine.fill(scan.token, [plan('f0', '女')]))[0]!.status).toBe('filled');
    expect(document.querySelector<HTMLInputElement>('[value=female]')!.checked).toBe(true);
    await engine.undo();
    expect(document.querySelectorAll(':checked')).toHaveLength(0);
  });
  it('fills and undoes checkbox groups', async () => {
    const { engine, scan } = fixture(
      '<fieldset><legend>技能</legend><label><input type="checkbox" name="skills" value="ts">TypeScript</label><label><input type="checkbox" name="skills" value="py">Python</label></fieldset>',
    );
    expect((await engine.fill(scan.token, [plan('f0', 'TypeScript、Python')]))[0]!.status).toBe(
      'filled',
    );
    expect(document.querySelectorAll(':checked')).toHaveLength(2);
    await engine.undo();
    expect(document.querySelectorAll(':checked')).toHaveLength(0);
  });
  it('selects only within the combobox-owned popup and verifies output', async () => {
    const { engine, scan } = fixture(
      '<input role="combobox" aria-controls="popup"><div id="popup"><div role="option">本科</div></div><div role="option">本科</div>',
    );
    const input = document.querySelector('input')!;
    document.querySelector('#popup [role=option]')!.addEventListener('click', () => {
      input.value = '本科';
    });
    expect((await engine.fill(scan.token, [plan('f0', '本科')]))[0]!.status).toBe('filled');
    expect((await engine.undo())[0]!.status).toBe('review');
    expect(input.value).toBe('本科');
  });
  it('requires manual selection when custom popup ownership is absent', async () => {
    const { engine, scan } = fixture('<input role="combobox"><div role="option">本科</div>');
    expect((await engine.fill(scan.token, [plan('f0', '本科')]))[0]!.status).toBe('failed');
  });
});

describe('repeated cards and mapping scope regressions', () => {
  it('does not count nested degree radio fieldsets as education cards', () => {
    const { scan } = fixture(
      '<section data-section="education"><fieldset><input aria-label="学校名称"><fieldset><legend>学历</legend><label><input type="radio" name="degree0">本科</label><label><input type="radio" name="degree0">硕士</label></fieldset><input aria-label="专业"></fieldset><fieldset><input aria-label="学校名称"><fieldset><legend>学历</legend><label><input type="radio" name="degree1">本科</label><label><input type="radio" name="degree1">硕士</label></fieldset><input aria-label="专业"></fieldset></section>',
    );
    expect(scan.fields.map((f) => f.index)).toEqual([0, 0, 0, 1, 1, 1]);
    expect(scan.fields.map((f) => matchField(f, ctx()).path)).toEqual([
      'education.0.organization',
      'education.0.degree',
      'education.0.major',
      'education.1.organization',
      'education.1.degree',
      'education.1.major',
    ]);
  });
  it('requires explicit mappings for ungrouped repeated schools', () => {
    const { scan } = fixture('<input aria-label="学校"><input aria-label="学校名称">');
    expect(scan.fields.map((f) => matchField(f, ctx()).selected)).toEqual([false, false]);
    expect(scan.fields.every((f) => !!f.reviewReason)).toBe(true);
    const context = ctx();
    context.mappings.push({
      origin,
      signature: scan.fields[1]!.signature,
      path: 'education.0.organization',
      label: '学校名称',
    });
    expect(matchField(scan.fields[1]!, context).selected).toBe(true);
  });
  it('does not assume repeated fields inside a single section are separate entries', () => {
    const { scan } = fixture(
      '<section data-section="education"><div><input aria-label="学校"></div><div><input aria-label="学校"></div></section>',
    );
    expect(scan.fields.map((f) => matchField(f, ctx()).selected)).toEqual([false, false]);
  });
  it('keeps checkbox option labels separate from the field label', async () => {
    const { engine, scan } = fixture(
      '<div role="group" aria-labelledby="skills-label"><span id="skills-label">技能</span><label><input type="checkbox" name="skills" value="ts">TypeScript</label><label><input type="checkbox" name="skills" value="py">Python</label></div>',
    );
    expect(scan.fields[0]!.label).toBe('技能');
    expect(scan.fields[0]!.options.map((o) => o.label)).toEqual(['TypeScript', 'Python']);
    expect((await engine.fill(scan.token, [plan('f0', 'Python')]))[0]!.status).toBe('filled');
    expect(document.querySelector<HTMLInputElement>('[value=py]')!.checked).toBe(true);
  });
  it('scopes signatures by page path without persisting query strings', () => {
    const { engine } = fixture('<input aria-label="姓名">');
    const a = engine.scan(origin + '/apply/a?secret=private').fields[0]!.signature;
    const b = engine.scan(origin + '/apply/b?secret=private').fields[0]!.signature;
    expect(a).not.toBe(b);
    expect(a).not.toContain('private');
    expect(a).toBe(engine.scan(origin + '/apply/a?other=x').fields[0]!.signature);
  });
  it('scopes learned mappings by the containing form', () => {
    const { engine } = fixture('<form id="candidate"><input aria-label="姓名"></form>');
    const a = engine.scan(origin).fields[0]!.signature;
    document.querySelector('form')!.id = 'referrer';
    expect(engine.scan(origin).fields[0]!.signature).not.toBe(a);
  });
  it('requires manual restoration of a non-native combobox without pretending success', async () => {
    const { engine, scan } = fixture(
      '<button role="combobox" aria-controls="menu" aria-label="学历"></button><div id="menu"><div role="option">本科</div></div>',
    );
    const combo = document.querySelector('button')!;
    document.querySelector('[role=option]')!.addEventListener('click', () => {
      combo.textContent = '本科';
    });
    const result = await engine.fill(scan.token, [plan('f0', '本科')]);
    expect(result[0]!.status).toBe('filled');
    expect(result[0]!.reason).toContain('手动');
    const undo = await engine.undo();
    expect(undo[0]!.status).toBe('review');
    expect(undo[0]!.reason).toContain('手动');
    expect(combo.textContent).toBe('本科');
  });
});
