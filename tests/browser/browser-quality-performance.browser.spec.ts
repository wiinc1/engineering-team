import { expect, test } from '@playwright/test';
import {
  CORE_WEB_VITALS_BUDGETS,
  CRITICAL_ROUTE_STATES,
} from './browser-quality-config.mjs';
import { installBrowserQualityApp, openNavigationIfCollapsed } from './browser-quality-fixtures';

const performanceRoutes = CRITICAL_ROUTE_STATES.filter((route) =>
  ['sign-in', 'task-workspace', 'task-detail'].includes(route.slug),
);

test.describe('browser Core Web Vitals budget gate', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Core Web Vitals budgets use Chromium timing APIs');

  for (const route of performanceRoutes) {
    test(`${route.label} stays within Core Web Vitals budgets`, async ({ page }, testInfo) => {
      await installCoreWebVitalsObserver(page);
      await installBrowserQualityApp(page, { session: route.requiresSession });
      await page.goto(route.path, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: route.heading, exact: true })).toBeVisible();
      await openNavigationIfCollapsed(page);
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await page.waitForTimeout(250);

      const metrics = await readCoreWebVitals(page, route.slug);
      await testInfo.attach(`${route.slug}-core-web-vitals.json`, {
        body: JSON.stringify(metrics, null, 2),
        contentType: 'application/json',
      });

      expect(metrics.firstContentfulPaintMs).toBeLessThanOrEqual(CORE_WEB_VITALS_BUDGETS.firstContentfulPaintMs);
      expect(metrics.largestContentfulPaintMs).toBeLessThanOrEqual(CORE_WEB_VITALS_BUDGETS.largestContentfulPaintMs);
      expect(metrics.cumulativeLayoutShift).toBeLessThanOrEqual(CORE_WEB_VITALS_BUDGETS.cumulativeLayoutShift);
      expect(metrics.totalBlockingTimeMs).toBeLessThanOrEqual(CORE_WEB_VITALS_BUDGETS.totalBlockingTimeMs);
      expect(metrics.domContentLoadedMs).toBeLessThanOrEqual(CORE_WEB_VITALS_BUDGETS.domContentLoadedMs);
    });
  }
});

async function installCoreWebVitalsObserver(page) {
  await page.addInitScript(() => {
    window.__browserQualityVitals = {
      cls: 0,
      lcp: 0,
      longTaskBlocking: 0,
    };

    const observe = (type, callback) => {
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) callback(entry);
        });
        observer.observe({ type, buffered: true });
      } catch {
        // Unsupported metrics are treated as zero by the budget reader.
      }
    };

    observe('largest-contentful-paint', (entry) => {
      window.__browserQualityVitals.lcp = entry.startTime;
    });
    observe('layout-shift', (entry) => {
      if (!entry.hadRecentInput) window.__browserQualityVitals.cls += entry.value;
    });
    observe('longtask', (entry) => {
      window.__browserQualityVitals.longTaskBlocking += Math.max(0, entry.duration - 50);
    });
  });
}

async function readCoreWebVitals(page, routeSlug: string) {
  return page.evaluate((slug) => {
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const paints = performance.getEntriesByType('paint');
    const fcp = paints.find((entry) => entry.name === 'first-contentful-paint')?.startTime || 0;
    const vitals = window.__browserQualityVitals || { cls: 0, lcp: 0, longTaskBlocking: 0 };

    return {
      route: slug,
      firstContentfulPaintMs: Math.round(fcp),
      largestContentfulPaintMs: Math.round(vitals.lcp || fcp),
      cumulativeLayoutShift: Number(vitals.cls.toFixed(4)),
      totalBlockingTimeMs: Math.round(vitals.longTaskBlocking),
      domContentLoadedMs: Math.round(navigation?.domContentLoadedEventEnd || 0),
    };
  }, routeSlug);
}
