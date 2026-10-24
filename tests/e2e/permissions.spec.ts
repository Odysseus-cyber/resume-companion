import { test, expect, chromium, type BrowserContext, type Worker } from '@playwright/test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
declare const chrome: typeof import('wxt/browser').browser;

const testOrigin = `http://127.0.0.1:${process.env.RC_TEST_PORT || 4178}`;
let context: BrowserContext;
let worker: Worker;
let extensionId: string;
let profile: string;
test.beforeAll(async () => {
  const profiles = process.env.PLAYWRIGHT_PROFILE_DIR || path.resolve('.dev/profiles');
  await mkdir(profiles, { recursive: true });
  profile = await mkdtemp(path.join(profiles, 'permissions-'));
  const extension = path.resolve('.output/chrome-mv3');
  // The real artifact, with NO test-only host_permissions added.
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  extensionId = new URL(worker.url()).host;
});
test.afterAll(async () => {
  await context?.close();
  if (profile) await rm(profile, { recursive: true, force: true });
});

test('real package distinguishes missing tab permission and offers explicit local authorization', async () => {
  const form = await context.newPage();
  await form.goto(testOrigin);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await form.bringToFront();
  const before = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return {
      hasId: tab?.id !== undefined,
      hasUrl: !!tab?.url,
      permissions: await chrome.permissions.getAll(),
    };
  });
  expect(before.hasId).toBe(true);
  expect(before.hasUrl).toBe(false);
  expect(before.permissions.origins || []).not.toContain('http://127.0.0.1/*');
  await panel.getByRole('button', { name: '识别并填写', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('无法读取当前页地址');
  await expect(panel.getByRole('button', { name: '授权本地测试页并识别' })).toBeVisible();
  const after = await worker.evaluate(async () => chrome.permissions.getAll());
  expect(after).toEqual(before.permissions);
  // Native optional-permission approval requires manual acceptance in a headed browser.
  // The granted-site fill path is covered separately in extension.spec.ts.
  await panel.close();
  await form.close();
});

test('toolbar opens through an explicit action handler and internal pages are identified separately', async () => {
  const behavior = await worker.evaluate(async () => ({
    behavior: await chrome.sidePanel.getPanelBehavior(),
    listens: chrome.action.onClicked.hasListeners(),
  }));
  expect(behavior.behavior.openPanelOnActionClick).toBe(false);
  expect(behavior.listens).toBe(true);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.bringToFront();
  await panel.getByRole('button', { name: '识别并填写', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('浏览器内部页面或扩展页面');
  await panel.close();
});
