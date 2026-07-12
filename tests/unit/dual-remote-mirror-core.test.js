'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  EXIT,
  decideMirrorAction,
  selectEvidencePaths,
  buildMirrorPrBody,
  buildMirrorPrTitle,
  buildLastSyncRecord,
  parseCliArgs,
} = require('../../lib/task-platform/dual-remote-mirror-core');

describe('dual-remote-mirror-core decideMirrorAction', () => {
  it('no-ops when synced', () => {
    const d = decideMirrorAction({
      divergence: {
        synced: true,
        shaOnlyDivergence: true,
        primaryBehindBackup: false,
        backupBehindPrimary: false,
      },
    });
    assert.equal(d.action, 'noop_synced');
    assert.equal(d.exitCode, EXIT.SYNCED);
  });

  it('fails closed when primary is behind backup content', () => {
    const d = decideMirrorAction({
      divergence: {
        synced: false,
        primaryBehindBackup: true,
        backupBehindPrimary: false,
      },
    });
    assert.equal(d.action, 'fail_primary_behind');
    assert.equal(d.exitCode, EXIT.PRIMARY_BEHIND);
  });

  it('fails when both sides diverged in content', () => {
    const d = decideMirrorAction({
      divergence: {
        synced: false,
        primaryBehindBackup: true,
        backupBehindPrimary: true,
      },
    });
    assert.equal(d.action, 'fail_diverged');
    assert.equal(d.exitCode, EXIT.ERROR);
  });

  it('mirrors when backup is behind primary', () => {
    const d = decideMirrorAction({
      divergence: {
        synced: false,
        primaryBehindBackup: false,
        backupBehindPrimary: true,
      },
    });
    assert.equal(d.action, 'mirror_backup');
    assert.equal(d.exitCode, EXIT.BACKUP_BEHIND);
  });
});

describe('dual-remote-mirror-core PR body / evidence', () => {
  it('selects test and doc evidence from changed files', () => {
    const sel = selectEvidencePaths([
      'lib/task-platform/forge-claim-policy.js',
      'tests/unit/forge-claim-policy.test.js',
      'docs/runbooks/golden-path-autonomous-delivery.md',
    ]);
    assert.ok(sel.testEvidence.includes('tests/unit/forge-claim-policy.test.js'));
    assert.ok(sel.docEvidence.includes('docs/runbooks/golden-path-autonomous-delivery.md'));
  });

  it('falls back to dual-remote defaults when diff has no tests/docs', () => {
    const sel = selectEvidencePaths(['lib/task-platform/foo.js']);
    assert.deepEqual(sel.testEvidence, ['tests/unit/dual-remote-sync-status.test.js']);
    assert.ok(sel.docEvidence[0].includes('dual-remote'));
  });

  it('builds governance-complete PR body fields', () => {
    const body = buildMirrorPrBody({
      originSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      githubSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      changedFiles: [
        'tests/unit/dual-remote-sync-status.test.js',
        'docs/runbooks/dual-remote-gitlab-primary.md',
      ],
      originSubject: 'abc1234 tip',
    });
    assert.match(body, /^- Task:/m);
    assert.match(body, /^- Standards baseline reviewed:/m);
    assert.match(body, /^- Test evidence paths:/m);
    assert.match(body, /^- Doc evidence paths:/m);
    assert.match(body, /^- Risk level:/m);
    assert.match(body, /^- Rollback path:/m);
    assert.match(body, /dual-remote-sync-status\.test\.js/);
  });

  it('builds title with short sha', () => {
    assert.equal(
      buildMirrorPrTitle('deadbeefcafebabe'),
      'sync: mirror GitLab main (deadbeef)',
    );
  });
});

describe('dual-remote-mirror-core status + CLI', () => {
  it('builds last-sync record shape', () => {
    const rec = buildLastSyncRecord({
      action: 'noop_synced',
      exitCode: 0,
      reason: 'ok',
      report: {
        tips: {
          'origin/main': { sha: 'aaa', fullSha: 'aaa', tree: 't1' },
          'github/main': { sha: 'bbb', fullSha: 'bbb', tree: 't1' },
        },
        divergence: { synced: true, treesEqual: true, shaOnlyDivergence: true },
        policy: { primary: 'origin (GitLab)', issue: 270 },
      },
    });
    assert.equal(rec.kind, 'dual-remote-last-sync');
    assert.equal(rec.schemaVersion, 1);
    assert.equal(rec.divergence.synced, true);
    assert.ok(rec.recordedAt);
  });

  it('parses CLI flags', () => {
    const opts = parseCliArgs([
      '--dry-run',
      '--merge-when-ready',
      '--repo', 'acme/repo',
      '--mirror-branch', 'sync/x',
    ]);
    assert.equal(opts.dryRun, true);
    assert.equal(opts.mergeWhenReady, true);
    assert.equal(opts.emitMergeReadiness, true);
    assert.equal(opts.repo, 'acme/repo');
    assert.equal(opts.mirrorBranch, 'sync/x');
  });
});
