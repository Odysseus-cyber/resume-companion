import { z } from 'zod';
import { formTemplateSchema } from './templates';

export const sectionNames = {
  education: '教育经历',
  experience: '实习 / 工作',
  projects: '项目经历',
} as const;
export type Section = keyof typeof sectionNames;
const text = z.string().max(20000);
export const personalLabels = {
  name: '姓名',
  email: '邮箱',
  phone: '手机号码',
  city: '现居住地（城市）',
  highestEducation: '最高学历',
  studyMode: '最高学历对应的学习形式',
  householdLocation: '户口所在地',
  ethnicity: '民族',
  gender: '性别',
  birthday: '出生日期',
  website: '个人网站',
  github: 'GitHub',
  summary: '自我介绍',
  skills: '技能',
  awards: '获奖经历',
} as const;
export const entryLabels = {
  organization: '学校 / 公司 / 项目名称',
  major: '专业',
  degree: '学历',
  role: '职位 / 角色',
  start: '开始日期',
  end: '结束日期',
  description: '经历描述',
} as const;
export const entrySchema = z.object({
  id: z.string().min(1),
  organization: text,
  major: text,
  degree: text,
  role: text,
  start: text,
  end: text,
  description: text,
});
export const profileSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).max(100),
    personal: z.object({
      name: text,
      email: text,
      phone: text,
      city: text,
      highestEducation: text,
      studyMode: text,
      householdLocation: text,
      ethnicity: text,
      gender: text,
      birthday: text,
      website: text,
      github: text,
      summary: text,
      skills: text,
      awards: text,
    }),
    education: z.array(entrySchema).max(30),
    experience: z.array(entrySchema).max(30),
    projects: z.array(entrySchema).max(30),
    custom: z
      .array(z.object({ id: z.string().min(1), label: z.string().min(1).max(100), value: text }))
      .max(100),
  })
  .refine(
    (p) =>
      [p.education, p.experience, p.projects, p.custom].every(
        (items) => new Set(items.map((i) => i.id)).size === items.length,
      ),
    '经历和自定义字段的 ID 必须在各自分组内唯一',
  );
export type Profile = z.infer<typeof profileSchema>;
export type Entry = z.infer<typeof entrySchema>;
export const mappingSchema = z.object({
  origin: z.string(),
  signature: z.string(),
  path: z.string(),
  label: z.string(),
});
export type Mapping = z.infer<typeof mappingSchema>;
export const settingsSchema = z.object({
  aiEnabled: z.boolean(),
  endpoint: z.string(),
  model: z.string(),
  // Omitted by older backups: retain the historical 30-second default. null means unlimited.
  timeoutSeconds: z.number().int().min(1).max(86400).nullable().optional(),
});
export const dbSchema = z
  .object({
    schemaVersion: z.literal(3),
    profiles: z.array(profileSchema).min(1).max(30),
    activeId: z.string(),
    mappings: z.array(mappingSchema).max(5000),
    templates: z.array(formTemplateSchema).max(200),
    settings: settingsSchema,
  })
  .refine((db) => db.profiles.some((p) => p.id === db.activeId), '当前简历不存在')
  .refine((db) => new Set(db.profiles.map((p) => p.id)).size === db.profiles.length, '简历 ID 重复')
  .refine(
    (db) => new Set(db.templates.map((template) => template.id)).size === db.templates.length,
    '模板 ID 重复',
  );
export type Database = z.infer<typeof dbSchema>;

