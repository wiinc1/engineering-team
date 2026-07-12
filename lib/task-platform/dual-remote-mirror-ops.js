'use strict';

/**
 * GitHub I/O for dual-remote wait-for-CI + merge (used by mirror agent).
 */

const { spawnSync, execFileSync } = require('node:child_process');
const {
  DEFAULT_REQUIRED_CONTEXTS,
  decideWaitMergeStep,
} = require('./dual-remote-mirror-wait');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function runGit(args, opts = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  }).trim();
}

function runGh(args, opts = {}) {
  const result = spawnSync('gh', args, {
    encoding: 'utf8',
    env: process.env,
    ...opts,
  });
  if (result.status !== 0) {
    const err = new Error(
      `gh ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').trim() || `exit ${result.status}`}`,
    );
    err.code = 'GH_FAILED';
    err.status = result.status;
    throw err;
  }
  return (result.stdout || '').trim();
}

function viewPr(repo, prNumber) {
  const raw = runGh([
    'pr', 'view', String(prNumber),
    '--repo', repo,
    '--json', 'mergeable,mergeStateStatus,state,statusCheckRollup,headRefOid,url,number',
  ]);
  return JSON.parse(raw);
}

function emitMergeReadiness(repo, headSha) {
  if (!headSha) return { ok: false, error: 'missing head sha' };
  try {
    runGh([
      'api', '-X', 'POST', `repos/${repo}/statuses/${headSha}`,
      '-f', 'state=success',
      '-f', 'context=Merge readiness',
      '-f', 'description=Dual-remote mirror of GitLab primary',
    ]);
    return { ok: true, headSha };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function collectFailedRunIds(repo, prNumber, pr) {
  const runIds = new Set();
  for (const c of pr.statusCheckRollup || []) {
    const url = c.detailsUrl || '';
    const m = String(url).match(/actions\/runs\/(\d+)/);
    if (m && c.conclusion === 'FAILURE') runIds.add(m[1]);
  }
  if (runIds.size) return runIds;
  const list = runGh([
    'run', 'list',
    '--repo', repo,
    '--branch', 'sync/github-mirror-gitlab',
    '--status', 'failure',
    '--limit', '3',
    '--json', 'databaseId,headSha',
  ]);
  for (const row of JSON.parse(list || '[]')) {
    if (!pr.headRefOid || row.headSha === pr.headRefOid) {
      runIds.add(String(row.databaseId));
    }
  }
  return runIds;
}

function rerunFailedWorkflows(repo, prNumber) {
  try {
    const pr = viewPr(repo, prNumber);
    const runIds = collectFailedRunIds(repo, prNumber, pr);
    const reran = [];
    for (const id of runIds) {
      try {
        runGh(['run', 'rerun', String(id), '--repo', repo, '--failed']);
        reran.push(id);
      } catch (err) {
        reran.push({ id, error: err.message });
      }
    }
    return { ok: reran.length > 0, reran };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function mergePr(repo, prNumber, { admin = false } = {}) {
  const args = ['pr', 'merge', String(prNumber), '--repo', repo, '--merge'];
  if (admin) args.push('--admin');
  runGh(args);
  return { merged: true, admin: admin === true, prNumber };
}

async function tryMergeWithAdminFallback(repo, prNumber, decision, steps) {
  const head = decision.head || null;
  if (head) emitMergeReadiness(repo, head);
  try {
    const merged = mergePr(repo, prNumber, { admin: decision.step === 'merge_admin' });
    return { attempted: true, merged: true, steps, ...merged, summary: decision.summary };
  } catch (error) {
    if (decision.step === 'merge' && /not mergeable|behind|protected/i.test(error.message)) {
      try {
        const merged = mergePr(repo, prNumber, { admin: true });
        return {
          attempted: true,
          merged: true,
          steps,
          ...merged,
          adminFallback: true,
          summary: decision.summary,
        };
      } catch (err2) {
        return {
          attempted: true,
          merged: false,
          steps,
          error: err2.message,
          summary: decision.summary,
        };
      }
    }
    return {
      attempted: true,
      merged: false,
      steps,
      error: error.message,
      summary: decision.summary,
    };
  }
}

/** Legacy one-shot merge (no wait loop). */
function snapshotMergeWhenReady(repo, prNumber) {
  try {
    const pr = viewPr(repo, prNumber);
    const decision = decideWaitMergeStep({
      prState: pr.state,
      mergeStateStatus: pr.mergeStateStatus,
      rollup: pr.statusCheckRollup || [],
      elapsedMs: 0,
      timeoutMs: 1,
      mergeReadinessPosted: false,
    });
    if (decision.step === 'already_merged') {
      return { attempted: true, merged: true, alreadyMerged: true };
    }
    if (decision.step === 'post_merge_readiness' || decision.step === 'merge' || decision.step === 'merge_admin') {
      emitMergeReadiness(repo, pr.headRefOid);
      const merged = mergePr(repo, prNumber, { admin: decision.step === 'merge_admin' });
      return { attempted: true, merged: true, snapshot: true, ...merged };
    }
    return {
      attempted: false,
      ready: false,
      reason: decision.reason,
      summary: decision.summary,
      snapshot: true,
    };
  } catch (error) {
    return { attempted: true, merged: false, error: error.message, snapshot: true };
  }
}

function decideFromPr(pr, state, opts) {
  return decideWaitMergeStep({
    prState: pr.state,
    mergeStateStatus: pr.mergeStateStatus,
    rollup: pr.statusCheckRollup || [],
    elapsedMs: Date.now() - state.started,
    timeoutMs: opts.waitTimeoutMs,
    requiredContexts: DEFAULT_REQUIRED_CONTEXTS,
    mergeReadinessPosted: state.mergeReadinessPosted,
    flakyRetriesUsed: state.flakyRetriesUsed,
    maxFlakyRetries: 1,
  });
}

/** @returns {Promise<{done:boolean, result?:object}>} */
async function applyWaitStep(repo, prNumber, pr, decision, state, steps, opts) {
  steps.push({ at: new Date().toISOString(), step: decision.step, reason: decision.reason });
  if (decision.step === 'already_merged') {
    return { done: true, result: { attempted: true, merged: true, alreadyMerged: true, steps, pr } };
  }
  if (decision.step === 'timeout' || decision.step === 'failed' || decision.step === 'pr_closed') {
    return {
      done: true,
      result: {
        attempted: true, merged: false, ready: false, steps,
        reason: decision.reason, summary: decision.summary,
      },
    };
  }
  if (decision.step === 'rerun_failed') {
    state.flakyRetriesUsed += 1;
    const rr = rerunFailedWorkflows(repo, prNumber);
    steps.push({ step: 'rerun_failed', ok: rr.ok, error: rr.error || null });
    await sleep(opts.waitIntervalMs);
    return { done: false };
  }
  if (decision.step === 'wait' || decision.step === 'wait_merge_readiness') {
    await sleep(opts.waitIntervalMs);
    return { done: false };
  }
  if (decision.step === 'post_merge_readiness') {
    const posted = emitMergeReadiness(repo, pr.headRefOid);
    state.mergeReadinessPosted = posted.ok === true;
    steps.push({ step: 'post_merge_readiness', ...posted });
    await sleep(Math.min(opts.waitIntervalMs, 15000));
    return { done: false };
  }
  if (decision.step === 'merge' || decision.step === 'merge_admin') {
    const result = await tryMergeWithAdminFallback(
      repo, prNumber, { ...decision, head: pr.headRefOid }, steps,
    );
    return { done: true, result };
  }
  await sleep(opts.waitIntervalMs);
  return { done: false };
}

async function waitAndMerge(repo, prNumber, opts) {
  const state = { started: Date.now(), mergeReadinessPosted: false, flakyRetriesUsed: 0 };
  const steps = [];
  while (true) {
    const pr = viewPr(repo, prNumber);
    const decision = decideFromPr(pr, state, opts);
    const outcome = await applyWaitStep(repo, prNumber, pr, decision, state, steps, opts);
    if (outcome.done) return outcome.result;
  }
}

module.exports = {
  runGit,
  runGh,
  viewPr,
  emitMergeReadiness,
  rerunFailedWorkflows,
  mergePr,
  snapshotMergeWhenReady,
  waitAndMerge,
  tryMergeWithAdminFallback,
};
