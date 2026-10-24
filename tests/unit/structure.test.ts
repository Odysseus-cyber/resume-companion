import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FormEngine } from '../../src/engine/dom';
import { matchField } from '../../src/engine/matcher';
import { demoProfile, facts } from '../../src/domain/model';

const origin = 'https://fictional.zhiye.com';
function scan(html: string) {
  document.body.innerHTML = html;
  return new FormEngine().scan(origin).fields;
}
beforeEach(() => {
  document.body.innerHTML = '';
});

describe('bounded structural field labels', () => {
  it('recovers nested field labels instead of generic placeholders', () => {
    const fields = scan(`<form>
      <div class="form-item"><div class="form-item-label"><span>毕业院校</span></div>
        <div class="control"><div class="input-wrapper"><input placeholder="请输入"></div></div>
      </div>
      <div class="form-item"><div class="form-item-label"><span>专业名称</span></div>
        <div class="control"><div class="input-wrapper"><input placeholder="请输入"></div></div>
      </div></form>`);
    expect(fields.map((f) => f.label)).toEqual(['毕业院校', '专业名称']);
  });

  it('does not associate the first label with multiple sibling controls', () => {
    const fields = scan(`<div><span class="label">学校</span>
      <div><input placeholder="第一个字段"></div>
      <div><input placeholder="第二个字段"></div></div>`);
    expect(fields.map((f) => f.label)).toEqual(['第一个字段', '第二个字段']);
  });

  it('does not borrow a label explicitly associated with a different control', () => {
    expect(
      scan(
        '<div><label for="other">学校</label><div><input id="target" placeholder="请输入"></div></div>',
      )[0]!.label,
    ).toBe('请输入');
  });

  it('does not search arbitrary ancestors for a label', () => {
    const nested = '<div>'.repeat(6) + '<input placeholder="请输入">' + '</div>'.repeat(6);
    expect(
      scan(`<section><span class="label">不相关的标题</span>${nested}</section>`)[0]!.label,
    ).toBe('请输入');
  });

  it('excludes current values and option text from wrapping labels', () => {
    const fields = scan(`<label>学校名称<textarea>虚构已填大学</textarea></label>
      <label>学历<select><option>虚构已选学历</option></select></label>
      <div class="item-label">现居城市<button role="combobox">虚构已选城市</button></div>`);
    expect(fields.map((f) => f.label)).toEqual(['学校名称', '学历', '现居城市']);
    expect(fields.map((f) => f.value)).toEqual(['虚构已填大学', '虚构已选学历', '虚构已选城市']);
  });

  it('excludes hidden text, editable values and controls from labelled-by descriptions', () => {
    const fields = scan(`<div id="caption">学校名称
      <span hidden>虚构隐藏资料</span><span aria-hidden="true">虚构隐藏信息</span>
      <span contenteditable="true">虚构编辑内容</span><textarea>虚构已有内容</textarea>
      </div><input aria-labelledby="caption">`);
    expect(fields.at(-1)!.label).toBe('学校名称');
  });

  it('recovers plain text captions without framework label classes', () => {
    const fields = scan(`<form>
      <div><span>毕业院校</span><div><input></div></div>
      <div><div>专业名称</div><input></div>
      <div><p>获奖经历</p><div><textarea></textarea></div></div>
      <dl><dt>现居城市</dt><dd><input></dd></dl>
      <table><tbody><tr><th>电子邮箱</th><td><input></td></tr></tbody></table>
    </form>`);
    expect(fields.map((field) => field.label)).toEqual([
      '毕业院校',
      '专业名称',
      '获奖经历',
      '现居城市',
      '电子邮箱',
    ]);
    expect(fields.every((field) => field.bindingStable)).toBe(true);
  });

  it('reads static labels in display contents wrappers with no own layout rectangle', () => {
    document.body.innerHTML =
      '<div style="display:contents"><span style="display:contents">学校</span><div><input></div></div>';
    const input = document.querySelector('input')!;
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Chrome');
    vi.spyOn(input, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
    try {
      const field = new FormEngine().scan(origin).fields[0]!;
      expect(field.label).toBe('学校');
      expect(field.bindingStable).toBe(true);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('keeps date pair titles as context without assigning the same label to both controls', () => {
    const fields = scan(`<div><span>在校时间</span>
      <div><input type="date"></div><span>至</span><div><input type="date"></div>
      </div>`);
    expect(fields.map((field) => field.label)).toEqual(['未命名字段', '未命名字段']);
    expect(fields.map((field) => field.context)).toEqual([['在校时间'], ['在校时间']]);
    expect(fields.every((field) => field.bindingStable === false)).toBe(true);
  });

  it('retains multiple plausible captions as context rather than picking the first', () => {
    const field = scan('<div><span>学校</span><span>院系</span><input></div>')[0]!;
    expect(field.label).toBe('未命名字段');
    expect(field.context).toEqual(['学校', '院系']);
    expect(field.bindingStable).toBe(false);
  });

  it('does not borrow sibling field labels, page headings, or promotional paragraphs', () => {
    const fields = scan(`<form><h2>欢迎加入我们的团队</h2>
      <div><p>欢迎填写简历。我们期待与你共同成长！</p><p>欢迎加入我们</p><input></div>
      <div><span>学校</span><input></div><div><input></div>
      </form>`);
    expect(fields.map((field) => field.label)).toEqual(['未命名字段', '学校', '未命名字段']);
    expect(fields[0]!.context).toEqual([]);
    expect(fields[2]!.context).toEqual([]);
  });

  it('excludes stylesheet-hidden ancestors and text including explicit label references', () => {
    const fields = scan(`<style>.private { display:none } .concealed { visibility:hidden }</style>
      <div class="private"><input aria-label="不应扫描"></div>
      <div><span class="private">虚构隐藏资料</span><span>学校</span><input></div>
      <div class="concealed"><span id="hidden-caption">虚构隐藏姓名</span></div>
      <input aria-labelledby="hidden-caption">
      <span id="visible-caption">专业<span class="private">虚构隐藏专业</span></span>
      <input aria-labelledby="visible-caption">`);
    expect(fields.map((field) => field.label)).toEqual(['学校', '未命名字段', '专业']);
    expect(JSON.stringify(fields.map((field) => [field.label, field.context]))).not.toContain(
      '虚构隐藏',
    );
  });

  it('does not include editable values, select options or combobox contents in context', () => {
    const fields = scan(`<div><span>日期范围</span><input value="虚构已填值">
      <textarea>虚构文本值</textarea><select><option>虚构选项值</option></select>
      <div role="combobox">虚构城市值</div>
      <div contenteditable="true">虚构编辑值</div>
      <span role="option">虚构菜单值</span></div>`);
    expect(fields.every((field) => field.context?.join(' ') === '日期范围')).toBe(true);
    expect(JSON.stringify(fields.map((field) => [field.label, field.context]))).not.toContain(
      '虚构',
    );
  });

  it('marks generated names and generic prompts unsafe for persistent binding', () => {
    const fields = scan(
      '<form><div><input name="field_123"></div><div><input placeholder="请输入"></div><div><input></div></form>',
    );
    expect(fields.every((field) => field.bindingStable === false)).toBe(true);
  });

  it('keeps readonly controls and unsupported widgets excluded', () => {
    expect(
      scan(
        '<input readonly placeholder="日期"><div class="custom-select">学校</div><input aria-label="姓名">',
      ),
    ).toHaveLength(1);
  });
});

describe('nested section headings and repeat ambiguity', () => {
  it('uses nested section headers and known repeat cards without mixing entries', () => {
    const fields = scan(`<form><section>
      <header><div><h2>教育经历</h2></div></header>
      <div class="resume-item"><div class="item-label">学校名称</div><div><input></div></div>
      <div class="resume-item"><div class="item-label">学校名称</div><div><input></div></div>
      </section><section><div><h2>项目经历</h2></div>
      <div class="resume-item"><div class="item-label">项目名称</div><div><input></div></div>
      </section></form>`);
    expect(fields.map((f) => [f.section, f.index])).toEqual([
      ['education', 0],
      ['education', 1],
      ['projects', 0],
    ]);
    expect(fields.every((f) => !f.reviewReason)).toBe(true);
  });

  it('retains review when repeated entries lack reliable card boundaries', () => {
    const fields = scan(`<section><div><h2>教育经历</h2></div>
      <div><div class="label">学校名称</div><div><input></div></div>
      <div><div class="label">学校名称</div><div><input></div></div></section>`);
    expect(fields.map((f) => f.index)).toEqual([0, 0]);
    expect(fields.every((f) => !!f.reviewReason)).toBe(true);
    expect(
      fields.map(
        (f) => matchField(f, { origin, facts: facts(demoProfile()), mappings: [] }).selected,
      ),
    ).toEqual([false, false]);
  });

  it('does not apply a heading in a sibling section to unrelated fields', () => {
    const fields = scan(`<form><section><header><h2>教育经历</h2></header>
      <input aria-label="学校"></section><div><input aria-label="公司"></div></form>`);
    expect(fields.map((f) => f.section)).toEqual(['education', undefined]);
  });

  it('does not select one of several section headings in a broad wrapper', () => {
    expect(
      scan(
        '<form><header><h2>教育经历</h2><h2>工作经历</h2></header><input aria-label="名称"></form>',
      )[0]!.section,
    ).toBeUndefined();
  });
});
