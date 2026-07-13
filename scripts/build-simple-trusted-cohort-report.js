#!/usr/bin/env node
'use strict';

/**
 * GitLab #276 — Build Simple operator-trusted cohort report + metrics MVP snapshot.
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  buildSimpleTrustedCohortFromRepo,
  DEFAULT_BAR,
} = require('../lib/task-platform/simple-trusted-cohort');

function main() {
  const root = process.cwd();
  const cohort = buildSimpleTrustedCohortFromRepo(root, { bar: DEFAULT_BAR });
  const outDir = path.join(root, 'observability', 'trusted-simple-close');
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, 'cohort-report.json');
  fs.writeFileSync(jsonPath, `${JSON.stringify(cohort, null, 2)}\n`);

  const mdPath = path.join(root, 'docs', 'reports', 'SIMPLE_TRUSTED_COHORT_REPORT_2026-07-13.md');
  const lines = [
    '# Simple Operator-Trusted Cohort Report',
    '',
    `**Generated:** ${cohort.generatedAt}`,
    `**Policy:** ${cohort.policy_version}`,
    `**Issue:** GitLab #276 / factory autonomy Q1 bar`,
    '',
    '## Bar',
    '',
    `| Metric | Target | Actual |`,
    `| --- | --- | --- |`,
    `| Trusted Simple closes | ≥ ${cohort.bar.minTrustedCloses} | **${cohort.summary.trustedCloses}** |`,
    `| Autonomous delivery rate (trusted / closed) | ≥ ${cohort.bar.minAutonomousRate} | **${cohort.summary.autonomous_delivery_rate}** |`,
    `| Bar met | true | **${cohort.summary.barMet}** |`,
    '',
    '## Definition of trusted close',
    '',
    '- Factory delivery / closeout at `phase6_complete`',
    '- Zero recorded manual interventions on closeout',
    '- At least one live OpenClaw `specialist-delegation-*` session id in factory evidence (not fixture)',
    '- Task class treated as Simple / low-risk cohort',
    '',
    '## Trusted tasks',
    '',
    ...(cohort.trustedTaskIds.length
      ? cohort.trustedTaskIds.map((id) => `- \`${id}\``)
      : ['- _(none)_']),
    '',
    '## All evaluated rows',
    '',
    '| Task | Closed | Live sessions | Interventions | Trusted | Reasons if not |',
    '| --- | --- | --- | --- | --- | --- |',
    ...cohort.rows.map((row) => {
      const reasons = Array.isArray(row.trustedReason) ? row.trustedReason.join(', ') : (row.trusted ? '—' : String(row.trustedReason || ''));
      return `| ${row.taskId} | ${row.closed} | ${row.liveSessionCount} | ${row.interventionCount} | ${row.trusted} | ${reasons || '—'} |`;
    }),
    '',
    '## Metrics MVP (aggregate of trusted signals)',
    '',
    '```json',
    JSON.stringify(cohort.metrics.summary || cohort.metrics, null, 2),
    '```',
    '',
    '## Artifacts',
    '',
    `- JSON: \`${path.relative(root, jsonPath)}\``,
    '',
    '## Residual',
    '',
    cohort.summary.barMet
      ? '- Q1 near-term bar is met for this evidence snapshot.'
      : `- Bar not met: need ${Math.max(0, cohort.bar.minTrustedCloses - cohort.summary.trustedCloses)} more trusted Simple closes with live session evidence.`,
    '',
  ];
  fs.writeFileSync(mdPath, `${lines.join('\n')}\n`);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    barMet: cohort.summary.barMet,
    trustedCloses: cohort.summary.trustedCloses,
    rate: cohort.summary.autonomous_delivery_rate,
    jsonPath,
    mdPath,
  }, null, 2)}\n`);
  process.exit(cohort.summary.barMet ? 0 : 2);
}

main();
