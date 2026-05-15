const assert = require('node:assert/strict');
const test = require('node:test');

async function loadConfig() {
  return import('../../tests/browser/browser-quality-config.mjs');
}

test('browser quality matrix includes WebKit in CI unless explicitly skipped', async () => {
  const { browserProjectNames, shouldIncludeWebkit } = await loadConfig();

  assert.equal(shouldIncludeWebkit({ CI: 'true' }), true);
  assert.equal(shouldIncludeWebkit({ GITHUB_ACTIONS: 'true' }), true);
  assert.equal(shouldIncludeWebkit({ CI: 'true', PLAYWRIGHT_SKIP_WEBKIT: '1' }), false);
  assert.equal(shouldIncludeWebkit({ PLAYWRIGHT_INCLUDE_WEBKIT: '1' }), true);

  assert.deepEqual(browserProjectNames({ CI: 'true' }), [
    'chromium',
    'firefox',
    'mobile-chrome',
    'mobile-safari',
  ]);
  assert.deepEqual(browserProjectNames({ PLAYWRIGHT_SKIP_WEBKIT: '1' }), [
    'chromium',
    'firefox',
    'mobile-chrome',
  ]);
});

test('browser quality config covers the required route and viewport matrix', async () => {
  const {
    CORE_WEB_VITALS_BUDGETS,
    CRITICAL_ROUTE_STATES,
    SCREENSHOT_VIEWPORTS,
    VISUAL_MAX_DIFF_PIXEL_RATIO,
    expectedVisualSnapshotNames,
    visualMaxDiffPixelRatio,
  } = await loadConfig();

  assert.deepEqual(CRITICAL_ROUTE_STATES.map((route) => route.slug), [
    'sign-in',
    'task-workspace',
    'role-inbox',
    'task-creation',
    'task-detail',
  ]);
  assert.deepEqual(SCREENSHOT_VIEWPORTS.map((viewport) => viewport.name), ['mobile', 'desktop']);
  assert.equal(expectedVisualSnapshotNames().length, 10);
  assert.equal(CORE_WEB_VITALS_BUDGETS.largestContentfulPaintMs, 3000);
  assert.equal(CORE_WEB_VITALS_BUDGETS.cumulativeLayoutShift, 0.1);
  assert.equal(VISUAL_MAX_DIFF_PIXEL_RATIO.local, 0.04);
  assert.equal(VISUAL_MAX_DIFF_PIXEL_RATIO.ci, 0.1);
  assert.equal(visualMaxDiffPixelRatio({}), VISUAL_MAX_DIFF_PIXEL_RATIO.local);
  assert.equal(visualMaxDiffPixelRatio({ GITHUB_ACTIONS: 'true' }), VISUAL_MAX_DIFF_PIXEL_RATIO.ci);
});
