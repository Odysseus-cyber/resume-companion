import type { Field, MatchContext, PlanItem } from './types';
import { getAdapter } from './adapters';
export function normalize(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s*：:()（）_\-/]/g, '');
}
const aliases: Record<string, string[]> = {
  'personal.name': ['姓名', '真实姓名', '中文姓名', '应聘者姓名', 'name', 'fullname'],
  'personal.email': ['邮箱', '电子邮箱', '电子邮件', '联系邮箱', 'email', 'emailaddress'],
  'personal.phone': [
    '手机',
    '手机号',
    '手机号码',
    '联系电话',
    '电话',
    'phone',
    'telephone',
    'mobile',
  ],
  'personal.city': ['现居城市', '现居住地', '居住城市', '所在城市', 'city'],
  'personal.gender': ['性别', 'gender'],
  'personal.birthday': ['出生日期', '生日', 'birthday', 'dateofbirth'],
  'personal.website': ['个人网站', '个人主页', 'website', 'portfolio'],
  'personal.github': ['github', 'github地址'],
  'personal.summary': ['自我介绍', '自我评价', '个人简介', 'summary'],
  'personal.skills': ['技能', '专业技能', '技能特长', 'skills'],
  'personal.awards': ['获奖经历', '获奖情况', '荣誉奖项', 'awards'],
  'education.0.organization': ['学校', '学校名称', '毕业院校', '院校名称', 'school', 'university'],
  'education.0.major': ['专业', '所学专业', '专业名称', 'major'],
  'education.0.degree': ['学历', '最高学历', 'degree'],
  'education.0.start': ['入学时间', '入学日期'],
  'education.0.end': ['毕业时间', '毕业日期', '预计毕业时间'],
  'experience.0.organization': ['公司名称', '实习单位', '工作单位', '公司', 'company'],
  'experience.0.role': ['职位', '职务', '岗位名称', '实习岗位', 'jobtitle'],
  'experience.0.description': ['工作描述', '实习描述', '工作内容', '实习内容'],
  'projects.0.organization': ['项目名称', '项目', 'projectname'],
  'projects.0.role': ['项目角色', '担任角色'],
  'projects.0.description': ['项目描述', '项目介绍', '项目内容'],
};
const autocomplete: Record<string, string> = {
  name: 'personal.name',
  email: 'personal.email',
  tel: 'personal.phone',
  sex: 'personal.gender',
  bday: 'personal.birthday',
  url: 'personal.website',
  'address-level2': 'personal.city',
};
export function matchField(field: Field, ctx: MatchContext): PlanItem {
  let path = '';
  let source = '未匹配';
  let confidence = 0;
  const learned = ctx.mappings.find(
    (m) =>
      field.bindingStable !== false &&
      m.origin === ctx.origin &&
      m.signature === field.signature &&
      ctx.facts.some((f) => f.path === m.path),
  );
  if (learned) {
    path = learned.path;
    source = '你的映射';
    confidence = 1;
  }
  if (!path) {
    const p = getAdapter(ctx.origin).identify(field);
    if (p) {
      path = p;
      source = '站点适配';
      confidence = 0.99;
    }
  }
  if (!path && autocomplete[field.autocomplete]) {
    path = autocomplete[field.autocomplete]!;
    source = '标准字段';
    confidence = 0.99;
  }
  const label = normalize(field.label);
  if (!path && field.section) {
    let key = '';
    if (/^(开始日期|开始时间|起始时间|startdate)$/.test(label)) key = 'start';
    if (/^(结束日期|结束时间|enddate)$/.test(label)) key = 'end';
    if (/^(描述|经历描述|description)$/.test(label)) key = 'description';
    if (/^(名称|单位名称|organization)$/.test(label)) key = 'organization';
    if (key) {
      path = `${field.section}.${field.index}.${key}`;
      source = '经历分组';
      confidence = 0.97;
    }
  }
  if (!path) {
    const hits = Object.entries(aliases).filter(([, words]) =>
      words.some((w) => normalize(w) === label),
    );
    if (hits.length === 1) {
      path = hits[0]![0];
      source = '字段词典';
      confidence = 0.98;
    }
  }
  if (!path) {
    const custom = ctx.facts.filter(
      (f) => f.path.startsWith('custom.') && normalize(f.label) === label,
    );
    if (custom.length === 1) {
      path = custom[0]!.path;
      source = '自定义字段';
      confidence = 0.98;
    }
  }
  if (!path) {
    const hits = Object.entries(aliases).filter(([, words]) =>
      words.some((w) => normalize(w).length >= 3 && label.includes(normalize(w))),
    );
    if (hits.length === 1) {
      path = hits[0]![0];
      source = '相似字段 · 请核对';
      confidence = 0.65;
    }
  }
  if (field.section && /^(education|experience|projects)\.0\./.test(path) && !learned) {
    const [, , key] = path.split('.');
    path = `${field.section}.${field.index}.${key}`;
  }
  if (field.reviewReason && !learned) {
    source = field.reviewReason;
    confidence = Math.min(confidence, 0.5);
  }
  const value = ctx.facts.find((f) => f.path === path)?.value || '';
  return {
    id: field.id,
    path,
    value,
    source,
    confidence,
    selected: !!value && confidence >= 0.9 && !field.blocked && !field.value,
  };
}
