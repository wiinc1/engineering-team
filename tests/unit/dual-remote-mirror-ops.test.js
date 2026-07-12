'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const ops = require('../../lib/task-platform/dual-remote-mirror-ops');

describe('dual-remote-mirror-ops exports', () => {
  it('exports waitAndMerge and related helpers', () => {
    assert.equal(typeof ops.waitAndMerge, 'function');
    assert.equal(typeof ops.snapshotMergeWhenReady, 'function');
    assert.equal(typeof ops.emitMergeReadiness, 'function');
    assert.equal(typeof ops.rerunFailedWorkflows, 'function');
    assert.equal(typeof ops.mergePr, 'function');
    assert.equal(typeof ops.viewPr, 'function');
    assert.equal(typeof ops.tryMergeWithAdminFallback, 'function');
  });

  it('is required by the mirror agent script', () => {
    const agent = require('../../scripts/dual-remote-mirror-github');
    assert.equal(typeof agent.waitAndMerge, 'function');
    assert.equal(typeof agent.runPreflight, 'function');
  });
});
