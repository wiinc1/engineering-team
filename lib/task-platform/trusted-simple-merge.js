'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  collectGitHubPullRequestEvidence,
} = require('./golden-path-real-evidence-collector');
const {
  buildMergeReadinessCheckRunPayload,
  createGitHubCheckRunClient,
} = require('./merge-readiness-github-check');
const { mergePullRequestWhenReady } = require('./github-auto-merge');
const {
  buildTrustedSimpleCloseEvidence,
  writeTrustedSimpleCloseEvidence,
} = require('./trusted-simple-close-evidence');
const { runQaAgentPhase } = require('./factory-agent-phases');
const { partitionPhaseStepsWithForgePolicy } = require('./forge-claim-policy');
const { shouldSkipForgePhases } = require('./golden-path-forge-skip');

const MERGE_READINESS = 'merge readiness';
const MERGE_READINESS_WORKFLOW = 'emit-merge-readiness-check.yml';
const SUCCESS = new Set(['success', 'passed']);

function checkName(check = {}) {
  return String(check.name || check.checkName || check.context || '').trim();
}

function checkPassed(check = {}) {
  return SUCCESS.has(String(check.conclusion || check.status || '').trim().toLowerCase());
}

function trustedPremergeFailures(github = {}) {
  const checks = Array.isArray(github.checks) ? github.checks : [];
  const required = Array.isArray(github.requiredChecks) ? github.requiredChecks : [];
  const failures = [];
  for (const requiredName of required) {
    if (String(requiredName).trim().toLowerCase() === MERGE_READINESS) continue;
    const matching = checks.filter((check) => checkName(check).toLowerCase() === String(requiredName).trim().toLowerCase());
    if (!matching.some(checkPassed)) failures.push(`${requiredName} is not successful`);
  }
  if (!required.length) failures.push('branch protection required-check inventory is missing');
  return failures;
}

function trustedMergeTarget(evidence = {}, options = {}) {
  const github = evidence.github || {};
  return {
    repository: options.ciRepository || options.repository || github.repository,
    prUrl: options.prUrl || github.prUrl,
    prNumber: options.prNumber || github.prNumber,
    branchName: github.branchName || options.branchName || options.branch,
    implementationCommitSha: github.commitSha || options.implementationCommitSha || options.commitSha,
  };
}

async function collectTrustedPullRequest(evidence, options) {
  const target = trustedMergeTarget(evidence, options);
  return collectGitHubPullRequestEvidence({
    ...target,
    githubToken: options.githubToken,
    githubApiBaseUrl: options.githubApiBaseUrl,
    fetchImpl: options.githubFetchImpl || options.fetchImpl || globalThis.fetch,
  }, evidence);
}

