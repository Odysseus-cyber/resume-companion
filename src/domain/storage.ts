import { browser } from 'wxt/browser';
import { defaultDatabase, migrate, dbSchema, type Database } from './model';
export const DATA_KEY = 'resume-companion';
export async function loadDatabase(): Promise<Database> {
  const result = await browser.storage.local.get(DATA_KEY);
  return result[DATA_KEY] === undefined ? defaultDatabase() : migrate(result[DATA_KEY]);
}
export async function saveDatabase(db: Database) {
  await browser.storage.local.set({ [DATA_KEY]: dbSchema.parse(db) });
}
export async function saveSessionKey(key: string) {
  await browser.storage.session.set({ aiKey: key });
}
export async function readSessionKey(): Promise<string> {
  return ((await browser.storage.session.get('aiKey')).aiKey as string) || '';
}
