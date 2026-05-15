import { expect, test } from '@playwright/test';
import {
  CRITICAL_ROUTE_STATES,
  SCREENSHOT_VIEWPORTS,
  visualMaxDiffPixelRatio,
} from './browser-quality-config.mjs';
import {
  installBrowserQualityApp,
  openNavigationIfCollapsed,
  stabilizeVisualState,
} from './browser-quality-fixtures';

test.describe('browser visual regression gate', () => {
  for (const route of CRITICAL_ROUTE_STATES) {
    for (const viewport of SCREENSHOT_VIEWPORTS) {
      test(`${route.label} matches the ${viewport.name} screenshot baseline`, async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'chromium', 'visual baselines are pinned to desktop Chromium');
        await installBrowserQualityApp(page, { session: route.requiresSession });
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(route.path, { waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('heading', { name: route.heading, exact: true })).toBeVisible();
        await openNavigationIfCollapsed(page);
        await stabilizeVisualState(page);

        const capturesStableViewport = route.slug === 'task-detail' && viewport.name === 'mobile';
        await expect(page).toHaveScreenshot(`${route.slug}-${viewport.name}.png`, {
          fullPage: !capturesStableViewport,
          maxDiffPixelRatio: visualMaxDiffPixelRatio(),
        });
      });
    }
  }
});
