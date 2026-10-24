import { migrate, type Database } from './model';
import { z } from 'zod';
const envelopeSchema = z.object({
  format: z.literal('resume-companion/encrypted-v1'),
  iterations: z.literal(310000),
  salt: z.string(),
  iv: z.string(),
  ciphertext: z.string(),
});
function b64(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
}
function un64(s: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
async function key(password: string, salt: Uint8Array<ArrayBuffer>) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', iterations: 310000, salt },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
export async function encryptBackup(db: Database, password: string): Promise<string> {
  if (password.length < 8) throw new Error('备份密码至少需要 8 个字符');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(migrate(db)));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await key(password, salt),
    data,
  );
  return JSON.stringify(
    {
      format: 'resume-companion/encrypted-v1',
      iterations: 310000,
      salt: b64(salt),
      iv: b64(iv),
      ciphertext: b64(new Uint8Array(ciphertext)),
    },
    null,
    2,
  );
}
export async function restoreBackup(raw: string, password: string): Promise<Database> {
  if (raw.length > 12_000_000) throw new Error('备份文件过大');
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed === 'object' && parsed !== null && 'format' in parsed) {
    const e = envelopeSchema.parse(parsed);
    try {
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: un64(e.iv) },
        await key(password, un64(e.salt)),
        un64(e.ciphertext),
      );
      return migrate(JSON.parse(new TextDecoder().decode(plain)));
    } catch {
      throw new Error('无法恢复：密码错误、文件损坏或备份版本不兼容');
    }
  }
  return migrate(parsed);
}
