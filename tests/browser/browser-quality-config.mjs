export const FEATURE_FLAG = 'ff_browser_verification_gates';

export const BROWSER_MATRIX = [
  {
    name: 'chromium',
    device: 'Desktop Chrome',
    label: 'Desktop Chrome',
    requiredInCi: true,
  },
  {
    name: 'firefox',
    device: 'Desktop Firefox',
    label: 'Desktop Firefox',
    requiredInCi: true,
  },
  {
    name: 'mobile-chrome',
    device: 'Pixel 5',
    label: 'Mobile Chrome',
    requiredInCi: true,
  },
  {
    name: 'mobile-safari',
    device: 'iPhone 12',
    label: 'Mobile Safari / WebKit',
    requiredInCi: true,
    localOptIn: 'PLAYWRIGHT_INCLUDE_WEBKIT=1',
    localOptOut: 'PLAYWRIGHT_SKIP_WEBKIT=1',
  },
];

export const CRITICAL_ROUTE_STATES = [
  {
    slug: 'sign-in',
    label: 'Sign-in',
    path: '/sign-in',
    heading: 'Sign in to Engineering Team',
    requiresSession: false,
  },
  {
    slug: 'task-workspace',
    label: 'Task workspace',
    path: '/tasks?view=board',
    heading: 'Task workspace',
    requiresSession: true,
  },
  {
    slug: 'role-inbox',
    label: 'Role inbox',
    path: '/inbox/qa',
    heading: 'QA Inbox',
    requiresSession: true,
  },
  {
    slug: 'task-creation',
    label: 'Task creation',
    path: '/tasks/create',
    heading: 'Add a new task',
    requiresSession: true,
  },
  {
    slug: 'task-detail',
    label: 'Task detail',
    path: '/tasks/TSK-42',
    heading: 'Wire task detail',
    requiresSession: true,
  },
];

export const SCREENSHOT_VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 900 },
];

export const CORE_WEB_VITALS_BUDGETS = {
  firstContentfulPaintMs: 2500,
  largestContentfulPaintMs: 3000,
  cumulativeLayoutShift: 0.1,
  totalBlockingTimeMs: 300,
  domContentLoadedMs: 2500,
};

export const VISUAL_MAX_DIFF_PIXEL_RATIO = {
  local: 0.04,
  ci: 0.1,
};

export const SCREENSHOT_SNAPSHOT_TEMPLATE = 'tests/browser/__screenshots__/{testFileName}/{arg}{ext}';

export function isCi(env = process.env) {
  return env.CI === 'true' || env.CI === '1' || env.GITHUB_ACTIONS === 'true';
}

export function shouldIncludeWebkit(env = process.env) {
  if (env.PLAYWRIGHT_SKIP_WEBKIT === '1') return false;
  if (env.PLAYWRIGHT_INCLUDE_WEBKIT === '1') return true;
  return isCi(env);
}

export function visualMaxDiffPixelRatio(env = process.env) {
  return isCi(env) ? VISUAL_MAX_DIFF_PIXEL_RATIO.ci : VISUAL_MAX_DIFF_PIXEL_RATIO.local;
}

export function browserProjectNames(env = process.env) {
  return BROWSER_MATRIX
    .filter((project) => project.name !== 'mobile-safari' || shouldIncludeWebkit(env))
    .map((project) => project.name);
}

export function expectedVisualSnapshotNames() {
  return CRITICAL_ROUTE_STATES.flatMap((route) =>
    SCREENSHOT_VIEWPORTS.map((viewport) => `${route.slug}-${viewport.name}.png`),
  );
}
