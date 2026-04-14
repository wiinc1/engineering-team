const crypto = require('crypto');
const { normalizeLinkedPr } = require('./linked-prs');

const TASK_ID_PATTERN = /\bTSK-[A-Z0-9-]+\b/g;

function verifyGitHubWebhookSignature(rawBody, signature, secret) {
  if (!secret) throw new Error('GITHUB_WEBHOOK_SECRET is required');
  const provided = String(signature || '').trim();
  if (!provided.startsWith('sha256=')) throw new Error('missing webhook signature');
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const actualBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new Error('invalid webhook signature');
  }
}

function uniqueTaskIds(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function findTaskIdsInText(value) {
  return uniqueTaskIds(String(value || '').match(TASK_ID_PATTERN) || []);
}

function inferTaskIdsFromWebhook(eventName, payload = {}) {
  const pullRequest = payload.pull_request || null;
  const issue = payload.issue || null;
  const candidates = [
    payload.repository?.default_branch,
    pullRequest?.title,
    pullRequest?.body,
    pullRequest?.head?.ref,
    pullRequest?.base?.ref,
    issue?.title,
    issue?.body,
    payload.comment?.body,
  ];

  if (eventName === 'pull_request' && pullRequest?.number != null) {
    candidates.push(`#${pullRequest.number}`);
  }

  return uniqueTaskIds(candidates.flatMap(findTaskIdsInText));
}

function repositoryName(payload = {}) {
  const fullName = payload.repository?.full_name;
  if (fullName) return fullName;
  const owner = payload.repository?.owner?.login;
  const repo = payload.repository?.name;
  return owner && repo ? `${owner}/${repo}` : null;
}

function normalizeWebhookPr(payload = {}) {
  const pr = payload.pull_request || payload.issue || {};
  return normalizeLinkedPr({
    id: pr.node_id || pr.html_url || (pr.number != null ? `pr-${pr.number}` : null),
    number: pr.number,
    title: pr.title,
    url: pr.html_url,
    repository: repositoryName(payload),
    state: pr.merged_at ? 'merged' : pr.state,
    merged: Boolean(pr.merged_at || pr.merged),
    draft: Boolean(pr.draft),
    updated_at: pr.updated_at || payload.comment?.updated_at || payload.comment?.created_at,
    branch: pr.head?.ref,
    comment_url: payload.comment?.html_url,
    comment_author: payload.comment?.user?.login,
  });
}

module.exports = {
  TASK_ID_PATTERN,
  findTaskIdsInText,
  inferTaskIdsFromWebhook,
  normalizeWebhookPr,
  verifyGitHubWebhookSignature,
};
