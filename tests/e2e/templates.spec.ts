import {
  test,
  expect,
  chromium,
  type BrowserContext,
  type Worker,
  type Page,
} from '@playwright/test';
import { cp, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { demoProfile, defaultDatabase, type Database } from '../../src/domain/model';
import type { LayoutPayload } from '../../src/ai/layout';
declare const chrome: typeof import('wxt/browser').browser;

const origin = `http://127.0.0.1:${process.env.RC_TEST_PORT || 4178}`;
const endpoint = 'https://ai.fixture.invalid/v1/chat/completions';
let context: BrowserContext;
let worker: Worker;
let extensionId: string;
let temporary: string;

test.beforeAll(async () => {
  const profiles = process.env.PLAYWRIGHT_PROFILE_DIR || path.resolve('.dev/profiles');
  await mkdir(profiles, { recursive: true });
  await mkdir('.dev/reports/screenshots', { recursive: true });
  temporary = await mkdtemp(path.join(profiles, 'templates-'));
  const extension = path.join(temporary, 'extension');
  await cp(path.resolve('.output/chrome-mv3'), extension, { recursive: true });
  const manifestFile = path.join(extension, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  manifest.host_permissions = ['http://127.0.0.1/*', 'https://ai.fixture.invalid/*'];
  await writeFile(manifestFile, JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  extensionId = new URL(worker.url()).host;
});

test.afterAll(async () => {
  await context?.close();
  if (temporary) await rm(temporary, { recursive: true, force: true });
});

async function readDatabase(): Promise<Database> {
  return worker.evaluate(
    async () =>
      (await chrome.storage.local.get('resume-companion'))['resume-companion'] as Database,
  );
}

async function writeDatabase(db: Database) {
  await worker.evaluate(
    async (value) => chrome.storage.local.set({ 'resume-companion': value }),
    db,
  );
}

async function prepare(emptyCity = false) {
  const db = defaultDatabase();
  const profile = demoProfile();
  profile.id = 'fictional-template-profile';
  profile.personal.city = emptyCity ? '' : '虚构甲市';
  profile.personal.ethnicity = '虚构本地民族';
  profile.custom.push({
    id: 'private-internal-template-id',
    label: '其他资料',
    value: '私密资料内容',
  });
  db.profiles = [profile];
  db.activeId = profile.id;
  db.settings = {
    aiEnabled: true,
    endpoint: 'https://ai.fixture.invalid/v1',
    model: 'fixture-model',
  };
  await writeDatabase(db);
  await worker.evaluate(async () => chrome.storage.session.set({ aiKey: 'fictional-key' }));
  const requests: string[] = [];
  const payloads: LayoutPayload[] = [];
  const keys: Record<string, string> = {
    姓名: 'personal.name',
    现居住地: 'personal.city',
    民族: 'personal.ethnicity',
  };
  await context.route(endpoint, async (route) => {
    const body = route.request().postData()!;
    const payload: LayoutPayload = JSON.parse(JSON.parse(body).messages[1].content);
    requests.push(body);
    payloads.push(payload);
    const results = payload.layout.controls.map((control) => {
      const text = payload.layout.texts
        .filter((text) => keys[text.text])
        .sort(
          (a, b) => Math.abs(a.rect.y - control.rect.y) - Math.abs(b.rect.y - control.rect.y),
        )[0]!;
      expect(text).toBeDefined();
      return {
        id: control.id,
        label: text.text,
        key: keys[text.text],
        status: 'matched',
        evidence: [text.id],
      };
    });
    await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify(results) } }] } });
  });
  const form = await context.newPage();
  // Serve an isolated fictional page without modifying the shared fixture server.
  await form.route(`${origin}/templates.html`, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>虚构模板学习表单</title><style>body{font:16px sans-serif;margin:30px}form{width:600px}.row{display:flex;align-items:center;margin:24px 0;gap:20px}.row label{width:120px}input{height:36px;width:300px}</style></head><body><h1>虚构申请表</h1><form><div class="row"><label for="name">姓名</label><input id="name"></div><div class="row"><label for="city">现居住地</label><input id="city"></div></form></body></html>`,
    }),
  );
  await form.goto(`${origin}/templates.html`);
  let panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  return {
    form,
    get panel() {
      return panel;
    },
    requests,
    payloads,
    profile,
    async reopen() {
      await panel.close();
      await form.reload();
      panel = await context.newPage();
      await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    },
    async cleanup() {
      await context.unroute(endpoint);
      await panel.close();
      await form.close();
    },
  };
}

async function identify(form: Page, panel: Page) {
  await form.bringToFront();
  await panel.getByRole('button', { name: '识别并填写', exact: true }).click();
}

async function learn(form: Page, panel: Page) {
  await identify(form, panel);
  await expect(panel.getByRole('status')).toContainText('等待确认发送');
  await panel.getByRole('button', { name: '确认识别并填写', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('当前阶段：完成');
}

async function saveFields(panel: Page, labels: string[]) {
  for (const label of labels)
    await panel.getByRole('checkbox', { name: `已核对 ${label}`, exact: true }).check();
  await panel.getByRole('button', { name: '保存已核对字段', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText(`已保存 ${labels.length} 个已核对字段`);
}

test('learns once then reloads and fills current local values with AI disabled, preserving later edits on undo', async () => {
  const session = await prepare();
  try {
    await identify(session.form, session.panel);
    await expect(session.panel.getByRole('status')).toContainText('等待确认发送');
    expect(session.requests).toHaveLength(0);
    await session.panel.getByRole('button', { name: '确认识别并填写', exact: true }).click();
    await expect(session.form.locator('#name')).toHaveValue(session.profile.personal.name);
    await expect(session.form.locator('#city')).toHaveValue('虚构甲市');
    await saveFields(session.panel, ['姓名', '现居住地']);
    const saved = await readDatabase();
    expect(saved.templates).toHaveLength(1);
    const serialized = JSON.stringify(saved.templates);
    for (const secret of [
      session.profile.personal.name,
      '虚构甲市',
      'private-internal-template-id',
      '私密资料内容',
    ]) {
      expect(serialized).not.toContain(secret);
      expect(session.requests[0]).not.toContain(secret);
    }
    saved.profiles[0]!.personal.name = '虚构新姓名';
    saved.profiles[0]!.personal.city = '虚构乙市';
    saved.settings.aiEnabled = false;
    await writeDatabase(saved);
    await session.reopen();
    await identify(session.form, session.panel);
    await expect(session.panel.getByRole('status')).toContainText('未发送 AI 请求');
    await expect(session.form.locator('#name')).toHaveValue('虚构新姓名');
    await expect(session.form.locator('#city')).toHaveValue('虚构乙市');
    expect(session.requests).toHaveLength(1);
    await session.panel.setViewportSize({ width: 430, height: 1000 });
    await session.panel.screenshot({
      path: '.dev/reports/screenshots/template-reuse-panel.png',
      fullPage: true,
    });
    await session.form.locator('#city').fill('用户后来编辑');
    await session.panel.getByRole('button', { name: '撤销上次填写' }).click();
    await expect(session.form.locator('#name')).toHaveValue('');
    await expect(session.form.locator('#city')).toHaveValue('用户后来编辑');
  } finally {
    await session.cleanup();
  }
});

test('sends only new controls for incremental learning and combines their results with reused fields', async () => {
  const session = await prepare();
  try {
    await learn(session.form, session.panel);
    await saveFields(session.panel, ['姓名', '现居住地']);
    await session.reopen();
    await session.form.locator('form').evaluate((form) => {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = '<label for="ethnicity">民族</label><input id="ethnicity">';
      form.append(row);
    });
    await identify(session.form, session.panel);
    await expect(session.panel.getByRole('status')).toContainText('等待确认发送');
    expect(session.requests).toHaveLength(1);
    await expect(session.panel.getByText('本地模板：部分适用')).toBeVisible();
    await session.panel.getByRole('button', { name: '确认识别并填写', exact: true }).click();
    await expect(session.form.locator('#ethnicity')).toHaveValue(
      session.profile.personal.ethnicity,
    );
    await expect(session.form.locator('#name')).toHaveValue(session.profile.personal.name);
    await expect(session.form.locator('#city')).toHaveValue('虚构甲市');
    expect(session.requests).toHaveLength(2);
    expect(session.payloads[1]!.layout.controls).toHaveLength(1);
    expect(session.payloads[1]!.layout.controls[0]!.id).not.toBe(
      session.payloads[0]!.layout.controls[0]!.id,
    );
    expect(session.payloads[1]!.layout.controls[0]!.id).not.toBe(
      session.payloads[0]!.layout.controls[1]!.id,
    );
    expect(session.requests[1]).not.toContain(session.profile.personal.ethnicity);
  } finally {
    await session.cleanup();
  }
});

test('retains a confirmed empty field and fills it from local data after completion; dashboard can disable template', async () => {
  const session = await prepare(true);
  let dashboard: Page | undefined;
  try {
    await learn(session.form, session.panel);
    await expect(session.form.locator('#city')).toHaveValue('');
    await saveFields(session.panel, ['姓名', '现居住地']);
    const db = await readDatabase();
    expect(db.templates[0]!.fields.find((field) => field.path === 'personal.city')).toBeDefined();
    db.profiles[0]!.personal.city = '后来补充的虚构城市';
    await writeDatabase(db);
    await session.reopen();
    await identify(session.form, session.panel);
    await expect(session.form.locator('#city')).toHaveValue('后来补充的虚构城市');
    expect(session.requests).toHaveLength(1);
    dashboard = await context.newPage();
    await dashboard.goto(`chrome-extension://${extensionId}/options.html`);
    await dashboard.getByRole('button', { name: '表单模板', exact: true }).click();
    await dashboard.getByText('查看字段与定位依据（2）', { exact: true }).click();
    await expect(dashboard.getByText('personal.city', { exact: true })).toBeVisible();
    await dashboard.screenshot({
      path: '.dev/reports/screenshots/template-management.png',
      fullPage: true,
    });
    await dashboard.getByRole('button', { name: '停用模板', exact: true }).click();
    await expect(dashboard.getByRole('button', { name: '启用模板', exact: true })).toBeVisible();
    expect((await readDatabase()).templates[0]!.enabled).toBe(false);
    await session.reopen();
    await identify(session.form, session.panel);
    await expect(session.panel.getByRole('status')).toContainText('等待确认发送');
    expect(session.requests).toHaveLength(1);
  } finally {
    await dashboard?.close();
    await session.cleanup();
  }
});

