#!/usr/bin/env node
const {
  getChangedFiles,
  normalizePathList,
} = require('./governance-lib');
const { execFileSync } = require('child_process');
const fs = require('fs');

const eventPath = process.env.GITHUB_EVENT_PATH;

if (!eventPath) {
  process.stdout.write('pr body check skipped: GITHUB_EVENT_PATH not set\n');
  process.exit(0);
}

function readEvent(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function currentPullRequestBody(filePath) {
  if (process.env.PR_BODY_OVERRIDE) return process.env.PR_BODY_OVERRIDE;
  const event = readEvent(filePath);
  const eventBody = event.pull_request?.body || '';
  const number = event.pull_request?.number;
  const repo = process.env.GITHUB_REPOSITORY;
  if (number && repo && process.env.GITHUB_TOKEN) {
    try {
      return execFileSync('gh', ['api', `repos/${repo}/pulls/${number}`, '--jq', '.body'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      return eventBody;
    }
  }
  return eventBody;
}

const body = currentPullRequestBody(eventPath);
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
