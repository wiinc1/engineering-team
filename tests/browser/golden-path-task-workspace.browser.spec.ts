import { expect, test } from '@playwright/test';

const ADMIN_EMAIL = process.env.GOLDEN_PATH_ADMIN_EMAIL || 'admin@golden-path.local';
const ADMIN_PASSWORD = process.env.GOLDEN_PATH_ADMIN_PASSWORD || 'GoldenPathAdmin1';

async function signIn(page) {
  await page.goto('/sign-in');
  await page.getByRole('textbox', { name: /email/i }).fill(ADMIN_EMAIL);
  await page.getByRole('textbox', { name: /^password$/i }).fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/(tasks|overview|inbox)/, { timeout: 30_000 });
}

test.describe('golden-path operator UI', () => {
  test('loads task workspace on runnable surface with real auth', async ({ page }) => {
    await signIn(page);
    await page.goto('/tasks?view=list');
    await expect(page.getByRole('heading', { name: 'Queue-first task workspace' })).toBeVisible();
    await expect(page.locator('.task-list-panel--command-center')).toBeVisible({ timeout: 15_000 });
  });

  test('selecting a task opens persistent inspector without leaving queue view', async ({ page }) => {
    await signIn(page);
    await page.goto('/tasks?view=list');
    const taskRow = page.locator('.command-center-queue tbody tr, .command-center-queue .task-card').first();
    await expect(taskRow).toBeVisible({ timeout: 20_000 });
    await taskRow.click();
    await expect(page.locator('.command-center-inspector:not(.command-center-inspector--empty)')).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/tasks/);
  });
});