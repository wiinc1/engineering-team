const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateDualRemoteSync,
  parseLeftRightCount,
  remediationFor,
} = require('../../scripts/dual-remote-sync-status');

describe('dual-remote-sync-status (#270)', () => {
  it('parses left-right rev-list counts', () => {
    assert.deepEqual(parseLeftRightCount('8\t1'), { onlyOrigin: 8, onlyGithub: 1 });
    assert.deepEqual(parseLeftRightCount('0\t0'), { onlyOrigin: 0, onlyGithub: 0 });
  });

  it('marks synced when both commit sets are empty', () => {
    const d = evaluateDualRemoteSync({
      onlyOrigin: 0,
      onlyGithub: 0,
      originTree: 'aaa',
      githubTree: 'aaa',
    });
    assert.equal(d.synced, true);
    assert.equal(d.commitSynced, true);
    assert.equal(d.shaOnlyDivergence, false);
    assert.equal(d.primaryBehindBackup, false);
    assert.equal(d.backupBehindPrimary, false);
  });

  it('marks synced under #270 AC1 when trees match despite unique merge commits', () => {
    const d = evaluateDualRemoteSync({
      onlyOrigin: 2,
      onlyGithub: 1,
      originTree: 'tree-same',
      githubTree: 'tree-same',
    });
    assert.equal(d.treesEqual, true);
    assert.equal(d.shaOnlyDivergence, true);
    assert.equal(d.synced, true);
    assert.equal(d.primaryBehindBackup, false);
    assert.equal(d.backupBehindPrimary, false);
    const rem = remediationFor(d);
    assert.ok(rem.some((line) => /#270 AC1|content-synced/i.test(line)));
  });

  it('fails #270 bar when unique commits exist and tip trees differ', () => {
    const d = evaluateDualRemoteSync({
      onlyOrigin: 8,
      onlyGithub: 1,
      originTree: 'tree-a',
      githubTree: 'tree-b',
    });
    assert.equal(d.synced, false);
    assert.equal(d.treesEqual, false);
    assert.equal(d.primaryBehindBackup, true);
    assert.equal(d.backupBehindPrimary, true);
    const rem = remediationFor(d);
    assert.ok(rem.some((line) => /Both sides have unique commits/i.test(line)));
  });

  it('treats backup-behind as not synced when trees differ', () => {
    const d = evaluateDualRemoteSync({
      onlyOrigin: 3,
      onlyGithub: 0,
      originTree: 'new',
      githubTree: 'old',
    });
    assert.equal(d.synced, false);
    assert.equal(d.backupBehindPrimary, true);
    assert.equal(d.primaryBehindBackup, false);
  });
});
