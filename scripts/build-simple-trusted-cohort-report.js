#!/usr/bin/env node
'use strict';

/**
 * GitLab #276 — Build Simple operator-trusted cohort report + metrics MVP snapshot.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  buildSimpleTrustedCohortFromRepo,
  DEFAULT_BAR,
} = require('../lib/task-platform/simple-trusted-cohort');
const { buildReportProvenance } = require('../lib/task-platform/simple-trusted-cohort-report');

const STABLE_REPORT_PATH = 'docs/reports/SIMPLE_TRUSTED_COHORT_REPORT.md';

function revisionFor(root) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}

function writeJsonAtomic(filePath, value) {
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, filePath);
}

function cohortRow(row) {
  const reasons = Array.isArray(row.trustedReason)
    ? row.trustedReason.join(', ')
    : (row.trusted ? '—' : String(row.trustedReason || ''));
  return `| ${row.taskId} | ${row.closed} | ${row.liveSessionCount} | ${row.interventionCount} | ${row.trusted} | ${reasons || '—'} |`;
}

function parseTaskIds(value) {
  return String(value || '').split(',').map((taskId) => taskId.trim()).filter(Boolean);
}

function selectedBar(env = process.env) {
  const minTrustedCloses = Number.parseInt(env.COHORT_MIN_TRUSTED_CLOSES || '', 10);
  const minAutonomousRate = Number.parseFloat(env.COHORT_MIN_AUTONOMOUS_RATE || '');
  return {
    ...DEFAULT_BAR,
    ...(Number.isFinite(minTrustedCloses) && minTrustedCloses > 0 ? { minTrustedCloses } : {}),
    ...(Number.isFinite(minAutonomousRate) && minAutonomousRate > 0
      ? { minAutonomousRate } : {}),
  };
}

function buildCohortMarkdown(cohort, jsonRelativePath) {
  return [
    '# Simple Operator-Trusted Cohort Report', '',
    `**Generated:** ${cohort.generatedAt}`, `**Policy:** ${cohort.policy_version}`,
    `**Cohort:** ${cohort.selection?.cohortId || cohort.selection?.mode || 'all discovered evidence'}`,
    `**Revision:** \`${cohort.provenance.revision}\``,
    `**Source set:** \`${cohort.provenance.sourceSetSha256}\``,
    '**Issue:** GitLab #276 / factory autonomy Q1 bar', '', '## Bar', '',
    '| Metric | Target | Actual |', '| --- | --- | --- |',
    `| Trusted Simple closes | ≥ ${cohort.bar.minTrustedCloses} | **${cohort.summary.trustedCloses}** |`,
    `| Autonomous delivery rate (trusted / closed) | ≥ ${cohort.bar.minAutonomousRate} | **${cohort.summary.autonomous_delivery_rate}** |`,
    `| Bar met | true | **${cohort.summary.barMet}** |`, '',
    '## Definition of trusted close', '',
    '- Factory delivery / closeout at `phase6_complete`',
    '- Zero recorded manual interventions on closeout',
    '- At least one live OpenClaw `specialist-delegation-*` session id in factory evidence (not fixture)',
    '- Task class treated as Simple / low-risk cohort', '', '## Trusted tasks', '',
    ...(cohort.trustedTaskIds.length ? cohort.trustedTaskIds.map((id) => `- \`${id}\``) : ['- _(none)_']),
    '', '## All evaluated rows', '',
    '| Task | Closed | Live sessions | Interventions | Trusted | Reasons if not |',
    '| --- | --- | --- | --- | --- | --- |', ...cohort.rows.map(cohortRow), '',
    '## Metrics MVP (aggregate of trusted signals)', '', '```json',
    JSON.stringify(cohort.metrics.summary || cohort.metrics, null, 2), '```', '',
    '## Artifacts', '', `- JSON: \`${jsonRelativePath}\``, '', '## Residual', '',
    cohort.summary.barMet
      ? '- Q1 near-term bar is met for this evidence snapshot.'
      : `- Bar not met: need ${cohort.summary.residual.additionalTrustedClosesRequired} additional trusted Simple closes to satisfy both count and rate, assuming every added close is trusted.`,
    '', '## Standards Alignment', '',
    '- Applicable standards areas: architecture and design; coding and code quality; testing and quality assurance; deployment and release; observability and monitoring; team and process.',
    '- Evidence expected for this change: immutable closeout, factory-delivery, hosted PR, human-review, and live OpenClaw evidence.',
    '- Gap observed: legacy evidence discovery and projection ordering could omit valid provenance. Documented rationale: select an explicit clean cohort and reconcile only from authoritative task history (source https://github.com/wiinc1/engineering-team).',
    '', '## Required Evidence', '',
    '- Commands run: `npm run cohort:reconcile-closeouts`; `npm run cohort:simple-trusted`; `make verify`.',
    '- Tests added or updated: cohort selection, factory-cohort discovery, report environment parsing, and governed report sections.',
    '- Rollout or rollback notes: deploy the exact merged revision to staging; roll back by reverting the reporting commit without modifying source evidence.',
    '- Docs updated: this generated cohort report and its SHA-256-addressed JSON snapshot.',
    '', '## Provenance', '',
    `- Generator: \`${cohort.provenance.generator}\``,
    `- Inputs: ${cohort.provenance.inputCount}`,
    `- Source-set SHA-256: \`${cohort.provenance.sourceSetSha256}\``,
    '', '| Input | SHA-256 | Bytes |', '| --- | --- | --- |',
    ...cohort.provenance.inputs.map((input) => `| \`${input.path}\` | \`${input.sha256}\` | ${input.bytes} |`),
    '',
  ];
}

function main(options = {}) {
  const root = options.root || process.cwd();
  const generatedAt = options.generatedAt || process.env.COHORT_REPORT_GENERATED_AT || new Date().toISOString();
  const taskIds = options.taskIds || parseTaskIds(process.env.COHORT_TASK_IDS);
  const cohort = buildSimpleTrustedCohortFromRepo(root, {
    bar: options.bar || selectedBar(),
    taskIds,
    cohortId: options.cohortId || process.env.COHORT_ID || null,
  });
  cohort.generatedAt = generatedAt;
  cohort.provenance = buildReportProvenance(cohort, {
    root, generatedAt, revision: options.revision || revisionFor(root),
  });
  const outDir = path.join(root, 'observability', 'trusted-simple-close');
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, 'cohort-report.json');
  writeJsonAtomic(jsonPath, cohort);

  const mdPath = path.join(root, STABLE_REPORT_PATH);
  const lines = buildCohortMarkdown(cohort, path.relative(root, jsonPath));
  fs.writeFileSync(mdPath, `${lines.join('\n')}\n`);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    barMet: cohort.summary.barMet,
    trustedCloses: cohort.summary.trustedCloses,
    rate: cohort.summary.autonomous_delivery_rate,
    jsonPath,
    mdPath,
  }, null, 2)}\n`);
  if (options.setExitCode !== false) process.exitCode = cohort.summary.barMet ? 0 : 2;
  return { cohort, jsonPath, mdPath };
}

if (require.main === module) main();

module.exports = {
  STABLE_REPORT_PATH,
  buildCohortMarkdown,
  main,
  parseTaskIds,
  revisionFor,
  selectedBar,
  writeJsonAtomic,
};
