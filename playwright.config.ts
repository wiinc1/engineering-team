import { defineConfig, devices } from '@playwright/test';

const includeWebkit = process.env.PLAYWRIGHT_INCLUDE_WEBKIT === '1';
const normalizedEnv = { ...process.env };

if (normalizedEnv.NO_COLOR) {
  delete normalizedEnv.NO_COLOR;
  delete process.env.NO_COLOR;
}

// Keep the parent Playwright process and its child workers on the same env.
Object.assign(process.env, normalizedEnv);

export default defineConfig({
  testDir: './tests/browser',
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'env -u FORCE_COLOR npm run dev -- --host 127.0.0.1 --port 4174',
    env: normalizedEnv,
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: true,
    timeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
    ...(includeWebkit ? [{
      name: 'mobile-safari',
      use: { ...devices['iPhone 12'] },
    }] : []),
  ],
});
