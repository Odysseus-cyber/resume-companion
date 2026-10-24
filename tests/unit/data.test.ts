// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createCipheriv, pbkdf2Sync } from 'node:crypto';
import {
  defaultDatabase,
  demoProfile,
  emptyProfile,
  facts,
  migrate,
  profileSchema,
} from '../../src/domain/model';
import { encryptBackup, restoreBackup } from '../../src/domain/backup';
import { draftFromText, extractText } from '../../src/domain/import';

const addedPersonalKeys = [
  'highestEducation',
  'studyMode',
  'householdLocation',
  'ethnicity',
] as const;
function legacyDatabase() {
  const db = defaultDatabase();
  db.profiles = [demoProfile(), emptyProfile('第二版简历')];
  db.activeId = db.profiles[0]!.id;
  db.profiles[0]!.custom = [{ id: 'old-study-mode', label: '学习形式', value: '自定义学习形式' }];
  db.mappings = [
    { origin: 'https://example.com', signature: 'field', path: 'personal.city', label: '居住地' },
  ];
  db.settings = { aiEnabled: true, endpoint: 'https://example.com/v1', model: 'fictional-model' };
  return {
    ...db,
    schemaVersion: 1,
    profiles: db.profiles.map((p) => ({
      ...p,
      personal: Object.fromEntries(
        Object.entries(p.personal).filter(
          ([key]) => !addedPersonalKeys.some((added) => added === key),
        ),
      ),
    })),
  };
}

// Encrypt the legacy JSON directly: encryptBackup would migrate it before encryption
// and therefore could not exercise restoring ciphertext that actually contains v1 data.
function encryptedLegacyBackup(value: unknown) {
  const password = 'fictional-legacy-password';
  const salt = Buffer.alloc(16, 4);
  const iv = Buffer.alloc(12, 7);
  const key = pbkdf2Sync(password, salt, 310000, 32, 'sha256');
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return JSON.stringify({
    format: 'resume-companion/encrypted-v1',
    iterations: 310000,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  });
}

