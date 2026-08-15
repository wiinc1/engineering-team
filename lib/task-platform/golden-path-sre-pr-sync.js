'use strict';

const crypto = require('node:crypto');

function resolveSrePullRequest({ etTaskId, hasPrTarget, prNumber, prUrl, mergeCommitSha, repository }) {
  const syncedAt = new Date().toISOString();
  const number = hasPrTarget ? prNumber : 900000 + (Number(String(etTaskId).replace(/\D/g, '').slice(-5)) || 1);
  const url = hasPrTarget ? prUrl : `https://github.com/${repository || 'wiinc1/engineering-team'}/pull/${number}`;
  const sha = hasPrTarget ? mergeCommitSha : (
    mergeCommitSha && String(mergeCommitSha).length === 40
      ? mergeCommitSha
      : crypto.createHash('sha1').update(`local-sre-pr:${etTaskId}:${syncedAt}`).digest('hex')
  );
  return { syncedAt, number, url, sha, repository: repository || 'wiinc1/engineering-team' };
}

async function syncSrePullRequest({ ctx, apiSend, etTaskId, hasPrTarget, title, ...target }) {
  const pr = resolveSrePullRequest({ etTaskId, hasPrTarget, ...target });
  return apiSend(ctx, `/tasks/${encodeURIComponent(etTaskId)}/events`, 'POST', ['admin'], {
    eventType: 'task.github_pr_synced',
    actorType: 'agent',
    idempotencyKey: `golden-path:pr-merged:${etTaskId}:${String(pr.sha).slice(0, 12)}`,
    payload: {
      pr_number: pr.number,
      pr_title: title,
      state: 'closed',
      pr_state: 'merged',
      pr_merged: true,
      pr_repository: pr.repository,
      merge_commit_sha: pr.sha,
      pr_url: pr.url,
      pr_updated_at: pr.syncedAt,
      linked_prs: [{
        number: pr.number, url: pr.url, title, repository: pr.repository,
        state: 'merged', merged: true, updated_at: pr.syncedAt,
      }],
      local_proof_synthetic_pr: !hasPrTarget,
    },
  });
}

module.exports = { resolveSrePullRequest, syncSrePullRequest };
