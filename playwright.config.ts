import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45000,
  expect: { timeout: 8000 },
  workers: 1,
  outputDir: '.dev/reports/test-results',
  reporter: [['list'], ['html', { outputFolder: '.dev/reports/playwright', open: 'never' }]],
  webServer: {
    command: 'node tests/fixtures/server.mjs',
    url: `http://127.0.0.1:${process.env.RC_TEST_PORT || 4178}`,
    reuseExistingServer: false,
  },
});
