import { test, expect, chromium, type BrowserContext, type Worker } from '@playwright/test';
import { cp, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { demoProfile, defaultDatabase, facts, type Database } from '../../src/domain/model';
import { matchField } from '../../src/engine/matcher';
import type { FillResult, Scan } from '../../src/engine/types';
declare const chrome: typeof import('wxt/browser').browser;

const testOrigin = `http://127.0.0.1:${process.env.RC_TEST_PORT || 4178}`;
let context: BrowserContext;
let worker: Worker;
let extensionId: string;
let temporary: string;
test.beforeAll(async () => {
  const profiles = process.env.PLAYWRIGHT_PROFILE_DIR || path.resolve('.dev/profiles');
  await mkdir(profiles, { recursive: true });
  temporary = await mkdtemp(path.join(profiles, 'e2e-'));
  const extension = path.join(temporary, 'extension');
  await cp(path.resolve('.output/chrome-mv3'), extension, { recursive: true });
  const manifestFile = path.join(extension, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  // Test-only localhost grant. The shipped artifact never includes host_permissions.
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
async function seed() {
  const db = defaultDatabase();
  const profile = demoProfile();
  profile.id = 'e2e';
  db.profiles = [profile];
  db.activeId = profile.id;
  await worker.evaluate(async (db) => {
    await chrome.storage.local.set({ 'resume-companion': db });
  }, db);
  return db;
}
test('package requests only user-triggered access and bundles all executable code', async () => {
  const m = JSON.parse(await readFile('.output/chrome-mv3/manifest.json', 'utf8'));
  expect(m.manifest_version).toBe(3);
  expect(m.host_permissions).toBeUndefined();
  expect(m.content_scripts).toBeUndefined();
  expect(m.permissions).not.toContain('tabs');
  expect(m.permissions).not.toContain('debugger');
  expect(m.content_security_policy.extension_pages).not.toContain('unsafe-eval');
  expect(m.side_panel.default_path).toBe('sidepanel.html');
});
test('dashboard edits persist after reload, demo stays isolated, screenshot', async () => {
  await seed();
  const page = await context.newPage();
  const network: string[] = [];
  page.on('request', (r) => {
    if (/^https?:/.test(r.url())) network.push(r.url());
  });
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(page.getByRole('heading', { name: '让经历，随时就绪。' })).toBeVisible();
  await expect(page.getByLabel('最高学历', { exact: true })).toHaveValue('');
  await page.getByLabel('最高学历', { exact: true }).fill('硕士');
  await page.getByLabel('最高学历对应的学习形式', { exact: true }).fill('全日制');
  await page.getByLabel('户口所在地', { exact: true }).fill('示例户籍城市');
  await page.getByLabel('民族', { exact: true }).fill('示例民族');
  await page.getByLabel('姓名', { exact: true }).fill('测试求职者');
  await page.getByRole('button', { name: '保存修改' }).click();
  await expect(page.getByRole('status')).toContainText('已保存在这台设备');
  await page.reload();
  await expect(page.getByLabel('姓名', { exact: true })).toHaveValue('测试求职者');
  await expect(page.getByLabel('最高学历', { exact: true })).toHaveValue('硕士');
  await expect(page.getByLabel('最高学历对应的学习形式', { exact: true })).toHaveValue('全日制');
  await expect(page.getByLabel('户口所在地', { exact: true })).toHaveValue('示例户籍城市');
  await expect(page.getByLabel('民族', { exact: true })).toHaveValue('示例民族');
  await page.getByRole('button', { name: '看看虚构演示' }).click();
  await page.getByLabel('姓名', { exact: true }).fill('不会保存的演示');
  await expect(page.getByRole('button', { name: '保存资料', exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.getByLabel('姓名', { exact: true })).toHaveValue('测试求职者');
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByRole('button', { name: '看看虚构演示' }).click();
  await mkdir('.dev/reports/screenshots', { recursive: true });
  await page.screenshot({ path: '.dev/reports/screenshots/dashboard.png' });
  expect(network).toEqual([]);
  await page.close();
});
test('first install can save its first profile without a preseeded database', async () => {
  await worker.evaluate(async () => {
    await chrome.storage.local.clear();
  });
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.getByLabel('姓名', { exact: true }).fill('第一次使用');
  await page.getByRole('button', { name: '保存修改' }).click();
  await expect(page.getByRole('status')).toContainText('已保存在这台设备');
  await page.reload();
  await expect(page.getByLabel('姓名', { exact: true })).toHaveValue('第一次使用');
  await page.close();
});
test('installed content script fills native controls, protects existing data, undoes safely', async () => {
  const db = await seed();
  const page = await context.newPage();
  await page.goto(testOrigin);
  const id = await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1/*' });
    return tabs[0]!.id!;
  });
  await worker.evaluate(async (id) => {
    await chrome.scripting.executeScript({
      target: { tabId: id },
      files: ['/content-scripts/content.js'],
    });
  }, id);
  const reply = (await worker.evaluate(
    async (id) => chrome.tabs.sendMessage(id, { type: 'SCAN' }),
    id,
  )) as { ok: boolean; data: Scan };
  expect(reply.ok).toBe(true);
  expect(reply.data.fields.length).toBeGreaterThan(8);
  const plan = reply.data.fields.map((f) =>
    matchField(f, { facts: facts(db.profiles[0]!), mappings: [], origin: reply.data.origin }),
  );
  const filled = (await worker.evaluate(
    async ({ id, token, plan }) =>
      chrome.tabs.sendMessage(id, { type: 'FILL', token, items: plan }),
    { id, token: reply.data.token, plan },
  )) as { data: FillResult[] };
  expect(filled.data.filter((r) => r.status === 'filled').length).toBeGreaterThanOrEqual(9);
  await expect(page.locator('#name')).toHaveValue('林知夏');
  await expect(page.locator('#degree')).toHaveValue('bachelor');
  await expect(page.locator('#city')).toHaveValue('用户原有城市');
  await expect(page.locator('#captcha')).toHaveValue('');
  await page.locator('#name').fill('用户后来修改');
  await worker.evaluate(async (id) => chrome.tabs.sendMessage(id, { type: 'UNDO' }), id);
  await expect(page.locator('#name')).toHaveValue('用户后来修改');
  await expect(page.locator('#email')).toHaveValue('');
  expect(
    await page.evaluate(() => (window as unknown as { submissions: number }).submissions),
  ).toBe(0);
  // A rescan observes a dynamically inserted second project.
  await page.getByRole('button', { name: '新增项目区域' }).click();
  const rescanned = (await worker.evaluate(
    async (id) => chrome.tabs.sendMessage(id, { type: 'SCAN' }),
    id,
  )) as { data: Scan };
  expect(
    rescanned.data.fields.filter((f) => f.section === 'projects' && f.index === 1),
  ).toHaveLength(1);
  await page.close();
});
test('TXT import stays local and requires a separate save', async () => {
  await seed();
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.getByRole('button', { name: '导入资料', exact: true }).click();
  await page.getByLabel('导入简历文件').setInputFiles({
    name: 'sample.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('姓名：赵同学\n邮箱：zhao@example.com\n手机：13900000000'),
  });
  await expect(page.getByLabel('姓名', { exact: true })).toHaveValue('赵同学');
  const before = await worker.evaluate(
    async () =>
      ((await chrome.storage.local.get('resume-companion'))['resume-companion'] as Database)
        .profiles.length,
  );
  expect(before).toBe(1);
  await page.getByRole('button', { name: '确认并保存为新版本' }).click();
  await expect(page.getByRole('status')).toContainText('已保存为新的简历版本');
  const after = await worker.evaluate(
    async () =>
      ((await chrome.storage.local.get('resume-companion'))['resume-companion'] as Database)
        .profiles.length,
  );
  expect(after).toBe(2);
  await page.close();
});
test('side panel starts without network traffic and renders at narrow width', async () => {
  await seed();
  const page = await context.newPage();
  const network: string[] = [];
  page.on('request', (r) => {
    if (/^https?:/.test(r.url())) network.push(r.url());
  });
  await page.setViewportSize({ width: 380, height: 850 });
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(page.getByRole('button', { name: '识别并填写' })).toBeEnabled();
  await expect(page.getByText('准备好，再轻轻一点')).toBeVisible();
  await page.screenshot({ path: '.dev/reports/screenshots/panel.png', fullPage: true });
  expect(network).toEqual([]);
  await page.close();
});
test('side panel previews, binds, fills and undoes through its real UI', async () => {
  await seed();
  const form = await context.newPage();
  await form.goto(testOrigin);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.setViewportSize({ width: 400, height: 900 });
  await form.bringToFront();
  await panel.getByRole('button', { name: '识别并填写' }).click();
  await expect(panel.getByRole('heading', { name: /表单识别与复用/ })).toBeVisible();
  const unrelated = await worker.evaluate(async () =>
    chrome.tabs.create({ url: 'about:blank', active: false }),
  );
  await expect(panel.getByRole('heading', { name: /表单识别与复用/ })).toBeVisible();
  await worker.evaluate(async (id) => chrome.tabs.remove(id!), unrelated.id);
  await panel.getByLabel('绑定 姓名', { exact: true }).selectOption('personal.name');
  await expect(panel.getByRole('button', { name: /填写已选/ })).toBeEnabled();
  await panel.getByRole('button', { name: /填写已选/ }).click();
  await expect(form.locator('#name')).toHaveValue('林知夏');
  await panel.screenshot({ path: '.dev/reports/screenshots/panel-filled.png', fullPage: true });
  await panel.getByRole('button', { name: '撤销上次填写' }).click();
  await expect(form.locator('#name')).toHaveValue('');
  await panel.close();
  await form.close();
});

test('plain labels and anonymous controls can be located without persisting positional guesses', async () => {
  await seed();
  const form = await context.newPage();
  await form.goto(testOrigin);
  await form.locator('form').evaluate((el) => {
    el.innerHTML =
      '<div><span>获奖经历</span><div><textarea></textarea></div></div><div><input data-testid="anonymous"></div>';
  });
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await form.bringToFront();
  await panel.getByRole('button', { name: '识别并填写', exact: true }).click();
  await expect(panel.getByLabel('绑定 获奖经历', { exact: true })).toHaveValue('personal.awards');
  const card = panel.locator('.field-card').nth(1);
  await expect(card).toContainText('待识别字段 2');
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: '在网页中定位 待识别字段 2' }).click();
  await expect
    .poll(() => form.getByTestId('anonymous').evaluate((el) => el.getAnimations().length))
    .toBeGreaterThan(0);
  await expect(form.getByTestId('anonymous')).toHaveValue('');
  await card.getByRole('combobox').selectOption('personal.awards');
  await expect(card).toContainText('手动对应');
  expect(
    await worker.evaluate(
      async () =>
        ((await chrome.storage.local.get('resume-companion'))['resume-companion'] as Database)
          .mappings,
    ),
  ).toEqual([]);
  await panel.getByRole('button', { name: '识别并填写', exact: true }).click();
  await expect(card.getByRole('combobox')).toHaveValue('');
  await panel.close();
  await form.close();
});

test('changing saved profile invalidates a side-panel plan', async () => {
  await seed();
  const form = await context.newPage();
  await form.goto(testOrigin);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await form.bringToFront();
  await panel.getByRole('button', { name: '识别并填写' }).click();
  await expect(panel.getByRole('heading', { name: /表单识别与复用/ })).toBeVisible();
  await worker.evaluate(async () => {
    const db = (await chrome.storage.local.get('resume-companion'))['resume-companion'] as Database;
    db.profiles[0]!.personal.name = '更新后的资料';
    await chrome.storage.local.set({ 'resume-companion': db });
  });
  await expect(panel.getByRole('heading', { name: /表单识别与复用/ })).toHaveCount(0);
  await panel.close();
  await form.close();
});

test('import asks before discarding unsaved edits', async () => {
  await seed();
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.getByLabel('姓名', { exact: true }).fill('未保存的编辑');
  await page.getByRole('button', { name: '导入资料', exact: true }).click();
  await page.getByLabel('也可以粘贴文本').fill('姓名：导入同学\n邮箱：import@example.com');
  await page.getByRole('button', { name: '生成本地基础草稿' }).click();
  page.once('dialog', async (d) => {
    expect(d.message()).toContain('尚未保存');
    await d.dismiss();
  });
  await page.getByRole('button', { name: '确认并保存为新版本' }).click();
  await page.getByRole('button', { name: '我的简历', exact: true }).click();
  await expect(page.getByLabel('姓名', { exact: true })).toHaveValue('未保存的编辑');
  // Clear dirty state before closing to avoid a beforeunload dialog.
  await page.getByRole('button', { name: '保存修改' }).click();
  await page.close();
});

test('AI reads independent layout and keys, automatically fills locally only after request confirmation', async () => {
  const db = await seed();
  db.profiles[0]!.custom.push({
    id: 'private-custom-id',
    label: '推荐人',
    value: '本地私密推荐人',
  });
  await worker.evaluate(
    async (value) => chrome.storage.local.set({ 'resume-companion': value }),
    db,
  );
  const page = await context.newPage();
  const requests: string[] = [];
  await context.route('https://ai.fixture.invalid/v1/chat/completions', async (route) => {
    requests.push(route.request().postData() || '');
    const payload = JSON.parse(JSON.parse(route.request().postData()!).messages[1].content);
    const text = (label: string) =>
      payload.layout.texts.find((t: { text: string }) => t.text.includes(label)).id;
    await route.fulfill({
      json: {
        choices: [
          {
            message: {
              content: JSON.stringify([
                {
                  id: payload.layout.controls[0].id,
                  label: '姓名',
                  key: 'personal.name',
                  status: 'matched',
                  evidence: [text('如何称呼您')],
                },
                {
                  id: payload.layout.controls[1].id,
                  label: '邮箱',
                  key: 'personal.email',
                  status: 'matched',
                  evidence: [text('联系邮箱')],
                },
                {
                  id: payload.layout.controls[2].id,
                  label: '出生日期',
                  key: 'personal.birthday',
                  status: 'matched',
                  evidence: [text('出生日期')],
                },
              ]),
            },
          },
        ],
      },
    });
  });
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.getByRole('button', { name: '数据与设置', exact: true }).click();
  await page.getByLabel('启用', { exact: true }).check();
  await page.getByLabel('API 基础地址').fill('https://ai.fixture.invalid/v1');
  await page.getByLabel('模型名称').fill('fixture-model');
  await page.getByLabel('本次会话 API Key').fill('fictional-test-key');
  await page.getByLabel('最长等待时间（秒）').fill('120');
  await page.getByRole('button', { name: '保存 AI 设置' }).click();
  await expect(page.getByRole('status')).toContainText('设置已保存');
  await page.reload();
  await page.getByRole('button', { name: '数据与设置', exact: true }).click();
  await expect(page.getByLabel('最长等待时间（秒）')).toHaveValue('120');
  await page.getByRole('button', { name: '导入资料', exact: true }).click();
  await page.getByLabel('也可以粘贴文本').fill('这段原文必须留在本地。');
  await expect(page.getByRole('button', { name: '用 AI 整理经历' })).toHaveCount(0);
  const form = await context.newPage();
  await form.goto(`${testOrigin}/layout.html`);
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 400, height: 900 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await form.bringToFront();
  await panel.getByRole('button', { name: '识别并填写', exact: true }).click();
  await expect(panel.getByRole('heading', { name: '确认发送页面布局' })).toBeVisible();
  await expect(panel.locator('.ai-preview')).toContainText('本次等待：最长 120 秒');
  await expect(panel.getByRole('status')).toContainText('尚未发送给 AI');
  expect(requests).toHaveLength(0);
  await expect(form.locator('[data-fixture="name"]')).toHaveValue('');
  await panel.getByText('查看完整发送内容', { exact: true }).click();
  const preview = await panel.locator('.ai-preview pre').innerText();
  const input = JSON.parse(preview);
  expect(input.layout.texts.some((t: { text: string }) => t.text.includes('如何称呼您'))).toBe(
    true,
  );
  expect(input.keys.some((k: { key: string }) => k.key === 'personal.name')).toBe(true);
  expect(input.keys.some((k: { key: string }) => k.key === 'custom.slot0')).toBe(true);
  expect(input.layout.controls[0]).not.toHaveProperty('label');
  await panel.getByRole('button', { name: '确认识别并填写', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('已填写 2 项');
  expect(requests).toHaveLength(1);
  const sent = JSON.parse(requests[0]!).messages[1].content;
  expect(JSON.parse(sent)).toEqual(input);
  for (const secret of [
    db.profiles[0]!.personal.name,
    db.profiles[0]!.personal.email,
    db.profiles[0]!.education[0]!.organization,
    db.profiles[0]!.experience[0]!.description,
    'private-custom-id',
    '本地私密推荐人',
    '网页私密已有城市',
    '网页私密编辑内容',
    '网页私密选中内容',
    '网页私密隐藏内容',
    '网页私密隐藏值',
    'fictional-test-key',
    '这段原文必须留在本地',
    testOrigin,
  ])
    expect(requests[0]).not.toContain(secret);
  expect(sent).not.toContain('"value"');
  await expect(form.locator('[data-fixture="name"]')).toHaveValue('林知夏');
  await expect(form.locator('[data-fixture="email"]')).toHaveValue('zhixia@example.com');
  await expect(form.locator('[data-fixture="birthday"]')).toHaveValue('');
  await expect(form.locator('[data-fixture="city"]')).toHaveValue('网页私密已有城市');
  expect(
    await form.evaluate(() => (window as unknown as { submissions: number }).submissions),
  ).toBe(0);
  const stored = await worker.evaluate(async () =>
    JSON.stringify(await chrome.storage.local.get(null)),
  );
  expect(stored).not.toContain('fictional-test-key');
  const nameCard = panel
    .locator('.field-card')
    .filter({ has: panel.locator('strong', { hasText: /^姓名$/ }) });
  await expect(nameCard).toContainText('林知夏');
  await expect(nameCard.getByRole('combobox')).toHaveValue('personal.name');
  await expect(
    nameCard.getByRole('checkbox', { name: '已核对 姓名', exact: true }),
  ).not.toBeChecked();
  await expect(nameCard.locator('.field-title input')).not.toBeChecked();
  await panel.screenshot({ path: '.dev/reports/screenshots/ai-layout-result.png', fullPage: true });
  await panel.getByRole('button', { name: '撤销上次填写' }).click();
  await expect(form.locator('[data-fixture="name"]')).toHaveValue('');
  await expect(form.locator('[data-fixture="email"]')).toHaveValue('');
  await context.unroute('https://ai.fixture.invalid/v1/chat/completions');
  await panel.close();
  await form.close();
  await page.close();
});

for (const change of ['profile', 'page label'] as const) {
  test(`AI results are discarded when ${change} changes while the request is pending`, async () => {
    const db = await seed();
    db.settings = {
      aiEnabled: true,
      endpoint: 'https://ai.fixture.invalid/v1',
      model: 'fixture-model',
    };
    await worker.evaluate(async (value) => {
      await chrome.storage.local.set({ 'resume-companion': value });
      await chrome.storage.session.set({ aiKey: 'fictional-key' });
    }, db);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requested = false;
    await context.route('https://ai.fixture.invalid/v1/chat/completions', async (route) => {
      requested = true;
      const payload = JSON.parse(JSON.parse(route.request().postData()!).messages[1].content);
      const evidence = payload.layout.texts.find((t: { text: string }) =>
        t.text.includes('如何称呼您'),
      ).id;
      await gate;
      await route.fulfill({
        json: {
          choices: [
            {
              message: {
                content: JSON.stringify([
                  {
                    id: payload.layout.controls[0].id,
                    label: '姓名',
                    key: 'personal.name',
                    status: 'matched',
                    evidence: [evidence],
                  },
                ]),
              },
            },
          ],
        },
      });
    });
    const form = await context.newPage();
    await form.goto(`${testOrigin}/layout.html`);
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await form.bringToFront();
    await panel.getByRole('button', { name: '识别并填写', exact: true }).click();
    await panel.getByRole('button', { name: '确认识别并填写', exact: true }).click();
    try {
      await expect.poll(() => requested).toBe(true);
      await expect(panel.getByRole('status')).toContainText('当前阶段：AI 识别中');
      if (change === 'profile') {
        db.profiles[0]!.personal.name = '更新后的虚构姓名';
        await worker.evaluate(
          async (value) => chrome.storage.local.set({ 'resume-companion': value }),
          db,
        );
        await expect(panel.getByRole('heading', { name: /AI 页面识别/ })).toHaveCount(0);
      } else {
        await form.locator('[data-fixture="name-label"]').evaluate((el) => {
          el.textContent = '紧急联系人';
        });
      }
    } finally {
      release();
    }
    await expect(panel.getByRole('status')).toContainText(/变化|过期/);
    await expect(form.locator('[data-fixture="name"]')).toHaveValue('');
    await context.unroute('https://ai.fixture.invalid/v1/chat/completions');
    await panel.close();
    await form.close();
  });
}

test('AI service failure never falls back to rule-based autofill', async () => {
  const db = await seed();
  db.settings = {
    aiEnabled: true,
    endpoint: 'https://ai.fixture.invalid/v1',
    model: 'fixture-model',
  };
  await worker.evaluate(async (value) => {
    await chrome.storage.local.set({ 'resume-companion': value });
    await chrome.storage.session.set({ aiKey: 'fictional-key' });
  }, db);
  await context.route('https://ai.fixture.invalid/v1/chat/completions', (route) =>
    route.fulfill({ status: 500, body: 'unavailable' }),
  );
  const form = await context.newPage();
  await form.goto(testOrigin);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await form.bringToFront();
  await panel.getByRole('button', { name: '识别并填写', exact: true }).click();
  await panel.getByRole('button', { name: '确认识别并填写', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('HTTP 500');
  await expect(panel.getByRole('status')).toContainText('当前阶段：失败');
  await expect(panel.getByRole('button', { name: '重新采集并识别' })).toBeVisible();
  await expect(panel.getByText('等待 AI 识别', { exact: true })).toHaveCount(0);
  await expect(form.locator('#name')).toHaveValue('');
  await expect(panel.getByRole('button', { name: /填写已选/ })).toBeDisabled();
  await context.unroute('https://ai.fixture.invalid/v1/chat/completions');
  await panel.close();
  await form.close();
});

test('AI names empty, missing and unsupported fields independently and fills new local profile keys', async () => {
  const db = await seed();
  Object.assign(db.profiles[0]!.personal, {
    highestEducation: '硕士',
    studyMode: '',
    householdLocation: '本地私密户籍',
    ethnicity: '本地私密民族',
  });
  db.settings = {
    aiEnabled: true,
    endpoint: 'https://ai.fixture.invalid/v1',
    model: 'fixture-model',
  };
  await worker.evaluate(async (value) => {
    await chrome.storage.local.set({ 'resume-companion': value });
    await chrome.storage.session.set({ aiKey: 'fictional-key' });
  }, db);
  const requests: string[] = [];
  await context.route('https://ai.fixture.invalid/v1/chat/completions', async (route) => {
    requests.push(route.request().postData()!);
    const payload = JSON.parse(JSON.parse(route.request().postData()!).messages[1].content);
    const labels = [
      '现居住地',
      '最高学历',
      '学习形式',
      '户口所在地',
      '民族',
      '政治面貌',
      '其他说明',
      '毕业时间',
      '证明编号',
    ];
    const keys = [
      'personal.city',
      'personal.highestEducation',
      'personal.studyMode',
      'personal.householdLocation',
      'personal.ethnicity',
      null,
      null,
      null,
      'personal.name',
    ];
    const mappings = labels.flatMap((label, i) =>
      i === 6
        ? []
        : [
            {
              id: payload.layout.controls[i].id,
              label,
              key: keys[i],
              status: keys[i] ? 'matched' : 'unmatched',
              evidence:
                i === 8
                  ? ['nonexistent-text']
                  : [payload.layout.texts.find((t: { text: string }) => t.text === label).id],
            },
          ],
    );
    await route.fulfill({
      json: { choices: [{ message: { content: JSON.stringify(mappings) } }] },
    });
  });
  const form = await context.newPage();
  await form.goto(`${testOrigin}/profile-fields.html`);
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 400, height: 900 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await form.bringToFront();
  await panel.getByRole('button', { name: '识别并填写', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('等待确认发送');
  expect(requests).toHaveLength(0);
  await expect(panel.locator('.ai-preview details')).not.toHaveAttribute('open', '');
  await panel.getByRole('button', { name: '确认识别并填写', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('当前阶段：完成');
  await expect(panel.getByRole('status')).toContainText(
    '候选控件 9 项 · 模板复用 0 项 · AI 新识别 7 项 · 已识别名称 7 项 · 已匹配资料 6 项 · 已填写 2 项',
  );
  const card = (name: string) =>
    panel
      .locator('.field-card')
      .filter({ has: panel.locator('strong', { hasText: new RegExp(`^${name}$`) }) });
  await expect(card('学习形式')).toContainText('缺少资料');
  await expect(card('政治面貌')).toContainText('已新增空资料字段');
  await expect(card('政治面貌').getByLabel('补充资料 政治面貌')).toHaveValue('');
  await expect(card('民族')).toContainText('无法确认自定义下拉菜单范围');
  await expect(card('毕业时间')).toContainText('只读控件需手动操作');
  await expect(card('户口所在地')).toContainText('已有内容');
  await expect(card('未识别字段 7')).toContainText('模型未返回此字段');
  await expect(card('未识别字段 9')).toContainText('未知页面文字');
  await expect(panel.getByText('等待 AI 识别', { exact: true })).toHaveCount(0);
  await expect(form.locator('[data-fixture="highestEducation"]')).toHaveValue('master');
  await expect(form.locator('[data-fixture="city"]')).toHaveValue('杭州');
  await expect(form.locator('[data-fixture="studyMode"]')).toHaveValue('');
  await expect(form.locator('[data-fixture="householdLocation"]')).toHaveValue('网页私密户籍');
  for (const secret of [
    '硕士',
    '杭州',
    '本地私密户籍',
    '本地私密民族',
    '网页私密户籍',
    'fictional-key',
  ])
    expect(requests[0]).not.toContain(secret);
  const sent = JSON.parse(JSON.parse(requests[0]!).messages[1].content);
  expect(sent.keys.some((k: { key: string }) => k.key === 'personal.studyMode')).toBe(true);
  await panel.getByRole('button', { name: '撤销上次填写' }).click();
  await expect(form.locator('[data-fixture="highestEducation"]')).toHaveValue('');
  await expect(form.locator('[data-fixture="city"]')).toHaveValue('');
  const withNewFields = (await worker.evaluate(
    async () => (await chrome.storage.local.get('resume-companion'))['resume-companion'],
  )) as Database;
  db.profiles = withNewFields.profiles;
  expect(db.profiles[0]!.custom.some((c) => c.label === '政治面貌' && c.value === '')).toBe(true);
  db.profiles[0]!.personal.studyMode = '全日制';
  await worker.evaluate(
    async (value) => chrome.storage.local.set({ 'resume-companion': value }),
    db,
  );
  await expect(panel.getByRole('status')).toContainText('页面或资料已变化');
  await panel.getByRole('button', { name: '重新采集并识别' }).click();
  await panel.getByRole('button', { name: '确认识别并填写', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('已填写 3 项');
  await expect(form.locator('[data-fixture="studyMode"]')).toHaveValue('全日制');
  expect(requests[1]).not.toContain('全日制');
  await card('政治面貌').getByLabel('补充资料 政治面貌').fill('虚构政治资料');
  await card('政治面貌').getByRole('button', { name: '保存并填写' }).click();
  await expect(form.locator('[data-fixture="politics"]')).toHaveValue('虚构政治资料');
  expect(requests).toHaveLength(2);
  const afterSupplement = (await worker.evaluate(
    async () => (await chrome.storage.local.get('resume-companion'))['resume-companion'],
  )) as Database;
  expect(afterSupplement.profiles[0]!.custom.find((c) => c.label === '政治面貌')?.value).toBe(
    '虚构政治资料',
  );
  await form.reload();
  await expect(panel.getByRole('status')).toContainText('页面或资料已变化');
  await panel.getByRole('button', { name: '重新采集并识别' }).click();
  await panel.getByRole('button', { name: '确认识别并填写', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('已填写 4 项');
  await expect(form.locator('[data-fixture="politics"]')).toHaveValue('虚构政治资料');
  expect(requests[2]).not.toContain('虚构政治资料');
  for (const custom of afterSupplement.profiles[0]!.custom)
    expect(requests[2]).not.toContain(custom.id);
  const afterReuse = (await worker.evaluate(
    async () => (await chrome.storage.local.get('resume-companion'))['resume-companion'],
  )) as Database;
  expect(afterReuse.profiles[0]!.custom).toEqual(afterSupplement.profiles[0]!.custom);
  await panel.evaluate(() => window.scrollTo(0, 600));
  await expect.poll(async () => (await panel.getByRole('status').boundingBox())?.y).toBe(0);
  await panel.evaluate(() => window.scrollTo(0, 0));
  await panel.screenshot({
    path: '.dev/reports/screenshots/ai-progress-fields.png',
    fullPage: true,
  });
  await context.unroute('https://ai.fixture.invalid/v1/chat/completions');
  await panel.close();
  await form.close();
});

test('unlimited wait persists, displays elapsed time and can be cancelled without applying late results', async () => {
  await seed();
  const settings = await context.newPage();
  await settings.goto(`chrome-extension://${extensionId}/options.html`);
  await settings.getByRole('button', { name: '数据与设置', exact: true }).click();
  await settings.getByLabel('启用', { exact: true }).check();
  await settings.getByLabel('API 基础地址').fill('https://ai.fixture.invalid/v1');
  await settings.getByLabel('模型名称').fill('fixture-model');
  await settings.getByLabel('本次会话 API Key').fill('fictional-key');
  await settings.getByLabel('最长等待时间（秒）').fill('0');
  await settings.getByRole('button', { name: '保存 AI 设置' }).click();
  await expect(settings.getByRole('status')).toContainText('1–86400');
  await settings.getByLabel('AI 等待方式').selectOption('unlimited');
  await settings.getByRole('button', { name: '保存 AI 设置' }).click();
  await expect(settings.getByRole('status')).toContainText('设置已保存');
  await settings.reload();
  await settings.getByRole('button', { name: '数据与设置', exact: true }).click();
  await expect(settings.getByLabel('AI 等待方式')).toHaveValue('unlimited');
  await expect(settings.getByLabel('最长等待时间（秒）')).toHaveCount(0);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  await context.route('https://ai.fixture.invalid/v1/chat/completions', async (route) => {
    requested = true;
    const payload = JSON.parse(JSON.parse(route.request().postData()!).messages[1].content);
    const evidence = payload.layout.texts.find((t: { text: string }) =>
      t.text.includes('如何称呼您'),
    ).id;
    await gate;
    await route.fulfill({
      json: {
        choices: [
          {
            message: {
              content: JSON.stringify([
                {
                  id: payload.layout.controls[0].id,
                  label: '姓名',
                  key: 'personal.name',
                  status: 'matched',
                  evidence: [evidence],
                },
              ]),
            },
          },
        ],
      },
    });
  });
  const form = await context.newPage();
  await form.goto(`${testOrigin}/layout.html`);
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 400, height: 900 });
  await panel.addInitScript(() => {
    AbortSignal.timeout = () => {
      throw new Error('无限等待不应创建超时信号');
    };
  });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await form.bringToFront();
  await panel.getByRole('button', { name: '识别并填写', exact: true }).click();
  await expect(panel.locator('.ai-preview')).toContainText('本次等待：无限等待');
  await panel.getByRole('button', { name: '确认识别并填写', exact: true }).click();
  try {
    await expect.poll(() => requested).toBe(true);
    await expect(panel.getByRole('status')).toContainText(/已等待 [1-9]\d* 秒 · 无限等待/);
    await panel.evaluate(() => window.scrollTo(0, 0));
    await panel.screenshot({ path: '.dev/reports/screenshots/ai-unlimited-wait.png' });
    await panel.getByRole('button', { name: '取消 AI 请求' }).click();
    await expect(panel.getByRole('status')).toContainText('当前阶段：已取消');
    await expect(panel.getByRole('button', { name: '重新采集并识别' })).toBeEnabled();
  } finally {
    release();
  }
  await context.unrouteAll({ behavior: 'wait' });
  await expect(form.locator('[data-fixture="name"]')).toHaveValue('');
  await expect(panel.getByRole('status')).toContainText('已取消');
  await panel.close();
  await form.close();
  await settings.close();
});

for (const failure of ['timeout', 'permission'] as const) {
  test(`AI ${failure} ends waiting and offers an explicit retry without filling`, async () => {
    const db = await seed();
    db.settings = {
      aiEnabled: true,
      endpoint: 'https://ai.fixture.invalid/v1',
      model: 'fixture-model',
    };
    await worker.evaluate(async (value) => {
      await chrome.storage.local.set({ 'resume-companion': value });
      await chrome.storage.session.set({ aiKey: 'fictional-key' });
    }, db);
    let requests = 0;
    await context.route('https://ai.fixture.invalid/v1/chat/completions', async (route) => {
      requests++;
      // Delay the mock response past the test's shortened AbortSignal deadline.
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({ json: { choices: [{ message: { content: '[]' } }] } });
    });
    const form = await context.newPage();
    await form.goto(`${testOrigin}/layout.html`);
    const panel = await context.newPage();
    await panel.addInitScript((mode) => {
      if (mode === 'permission') {
        // Exercise the denied API result; native OS permission UI is covered manually.
        chrome.permissions.request = async () => false;
      } else {
        const timeout = AbortSignal.timeout.bind(AbortSignal);
        AbortSignal.timeout = () => timeout(100);
      }
    }, failure);
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await form.bringToFront();
    await panel.getByRole('button', { name: '识别并填写', exact: true }).click();
    await panel.getByRole('button', { name: '确认识别并填写', exact: true }).click();
    await expect(panel.getByRole('status')).toContainText('当前阶段：失败');
    await expect(panel.getByRole('status')).toContainText(
      failure === 'timeout' ? '请求超时' : '未允许访问 AI 服务',
    );
    await expect(panel.getByRole('button', { name: '重新采集并识别' })).toBeVisible();
    await expect(panel.getByRole('button', { name: '确认识别并填写', exact: true })).toHaveCount(0);
    await expect(form.locator('[data-fixture="name"]')).toHaveValue('');
    expect(requests).toBe(failure === 'timeout' ? 1 : 0);
    await context.unrouteAll({ behavior: 'wait' });
    await panel.close();
    await form.close();
  });
}

for (const [file, email] of [
  ['sample.pdf', 'student@example.com'],
  ['sample.docx', 'docx@example.com'],
]) {
  test(`${file} is extracted locally in the packaged extension`, async () => {
    await seed();
    const page = await context.newPage();
    const network: string[] = [];
    page.on('request', (r) => {
      if (/^https?:/.test(r.url())) network.push(r.url());
    });
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.getByRole('button', { name: '导入资料', exact: true }).click();
    await page.getByLabel('导入简历文件').setInputFiles(path.resolve('tests/fixtures', file!));
    await expect(page.getByLabel('邮箱', { exact: true })).toHaveValue(email!);
    expect(network).toEqual([]);
    await page.close();
  });
}
