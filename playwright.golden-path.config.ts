import { defineConfig, devices } from '@playwright/test';

const normalizedEnv = { ...process.env };

if (normalizedEnv.NO_COLOR) {
  delete normalizedEnv.NO_COLOR;
  delete process.env.NO_COLOR;
}

Object.assign(process.env, normalizedEnv);

const baseURL = normalizedEnv.GOLDEN_PATH_UI_BASE_URL || 'http://127.0.0.1:15173';

export default defineConfig({
  testDir: './tests/browser',
  testMatch: '**/*golden-path*.browser.spec.ts',
  timeout: 60_000,
  outputDir: 'test-results/browser-golden-path',
  reporter: process.env.CI
    ? [
      ['list'],
      ['json', { outputFile: 'test-results/browser-golden-path/playwright-results.json' }],
    ]
    : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'golden-path-chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
});