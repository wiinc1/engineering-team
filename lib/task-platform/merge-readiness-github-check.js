const crypto = require('crypto');

const MERGE_READINESS_CHECK_NAME = 'Merge readiness';
const MERGE_READINESS_GITHUB_CHECK_VERSION = 'merge-readiness-github-check.v1';
const REFRESH_PULL_REQUEST_ACTIONS = new Set(['opened', 'synchronize', 'reopened']);
const REFRESH_EVENT_NAMES = new Set([
  'check_run',
  'check_suite',
  'deployment',
  'deployment_status',
  'status',
  'workflow_run',
]);

function cloneJson(value, fallback = null) {
  if (value === undefined) return fallback;
  return value === null ? null : JSON.parse(JSON.stringify(value));
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function evidenceFingerprint(evidence = {}) {
  const material = {
    blockingSignals: evidence.blockingSignals || evidence.blocking_signals || [],
    deployment: evidence.deployment || null,
    previewDeployment: evidence.previewDeployment || evidence.preview_deployment || null,
    requiredChecks: evidence.requiredChecks || evidence.required_checks || [],
  };
  return crypto.createHash('sha256').update(stableStringify(material)).digest('hex');
}

function repositoryParts(repository) {
  const [owner, repo] = String(repository || '').split('/');
  return owner && repo ? { owner, repo } : null;
}

function reviewMetadata(review = {}) {
  return review.metadata?.github_merge_readiness_gate || review.metadata?.merge_readiness_github_check || null;
}

function reviewStatus(review) {
  return review?.reviewStatus || review?.review_status || null;
}

function reviewCommitSha(review) {
  return review?.commitSha || review?.commit_sha || null;
}

function checkRunId(review) {
  return review?.githubCheckRunId || review?.github_check_run_id || null;
}

function currentReviewMatches({ review, commitSha, evidence }) {
  if (!review || review.isCurrent === false || review.is_current === false) return false;
  if (commitSha && reviewCommitSha(review) !== commitSha) return false;
  const stored = reviewMetadata(review)?.evidence_fingerprint;
  return !(stored && evidence && stored !== evidenceFingerprint(evidence));
}

function mapReviewToCheckRun(review, context = {}) {
  if (!review) {
    return pendingMapping('missing_review', 'Merge readiness review is pending.');
  }
  if (!currentReviewMatches({ review, commitSha: context.commitSha, evidence: context.evidence })) {
    return pendingMapping('stale_review', 'Merge readiness review is stale for the latest PR evidence.');
  }
  const status = reviewStatus(review);
  if (status === 'passed') {
    return {
      status: 'completed',
      conclusion: 'success',
      reason: 'passed',
      title: 'Merge readiness passed',
      summary: 'Structured MergeReadinessReview passed for the current PR evidence.',
    };
  }
  if (status === 'blocked' || status === 'error') {
    return {
      status: 'completed',
      conclusion: 'failure',
      reason: status,
      title: status === 'error' ? 'Merge readiness error' : 'Merge readiness blocked',
      summary: status === 'error'
        ? 'Structured MergeReadinessReview reached an error state.'
        : 'Structured MergeReadinessReview is blocked.',
    };
  }
  return pendingMapping(status || 'missing_review', 'Merge readiness review is pending.');
}

function pendingMapping(reason, summary) {
  return {
    status: 'in_progress',
    conclusion: null,
    reason,
    title: 'Merge readiness pending',
    summary,
  };
}

function buildMergeReadinessCheckRunPayload(options = {}) {
  const mapping = mapReviewToCheckRun(options.review, options);
  const payload = {
    name: MERGE_READINESS_CHECK_NAME,
    head_sha: options.commitSha || reviewCommitSha(options.review),
    status: mapping.status,
    external_id: options.externalId || checkExternalId(options.review, mapping.reason),
    output: {
      title: mapping.title,
      summary: mapping.summary,
    },
  };
  if (mapping.conclusion) payload.conclusion = mapping.conclusion;
  if (mapping.status === 'completed') payload.completed_at = options.completedAt || new Date().toISOString();
  if (options.detailsUrl) payload.details_url = options.detailsUrl;
  return payload;
}

function checkExternalId(review, reason) {
  const reviewId = review?.reviewId || review?.review_id || 'missing';
  return `${MERGE_READINESS_GITHUB_CHECK_VERSION}:${reviewId}:${reason}`;
}

async function emitMergeReadinessCheckRun(options = {}) {
  if (!options.github) throw new Error('github check-run client is required');
  const repository = options.repository || options.review?.repository;
  const payload = buildMergeReadinessCheckRunPayload(options);
  const id = checkRunId(options.review);
  if (id && typeof options.github.updateCheckRun === 'function') {
    return options.github.updateCheckRun({ repository, checkRunId: id, payload });
  }
  if (typeof options.github.createCheckRun !== 'function') {
    throw new Error('github check-run client must implement createCheckRun');
  }
  return options.github.createCheckRun({ repository, payload });
}

function createGitHubCheckRunClient(options = {}) {
  const token = options.token || process.env.GITHUB_TOKEN;
  const fetchImpl = options.fetch || globalThis.fetch;
  const apiBaseUrl = (options.apiBaseUrl || 'https://api.github.com').replace(/\/$/, '');
  if (!token) throw new Error('GITHUB_TOKEN is required for GitHub check-run emission');
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');
  return {
    createCheckRun({ repository, payload }) {
      return requestGitHubCheckRun({ apiBaseUrl, fetchImpl, token, repository, payload, method: 'POST' });
    },
    updateCheckRun({ repository, checkRunId, payload }) {
      return requestGitHubCheckRun({ apiBaseUrl, fetchImpl, token, repository, payload, method: 'PATCH', checkRunId });
    },
  };
}

async function requestGitHubCheckRun(options) {
  const parts = repositoryParts(options.repository);
  if (!parts) throw new Error('repository must be in owner/name form');
  const suffix = options.checkRunId ? `/${options.checkRunId}` : '';
  const response = await options.fetchImpl(`${options.apiBaseUrl}/repos/${parts.owner}/${parts.repo}/check-runs${suffix}`, {
    method: options.method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${options.token}`,
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28',
    },
    body: JSON.stringify(options.payload),
  });
  if (!response.ok) {
    const body = typeof response.text === 'function' ? await response.text() : '';
    throw new Error(`GitHub check-run ${options.method} failed: ${response.status} ${body}`.trim());
  }
  return response.json();
}

function deriveMergeReadinessEvent(eventName, payload = {}) {
  const repository = payload.repository?.full_name || null;
  if (eventName === 'pull_request') {
    return pullRequestEvent(payload, repository);
  }
  if (eventName === 'check_run' && payload.check_run?.name === MERGE_READINESS_CHECK_NAME) {
    return { shouldRefresh: false, reason: 'self_check_run' };
  }
  if (REFRESH_EVENT_NAMES.has(eventName)) {
    return evidenceEvent(eventName, payload, repository);
  }
  return { shouldRefresh: false, reason: 'unsupported_event' };
}

function pullRequestEvent(payload, repository) {
  const action = String(payload.action || '');
  const pr = payload.pull_request || {};
  return {
    shouldRefresh: REFRESH_PULL_REQUEST_ACTIONS.has(action),
    reason: `pull_request.${action || 'unknown'}`,
    repository,
    pullRequestNumber: pr.number,
    headSha: pr.head?.sha || null,
    evidence: { previewDeployment: pr.head?.repo?.html_url || null },
  };
}

function evidenceEvent(eventName, payload, repository) {
  const pr = firstEventPullRequest(payload);
  return {
    shouldRefresh: true,
    reason: eventName,
    repository,
    pullRequestNumber: pr?.number || payload.pull_request?.number || null,
    headSha: payload.check_run?.head_sha
      || payload.check_suite?.head_sha
      || payload.workflow_run?.head_sha
      || payload.deployment?.sha
      || payload.sha
      || null,
    evidence: evidenceFromEvent(eventName, payload),
  };
}

function firstEventPullRequest(payload = {}) {
  const pulls = payload.check_run?.pull_requests || payload.check_suite?.pull_requests || payload.workflow_run?.pull_requests || [];
  return Array.isArray(pulls) ? pulls[0] : null;
}

function evidenceFromEvent(eventName, payload = {}) {
  if (eventName === 'check_run') {
    return { requiredChecks: [checkEvidence(payload.check_run)] };
  }
  if (eventName === 'check_suite') {
    return { requiredChecks: [checkEvidence(payload.check_suite)] };
  }
  if (eventName === 'status') {
    return { requiredChecks: [statusEvidence(payload)] };
  }
  if (eventName === 'deployment' || eventName === 'deployment_status') {
    return { deployment: deploymentEvidence(payload) };
  }
  return { requiredChecks: [workflowRunEvidence(payload.workflow_run)] };
}

function checkEvidence(check) {
  return {
    id: check?.id || null,
    name: check?.name || check?.app?.name || 'check',
    conclusion: check?.conclusion || check?.status || null,
    url: check?.html_url || check?.details_url || null,
  };
}

function statusEvidence(payload) {
  return {
    name: payload.context || 'status',
    conclusion: payload.state || null,
    url: payload.target_url || null,
  };
}

function workflowRunEvidence(run) {
  return {
    id: run?.id || null,
    name: run?.name || 'workflow_run',
    conclusion: run?.conclusion || run?.status || null,
    url: run?.html_url || null,
  };
}

function deploymentEvidence(payload) {
  const status = payload.deployment_status || {};
  const deployment = payload.deployment || {};
  return {
    id: status.id || deployment.id || null,
    environment: status.environment || deployment.environment || null,
    state: status.state || deployment.state || null,
    url: status.target_url || status.environment_url || deployment.url || null,
  };
}

async function refreshMergeReadinessForEvent(options = {}) {
  const event = deriveMergeReadinessEvent(options.eventName, options.payload || {});
  if (!event.shouldRefresh) return { refreshed: false, reason: event.reason, results: [] };
  const refs = options.taskRefs || [];
  const results = [];
  for (const ref of refs) {
    results.push(await refreshTaskMergeReadinessCheck({
      ...options,
      tenantId: ref.tenantId,
      taskId: ref.taskId,
      event,
    }));
  }
  return { refreshed: true, reason: event.reason, results };
}

async function refreshTaskMergeReadinessCheck(options = {}) {
  const reviews = await options.taskPlatform.listMergeReadinessReviews({
    tenantId: options.tenantId,
    taskId: options.taskId,
    repository: options.event.repository,
    pullRequestNumber: options.event.pullRequestNumber,
  });
  const current = reviews.find(review => reviewCommitSha(review) === options.event.headSha) || reviews[0] || null;
  const stale = current && !currentReviewMatches({
    review: current,
    commitSha: options.event.headSha,
    evidence: options.event.evidence,
  });
  const review = stale ? await markReviewStale(options.taskPlatform, current, options.event) : current;
  const emitted = await emitMergeReadinessCheckRun({
    github: options.github,
    review: stale ? null : review,
    repository: options.event.repository,
    commitSha: options.event.headSha,
    evidence: options.event.evidence,
    detailsUrl: options.detailsUrl,
  });
  return { taskId: options.taskId, stale: Boolean(stale), checkRun: emitted };
}

async function markReviewStale(taskPlatform, review, event) {
  const metadata = cloneJson(review.metadata, {});
  metadata.github_merge_readiness_gate = {
    policy_version: MERGE_READINESS_GITHUB_CHECK_VERSION,
    invalidated_reason: reviewCommitSha(review) !== event.headSha ? 'commit_sha_changed' : 'evidence_changed',
    invalidated_at: new Date().toISOString(),
    latest_commit_sha: event.headSha,
    evidence_fingerprint: evidenceFingerprint(event.evidence),
  };
  return taskPlatform.updateMergeReadinessReview({
    tenantId: review.tenantId,
    taskId: review.taskId,
    reviewId: review.reviewId,
    recordVersion: review.recordVersion,
    reviewStatus: 'stale',
    metadata,
    skipGitHubCheckRun: true,
  });
}

module.exports = {
  MERGE_READINESS_CHECK_NAME,
  MERGE_READINESS_GITHUB_CHECK_VERSION,
  buildMergeReadinessCheckRunPayload,
  createGitHubCheckRunClient,
  deriveMergeReadinessEvent,
  emitMergeReadinessCheckRun,
  evidenceFingerprint,
  mapReviewToCheckRun,
  refreshMergeReadinessForEvent,
};
