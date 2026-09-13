const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseDelegationJsonOutput,
  resolveImplementerArtifacts,
  resolveQaOutcome,
  resolveSreApproval,
  buildCiValidationEvidence,
  buildImplementerPrompt,
  buildQaPrompt,
  isTrustedDeliveryMode,
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

test('buildImplementerPrompt labels session-proof vs trusted delivery', () => {
  const session = buildImplementerPrompt({ taskId: 'TSK-1', requirements: 'x' });
  assert.match(session, /SESSION PROOF ONLY/);
  assert.doesNotMatch(session, /Synthetic values are acceptable for local factory proof/);

  const trusted = buildImplementerPrompt({
    taskId: 'TSK-1',
    requirements: 'x',
    repository: 'wiinc1/engineering-team',
    githubIssueUrl: 'https://github.com/wiinc1/engineering-team/issues/388',
    changedFiles: ['docs/reference/example.md'],
    requireRealEvidence: true,
  });
  assert.match(trusted, /TRUSTED DELIVERY/);
  assert.match(trusted, /FORBIDDEN/);
  assert.match(trusted, /isolated git worktree/);
  assert.match(trusted, /prefer the `github` remote/);
  assert.match(trusted, /Do not merge the pull request/);
  assert.match(trusted, /filesystem, shell, git, and GitHub tools/);
  assert.match(trusted, /Repository: wiinc1\/engineering-team/);
  assert.match(trusted, /Source GitHub issue: https:\/\/github\.com\/wiinc1\/engineering-team\/issues\/388/);
  assert.match(trusted, /Expected changed files: docs\/reference\/example\.md/);
  assert.match(trusted, /- Standards baseline reviewed:/);
  assert.match(trusted, /- Rollback path:/);
  assert.match(trusted, /rejects `None`, `N\/A`, `TBD`, `TODO`, and `unknown`/);
  assert.match(trusted, /No gaps or exceptions; rationale: <specific reason this change conforms>/);
  assert.match(trusted, /Do not write only `None`/);
  assert.match(trusted, /Pending at PR creation; all protected checks are required before merge/);
  assert.match(trusted, /documentation-only change, use the changed documentation path for both fields/);
  assert.match(trusted, /Closes #388/);
  assert.doesNotMatch(trusted, /attribution proof only/);
  assert.match(session, /attribution proof only/);

  const trustedSimple = buildImplementerPrompt({
    taskId: 'TSK-2',
    requirements: 'x',
    trustedSimpleClose: true,
  });
  assert.match(trustedSimple, /TRUSTED DELIVERY/);

  const fix = buildImplementerPrompt({
    taskId: 'TSK-2',
    requirements: 'x',
    trustedSimpleClose: true,
    runKind: 'fix_after_qa_fail',
  });
  assert.match(fix, /existing pull request/);
  assert.match(fix, /Do not open a second pull request/);
});

test('buildImplementerPrompt requires literal PR metadata bullet prefixes', () => {
  const trusted = buildImplementerPrompt({
    taskId: 'TSK-1', requirements: 'x', requireRealEvidence: true,
  });
  assert.match(trusted, /MUST begin with the literal ASCII characters `- `/);
  assert.match(trusted, /hosted validator matches `\^- <label>:`/);
  assert.match(trusted, /unbulleted `Task: value` line is treated as missing/);
  assert.match(trusted, /Preserve the `- ` prefix/);
});

test('buildQaPrompt supplies exact read-only PR evidence for trusted delivery QA', () => {
  const prompt = buildQaPrompt({
    taskId: 'TSK-26',
    requirements: 'Add one documentation file.',
    repository: 'wiinc1/engineering-team',
    branchName: 'jr/tsk-26-docs',
    commitSha: 'd3690b68a8aec49fa35194c7532a9629ba8109db',
    prUrl: 'https://github.com/wiinc1/engineering-team/pull/362',
    changedFiles: ['docs/reference/example.md'],
    trustedSimpleClose: true,
  });

  assert.match(prompt, /TRUSTED DELIVERY QA/);
  assert.match(prompt, /read-only filesystem, git, and GitHub commands/);
  assert.match(prompt, /wiinc1\/engineering-team/);
  assert.match(prompt, /d3690b68a8aec49fa35194c7532a9629ba8109db/);
  assert.match(prompt, /pull\/362/);
  assert.match(prompt, /docs\/reference\/example\.md/);
  assert.match(prompt, /Do not edit files or pull-request metadata/);
  assert.doesNotMatch(prompt, /no tools/);
});

test('buildQaPrompt keeps session-proof QA tool-free', () => {
  const prompt = buildQaPrompt({ taskId: 'TSK-1', requirements: 'x' });
  assert.match(prompt, /no tools, no file edits/);
  assert.doesNotMatch(prompt, /TRUSTED DELIVERY QA/);
});

test('isTrustedDeliveryMode is opt-in via real-evidence flags', () => {
  assert.equal(isTrustedDeliveryMode({}), false);
  assert.equal(isTrustedDeliveryMode({ requireRealEvidence: true }), true);
  assert.equal(isTrustedDeliveryMode({ sessionProofOnly: true, requireRealEvidence: true }), false);
});

test('resolveImplementerArtifacts rejects synthetic under trusted delivery', () => {
  assert.throws(
    () => resolveImplementerArtifacts(
      { delegated: true, message: '{"branchName":"x","commitSha":"deadbeef","prUrl":"https://example.com"}' },
      { requireRealEvidence: true },
    ),
    /real/,
  );
});
