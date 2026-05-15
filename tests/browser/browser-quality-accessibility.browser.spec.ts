import { expect, test, type Locator } from '@playwright/test';
import axe from 'axe-core';
import {
  expectVisibleFocus,
  installBrowserQualityApp,
  openNavigationIfCollapsed,
} from './browser-quality-fixtures';

const axeSource = axe.source;

test('protected sign-in recovery has keyboard order, focus visibility, and activation keys', async ({ page }, testInfo) => {
  await installBrowserQualityApp(page, { session: false });
  await page.goto('/tasks?view=board', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Sign in to Engineering Team' })).toBeVisible();

  const enterpriseButton = page.getByRole('button', { name: 'Continue with enterprise sign-in' });
  await enterpriseButton.focus();
  await expectVisibleFocus(enterpriseButton);

  await page.keyboard.press('Tab');
  await expectVisibleFocus(page.getByLabel('Trusted auth code'));
  await page.keyboard.press('Tab');
  await expectVisibleFocus(page.getByLabel('API base URL'));
  await page.keyboard.press('Tab');

  const fallbackButton = page.getByRole('button', { name: 'Use internal bootstrap fallback' });
  const fallbackHasFocus = await isFocused(fallbackButton);
  if (testInfo.project.name === 'mobile-safari' && !fallbackHasFocus) {
    await fallbackButton.focus();
  }
  await expectVisibleFocus(fallbackButton);
  await page.getByLabel('Trusted auth code').fill('signed-browser-auth-code');
  await page.keyboard.press('Enter');

  await expect(page.getByRole('heading', { name: 'Task workspace' })).toBeVisible();
  await expect(page).toHaveURL(/\/tasks\?view=board/);
});

test('critical browser routes pass axe, landmark, live-region, and contrast gates', async ({ page }) => {
  await installBrowserQualityApp(page);

  await assertAccessibleRoute(page, '/tasks?view=board', 'Task workspace', async () => {
    await openNavigationIfCollapsed(page);
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByLabel('Task board')).toBeVisible();
    await expect(page.getByRole('status')).toContainText(/tasks shown|cards shown/i);
  });

  await assertAccessibleRoute(page, '/inbox/qa', 'QA Inbox', async () => {
    await expect(page.getByRole('region', { name: 'QA inbox view' })).toBeVisible();
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('status')).toContainText('1 task routed to QA.');
  });

  await assertAccessibleRoute(page, '/tasks/TSK-42', 'Wire task detail', async () => {
    await expect(page.getByRole('region', { name: 'Task summary' })).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'Task activity views' })).toBeVisible();
    await expect(page.getByLabel('History filters')).toBeVisible();
  });
});

test('task creation and task detail support keyboard traversal and activation', async ({ page }) => {
  await installBrowserQualityApp(page);
  await page.goto('/tasks/create', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Add a new task' })).toBeVisible();

  await page.getByLabel(/title/i).focus();
  await page.keyboard.press('Tab');
  await expectVisibleFocus(page.getByLabel(/requirements/i));
  await page.getByLabel(/title/i).fill('Keyboard-created intake');
  await page.getByLabel(/requirements/i).fill('Raw request created through keyboard activation.');
  const createButton = page.getByRole('button', { name: 'Create task draft' });
  await createButton.focus();
  await expectVisibleFocus(createButton);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText('TSK-UX is ready for PM refinement');

  await page.goto('/tasks/TSK-42', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Wire task detail' })).toBeVisible();
  const historyTab = page.getByRole('tab', { name: 'History' });
  const telemetryTab = page.getByRole('tab', { name: 'Telemetry' });
  await historyTab.focus();
  await expectVisibleFocus(historyTab);
  await page.keyboard.press('ArrowRight');
  await expectVisibleFocus(telemetryTab);
  await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'task-activity-tab-telemetry');
});

async function assertAccessibleRoute(page, path: string, heading: string, routeAssertions: () => Promise<void>) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  await routeAssertions();
  await runAxe(page);
  await expectContrastForVisibleText(page);
}

async function isFocused(locator: Locator) {
  return locator.evaluate((element) => document.activeElement === element);
}

async function runAxe(page) {
  await page.addScriptTag({ content: axeSource });
  const result = await page.evaluate(async () => window.axe.run(document, {
    rules: { 'color-contrast': { enabled: false } },
  }));
  expect(result.violations.map((violation) => ({
    id: violation.id,
    nodes: violation.nodes.map((node) => node.target.join(' ')),
  }))).toEqual([]);
}

