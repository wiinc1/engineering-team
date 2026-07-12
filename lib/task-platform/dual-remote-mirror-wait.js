'use strict';

/**
 * Pure helpers for wait-for-CI + merge decision (inject I/O from the agent).
 */

const DEFAULT_REQUIRED_CONTEXTS = Object.freeze([
  'Pull request metadata',
  'Repo validation',
  'Browser validation',
  'verify',
  'Merge readiness',
]);

const FAIL_CONCLUSIONS = new Set([
  'FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE',
]);

const TRANSIENT_FAIL_RE = /timed out|timeout|ECONNRESET|ENOTFOUND|download|ETIMEDOUT|503|502|rate limit/i;

function normalizeCheckName(name) {
  return String(name || '').trim();
}

function indexRollup(rollup = []) {
  const byName = new Map();
  for (const c of rollup || []) {
    const name = normalizeCheckName(c.name);
    if (!name) continue;
    byName.set(name, {
      name,
      status: c.status || '',
      conclusion: c.conclusion || '',
    });
  }
  return byName;
}

function classifyOneCheck(required, row) {
  if (!row) {
    return required === 'Merge readiness' ? 'missing' : 'pending';
  }
  if (row.status !== 'COMPLETED') return 'pending';
  if (FAIL_CONCLUSIONS.has(row.conclusion)) return 'failed';
  return 'passed';
}

/**
 * Summarize PR statusCheckRollup against required contexts.
 */
function summarizeRequiredChecks(rollup = [], requiredContexts = DEFAULT_REQUIRED_CONTEXTS) {
  const byName = indexRollup(rollup);
  const pending = [];
  const failed = [];
  const passed = [];
  const missing = [];
  for (const required of requiredContexts) {
    const kind = classifyOneCheck(required, byName.get(required));
    if (kind === 'missing') missing.push(required);
    else if (kind === 'pending') pending.push(required);
    else if (kind === 'failed') failed.push(required);
    else passed.push(required);
  }
  const actionRequired = requiredContexts.filter((c) => c !== 'Merge readiness');
  const actionsGreen = actionRequired.every((c) => passed.includes(c));
  const allGreen = requiredContexts.every((c) => passed.includes(c));
  return { pending, failed, passed, missing, actionsGreen, allGreen, byName };
}

function decideWaitMergeStep(input = {}) {
  const {
    prState = 'OPEN',
    mergeStateStatus = '',
    rollup = [],
    elapsedMs = 0,
    timeoutMs = 25 * 60 * 1000,
    requiredContexts = DEFAULT_REQUIRED_CONTEXTS,
    mergeReadinessPosted = false,
    flakyRetriesUsed = 0,
    maxFlakyRetries = 1,
  } = input;
  if (prState && prState !== 'OPEN') {
    return {
      step: prState === 'MERGED' ? 'already_merged' : 'pr_closed',
      ready: prState === 'MERGED',
      summary: summarizeRequiredChecks(rollup, requiredContexts),
    };
  }
  const summary = summarizeRequiredChecks(rollup, requiredContexts);
  if (elapsedMs >= timeoutMs) {
    return {
      step: 'timeout',
      ready: false,
      summary,
      reason: `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for CI`,
    };
  }
  return decideAfterSummary({
    summary,
    mergeStateStatus,
    mergeReadinessPosted,
    flakyRetriesUsed,
    maxFlakyRetries,
  });
}

function decideAfterSummary({
  summary,
  mergeStateStatus,
  mergeReadinessPosted,
  flakyRetriesUsed,
  maxFlakyRetries,
}) {
  if (summary.failed.length) {
    if (flakyRetriesUsed < maxFlakyRetries) {
      return {
        step: 'rerun_failed',
        ready: false,
        summary,
        reason: `Failed checks (retry ${flakyRetriesUsed + 1}/${maxFlakyRetries}): ${summary.failed.join(', ')}`,
      };
    }
    return {
      step: 'failed',
      ready: false,
      summary,
      reason: `Required checks failed: ${summary.failed.join(', ')}`,
    };
  }
  const actionPending = summary.pending.filter((p) => p !== 'Merge readiness');
  if (!summary.actionsGreen || actionPending.length) {
    return {
      step: 'wait',
      ready: false,
      summary,
      reason: `Waiting for checks: ${actionPending.join(', ') || 'queued'}`,
    };
  }
  if (!mergeReadinessPosted) {
    return {
      step: 'post_merge_readiness',
      ready: false,
      summary,
      reason: 'Action checks green; post Merge readiness on head',
    };
  }
  if (!summary.passed.includes('Merge readiness')) {
    return {
      step: 'wait_merge_readiness',
      ready: false,
      summary,
      reason: 'Waiting for Merge readiness status to be visible',
    };
  }
  if (String(mergeStateStatus || '').toUpperCase() === 'BEHIND') {
    return {
      step: 'merge_admin',
      ready: true,
      summary,
      reason: 'All required contexts green but branch BEHIND base; merge with admin',
    };
  }
  return {
    step: 'merge',
    ready: true,
    summary,
    reason: 'All required contexts green',
  };
}

function isTransientFailureMessage(text = '') {
  return TRANSIENT_FAIL_RE.test(String(text || ''));
}

function isMirrorHeadStale(originFullSha, prHeadOid) {
  if (!originFullSha || !prHeadOid) return true;
  return String(originFullSha) !== String(prHeadOid);
}

function shouldForcePushMirror({
  hasOpenPr = false,
  headStale = false,
  ciInProgress = false,
} = {}) {
  if (!hasOpenPr) return { allow: true, reason: 'no open mirror PR' };
  if (headStale) return { allow: true, reason: 'mirror head stale vs origin/main' };
  if (ciInProgress) return { allow: false, reason: 'CI in progress on current head' };
  return { allow: true, reason: 'open PR idle; refresh allowed' };
}

module.exports = {
  DEFAULT_REQUIRED_CONTEXTS,
  summarizeRequiredChecks,
  decideWaitMergeStep,
  decideAfterSummary,
  isTransientFailureMessage,
  isMirrorHeadStale,
  shouldForcePushMirror,
};
