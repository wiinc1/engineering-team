#!/usr/bin/env node
const {
  getChangedFiles,
  getPullRequestShas,
  normalizePathList,
} = require('./governance-lib');

const eventPath = process.env.GITHUB_EVENT_PATH;

if (!eventPath) {
  process.stdout.write('pr body check skipped: GITHUB_EVENT_PATH not set\n');
  process.exit(0);
}

const { body } = getPullRequestShas(eventPath);
const changedFiles = getChangedFiles();
const violations = [];
const PLACEHOLDER_PATTERN = /^(tbd|todo|n\/a|none|unknown)$/i;

function valueFor(label) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = body.match(new RegExp(`^- ${escapedLabel}:\\s*(.+)$`, 'mi'));
  return match ? match[1].trim() : '';
}

function requireFilled(label, options = {}) {
  const value = valueFor(label);
  if (!value) {
    violations.push(`missing PR field: ${label}`);
    return '';
  }
  if (PLACEHOLDER_PATTERN.test(value)) {
    violations.push(`placeholder PR field for ${label}: ${value}`);
    return '';
  }
  if (options.disallow === value.toLowerCase()) {
    violations.push(`invalid PR field for ${label}: ${value}`);
  }
  return value;
}

function requireChangedPaths(label) {
  const value = requireFilled(label);
  if (!value) return;
  const paths = normalizePathList(value);
  if (paths.length === 0) {
    violations.push(`missing changed file paths in PR field: ${label}`);
    return;
  }
  for (const filePath of paths) {
    if (!changedFiles.includes(filePath)) {
      violations.push(`PR field ${label} references file not changed in diff: ${filePath}`);
    }
  }
}

requireFilled('Task');
requireFilled('Standards baseline reviewed', { disallow: 'no' });
requireFilled('Checklist completed or updated', { disallow: 'no' });
requireFilled('Compliance checklist path');
requireFilled('Relevant standards areas');
requireFilled('Standards gaps or exceptions');
requireFilled('Standards check result');
requireFilled('Lint result');
requireFilled('Tests');
requireChangedPaths('Test evidence paths');
requireFilled('Docs updated');
requireChangedPaths('Doc evidence paths');
requireFilled('Risk level');
requireFilled('Rollback path');

if (violations.length > 0) {
  process.stderr.write(`${violations.join('\n')}\n`);
  process.exit(1);
}

process.stdout.write('pr body checks passed\n');