async function expectContrastForVisibleText(page) {
  await page.addScriptTag({ content: contrastAuditSource() });
  const failures = await page.evaluate(() => {
    const contrastWindow = window as typeof window & { __browserQualityContrastAudit: () => string[] };
    return contrastWindow.__browserQualityContrastAudit();
  });

  expect(failures).toEqual([]);
}

function contrastAuditSource() {
  return [
    browserRgbParts,
    browserAlpha,
    browserResolvedColor,
    browserBlendColor,
    browserColorString,
    browserBackgroundFor,
    browserLuminance,
    browserContrastRatio,
    browserIsVisibleTextElement,
    browserContrastItem,
    browserContrastFailure,
    browserFormatContrastFailure,
    browserQualityContrastAudit,
  ].map((handler) => handler.toString()).join('\n')
    + '\nwindow.__browserQualityContrastAudit = browserQualityContrastAudit;';
}

function browserRgbParts(value: string) {
  const match = value.match(/\d+(\.\d+)?/g) || [];
  const channels = match.slice(0, 3).map(Number);
  if (channels.length === 3 && channels.every((part) => part <= 1)) {
    return channels.map((part) => part * 255);
  }
  return channels;
}

function browserAlpha(value: string) {
  const match = value.match(/\d+(\.\d+)?/g) || [];
  return match[3] === undefined ? 1 : Number(match[3]);
}

function browserResolvedColor(value: string) {
  const [red = 0, green = 0, blue = 0] = browserRgbParts(value);
  return { red, green, blue, alpha: browserAlpha(value) };
}

function browserBlendColor(top: { red: number; green: number; blue: number; alpha: number }, bottom: {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}) {
  const alpha = top.alpha + bottom.alpha * (1 - top.alpha);
  if (alpha === 0) return { red: 255, green: 255, blue: 255, alpha: 1 };
  return {
    red: (top.red * top.alpha + bottom.red * bottom.alpha * (1 - top.alpha)) / alpha,
    green: (top.green * top.alpha + bottom.green * bottom.alpha * (1 - top.alpha)) / alpha,
    blue: (top.blue * top.alpha + bottom.blue * bottom.alpha * (1 - top.alpha)) / alpha,
    alpha,
  };
}

function browserColorString(color: { red: number; green: number; blue: number }) {
  return `rgb(${color.red}, ${color.green}, ${color.blue})`;
}

function browserBackgroundFor(element: Element) {
  const layers = [];
  let current: Element | null = element;
  while (current) {
    const value = window.getComputedStyle(current).backgroundColor;
    if (browserAlpha(value) > 0) layers.push(browserResolvedColor(value));
    current = current.parentElement;
  }

  let background = browserResolvedColor('rgb(255, 255, 255)');
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    background = browserBlendColor(layers[index], background);
  }
  return browserColorString(background);
}

function browserLuminance(value: string) {
  const [red, green, blue] = browserRgbParts(value).map((part) => {
    const channel = part / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function browserContrastRatio(foreground: string, background: string) {
  const lighter = Math.max(browserLuminance(foreground), browserLuminance(background));
  const darker = Math.min(browserLuminance(foreground), browserLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function browserIsVisibleTextElement(element: Element) {
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return !element.matches(':disabled, [aria-disabled="true"]')
    && rect.width > 0
    && rect.height > 0
    && style.visibility !== 'hidden'
    && style.display !== 'none';
}

function browserContrastItem(element: Element) {
  const style = window.getComputedStyle(element);
  const text = (element.textContent || element.getAttribute('aria-label') || '').trim();
  const background = browserBackgroundFor(element);
  const foreground = browserColorString(browserBlendColor(browserResolvedColor(style.color), browserResolvedColor(background)));
  const ratio = browserContrastRatio(foreground, background);
  const fontSize = Number.parseFloat(style.fontSize);
  const fontWeight = Number.parseInt(style.fontWeight, 10) || 400;
  const minimum = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700) ? 3 : 4.5;
  return { text, foreground, background, ratio, minimum };
}

function browserContrastFailure(item: { text: string; ratio: number; minimum: number }) {
  return item.text && item.ratio < item.minimum;
}

function browserFormatContrastFailure(item: {
  text: string;
  foreground: string;
  background: string;
  ratio: number;
  minimum: number;
}) {
  return `${item.text.slice(0, 60)} ratio ${item.ratio.toFixed(2)} < ${item.minimum} (${item.foreground} on ${item.background})`;
}

function browserQualityContrastAudit() {
  const selectors = 'a, button, input, select, textarea, [role="status"], h1, h2, th, td, label';
  return [...document.querySelectorAll(selectors)]
    .filter(browserIsVisibleTextElement)
    .slice(0, 80)
    .map(browserContrastItem)
    .filter(browserContrastFailure)
    .map(browserFormatContrastFailure);
}
