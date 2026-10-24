import { z } from 'zod';

// Persistent templates contain only declarative metadata. Current scan IDs and
// values belong to an individual operation and must never be stored here.
export const templateFieldSchema = z
  .object({
    id: z.string().min(1).max(100),
    label: z.string().min(1).max(200),
    path: z
      .string()
      .max(300)
      .regex(
        /^(?:personal\.[a-zA-Z]+|(?:education|experience|projects)\.\{index\}\.[a-zA-Z]+|custom\.[^\s]+)$/,
        '模板资料路径无效',
      ),
    section: z.enum(['education', 'experience', 'projects']).optional(),
    regionAnchors: z.array(z.string().min(1).max(200)).max(8).optional(),
    index: z.number().int().min(0).max(29),
    anchors: z.array(z.string().min(1).max(300)).min(1).max(16),
    kind: z.enum([
      'text',
      'textarea',
      'date',
      'month',
      'select',
      'radio',
      'checkbox',
      'combobox',
      'unsupported',
    ]),
    customProfileId: z.string().min(1).max(100).optional(),
    confirmed: z.literal(true),
  })
  .strict()
  .refine(
    (field) => !field.path.startsWith('custom.') || Boolean(field.customProfileId),
    '自定义资料字段必须关联简历',
  );

export const formTemplateSchema = z
  .object({
    version: z.literal(1),
    id: z.string().min(1).max(100),
    name: z.string().min(1).max(100),
    adapter: z.string().min(1).max(100),
    origin: z
      .string()
      .max(500)
      .refine((value) => {
        try {
          const url = new URL(value);
          return ['https:', 'http:'].includes(url.protocol) && url.origin === value;
        } catch {
          return false;
        }
      }, '模板来源只能包含网站 origin'),
    enabled: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    fields: z.array(templateFieldSchema).min(1).max(500),
  })
  .strict()
  .refine(
    (template) => new Set(template.fields.map((field) => field.id)).size === template.fields.length,
    '模板字段 ID 重复',
  );

export type TemplateField = z.infer<typeof templateFieldSchema>;
export type FormTemplate = z.infer<typeof formTemplateSchema>;
