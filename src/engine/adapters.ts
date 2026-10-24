import type { SiteAdapter } from './types';
// Domain detection is not a claim of compatibility with every tenant.
// All three reuse the tested DOM engine; tenant-specific selectors belong here.
export const adapters: SiteAdapter[] = [
  {
    id: 'moka',
    name: 'Moka · 实验适配',
    matches: (u) => /(^|\.)mokahr\.com$/.test(u.hostname),
    sectionSelectors: ['[data-section]', 'fieldset', '[class*="experience-item"]'],
    identify: () => undefined,
  },
  {
    id: 'beisen',
    name: '北森 · 实验适配',
    matches: (u) => /(^|\.)(zhiye\.com|italent\.cn)$/.test(u.hostname),
    sectionSelectors: ['[data-section]', 'fieldset', '[class*="resume-item"]'],
    identify: () => undefined,
  },
  {
    id: 'feishu',
    name: '飞书招聘 · 实验适配',
    matches: (u) => /(^|\.)(feishu\.cn|larkoffice\.com)$/.test(u.hostname),
    sectionSelectors: ['[data-section]', 'fieldset', '[class*="experience-item"]'],
    identify: () => undefined,
  },
  {
    id: 'generic',
    name: '通用表单',
    matches: () => true,
    sectionSelectors: ['[data-section]', 'fieldset'],
    identify: () => undefined,
  },
];
export function getAdapter(url: string): SiteAdapter {
  return adapters.find((a) => a.matches(new URL(url)))!;
}