describe('local profile schema and backups', () => {
  it('starts with an empty profile, AI disabled and no mappings', () => {
    const db = defaultDatabase();
    expect(db.profiles).toHaveLength(1);
    expect(db.settings.aiEnabled).toBe(false);
    expect(db.mappings).toEqual([]);
    expect(db.templates).toEqual([]);
    expect(db.profiles[0]!.personal.name).toBe('');
  });
  it('keeps unsaved initial identity stable while new profile versions remain unique', () => {
    const editor = defaultDatabase();
    const latest = defaultDatabase();
    expect(latest.activeId).toBe(editor.activeId);
    const edited = {
      ...editor.profiles[0]!,
      personal: { ...editor.profiles[0]!.personal, name: '首次保存' },
    };
    latest.profiles = latest.profiles.map((p) => (p.id === edited.id ? edited : p));
    expect(migrate(latest).profiles[0]!.personal.name).toBe('首次保存');
    expect(emptyProfile().id).not.toBe(emptyProfile().id);
  });
  it('rejects duplicate entry identifiers in each repeated section and custom fields', () => {
    for (const section of ['education', 'experience', 'projects'] as const) {
      const p = demoProfile();
      p[section].push({ ...p[section][0]! });
      expect(() => profileSchema.parse(p)).toThrow('唯一');
    }
    const p = demoProfile();
    p.custom = [
      { id: 'same', label: '语言', value: '中文' },
      { id: 'same', label: '资格', value: '示例资格' },
    ];
    expect(() => profileSchema.parse(p)).toThrow('唯一');
  });
  it('migrates an unversioned prototype without losing facts', () => {
    const p = demoProfile();
    const db = migrate({ profile: p });
    expect(db.schemaVersion).toBe(3);
    expect(db.activeId).toBe(p.id);
    expect(db.profiles[0]).toEqual(p);
    expect(db.templates).toEqual([]);
  });
  it('keeps the new personal fields empty and in the fact directory', () => {
    const p = emptyProfile();
    for (const key of addedPersonalKeys) {
      expect(p.personal[key]).toBe('');
      expect(facts(p).find((fact) => fact.path === `personal.${key}`)?.value).toBe('');
    }
    expect(facts(p).find((fact) => fact.path === 'personal.city')?.label).toBe('现居住地（城市）');
  });
  it('migrates all v1 profiles without inferring fields or changing settings, mappings and custom fields', () => {
    const old = legacyDatabase();
    const original = structuredClone(old);
    const migrated = migrate(old);
    expect(old).toEqual(original);
    expect(migrated.schemaVersion).toBe(3);
    expect(migrated.activeId).toBe(old.activeId);
    expect(migrated.settings).toEqual(old.settings);
    expect(migrated.mappings).toEqual(old.mappings);
    expect(migrated.templates).toEqual([]);
    migrated.profiles.forEach((p, index) => {
      const previous = old.profiles[index]!;
      expect(p).toEqual({
        ...previous,
        personal: {
          ...previous.personal,
          highestEducation: '',
          studyMode: '',
          householdLocation: '',
          ethnicity: '',
        },
      });
    });
    expect(migrate(migrated)).toEqual(migrated);
  });
  it('migrates a genuinely old single profile while preserving optional prototype settings and mappings', () => {
    const old = legacyDatabase();
    const migrated = migrate({
      profile: old.profiles[0],
      settings: old.settings,
      mappings: old.mappings,
    });
    expect(migrated.profiles[0]!.personal.highestEducation).toBe('');
    expect(migrated.profiles[0]!.custom).toEqual(old.profiles[0]!.custom);
    expect(migrated.settings).toEqual(old.settings);
    expect(migrated.mappings).toEqual(old.mappings);
  });
  it('does not repair missing old fields or malformed v2 data with migration defaults', () => {
    const old = legacyDatabase();
    delete old.profiles[0]!.personal.name;
    expect(() => migrate(old)).toThrow();
    expect(() => migrate({ ...legacyDatabase(), schemaVersion: 2 })).toThrow();
  });
  it('restores old plaintext JSON through the same migration', async () => {
    const old = legacyDatabase();
    expect(await restoreBackup(JSON.stringify(old), '')).toEqual(migrate(old));
  });
  it('decrypts actual v1 plaintext in a legacy encrypted envelope before migration', async () => {
    const old = legacyDatabase();
    const encrypted = encryptedLegacyBackup(old);
    expect(encrypted).not.toContain('林知夏');
    expect(await restoreBackup(encrypted, 'fictional-legacy-password')).toEqual(migrate(old));
  });
  it('migrates v2 local data, JSON and encrypted backups without changing existing data', async () => {
    const current = defaultDatabase();
    current.profiles[0] = demoProfile();
    current.activeId = 'demo';
    current.mappings = legacyDatabase().mappings;
    current.settings = legacyDatabase().settings;
    const { templates: _templates, ...base } = current;
    expect(_templates).toEqual([]);
    const old = { ...base, schemaVersion: 2 };
    const original = structuredClone(old);
    expect(migrate(old)).toEqual(current);
    expect(await restoreBackup(JSON.stringify(old), '')).toEqual(current);
    expect(await restoreBackup(encryptedLegacyBackup(old), 'fictional-legacy-password')).toEqual(
      current,
    );
    expect(old).toEqual(original);
  });
  it('rejects future database versions inside encrypted backups', async () => {
    const encrypted = encryptedLegacyBackup({ ...legacyDatabase(), schemaVersion: 99 });
    await expect(restoreBackup(encrypted, 'fictional-legacy-password')).rejects.toThrow(
      '版本不兼容',
    );
  });
  it('rejects unknown future versions rather than resetting', () => {
    expect(() => migrate({ ...defaultDatabase(), schemaVersion: 99 })).toThrow();
  });
  it('rejects a missing active profile', () => {
    expect(() => migrate({ ...defaultDatabase(), activeId: 'missing' })).toThrow();
  });
  it('rejects duplicate profile identifiers', () => {
    const db = defaultDatabase();
    db.profiles.push(db.profiles[0]!);
    expect(() => migrate(db)).toThrow();
  });
  it('keeps fictional demonstration data separate from new storage', () => {
    demoProfile();
    expect(defaultDatabase().profiles[0]!.id).not.toBe('demo');
    expect(defaultDatabase().profiles[0]!.personal.email).toBe('');
  });
  it('exposes every repeated entry and custom field by stable path', () => {
    const p = demoProfile();
    p.education.push({ ...p.education[0]!, id: 'second', organization: '第二示例大学' });
    p.custom = [{ id: 'language', label: '语言', value: '中文' }];
    expect(facts(p)).toContainEqual({ path: 'custom.language', label: '语言', value: '中文' });
    expect(facts(p).find((f) => f.path === 'education.1.organization')!.value).toBe('第二示例大学');
  });
  it('round-trips encrypted unicode data without plaintext exposure', async () => {
    const db = defaultDatabase();
    db.profiles[0] = demoProfile();
    db.activeId = 'demo';
    Object.assign(db.profiles[0]!.personal, {
      highestEducation: '硕士研究生',
      studyMode: '全日制',
      householdLocation: '示例省示例市',
      ethnicity: '汉族',
    });
    const encrypted = await encryptBackup(db, 'fictional-password');
    expect(encrypted).not.toContain('林知夏');
    expect(encrypted).not.toContain('zhixia@example.com');
    expect(await restoreBackup(encrypted, 'fictional-password')).toEqual(db);
  });
  it('uses a new salt and IV for each export', async () => {
    const db = defaultDatabase();
    const a = JSON.parse(await encryptBackup(db, 'fictional-password'));
    const b = JSON.parse(await encryptBackup(db, 'fictional-password'));
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
  });
  it('rejects wrong backup passwords', async () => {
    const encrypted = await encryptBackup(defaultDatabase(), 'fictional-password');
    await expect(restoreBackup(encrypted, 'wrong-password')).rejects.toThrow('无法恢复');
  });
  it('rejects damaged ciphertext', async () => {
    const e = JSON.parse(await encryptBackup(defaultDatabase(), 'fictional-password'));
    e.ciphertext = 'AAAA' + e.ciphertext.slice(4);
    await expect(restoreBackup(JSON.stringify(e), 'fictional-password')).rejects.toThrow(
      '无法恢复',
    );
  });
  it('rejects short export passwords', async () => {
    await expect(encryptBackup(defaultDatabase(), 'short')).rejects.toThrow('8');
  });
  it('imports explicitly provided plaintext JSON', async () => {
    const db = defaultDatabase();
    expect(await restoreBackup(JSON.stringify(db), '')).toEqual(db);
  });
  it('rejects excessive backup sizes before parsing', async () => {
    await expect(restoreBackup(' '.repeat(12_000_001), '')).rejects.toThrow('过大');
  });
});

