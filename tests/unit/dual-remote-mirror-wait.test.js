'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  summarizeRequiredChecks,
  decideWaitMergeStep,
  shouldForcePushMirror,
  isMirrorHeadStale,
  isTransientFailureMessage,
  DEFAULT_REQUIRED_CONTEXTS,
} = require('../../lib/task-platform/dual-remote-mirror-wait');

function rollup(entries) {
  return entries.map(([name, status, conclusion]) => ({ name, status, conclusion }));
}

describe('summarizeRequiredChecks', () => {
  it('treats incomplete action checks as pending', () => {
    const s = summarizeRequiredChecks(rollup([
      ['Pull request metadata', 'COMPLETED', 'SUCCESS'],
      ['Repo validation', 'IN_PROGRESS', ''],
      ['Browser validation', 'COMPLETED', 'SUCCESS'],
      ['verify', 'COMPLETED', 'SUCCESS'],
    ]));
    assert.ok(s.pending.includes('Repo validation'));
    assert.equal(s.actionsGreen, false);
  });

  it('actionsGreen when action checks pass without Merge readiness', () => {
    const s = summarizeRequiredChecks(rollup([
      ['Pull request metadata', 'COMPLETED', 'SUCCESS'],
      ['Repo validation', 'COMPLETED', 'SUCCESS'],
      ['Browser validation', 'COMPLETED', 'SUCCESS'],
      ['verify', 'COMPLETED', 'SUCCESS'],
    ]));
    assert.equal(s.actionsGreen, true);
    assert.equal(s.allGreen, false);
    assert.ok(s.missing.includes('Merge readiness') || s.pending.includes('Merge readiness'));
  });
});

describe('decideWaitMergeStep', () => {
  it('waits while action checks pending', () => {
    const d = decideWaitMergeStep({
      rollup: rollup([
        ['Pull request metadata', 'COMPLETED', 'SUCCESS'],
        ['Repo validation', 'IN_PROGRESS', ''],
        ['Browser validation', 'QUEUED', ''],
        ['verify', 'QUEUED', ''],
      ]),
      elapsedMs: 1000,
      timeoutMs: 60000,
    });
    assert.equal(d.step, 'wait');
  });

  it('posts merge readiness after actions green', () => {
    const d = decideWaitMergeStep({
      rollup: rollup([
        ['Pull request metadata', 'COMPLETED', 'SUCCESS'],
        ['Repo validation', 'COMPLETED', 'SUCCESS'],
        ['Browser validation', 'COMPLETED', 'SUCCESS'],
        ['verify', 'COMPLETED', 'SUCCESS'],
      ]),
      mergeReadinessPosted: false,
      elapsedMs: 1000,
      timeoutMs: 60000,
    });
    assert.equal(d.step, 'post_merge_readiness');
  });

  it('merges when all required contexts green', () => {
    const d = decideWaitMergeStep({
      rollup: rollup([
        ['Pull request metadata', 'COMPLETED', 'SUCCESS'],
        ['Repo validation', 'COMPLETED', 'SUCCESS'],
        ['Browser validation', 'COMPLETED', 'SUCCESS'],
        ['verify', 'COMPLETED', 'SUCCESS'],
        ['Merge readiness', 'COMPLETED', 'SUCCESS'],
      ]),
      mergeReadinessPosted: true,
      mergeStateStatus: 'CLEAN',
      elapsedMs: 1000,
      timeoutMs: 60000,
    });
    assert.equal(d.step, 'merge');
    assert.equal(d.ready, true);
  });

  it('uses merge_admin when BEHIND but green', () => {
    const d = decideWaitMergeStep({
      rollup: rollup([
        ['Pull request metadata', 'COMPLETED', 'SUCCESS'],
        ['Repo validation', 'COMPLETED', 'SUCCESS'],
        ['Browser validation', 'COMPLETED', 'SUCCESS'],
        ['verify', 'COMPLETED', 'SUCCESS'],
        ['Merge readiness', 'COMPLETED', 'SUCCESS'],
      ]),
      mergeReadinessPosted: true,
      mergeStateStatus: 'BEHIND',
      elapsedMs: 1000,
      timeoutMs: 60000,
    });
    assert.equal(d.step, 'merge_admin');
  });

  it('times out', () => {
    const d = decideWaitMergeStep({
      rollup: rollup([['verify', 'IN_PROGRESS', '']]),
      elapsedMs: 100000,
      timeoutMs: 1000,
    });
    assert.equal(d.step, 'timeout');
  });

  it('requests flaky rerun once', () => {
    const d = decideWaitMergeStep({
      rollup: rollup([
        ['Pull request metadata', 'COMPLETED', 'SUCCESS'],
        ['Repo validation', 'COMPLETED', 'SUCCESS'],
        ['Browser validation', 'COMPLETED', 'FAILURE'],
        ['verify', 'COMPLETED', 'SUCCESS'],
      ]),
      flakyRetriesUsed: 0,
      maxFlakyRetries: 1,
      elapsedMs: 1000,
      timeoutMs: 60000,
    });
    assert.equal(d.step, 'rerun_failed');
  });
});

describe('single-flight helpers', () => {
  it('blocks force-push when CI in progress and head not stale', () => {
    const g = shouldForcePushMirror({
      hasOpenPr: true,
      headStale: false,
      ciInProgress: true,
    });
    assert.equal(g.allow, false);
  });

  it('allows force-push when head stale', () => {
    const g = shouldForcePushMirror({
      hasOpenPr: true,
      headStale: true,
      ciInProgress: true,
    });
    assert.equal(g.allow, true);
  });

  it('detects stale mirror head', () => {
    assert.equal(isMirrorHeadStale('aaa', 'bbb'), true);
    assert.equal(isMirrorHeadStale('aaa', 'aaa'), false);
  });

  it('detects transient failure messages', () => {
    assert.equal(isTransientFailureMessage('download timed out after 30000ms'), true);
    assert.equal(isTransientFailureMessage('AssertionError expected true'), false);
  });

  it('exports required contexts list', () => {
    assert.ok(DEFAULT_REQUIRED_CONTEXTS.includes('verify'));
    assert.ok(DEFAULT_REQUIRED_CONTEXTS.includes('Merge readiness'));
  });
});
