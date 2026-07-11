const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  isTrustedSimpleCloseRequired,
  assertTrustedSimpleCloseEvidence,
  buildTrustedSimpleCloseEvidence,
  writeTrustedSimpleCloseEvidence,
  applyTrustedSimpleCloseOptions,
} = require('../../lib/task-platform/trusted-simple-close-evidence');
const {
  resolveImplementerArtifacts,
  isTrustedDeliveryMode,
  buildImplementerPrompt,
} = require('../../lib/task-platform/factory-agent-phases');
const { assertRealPhase6AutoMerge } = require('../../lib/task-platform/golden-path-phase6-auto-merge-proof');
const { evidenceModeOptions } = require('../../lib/task-platform/factory-phase-runner-options');

// Real SHAs (non-fixture pattern) used only as known-good shapes for fail/pass matrix.
const REAL_IMPL_SHA = 'e9c769fe45eef8e1498ff018c1c939109e8047bd';
const REAL_MERGE_SHA = '6f8ebd8ad9d48b27480dcc06845e8fc9a24f31f1';
const REAL_PR_URL = 'https://github.com/wiinc1/engineering-team/pull/301';

describe('trusted Simple close (#274)', () => {
  it('distinguishes session-proof vs trusted delivery modes', () => {
    assert.equal(isTrustedDeliveryMode({}), false);
    assert.equal(isTrustedDeliveryMode({ sessionProofOnly: true, requireRealEvidence: true }), false);
    assert.equal(isTrustedDeliveryMode({ requireRealEvidence: true }), true);
    assert.equal(isTrustedDeliveryMode({ trustedDelivery: true }), true);
    assert.equal(isTrustedSimpleCloseRequired({ trustedDelivery: true, templateTier: 'Simple' }), true);
    assert.match(buildImplementerPrompt({ taskId: 'T1', requireRealEvidence: true }), /TRUSTED DELIVERY/);
    assert.match(buildImplementerPrompt({ taskId: 'T1' }), /SESSION PROOF ONLY/);
  });

  it('rejects synthetic implementer artifacts under trusted mode', () => {
    assert.throws(
      () => resolveImplementerArtifacts(
        { message: '{"branchName":"x","commitSha":"deadbeef","prUrl":"https://example.com"}' },
        { requireRealEvidence: true },
      ),
      /real/,
    );
    assert.throws(
      () => resolveImplementerArtifacts(
        {
          message: JSON.stringify({
            branchName: 'feat/x',
            commitSha: '0123456789abcdef0123456789abcdef01234567',
            prUrl: 'https://github.com/wiinc1/engineering-team/pull/271',
          }),
        },
        { trustedDelivery: true },
      ),
      /real|non-fixture|non-default/,
    );
  });

  it('accepts real implementer artifacts under trusted mode', () => {
    const artifacts = resolveImplementerArtifacts(
      {
        message: JSON.stringify({
          branchName: 'feat/issue-274-trusted-simple-pr-merge',
          commitSha: REAL_IMPL_SHA,
          prUrl: REAL_PR_URL,
        }),
      },
      { requireRealEvidence: true },
    );
    assert.equal(artifacts.trustedDelivery, true);
    assert.equal(artifacts.prUrl, REAL_PR_URL);
    assert.equal(artifacts.commitSha, REAL_IMPL_SHA);
  });

  it('rejects simulated or incomplete GP-022 auto-merge for trusted close', () => {
    assert.throws(
      () => assertRealPhase6AutoMerge({ simulated: true, reason: 'missing_github_token' }),
      /cannot be simulated/,
    );
    assert.throws(
      () => assertRealPhase6AutoMerge({
        simulated: false,
        skipped: false,
        merged: true,
        mergeCommitSha: REAL_MERGE_SHA,
        mergedAt: '2026-07-11T00:00:00.000Z',
        reason: 'missing_github_token',
      }),
      /not eligible/,
    );
    assert.throws(
      () => assertRealPhase6AutoMerge({
        merged: true,
        mergeCommitSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        mergedAt: '2026-07-11T00:00:00.000Z',
      }),
      /non-fixture/,
    );
  });

  it('builds and validates trusted Simple evidence package with PR URL + merge SHA', () => {
    const evidence = buildTrustedSimpleCloseEvidence({
      templateTier: 'Simple',
      branchName: 'sync/github-mirror-gitlab',
      commitSha: REAL_IMPL_SHA,
      prUrl: REAL_PR_URL,
      prNumber: 301,
      mergeCommitSha: REAL_MERGE_SHA,
      mergedAt: '2026-07-11T03:30:00.000Z',
      notes: 'Built from real GitHub PR #301 merge evidence for #274 unit audit.',
    });
    assert.equal(evidence.schemaVersion, 'trusted-simple-close-evidence.v1');
    assert.equal(evidence.prUrl, REAL_PR_URL);
    assert.equal(evidence.mergeCommitSha, REAL_MERGE_SHA);
    assert.equal(evidence.merged, true);
    assert.equal(assertTrustedSimpleCloseEvidence(evidence).ok, true);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trusted-simple-'));
    const out = path.join(dir, 'close.json');
    const written = writeTrustedSimpleCloseEvidence(out, evidence);
    assert.equal(fs.existsSync(written.path), true);
    const loaded = JSON.parse(fs.readFileSync(written.path, 'utf8'));
    assert.equal(loaded.mergeCommitSha, REAL_MERGE_SHA);
  });

  it('rejects synthetic package fields for trusted Simple close', () => {
    assert.throws(
      () => buildTrustedSimpleCloseEvidence({
        branchName: 'x',
        commitSha: '0123456789abcdef0123456789abcdef01234567',
        prUrl: 'https://github.com/wiinc1/engineering-team/pull/271',
        mergeCommitSha: '0123456789abcdef0123456789abcdef01234567',
        mergedAt: '2026-07-11T00:00:00.000Z',
      }),
      /Trusted Simple close evidence invalid/,
    );
  });

  it('factory phase options force requireRealEvidence for trusted Simple close', () => {
    const opts = evidenceModeOptions(
      { trustedDelivery: true, templateTier: 'Simple' },
      { id: 'item-1', templateTier: 'Simple' },
    );
    assert.equal(opts.requireRealEvidence, true);
    assert.equal(opts.trustedSimpleClose, true);
    assert.equal(opts.trustedDelivery, true);

    const applied = applyTrustedSimpleCloseOptions({ templateTier: 'Simple', trustedDelivery: true });
    assert.equal(applied.requireRealEvidence, true);
    assert.equal(applied.sessionProofOnly, false);
  });
});