async function waitForTrustedPremerge(evidence, options = {}) {
  const attempts = Number(options.trustedCheckPollAttempts || 120);
  const intervalMs = Number(options.trustedCheckPollIntervalMs || 10_000);
  let github = null;
  let failures = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    github = await collectTrustedPullRequest(evidence, options);
    failures = trustedPremergeFailures(github);
    if (!failures.length) return github;
    if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Trusted Simple pre-merge checks did not pass: ${failures.join('; ')}`);
}

async function dispatchMergeReadinessWorkflow(github, options, directError) {
  const token = options.githubToken || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const fetchImpl = options.githubFetchImpl || options.fetchImpl || globalThis.fetch;
  if (!token || typeof fetchImpl !== 'function') throw directError;
  const apiBaseUrl = (options.githubApiBaseUrl || 'https://api.github.com').replace(/\/$/, '');
  const workflow = options.mergeReadinessWorkflow || MERGE_READINESS_WORKFLOW;
  const workflowRef = options.mergeReadinessWorkflowRef || 'main';
  const response = await fetchImpl(
    `${apiBaseUrl}/repos/${github.repository}/actions/workflows/${workflow}/dispatches`,
    {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-github-api-version': '2022-11-28',
      },
      body: JSON.stringify({
        ref: workflowRef,
        inputs: { pr_number: String(github.prNumber), conclusion: 'success' },
      }),
    },
  );
  if (!response.ok) {
    const body = typeof response.text === 'function' ? await response.text() : '';
    throw new Error(
      `Merge readiness emission failed directly (${directError.message}) and via workflow dispatch: ${response.status} ${body}`.trim(),
    );
  }
  return { workflowDispatched: true, workflow, workflowRef, directCheckRunError: directError.message };
}

async function emitTrustedMergeReadiness(github, options = {}) {
  if (github.mergeReadiness?.reviewStatus === 'passed') return { skipped: true, reason: 'already_passed' };
  const token = options.githubToken || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const client = options.githubCheckRunClient || createGitHubCheckRunClient({
    token,
    apiBaseUrl: options.githubApiBaseUrl,
    fetch: options.githubFetchImpl || options.fetchImpl || globalThis.fetch,
  });
  const review = {
    reviewId: `factory-${github.commitSha.slice(0, 12)}`,
    repository: github.repository,
    commitSha: github.commitSha,
    reviewStatus: 'passed',
    isCurrent: true,
  };
  const payload = buildMergeReadinessCheckRunPayload({
    review,
    commitSha: github.commitSha,
    completedAt: new Date().toISOString(),
    detailsUrl: github.prUrl,
  });
  try {
    return await client.createCheckRun({ repository: github.repository, payload });
  } catch (directError) {
    return dispatchMergeReadinessWorkflow(github, options, directError);
  }
}

async function waitForMergeReadiness(evidence, options = {}) {
  const attempts = Number(options.trustedReadinessPollAttempts || 30);
  const intervalMs = Number(options.trustedReadinessPollIntervalMs || 2_000);
  let github = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    github = await collectTrustedPullRequest(evidence, options);
    if (github.mergeReadiness?.reviewStatus === 'passed') return github;
    if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Trusted Simple Merge readiness check did not become successful');
}

async function prepareTrustedSimpleMerge(evidence = {}, options = {}) {
  if (options.trustedSimpleClose !== true) return { skipped: true, evidence };
  const premerge = await waitForTrustedPremerge(evidence, options);
  await emitTrustedMergeReadiness(premerge, options);
  const ready = await waitForMergeReadiness({ ...evidence, github: premerge }, options);
  const autoMerge = await mergePullRequestWhenReady({
    repository: ready.repository,
    prNumber: ready.prNumber,
    prUrl: ready.prUrl,
    autoMerge: options.autoMerge,
    githubToken: options.githubToken,
    fetchImpl: options.githubFetchImpl || options.fetchImpl || globalThis.fetch,
    commitTitle: `Factory trusted Simple delivery: ${evidence.engineeringTeam?.taskId || ready.prNumber}`,
    commitMessage: 'Automated merge after live OpenClaw implementation, QA, required checks, and Merge readiness passed.',
  });
  if (!autoMerge.ok || autoMerge.merged !== true) {
    throw new Error(`Trusted Simple auto-merge failed: ${autoMerge.reason || 'merge was not confirmed'}`);
  }
  const merged = await collectTrustedPullRequest({ ...evidence, github: ready }, {
    ...options,
    implementationCommitSha: ready.commitSha,
  });
  return {
    skipped: false,
    autoMerge,
    github: merged,
    evidence: {
      ...evidence,
      github: {
        ...merged,
        merged: true,
        mergeCommitSha: autoMerge.mergeCommitSha || merged.mergeCommitSha,
        mergedAt: autoMerge.mergedAt || merged.mergedAt,
      },
    },
  };
}

function recordTrustedSimpleCloseEvidence(evidence = {}, options = {}) {
  if (options.trustedSimpleClose !== true) return null;
  const github = evidence.github || {};
  const taskId = evidence.engineeringTeam?.taskId || evidence.factoryQueueId;
  if (!taskId) throw new Error('Trusted Simple close evidence requires a task id');
  const body = buildTrustedSimpleCloseEvidence({
    taskId,
    templateTier: 'Simple',
    repository: github.repository,
    branchName: github.branchName,
    commitSha: github.commitSha,
    prUrl: github.prUrl,
    prNumber: github.prNumber,
    mergeCommitSha: github.mergeCommitSha,
    mergedAt: github.mergedAt,
    changedFiles: github.changedFiles,
    checks: github.checks,
    requiredChecks: github.requiredChecks,
    branchProtection: github.branchProtection,
    mergeReadiness: github.mergeReadiness,
    autoMergeReason: 'factory_owned_merge_after_green_checks',
    notes: `Trusted Simple close for ${taskId}; generated by the live factory after merge confirmation.`,
  });
  body.taskId = taskId;
  body.factoryQueueId = evidence.factoryQueueId || null;
  const relativePath = path.join('observability', 'trusted-simple-close', `${taskId}.json`);
  const written = writeTrustedSimpleCloseEvidence(relativePath, body);
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(written.path)).digest('hex');
  return { path: relativePath, sha256 };
}

async function runTrustedSimpleCleanQa({
  ctx, etTaskId, evidence, options, phase2Result, recordQaResult,
}) {
  if (options.trustedSimpleClose !== true || options.agentDrivenPhases !== true) {
    return { agent: null, result: null };
  }
  const implementation = phase2Result?.api?.implementation || {};
  const agent = await runQaAgentPhase(ctx, {
    taskId: etTaskId, requirements: evidence.engineeringTeam?.requirements,
    runKind: 'initial', outcome: 'pass', openclawUrl: options.openclawUrl,
    repository: evidence.github?.repository || options.ciRepository || options.repository,
    branchName: implementation.branchName || evidence.github?.branchName,
    commitSha: implementation.commitSha || evidence.github?.commitSha,
    prUrl: implementation.prUrl || evidence.github?.prUrl,
    changedFiles: evidence.change?.changedFiles || evidence.engineeringTeam?.changedFiles || [],
    requireRealEvidence: true,
    trustedDelivery: options.trustedDelivery === true,
    trustedSimpleClose: true,
    proofProfile: options.proofProfile,
  });
  if (agent.outcome !== 'pass') return { agent, result: null };
  const qaPass = etTaskId ? await recordQaResult(ctx, etTaskId, {
    outcome: 'pass', runKind: 'initial',
    summary: 'Live QA specialist approved the clean Simple implementation.',
    scenarios: ['Approved requirements and focused implementation test evidence reviewed.'],
    retestScope: 'Initial clean implementation; no corrective loop required.',
  }) : { ok: false, skipped: true };
  if (etTaskId && !qaPass.ok) {
    throw new Error(`QA pass recording failed (${qaPass.status}): ${JSON.stringify(qaPass.body)}`);
  }
  const steps = partitionPhaseStepsWithForgePolicy({
    steps: ['GP-015', 'GP-016'], forgeStepsInPhase: ['GP-016'],
    skipped: shouldSkipForgePhases(options, phase2Result),
  });
  return { agent, result: {
    steps: steps.steps, stepsSkipped: steps.stepsSkipped, priorQaRunId: null,
    api: {
      qaPass: { status: qaPass.status, ok: qaPass.ok },
      qaAgent: { delegated: agent.delegated, sessionId: agent.sessionId, agentId: agent.agentId, outcome: agent.outcome },
      forgeRejectJobId: null, executionState: null, workflowState: null,
    },
  } };
}

async function applyTrustedSimpleMerge({ evidence, options, phaseResults, outputPath, saveEvidence }) {
  if (options.trustedSimpleClose !== true || evidence.github?.merged === true) return evidence;
  const result = await prepareTrustedSimpleMerge(evidence, options);
  const updated = result.evidence;
  updated.trustedSimpleMerge = { completedAt: new Date().toISOString(), autoMerge: result.autoMerge };
  Object.assign(options, {
    repository: updated.github.repository, ciRepository: updated.github.repository,
    branchName: updated.github.branchName, implementationCommitSha: updated.github.commitSha,
    prUrl: updated.github.prUrl, prNumber: updated.github.prNumber,
    mergeCommitSha: updated.github.mergeCommitSha, checks: updated.github.checks,
    requiredChecks: updated.github.requiredChecks, branchProtection: updated.github.branchProtection,
    mergeReadiness: updated.github.mergeReadiness,
  });
  phaseResults.trustedMerge = updated.trustedSimpleMerge;
  saveEvidence(updated, outputPath);
  return updated;
}

function finalizeTrustedSimpleCloseEvidence(evidence, options, autoMerge, mergeCommitSha) {
  if (options.trustedSimpleClose !== true) return;
  evidence.github = {
    ...(evidence.github || {}), merged: true, mergeCommitSha,
    mergedAt: autoMerge.mergedAt || evidence.github?.mergedAt,
  };
  evidence.trustedSimpleCloseEvidence = recordTrustedSimpleCloseEvidence(evidence, options);
}

module.exports = {
  applyTrustedSimpleMerge,
  checkPassed,
  collectTrustedPullRequest,
  emitTrustedMergeReadiness,
  finalizeTrustedSimpleCloseEvidence,
  prepareTrustedSimpleMerge,
  recordTrustedSimpleCloseEvidence,
  runTrustedSimpleCleanQa,
  trustedMergeTarget,
  trustedPremergeFailures,
  waitForMergeReadiness,
  waitForTrustedPremerge,
};
