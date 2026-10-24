import { personalLabels, type Fact } from './model';

// Conservative equivalences, not substring/fuzzy matching. The model handles broader semantics.
const groups: Record<string, string[]> = {
  name: ['姓名', '真实姓名', '中文姓名'],
  phone: ['手机号码', '手机号', '手机', '联系电话', '联系手机'],
  email: ['邮箱', '电子邮箱', '电子邮件', '邮箱地址'],
  city: ['现居住地（城市）', '现居住地', '现居城市', '当前居住城市', '居住城市'],
  highestEducation: ['最高学历', '最高教育程度'],
  studyMode: ['最高学历对应的学习形式', '学习形式', '学习方式'],
  householdLocation: ['户口所在地', '户籍所在地', '户籍地址'],
  ethnicity: ['民族'],
  birthday: ['出生日期', '出生年月', '生日'],
  school: ['毕业院校', '学校名称', '学校', '院校名称', '毕业学校'],
  enrollment: ['入学时间', '入学日期'],
  graduation: ['毕业时间', '毕业日期', '预计毕业时间'],
  company: ['工作单位', '公司名称', '公司', '单位名称', '公司 / 单位名称'],
  project: ['项目名称'],
  major: ['专业', '所学专业', '专业名称'],
  degree: ['学历', '教育程度'],
  job: ['职位', '职务', '岗位名称'],
  projectRole: ['项目角色'],
  schoolRole: ['在校职务'],
};

function normalize(label: string): string {
  return label
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s·/()：:*]/g, '');
}

function meaning(label: string) {
  const value = normalize(label);
  return (
    Object.entries(groups).find(([, aliases]) =>
      aliases.some((a) => normalize(a) === value),
    )?.[0] || `literal:${value}`
  );
}

function parseLabel(label: string): { meaning: string; section?: string; index?: number } {
  const scoped = label
    .normalize('NFKC')
    .match(/^(教育经历|实习\s*\/\s*工作|工作经历|实习经历|项目经历)\s*(\d+)\s*[·:：]\s*(.+)$/);
  if (!scoped) return { meaning: meaning(label) };
  return {
    meaning: meaning(scoped[3]!),
    section:
      scoped[1] === '教育经历' ? 'education' : scoped[1] === '项目经历' ? 'projects' : 'experience',
    index: Number(scoped[2]) - 1,
  };
}

function factMeaning(fact: Fact) {
  const [section, index, property] = fact.path.split('.');
  if (section === 'personal' && index && index in personalLabels)
    return { meaning: meaning(personalLabels[index as keyof typeof personalLabels]) };
  if (
    ['education', 'experience', 'projects'].includes(section || '') &&
    /^\d+$/.test(index || '')
  ) {
    const contextual: Record<string, string> = {
      'education.organization': 'school',
      'education.start': 'enrollment',
      'education.end': 'graduation',
      'experience.organization': 'company',
      'projects.organization': 'project',
      'education.role': 'schoolRole',
      'experience.role': 'job',
      'projects.role': 'projectRole',
    };
    return {
      meaning:
        contextual[`${section}.${property}`] ||
        (section !== 'education' && (property === 'major' || property === 'degree')
          ? `scoped:${section}.${property}`
          : parseLabel(fact.label).meaning),
      section,
      index: Number(index),
    };
  }
  return parseLabel(fact.label);
}

/** Local-only reuse/deduplication. Multiple results deliberately preserve ambiguity. */
export function findEquivalentFacts(label: string, facts: Fact[]): Fact[] {
  if (!normalize(label)) return [];
  const wanted = parseLabel(label);
  return facts.filter((fact) => {
    const candidate = factMeaning(fact);
    return (
      candidate.meaning === wanted.meaning &&
      (wanted.section === undefined || candidate.section === wanted.section) &&
      (wanted.index === undefined || candidate.index === wanted.index)
    );
  });
}
