const test = require('node:test');
const assert = require('node:assert/strict');
const { runMilestoneCAgentVerify } = require('../../lib/audit/milestone-c-agent-verify');

test('milestone C verify module exports agent autonomy verifier', () => {
  assert.equal(typeof runMilestoneCAgentVerify, 'function');
});