const test = require('node:test');
const assert = require('node:assert/strict');
const { runMilestoneBOrchestrationVerify } = require('../../lib/audit/milestone-b-orchestration-verify');

test('milestone B verify module exports orchestration verifier', () => {
  assert.equal(typeof runMilestoneBOrchestrationVerify, 'function');
});