describe('local text import', () => {
  it('extracts explicit contact facts without adding raw text as a summary', () => {
    const p = draftFromText(
      '姓名：林知夏\n现居城市：杭州\nzhixia@example.com 13800000000\n未经整理的内容',
    );
    expect(p.personal).toMatchObject({
      name: '林知夏',
      city: '杭州',
      email: 'zhixia@example.com',
      phone: '13800000000',
      summary: '',
    });
  });
  it('does not guess missing names, dates or achievements', () => {
    const p = draftFromText('一份没有姓名的简历');
    expect(p.personal.name).toBe('');
    expect(p.education).toEqual([]);
    expect(p.personal.awards).toBe('');
  });
  it('does not match phone numbers embedded in longer numbers', () => {
    expect(draftFromText('1138000000001').personal.phone).toBe('');
  });
  it('extracts TXT locally', async () => {
    expect(await extractText(new File(['  虚构简历内容  '], 'resume.txt'))).toBe('虚构简历内容');
  });
  it('rejects empty extracted text', async () => {
    await expect(extractText(new File(['   '], 'empty.txt'))).rejects.toThrow('未提取');
  });
  it('rejects unsupported file types', async () => {
    await expect(extractText(new File(['data'], 'resume.exe'))).rejects.toThrow('支持');
  });
  it('rejects large input files', async () => {
    await expect(
      extractText(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.txt')),
    ).rejects.toThrow('10 MB');
  });
});
