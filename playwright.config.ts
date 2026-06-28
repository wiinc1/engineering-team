import { defineConfig, devices } from '@playwright/test';
import {
  SCREENSHOT_SNAPSHOT_TEMPLATE,
  browserProjectNames,
} from './tests/browser/browser-quality-config.mjs';

const normalizedEnv = { ...process.env };
const projectDevices = {
  chromium: devices['Desktop Chrome'],
  firefox: devices['Desktop Firefox'],
  'mobile-chrome': devices['Pixel 5'],
  'mobile-safari': devices['iPhone 12'],
};

if (normalizedEnv.NO_COLOR) {
  delete normalizedEnv.NO_COLOR;
  delete process.env.NO_COLOR;
}

// Keep the parent Playwright process and its child workers on the same env.
Object.assign(process.env, normalizedEnv);

export default defineConfig({
  testDir: './tests/browser',
  testIgnore: '**/*golden-path*.browser.spec.ts',
  timeout: 30_000,
  outputDir: 'test-results/browser',
  reporter: process.env.CI
    ? [
      ['list'],
      ['html', { outputFolder: 'playwright-report', open: 'never' }],
      ['json', { outputFile: 'test-results/browser/playwright-results.json' }],
    ]
    : 'list',
  snapshotPathTemplate: SCREENSHOT_SNAPSHOT_TEMPLATE,
  expect: {
    timeout: 5_000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.04,
      threshold: 0.2,
    },
  },
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'env -u FORCE_COLOR npm run dev -- --host 127.0.0.1 --port 4174',
    env: normalizedEnv,
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: true,
    timeout: 30_000,
  },
  projects: browserProjectNames(normalizedEnv).map((name) => ({
    name,
    use: { ...projectDevices[name] },
  })),
});
