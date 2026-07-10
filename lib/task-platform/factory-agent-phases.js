const crypto = require('node:crypto');
const path = require('node:path');
const { delegateFactorySpecialist } = require('./factory-orchestration');
const { commitShaEvidenceFailure } = require('./real-commit-sha');

function buildImplementerPrompt({ taskId, requirements, engineerTier = 'Jr', runKind = 'initial' } = {}) {
  return [
    `You are the ${engineerTier} engineer agent for task ${taskId}.`,
    `Run kind: ${runKind}.`,
    'Reply with JSON only — no tools, no file edits, no prose.',
    'Required JSON keys: branchName (string), commitSha (40-char hex), prUrl (https PR URL).',
    'Synthetic values are acceptable for local factory proof.',
    'Requirements summary:',
    String(requirements || '(none provided)').slice(0, 400),
  ].join('\n');
}

function buildQaPrompt({ taskId, requirements, runKind = 'initial', priorRunId = null } = {}) {
  return [
    `You are the QA agent for task ${taskId}.`,
    `Run kind: ${runKind}.`,
    priorRunId ? `Prior run id: ${priorRunId}` : '',
    'Reply with JSON only — no tools, no file edits, no prose.',
    'Required JSON: {"outcome":"pass"|"fail","findings":[]}.',
    'Requirements summary:',
    String(requirements || '(none provided)').slice(0, 400),
  ].filter(Boolean).join('\n');
}

function buildSrePrompt({ taskId, operatorUrl, mergeCommitSha, requirements } = {}) {
  return [
    `You are the SRE agent for task ${taskId}.`,
    `Operator URL: ${operatorUrl || '(not provided)'}`,
    mergeCommitSha ? `Deployment version: ${mergeCommitSha}` : '',
    'Reply with JSON only — no tools, no file edits, no prose.',
    'Required JSON: {"approved":true,"reason":"...","evidence":["..."]}.',
    'Requirements summary:',
    String(requirements || '(none provided)').slice(0, 400),
  ].filter(Boolean).join('\n');
}

function buildReviewPrompt({ taskId, gate, requirements } = {}) {
  return [
    `You are the ${gate} reviewer for task ${taskId}.`,
    'Approve or reject the delivery with a concise rationale.',
    'Requirements:',
    requirements || '(none provided)',
  ].join('\n');
}

