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
import { demoProfile, defaultDatabase } from '../../src/domain/model';
declare const chrome: typeof import('wxt/browser').browser;

const origin = `http://127.0.0.1:${process.env.RC_TEST_PORT || 4178}`;
let context: BrowserContext;
let worker: Worker;
let extensionId: string;
let temporary: string;
test.beforeAll(async () => {
  const profiles = process.env.PLAYWRIGHT_PROFILE_DIR || path.resolve('.dev/profiles');
  await mkdir(profiles, { recursive: true });
  temporary = await mkdtemp(path.join(profiles, 'choices-'));
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

async function prepare() {
  const db = defaultDatabase();
  const profile = demoProfile();
  profile.personal.highestEducation = '本科';
  profile.personal.householdLocation = '浙江省/杭州市/余杭区';
  profile.personal.ethnicity = '虚构本地民族';
  profile.custom.push({
    id: 'private-custom-choice-id',
    label: '自定义说明',
    value: '私密自定义内容',
  });
  db.profiles = [profile];
  db.activeId = profile.id;
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
    const body = route.request().postData()!;
    requests.push(body);
    const payload = JSON.parse(JSON.parse(body).messages[1].content);
    expect(payload.layout.controls).toHaveLength(3);
    const pairs = [
      ['最高学历', 'personal.highestEducation'],
      ['户口所在地', 'personal.householdLocation'],
      ['民族', 'personal.ethnicity'],
    ];
    await route.fulfill({
      json: {
        choices: [
          {
            message: {
              content: JSON.stringify(
                pairs.map(([label, key], index) => ({
                  id: payload.layout.controls[index].id,
                  label,
                  key,
                  status: 'matched',
                  evidence: [
                    payload.layout.texts.find((entry: { text: string }) => entry.text === label).id,
                  ],
                })),
              ),
            },
          },
        ],
      },
    });
  });
  const form = await context.newPage();
  await form.goto(`${origin}/choices.html`);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  return { form, panel, requests, profile };
}

async function identify(form: Page, panel: Page) {
  await form.bringToFront();
  await panel.getByRole('button', { name: 'AI 识别并填写', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('等待确认发送');
}

async function finish(form: Page, panel: Page) {
  await panel.getByRole('button', { name: '确认识别并填写', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('当前阶段：完成');
  expect(
    await form.evaluate(() => (window as unknown as { submissions: number }).submissions),
  ).toBe(0);
}

test('AI maps keys; local drivers choose delayed enum and scoped region then continue and undo', async () => {
  const { form, panel, requests, profile } = await prepare();
  try {
    await identify(form, panel);
    expect(requests).toHaveLength(0);
    await finish(form, panel);
    await expect(form.locator('#education')).toHaveValue('大学本科');
    await expect(form.locator('#household')).toHaveValue('浙江省/杭州市/余杭区');
    await expect(form.locator('#ethnicity')).toHaveValue('虚构本地民族');
    expect(requests).toHaveLength(1);
    for (const secret of [
      profile.personal.name,
      profile.personal.phone,
      profile.personal.householdLocation,
      profile.personal.ethnicity,
      'private-custom-choice-id',
      '私密自定义内容',
    ]) {
      expect(requests[0]).not.toContain(secret);
    }
    await expect(form.locator('#region-dialog')).toBeHidden();
    await form.locator('#ethnicity').fill('用户后来修改');
    await panel.getByRole('button', { name: '撤销上次填写' }).click();
    await expect(form.locator('#education')).toHaveValue('');
    await expect(form.locator('#household')).toHaveValue('');
    await expect(form.locator('#ethnicity')).toHaveValue('用户后来修改');
  } finally {
    await context.unroute('https://ai.fixture.invalid/v1/chat/completions');
    await panel.close();
    await form.close();
  }
});

test('existing choices and popup query/selection are private and preserved', async () => {
  const { form, panel, requests } = await prepare();
  try {
    await form.locator('#education').evaluate((element) => {
      (element as HTMLInputElement).value = '网页已有学历';
    });
    await form.locator('#household').evaluate((element) => {
      (element as HTMLInputElement).value = '网页已有私密地区';
    });
    await form.locator('#household').click();
    await form.locator('#region-search').fill('私密地区搜索词');
    await form.locator('#selected-region').evaluate((element) => {
      element.textContent = '网页已选择的私密位置';
    });
    await identify(form, panel);
    expect(requests).toHaveLength(0);
    await finish(form, panel);
    await expect(form.locator('#education')).toHaveValue('网页已有学历');
    await expect(form.locator('#household')).toHaveValue('网页已有私密地区');
    await expect(form.locator('#ethnicity')).toHaveValue('虚构本地民族');
    for (const secret of [
      '网页已有学历',
      '网页已有私密地区',
      '私密地区搜索词',
      '网页已选择的私密位置',
      '余杭区',
      '搜索地区',
    ]) {
      expect(requests[0]).not.toContain(secret);
    }
  } finally {
    await context.unroute('https://ai.fixture.invalid/v1/chat/completions');
    await panel.close();
    await form.close();
  }
});
