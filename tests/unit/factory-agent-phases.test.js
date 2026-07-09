const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseDelegationJsonOutput,
  resolveImplementerArtifacts,
  resolveQaOutcome,
  resolveSreApproval,
  buildCiValidationEvidence,
} = require('../../lib/task-platform/factory-agent-phases');

test('parseDelegationJsonOutput extracts JSON payloads from agent output', () => {
  const parsed = parseDelegationJsonOutput({
    message: 'done {"commitSha":"abc123","prUrl":"https://example.com/pr/1"}',
  });
  assert.equal(parsed.commitSha, 'abc123');
});

test('resolveImplementerArtifacts falls back to generated commit without fake PR evidence', () => {
  const artifacts = resolveImplementerArtifacts({ delegated: true, message: 'implemented' });
  assert.equal(artifacts.delegated, true);
  assert.match(artifacts.commitSha, /^[0-9a-f]{40}$/);
  assert.equal(artifacts.prUrl, null);
});

test('resolveQaOutcome defaults to pass when agent output is empty', () => {
  const outcome = resolveQaOutcome({ delegated: true, message: '' }, { outcome: 'fail' });
  assert.equal(outcome.outcome, 'fail');
});

test('buildCiValidationEvidence links local validation to workflow metadata', () => {
  const evidence = buildCiValidationEvidence({ ok: true }, { repository: 'wiinc1/engineering-team' });
  assert.equal(evidence.repository, 'wiinc1/engineering-team');
  assert.match(evidence.ciUrl, /validation\.yml/);
});

test('buildCiValidationEvidence does not invent repository identity', () => {
  const evidence = buildCiValidationEvidence({ ok: true });
  assert.equal(evidence.repository, null);
  assert.equal(evidence.ciUrl, null);
});

test('resolveSreApproval approves agent JSON payloads by default', () => {
  const approval = resolveSreApproval({
    delegated: true,
    message: '{"approved":true,"reason":"monitoring window clear","evidence":["deploy green"]}',
  });
  assert.equal(approval.approved, true);
  assert.equal(approval.delegated, true);
  assert.equal(approval.reason, 'monitoring window clear');
  assert.deepEqual(approval.evidence, ['deploy green']);
});

test('resolveSreApproval rejects explicit reject outcomes', () => {
  const approval = resolveSreApproval({
    delegated: true,
    message: '{"approved":false,"outcome":"reject","reason":"alerts firing"}',
  });
  assert.equal(approval.approved, false);
  assert.equal(approval.reason, 'alerts firing');
});