test('persists confirmed templates across a browser restart and reuses local values without AI', async () => {
  const session = await prepare();
  await learn(session.form, session.panel);
  await saveFields(session.panel, ['姓名', '现居住地']);
  const db = await readDatabase();
  const savedTemplateId = db.templates[0]!.id;
  db.settings.aiEnabled = false;
  db.profiles[0]!.personal.name = '重启后虚构姓名';
  db.profiles[0]!.personal.city = '重启后虚构城市';
  await writeDatabase(db);
  // This fixture is entirely fictional; native input properties are not serialized as values.
  const fixtureHTML = await session.form.content();
  await session.cleanup();
  await context.close();

  const extension = path.join(temporary, 'extension');
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  extensionId = new URL(worker.url()).host;
  expect((await readDatabase()).templates[0]!.id).toBe(savedTemplateId);
  let requestsAfterRestart = 0;
  await context.route(endpoint, async (route) => {
    requestsAfterRestart++;
    await route.fulfill({ status: 500, body: 'AI must remain unused in this test' });
  });
  const form = await context.newPage();
  const panel = await context.newPage();
  try {
    await form.route(`${origin}/templates.html`, (route) =>
      route.fulfill({ contentType: 'text/html', body: fixtureHTML }),
    );
    await form.goto(`${origin}/templates.html`);
    await expect(form.locator('#name')).toHaveValue('');
    await expect(form.locator('#city')).toHaveValue('');
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await identify(form, panel);
    await expect(panel.getByRole('status')).toContainText('未发送 AI 请求');
    await expect(form.locator('#name')).toHaveValue('重启后虚构姓名');
    await expect(form.locator('#city')).toHaveValue('重启后虚构城市');
    expect(requestsAfterRestart).toBe(0);
  } finally {
    await context.unroute(endpoint);
    await panel.close();
    await form.close();
  }
});
