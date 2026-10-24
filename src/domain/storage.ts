import { browser } from 'wxt/browser';
import { defaultDatabase, migrate, dbSchema, type Database } from './model';
import type { FormTemplate } from './templates';
export const DATA_KEY = 'resume-companion';
export async function loadDatabase(): Promise<Database> {
  const result = await browser.storage.local.get(DATA_KEY);
  return result[DATA_KEY] === undefined ? defaultDatabase() : migrate(result[DATA_KEY]);
}
export async function saveDatabase(db: Database) {
  await browser.storage.local.set({ [DATA_KEY]: dbSchema.parse(db) });
}
export async function updateTemplates(
  transform: (templates: FormTemplate[]) => FormTemplate[],
): Promise<Database> {
  // Read at mutation time, rather than writing the panel's potentially stale
  // copy of profiles, mappings and settings back alongside its templates.
  const latest = await loadDatabase();
  const updated = dbSchema.parse({ ...latest, templates: transform(latest.templates) });
  await saveDatabase(updated);
  return updated;
}
export async function saveSessionKey(key: string) {
  await browser.storage.session.set({ aiKey: key });
}
export async function readSessionKey(): Promise<string> {
  return ((await browser.storage.session.get('aiKey')).aiKey as string) || '';
}