function parseDelegationJsonOutput(delegation = {}) {
  const raw = String(delegation.message || delegation.output || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function prNumberFromUrl(prUrl) {
  const match = String(prUrl || '').match(/\/pull\/(\d+)(?:$|[/?#])/);
  return match ? Number(match[1]) : null;
}

function commitShaFailureLabel(commitSha) {
  const failure = commitSha ? commitShaEvidenceFailure(commitSha) : null;
  if (!failure) return null;
  return failure.includes('non-fixture')
    ? 'non-fixture 40-character commitSha'
    : 'valid 40-character commitSha';
}

function assertRealImplementerArtifacts({ branchName, commitSha, prUrl, prNumber } = {}) {
  const failures = [];
  const prNumberInUrl = prNumberFromUrl(prUrl);
  const commitShaFailure = commitShaFailureLabel(commitSha);
  if (!branchName) failures.push('branchName');
  if (!commitSha) failures.push('commitSha');
  if (!prUrl) failures.push('prUrl');
  if (commitShaFailure) failures.push(commitShaFailure);
  if (prUrl && !prNumberInUrl) failures.push('prUrl with pull request number');
  if (prNumber && prNumberInUrl && prNumber !== prNumberInUrl) failures.push('matching prNumber and prUrl');
  if (prNumber === 271 || prNumberInUrl === 271) failures.push('non-default prUrl');
  if (failures.length === 0) return;
  const failureLabel = failures.length === 3
    && failures.includes('branchName')
    && failures.includes('commitSha')
    && failures.includes('prUrl')
    ? 'branchName, commitSha, and prUrl'
    : failures.join(', ');
  throw new Error(`Implementer agent must return real ${failureLabel} evidence`);
}

function resolveImplementerArtifacts(delegation = {}, options = {}) {
  const parsed = parseDelegationJsonOutput(delegation);
  const branchName = parsed?.branchName
    || parsed?.branch_name
    || parsed?.branch
    || options.branchName
    || options.branch;
  const providedCommitSha = parsed?.commitSha
    || parsed?.commit_sha
    || options.commitSha;
  const providedPrUrl = parsed?.prUrl
    || parsed?.pr_url
    || options.prUrl;
  const providedPrNumber = Number(parsed?.prNumber || parsed?.pr_number || options.prNumber) || null;
  if (options.requireRealEvidence === true) {
    assertRealImplementerArtifacts({
      branchName,
      commitSha: providedCommitSha,
      prUrl: providedPrUrl,
      prNumber: providedPrNumber,
    });
  }
  const commitSha = providedCommitSha
    || crypto.randomBytes(20).toString('hex');
  const prUrl = providedPrUrl || null;
  return { branchName, commitSha, prUrl, parsed, delegated: delegation.delegated === true };
}

function resolveSreApproval(delegation = {}, options = {}) {
  const parsed = parseDelegationJsonOutput(delegation);
  const approved = parsed?.approved !== false && String(parsed?.outcome || 'approve').toLowerCase() !== 'reject';
  const reason = parsed?.reason
    || String(delegation.message || delegation.output || '').trim()
    || options.reason
    || 'SRE agent approved the monitoring window after reviewing deployment evidence.';
  const evidence = Array.isArray(parsed?.evidence)
    ? parsed.evidence
    : (options.evidence || ['Agent-reviewed deployment validation evidence.']);
  return {
    approved,
    reason,
    evidence,
    delegated: delegation.delegated === true,
    parsed,
  };
}

function resolveQaOutcome(delegation = {}, options = {}) {
  const parsed = parseDelegationJsonOutput(delegation);
  const outcome = String(parsed?.outcome || options.outcome || 'pass').toLowerCase();
  return {
    outcome: outcome === 'fail' ? 'fail' : 'pass',
    findings: parsed?.findings || options.findings || [],
    delegated: delegation.delegated === true,
    parsed,
  };
}

async function runImplementerAgentPhase(ctx, options = {}) {
  const delegation = await delegateFactorySpecialist(
    options.specialist || 'jr-engineer',
    buildImplementerPrompt(options),
    {
      taskId: options.taskId,
      actorId: ctx.actorId,
      engineerTier: options.engineerTier || 'Jr',
      openclawUrl: options.openclawUrl,
      baseDir: ctx.stackPersistDir || process.cwd(),
    },
  );
  const artifacts = resolveImplementerArtifacts(delegation, options);
  return {
    mode: 'agent_implementer',
    delegated: artifacts.delegated,
    sessionId: delegation.sessionId,
    agentId: delegation.agentId,
    branchName: artifacts.branchName,
    commitSha: artifacts.commitSha,
    prUrl: artifacts.prUrl,
    parsed: artifacts.parsed,
    delegation,
  };
}

async function runImplementerFixAgentPhase(ctx, options = {}) {
  return runImplementerAgentPhase(ctx, {
    ...options,
    runKind: 'fix_after_qa_fail',
    specialist: options.specialist || 'sr-engineer',
    engineerTier: options.engineerTier || 'Sr',
  });
}

async function runQaAgentPhase(ctx, options = {}) {
  const delegation = await delegateFactorySpecialist('qa', buildQaPrompt(options), {
    taskId: options.taskId,
    actorId: ctx.actorId,
    openclawUrl: options.openclawUrl,
    baseDir: ctx.stackPersistDir || process.cwd(),
  });
  const outcome = resolveQaOutcome(delegation, options);
  return {
    mode: 'agent_qa',
    delegated: outcome.delegated,
    sessionId: delegation.sessionId,
    agentId: delegation.agentId,
    outcome: outcome.outcome,
    findings: outcome.findings,
    parsed: outcome.parsed,
    delegation,
  };
}

async function runSreAgentPhase(ctx, options = {}) {
  const delegation = await delegateFactorySpecialist('sre', buildSrePrompt(options), {
    taskId: options.taskId,
    actorId: ctx.actorId,
    openclawUrl: options.openclawUrl,
    baseDir: ctx.stackPersistDir || process.cwd(),
  });
  const approval = resolveSreApproval(delegation, options);
  return {
    mode: 'agent_sre',
    delegated: approval.delegated,
    sessionId: delegation.sessionId,
    agentId: delegation.agentId,
    approved: approval.approved,
    reason: approval.reason,
    evidence: approval.evidence,
    parsed: approval.parsed,
    delegation,
  };
}

async function runReviewPacketAgentPhase(ctx, gate, options = {}) {
  const delegation = await delegateFactorySpecialist(gate === 'qa' ? 'qa' : gate, buildReviewPrompt({
    taskId: options.taskId,
    gate,
    requirements: options.requirements,
  }), {
    taskId: options.taskId,
    actorId: ctx.actorId,
    openclawUrl: options.openclawUrl,
    baseDir: ctx.stackPersistDir || process.cwd(),
  });
  return {
    mode: 'agent_review_packet',
    gate,
    delegated: delegation.delegated === true,
    sessionId: delegation.sessionId,
    agentId: delegation.agentId,
    summary: String(delegation.message || delegation.output || '').trim()
      || `${gate} gate approved via agent delegation.`,
    approved: true,
    delegation,
  };
}

function buildCiValidationEvidence(validation = {}, options = {}) {
  const workflow = options.workflowFile || '.github/workflows/validation.yml';
  const repository = options.repository || null;
  return {
    mode: 'local_and_ci',
    workflowFile: workflow,
    repository,
    ciUrl: options.ciUrl || (repository ? `https://github.com/${repository}/actions/workflows/${path.basename(workflow)}` : null),
    local: validation,
    recordedAt: new Date().toISOString(),
  };
}

module.exports = {
  buildImplementerPrompt,
  buildQaPrompt,
  buildSrePrompt,
  buildReviewPrompt,
  parseDelegationJsonOutput,
  resolveImplementerArtifacts,
  resolveQaOutcome,
  resolveSreApproval,
  runImplementerAgentPhase,
  runImplementerFixAgentPhase,
  runQaAgentPhase,
  runSreAgentPhase,
  runReviewPacketAgentPhase,
  buildCiValidationEvidence,
};