export function emptyEntry(): Entry {
  return {
    id: crypto.randomUUID(),
    organization: '',
    major: '',
    degree: '',
    role: '',
    start: '',
    end: '',
    description: '',
  };
}
export function emptyProfile(name = '我的校招简历'): Profile {
  return {
    id: crypto.randomUUID(),
    name,
    personal: {
      name: '',
      email: '',
      phone: '',
      city: '',
      highestEducation: '',
      studyMode: '',
      householdLocation: '',
      ethnicity: '',
      gender: '',
      birthday: '',
      website: '',
      github: '',
      summary: '',
      skills: '',
      awards: '',
    },
    education: [],
    experience: [],
    projects: [],
    custom: [],
  };
}
export function defaultDatabase(): Database {
  const p = emptyProfile();
  // A not-yet-persisted database must have the same identity across extension pages.
  p.id = 'local-default';
  return {
    schemaVersion: 3,
    profiles: [p],
    activeId: p.id,
    mappings: [],
    templates: [],
    settings: { aiEnabled: false, endpoint: '', model: '' },
  };
}
function migrateLegacyProfile(value: unknown): Profile {
  // Only the four fields introduced in v2 receive defaults; invalid legacy data still fails.
  const legacy = z
    .object({ personal: z.record(z.string(), z.unknown()) })
    .passthrough()
    .parse(value);
  return profileSchema.parse({
    ...legacy,
    personal: {
      highestEducation: '',
      studyMode: '',
      householdLocation: '',
      ethnicity: '',
      ...legacy.personal,
    },
  });
}
export function migrate(value: unknown): Database {
  // v0 was the unversioned single-profile prototype; never overwrite unknown newer schemas.
  if (typeof value === 'object' && value !== null) {
    if ('profile' in value && !('schemaVersion' in value)) {
      const p = migrateLegacyProfile(value.profile);
      const defaults = defaultDatabase();
      return dbSchema.parse({
        ...defaults,
        profiles: [p],
        activeId: p.id,
        mappings: 'mappings' in value ? value.mappings : defaults.mappings,
        settings: 'settings' in value ? value.settings : defaults.settings,
      });
    }
    if ('schemaVersion' in value && value.schemaVersion === 1) {
      const legacy = z
        .object({ profiles: z.array(z.unknown()) })
        .passthrough()
        .parse(value);
      return dbSchema.parse({
        ...legacy,
        schemaVersion: 3,
        templates: [],
        profiles: legacy.profiles.map(migrateLegacyProfile),
      });
    }
    if ('schemaVersion' in value && value.schemaVersion === 2) {
      // v2 already has all personal fields; only templates are introduced here.
      return dbSchema.parse({ ...value, schemaVersion: 3, templates: [] });
    }
  }
  return dbSchema.parse(value);
}
export interface Fact {
  path: string;
  label: string;
  value: string;
}
export function facts(profile: Profile): Fact[] {
  const list: Fact[] = Object.entries(personalLabels).map(([key, label]) => ({
    path: `personal.${key}`,
    label,
    value: profile.personal[key as keyof Profile['personal']],
  }));
  for (const section of Object.keys(sectionNames) as Section[]) {
    profile[section].forEach((entry, index) => {
      for (const [key, label] of Object.entries(entryLabels)) {
        list.push({
          path: `${section}.${index}.${key}`,
          label: `${sectionNames[section]} ${index + 1} · ${label}`,
          value: entry[key as keyof Entry],
        });
      }
    });
  }
  profile.custom.forEach((c) =>
    list.push({ path: `custom.${c.id}`, label: c.label, value: c.value }),
  );
  return list;
}
export function demoProfile(): Profile {
  const p = emptyProfile('林知夏 · 虚构演示');
  p.id = 'demo';
  p.personal = {
    ...p.personal,
    name: '林知夏',
    email: 'zhixia@example.com',
    phone: '13800000000',
    city: '杭州',
    gender: '女',
    birthday: '2003-05-12',
    website: 'https://example.com',
    github: 'https://github.com/example',
    summary: '喜欢把复杂问题拆解为清晰、可验证的步骤。希望从事前端开发实习。',
    skills: 'TypeScript, React, Python',
    awards: '校级创新项目优秀奖（虚构）',
  };
  p.education = [
    {
      ...emptyEntry(),
      organization: '示例大学',
      major: '计算机科学与技术',
      degree: '本科',
      start: '2022-09',
      end: '2026-06',
      description: '主修数据结构、软件工程。',
    },
  ];
  p.experience = [
    {
      ...emptyEntry(),
      organization: '示例科技',
      role: '前端开发实习生',
      start: '2025-06',
      end: '2025-09',
      description: '参与组件开发与表单体验改进。',
    },
  ];
  p.projects = [
    {
      ...emptyEntry(),
      organization: '校园活动助手',
      role: '前端开发',
      start: '2024-09',
      end: '2025-01',
      description: '为校园活动设计报名与管理界面。',
    },
  ];
  return p;
}
