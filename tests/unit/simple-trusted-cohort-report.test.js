'use strict';

const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildReportProvenance } = require('../../lib/task-platform/simple-trusted-cohort-report');
const {
  buildCohortMarkdown, parseTaskIds, selectedBar, STABLE_REPORT_PATH,
} = require('../../scripts/build-simple-trusted-cohort-report');

it('builds sorted per-input and aggregate provenance for the stable report', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cohort-report-'));
  fs.writeFileSync(path.join(root, 'a.json'), '{}\n');
  fs.writeFileSync(path.join(root, 'b.json'), '{"ok":true}\n');
  const cohort = {
    policy_version: 'simple-trusted-cohort.v2',
    rows: [{ closeoutPath: path.join(root, 'b.json'), factoryEvidencePath: path.join(root, 'a.json') }],
  };
  const provenance = buildReportProvenance(cohort, {
    root, revision: 'a'.repeat(40), generatedAt: '2026-08-19T19:00:00.000Z',
  });
  assert.deepEqual(provenance.inputs.map((input) => input.path), ['a.json', 'b.json']);
  assert.match(provenance.sourceSetSha256, /^[a-f0-9]{64}$/);
  assert.equal(STABLE_REPORT_PATH, 'docs/reports/SIMPLE_TRUSTED_COHORT_REPORT.md');
});

it('renders revision, source digest, and joint residual', () => {
  const cohort = {
    generatedAt: '2026-08-19T19:00:00.000Z', policy_version: 'simple-trusted-cohort.v2',
    provenance: { revision: 'a'.repeat(40), sourceSetSha256: 'b'.repeat(64), generator: 'generator.js', inputCount: 0, inputs: [] },
    bar: { minTrustedCloses: 10, minAutonomousRate: 0.8 },
    summary: { trustedCloses: 6, autonomous_delivery_rate: 0.6667, barMet: false, residual: { additionalTrustedClosesRequired: 6 } },
    trustedTaskIds: [], rows: [], metrics: { summary: {} },
  };
  const markdown = buildCohortMarkdown(cohort, 'cohort-report.json').join('\n');
  assert.match(markdown, /need 6 additional trusted Simple closes/);
  assert.match(markdown, new RegExp('a{40}'));
  assert.match(markdown, /Source-set SHA-256/);
  assert.match(markdown, /## Standards Alignment/);
  assert.match(markdown, /## Required Evidence/);
});

it('parses an explicit report cohort and threshold overrides', () => {
  assert.deepEqual(parseTaskIds('TSK-080, TSK-081'), ['TSK-080', 'TSK-081']);
  assert.deepEqual(selectedBar({
    COHORT_MIN_TRUSTED_CLOSES: '6', COHORT_MIN_AUTONOMOUS_RATE: '0.8',
  }), { minTrustedCloses: 6, minAutonomousRate: 0.8, taskClass: 'Simple' });
});
