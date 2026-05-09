#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const CONFIG_PATH = 'docs/design/design-md-adoption.config.json';
const DEFAULT_AUDIT_PATH = 'docs/design/DESIGN_MD_ADOPTION_AUDIT.md';
const STATUS_LABELS = {
  implemented: 'Implemented',
  implemented_smoke: 'Implemented Smoke',
  not_applicable: 'N/A',
  needs_work: 'Needs Work',
  backlog: 'Backlog',
  pass: 'Pass',
  fail: 'Fail',
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function escapeTableCell(value) {
  return String(value ?? '')
    .replace(/\r?\n/g, '<br>')
    .replace(/\|/g, '\\|');
}

function sentence(value) {
  return String(value ?? '').trim();
}

function titleizeKey(key) {
  return key
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function statusLabel(value) {
  return STATUS_LABELS[value] || String(value ?? '').replace(/_/g, ' ');
}

function yesNo(value) {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (String(value).toLowerCase() === 'yes') return 'Yes';
  if (String(value).toLowerCase() === 'no') return 'No';
  return String(value ?? 'N/A');
}

function validateOptionalAreas(optionalAreas) {
  const failures = [];
  if (!optionalAreas || typeof optionalAreas !== 'object' || Array.isArray(optionalAreas)) {
    return ['optional_areas must be an object with status and reason entries'];
  }

  for (const [area, entry] of Object.entries(optionalAreas)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      failures.push(`optional_areas.${area} must include status and reason`);
      continue;
    }
    if (!sentence(entry.status)) {
      failures.push(`optional_areas.${area}.status is required`);
    }
    if (!sentence(entry.reason)) {
      failures.push(`optional_areas.${area}.reason is required`);
    }
  }

  return failures;
}

function validateConfig(config) {
  const failures = validateOptionalAreas(config.optional_areas);
  for (const [index, entry] of (config.component_coverage || []).entries()) {
    if (!sentence(entry.area)) failures.push(`component_coverage[${index}].area is required`);
    if (!sentence(entry.uses_design_tokens)) failures.push(`component_coverage[${index}].uses_design_tokens is required`);
    if (typeof entry.enforcement_covered !== 'boolean') {
      failures.push(`component_coverage[${index}].enforcement_covered must be true or false`);
    }
    if (!sentence(entry.notes)) failures.push(`component_coverage[${index}].notes is required`);
  }
  return failures;
}

function componentRows(config) {
  return (config.component_coverage || []).map((entry) => (
    `| ${escapeTableCell(entry.area)} | ${escapeTableCell(yesNo(entry.uses_design_tokens))} | ${escapeTableCell(yesNo(entry.enforcement_covered))} | ${escapeTableCell(entry.notes)} |`
  ));
}

function optionalAreaRows(config) {
  return Object.entries(config.optional_areas || {}).map(([area, entry]) => (
    `| ${escapeTableCell(titleizeKey(area))} | ${escapeTableCell(statusLabel(entry.status))} | ${escapeTableCell(entry.reason)} |`
  ));
}

function acceptanceRows(config) {
  return (config.acceptance_criteria || []).map((entry) => (
    `| ${escapeTableCell(entry.criterion)} | ${escapeTableCell(statusLabel(entry.status))} | ${escapeTableCell(entry.evidence)} |`
  ));
}

function generateAuditMarkdown(config) {
  const auditPath = config.audit_document || DEFAULT_AUDIT_PATH;
  const lines = [
    '# DESIGN.md Adoption Audit',
    '',
    `Generated from: \`${CONFIG_PATH}\``,
  ];

  if (config.audit?.date) {
    lines.push(`Date: ${config.audit.date}`);
  }

  lines.push(
    '',
    '## Summary',
    '',
    sentence(config.audit?.summary) || '`DESIGN.md` is the authoritative visual design source of truth for this repo.',
    '',
    `Machine-readable audit config: \`${CONFIG_PATH}\``,
    `Generated audit document: \`${auditPath}\``,
    '',
    '## Component Coverage',
    '',
    '| Component / Area | Uses DESIGN.md Tokens? | Enforcement Covered? | Notes |',
    '| --- | --- | --- | --- |',
    ...componentRows(config),
    '',
    '## Optional DESIGN.md Area Audit',
    '',
    '| Area | Status | Reason |',
    '| --- | --- | --- |',
    ...optionalAreaRows(config),
    '',
    '## Acceptance Criteria Status',
    '',
    '| Criterion | Status | Evidence |',
    '| --- | --- | --- |',
    ...acceptanceRows(config),
    '',
    '## Follow-Up Backlog',
    '',
  );

  for (const item of config.follow_up_backlog || []) {
    lines.push(`- ${item}`);
  }

  lines.push('');
  return `${lines.join('\n')}`;
}

function main() {
  const checkMode = process.argv.includes('--check');
  const config = readJson(CONFIG_PATH);
  const failures = validateConfig(config);
  if (failures.length > 0) {
    process.stderr.write(`Design adoption audit config is invalid:\n${failures.map((failure) => `- ${failure}`).join('\n')}\n`);
    process.exit(1);
  }

  const auditPath = config.audit_document || DEFAULT_AUDIT_PATH;
  const generated = generateAuditMarkdown(config);
  const existing = fs.existsSync(auditPath) ? fs.readFileSync(auditPath, 'utf8') : '';

  if (checkMode) {
    if (existing !== generated) {
      process.stderr.write(`Design adoption audit is stale. Run node scripts/generate-design-adoption-audit.mjs to update ${auditPath}.\n`);
      process.exit(1);
    }
    process.stdout.write(`design adoption audit is up to date: ${auditPath}\n`);
    return;
  }

  fs.mkdirSync(path.dirname(auditPath), { recursive: true });
  fs.writeFileSync(auditPath, generated);
  process.stdout.write(`design adoption audit generated: ${auditPath}\n`);
}

main();
