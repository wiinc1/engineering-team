const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const TOKEN_PATH = path.join(ROOT, 'src/app/design-tokens.css');
const MIN_NORMAL_TEXT_CONTRAST = 4.5;

function readTokenColors() {
  const css = fs.readFileSync(TOKEN_PATH, 'utf8');
  const tokens = new Map();
  const pattern = /--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g;
  for (const match of css.matchAll(pattern)) {
    tokens.set(match[1], match[2]);
  }
  return tokens;
}

function relativeLuminance(hex) {
  const normalized = hex.replace('#', '');
  const [red, green, blue] = [0, 2, 4].map((offset) => parseInt(normalized.slice(offset, offset + 2), 16) / 255);
  const [r, g, b] = [red, green, blue].map((channel) => (
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(foreground, background) {
  const foregroundLum = relativeLuminance(foreground);
  const backgroundLum = relativeLuminance(background);
  const lighter = Math.max(foregroundLum, backgroundLum);
  const darker = Math.min(foregroundLum, backgroundLum);
  return (lighter + 0.05) / (darker + 0.05);
}

test('semantic DESIGN.md token text/background pairs meet WCAG AA contrast', () => {
  const tokens = readTokenColors();
  const pairs = [
    ['color-on-surface', 'color-surface'],
    ['color-on-heading', 'color-page-bg'],
    ['color-on-muted', 'color-surface'],
    ['color-on-muted-strong', 'color-surface-muted'],
    ['color-primary', 'color-surface'],
    ['color-surface', 'color-primary'],
    ['color-primary-strong', 'color-primary-soft'],
    ['color-success-text', 'color-success-soft'],
    ['color-warning-text', 'color-warning-soft'],
    ['color-danger-text', 'color-danger-soft'],
    ['color-info', 'color-info-soft'],
    ['color-review', 'color-review-soft'],
    ['color-surface', 'color-success'],
    ['color-surface', 'color-warning'],
    ['color-surface', 'color-danger'],
  ];

  for (const [foregroundToken, backgroundToken] of pairs) {
    const foreground = tokens.get(foregroundToken);
    const background = tokens.get(backgroundToken);
    assert.ok(foreground, `missing ${foregroundToken}`);
    assert.ok(background, `missing ${backgroundToken}`);
    assert.ok(
      contrastRatio(foreground, background) >= MIN_NORMAL_TEXT_CONTRAST,
      `${foregroundToken} on ${backgroundToken} must meet WCAG AA contrast`,
    );
  }
});
