'use strict';

const { it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildSimpleTrustedCohortFromRepo } = require('../../lib/task-platform/simple-trusted-cohort');
const { buildTrustedSimpleCloseEvidence } = require('../../lib/task-platform/trusted-simple-close-evidence');
const { buildReportProvenance } = require('../../lib/task-platform/simple-trusted-cohort-report');

function writeProspectiveCohort(root, expectedDigest) {
  const closeoutDir = path.join(root, 'observability', 'factory-closeout');
  fs.mkdirSync(closeoutDir, { recursive: true });
  fs.writeFileSync(path.join(closeoutDir, 'TSK-319.json'), JSON.stringify({
    taskId: 'TSK-319', deliveryStatus: 'phase6_complete',
    generatedAt: '2026-08-19T18:00:00.000Z', manualInterventions: [],
    trustedSimpleCloseEvidence: {
      path: 'observability/trusted-simple-close/TSK-319.json', sha256: expectedDigest,
    },
    humanReviewProvenance: {
      eventId: 'review-319', eventType: 'task.pm_architect_human_review_recorded',
      roles: {
        pm: { actorId: 'operator-1', actorType: 'human', reviewedAt: '2026-08-19T17:58:00.000Z', eventId: 'review-319' },
        architect: { actorId: 'operator-1', actorType: 'human', reviewedAt: '2026-08-19T17:58:00.000Z', eventId: 'review-319' },
      },
    },
    approvalProvenance: {
      eventId: 'approval-319', eventType: 'task.execution_contract_approved',
      approvedAt: '2026-08-19T17:59:00.000Z', approvalMode: 'policy',
    },
  }));
  fs.writeFileSync(path.join(root, 'observability', 'factory-milestone-c-319.json'), JSON.stringify({
    taskId: 'TSK-319', status: 'phase6_complete',
    session: 'specialist-delegation-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeee19',
  }));
  return closeoutDir;
}

it('joins immutable task-bound PR evidence and rejects a changed package', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cohort-v2-contract-'));
  const evidenceDir = path.join(root, 'observability', 'trusted-simple-close');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const evidencePath = path.join(evidenceDir, 'TSK-319.json');
  const evidence = {
    ...buildTrustedSimpleCloseEvidence({
    taskId: 'TSK-319', repository: 'wiinc1/engineering-team',
    branchName: 'agent/simple-cohort-v2-pr-evidence',
    commitSha: 'e9c769fe45eef8e1498ff018c1c939109e8047bd',
    prUrl: 'https://github.com/wiinc1/engineering-team/pull/301',
    mergeCommitSha: '6f8ebd8ad9d48b27480dcc06845e8fc9a24f31f1',
    mergedAt: '2026-08-19T17:00:00.000Z', changedFiles: ['README.md'],
      includeGithubCheckProof: true, requiredChecks: ['unit tests', 'Merge readiness'],
    }),
    taskId: 'TSK-319',
  };
  const body = `${JSON.stringify(evidence, null, 2)}\n`;
  fs.writeFileSync(evidencePath, body);
  const digest = crypto.createHash('sha256').update(body).digest('hex');
  const closeoutDir = writeProspectiveCohort(root, digest);

  let cohort = buildSimpleTrustedCohortFromRepo(root, { closeoutDir });
  assert.equal(cohort.rows[0].trusted, true);
  assert.equal(cohort.summary.residual.additionalTrustedClosesRequired, 9);
  const provenance = buildReportProvenance(cohort, {
    root, revision: 'a'.repeat(40), generatedAt: '2026-08-19T19:00:00.000Z',
  });
  assert.equal(provenance.inputCount, 3);
  assert.match(provenance.sourceSetSha256, /^[a-f0-9]{64}$/);
  fs.appendFileSync(evidencePath, ' ');
  cohort = buildSimpleTrustedCohortFromRepo(root, { closeoutDir });
  assert.equal(cohort.rows[0].trusted, false);
  assert.equal(cohort.summary.residual.additionalTrustedClosesRequired, 10);
  assert.ok(cohort.rows[0].trustedReason.includes('trusted_close_evidence_digest_mismatch'));
});
