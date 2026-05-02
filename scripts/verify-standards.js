#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const violations = [];
const STANDARDS_AREAS = [
  'architecture and design',
  'coding and code quality',
  'testing and quality assurance',
  'deployment and release',
  'observability and monitoring',
  'team and process',
];
const PLACEHOLDER_PATTERN = /^(tbd|todo|n\/a|none|unknown)$/i;

function read(filePath) {
  return fs.readFileSync(path.join(ROOT, filePath), 'utf8');
}

function exists(filePath) {
  return fs.existsSync(path.join(ROOT, filePath));
}

function requireFile(filePath) {
  if (!exists(filePath)) {
    violations.push(`missing required file: ${filePath}`);
  }
}

function requireIncludes(filePath, snippets) {
  if (!exists(filePath)) return;
  const content = read(filePath);
  for (const snippet of snippets) {
    if (!content.includes(snippet)) {
      violations.push(`${filePath} missing required content: ${snippet}`);
    }
  }
}

function getSection(content, heading) {
  const lines = content.split('\n');
  const target = `## ${heading}`;
  const start = lines.findIndex((line) => line.trim() === target);
  if (start === -1) return '';

  const collected = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith('## ')) break;
    collected.push(line);
  }

  return collected.join('\n').trim();
}

function getBulletValue(section, label) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = section.match(new RegExp(`^- ${escapedLabel}:\\s*(.+)$`, 'm'));
  return match ? match[1].trim() : '';
}

function getFirstBulletValue(section, labels) {
  for (const label of labels) {
    const value = getBulletValue(section, label);
    if (value) return value;
  }
  return '';
}

function validateNonPlaceholder(filePath, label, value) {
  if (!value) {
    violations.push(`${filePath} missing value for ${label}`);
    return;
  }
  if (PLACEHOLDER_PATTERN.test(value)) {
    violations.push(`${filePath} uses placeholder value for ${label}: ${value}`);
  }
}

function validateTaskFile(filePath) {
  const content = read(filePath);
  const standardsSection = getSection(content, 'Standards Alignment');
  const evidenceSection = getSection(content, 'Required Evidence');

  if (!standardsSection) {
    violations.push(`${filePath} missing section: Standards Alignment`);
    return;
  }
  if (!evidenceSection) {
    violations.push(`${filePath} missing section: Required Evidence`);
    return;
  }

  const areas = getBulletValue(standardsSection, 'Applicable standards areas');
  const expectedEvidence = getFirstBulletValue(standardsSection, [
    'Evidence expected for this change',
    'Evidence in this decision',
    'Evidence in this report',
  ]);
  const gapStatement = getBulletValue(standardsSection, 'Gap observed');
  const commands = getBulletValue(evidenceSection, 'Commands run');
  const tests = getBulletValue(evidenceSection, 'Tests added or updated');
  const rollout = getBulletValue(evidenceSection, 'Rollout or rollback notes');
  const docs = getBulletValue(evidenceSection, 'Docs updated');

  validateNonPlaceholder(filePath, 'Applicable standards areas', areas);
  validateNonPlaceholder(filePath, 'Evidence expected for this change', expectedEvidence);
  validateNonPlaceholder(filePath, 'Gap observed', gapStatement);
  validateNonPlaceholder(filePath, 'Commands run', commands);
  validateNonPlaceholder(filePath, 'Tests added or updated', tests);
  validateNonPlaceholder(filePath, 'Rollout or rollback notes', rollout);
  validateNonPlaceholder(filePath, 'Docs updated', docs);

  if (areas) {
    const normalized = areas.toLowerCase();
    const matchedAreas = STANDARDS_AREAS.filter((area) => normalized.includes(area));
    if (matchedAreas.length === 0) {
      violations.push(`${filePath} must reference at least one known standards area`);
    }
  }

  if (gapStatement && !gapStatement.includes('Documented rationale:')) {
    violations.push(`${filePath} gap statement must include "Documented rationale:"`);
  }

  if (gapStatement && !/source\s+https?:\/\//i.test(gapStatement)) {
    violations.push(`${filePath} gap statement must cite a source URL`);
  }
}

requireFile('docs/standards/software-development-standards.md');
requireFile('docs/standards/change-governance-maintenance.md');
requireFile('docs/templates/STANDARDS_COMPLIANCE_CHECKLIST.md');
requireFile('docs/templates/ADR_TEMPLATE.md');
requireFile('docs/templates/REPORT_TEMPLATE.md');
requireFile('.github/PULL_REQUEST_TEMPLATE.md');
requireFile('.github/BRANCH_PROTECTION.md');
requireFile('config/change-ownership-map.json');

requireIncludes('docs/standards/software-development-standards.md', [
  '## Repo Enforcement Policy',
  '## Required Gap Statement Format',
  'Every task file under `tasks/` must include `## Standards Alignment` and `## Required Evidence`.',
  'Every ADR under `docs/adr/` must include `## Standards Alignment` and `## Required Evidence`.',
  'Every report under `docs/reports/` must include `## Standards Alignment` and `## Required Evidence`.',
  'Authored source files warn at `300` lines and hard fail at `400` lines',
  'test files warn at `400` lines and hard fail at `500` lines',
  'functions or methods warn at `40` lines and hard fail at `50` lines',
  'Legacy maintainability violations must be tracked in `config/maintainability-baseline.json`',
  'config/change-ownership-map.json',
  'docs/standards/change-governance-maintenance.md',
  '.github/BRANCH_PROTECTION.md',
]);

requireIncludes('docs/templates/STANDARDS_COMPLIANCE_CHECKLIST.md', [
  '## Architecture and Design',
  '## Coding and Code Quality',
  '## Testing and Quality Assurance',
  '## Deployment and Release',
  '## Observability and Monitoring',
  '## Team and Process',
  '## Required Evidence',
]);

requireIncludes('docs/templates/ADR_TEMPLATE.md', [
  '## Standards Alignment',
  '## Required Evidence',
]);

requireIncludes('docs/templates/REPORT_TEMPLATE.md', [
  '## Standards Alignment',
  '## Required Evidence',
]);

requireIncludes('.github/PULL_REQUEST_TEMPLATE.md', [
  '## Standards Compliance',
  '## Required Evidence',
  '`npm run standards:check`',
  'Compliance checklist path:',
  'Standards gaps or exceptions:',
  'Test evidence paths:',
  'Doc evidence paths:',
  'Docs updated:',
]);

requireIncludes('.github/BRANCH_PROTECTION.md', [
  '## Required Status Checks',
  '`Pull request metadata`',
  '`Repo validation`',
  '`Browser validation`',
  '.github/workflows/validation.yml',
]);

const tasksDir = path.join(ROOT, 'tasks');
if (fs.existsSync(tasksDir)) {
  for (const entry of fs.readdirSync(tasksDir)) {
    if (!entry.endsWith('.md')) continue;
    validateTaskFile(path.join('tasks', entry));
  }
}

for (const dir of ['docs/adr', 'docs/reports']) {
  const absoluteDir = path.join(ROOT, dir);
  if (!fs.existsSync(absoluteDir)) continue;
  for (const entry of fs.readdirSync(absoluteDir)) {
    if (!entry.endsWith('.md')) continue;
    validateTaskFile(path.join(dir, entry));
  }
}

requireIncludes('agents/README.md', [
  '## Standards Enforcement',
  '`docs/standards/software-development-standards.md`',
]);

if (violations.length) {
  process.stderr.write(`${violations.join('\n')}\n`);
  process.exit(1);
}

process.stdout.write('standards checks passed\n');
