#!/usr/bin/env node
const {
  createGitHubCheckRunClient,
  buildMergeReadinessCheckRunPayload,
} = require('../lib/task-platform/merge-readiness-github-check');

function usage() {
  process.stderr.write('usage: emit-merge-readiness-check <owner/repo> <head-sha> [conclusion]\n');
  process.exit(1);
}

async function main() {
  const [repository, headSha, conclusion = 'success'] = process.argv.slice(2);
  if (!repository || !headSha) usage();
  if (!['success', 'failure', 'neutral'].includes(conclusion)) {
    process.stderr.write(`invalid conclusion: ${conclusion}\n`);
    process.exit(1);
  }

  const github = createGitHubCheckRunClient({ token: process.env.GITHUB_TOKEN });
  const review = {
    reviewId: `manual-${headSha.slice(0, 12)}`,
    repository,
    commitSha: headSha,
    reviewStatus: conclusion === 'success' ? 'passed' : 'blocked',
    isCurrent: true,
  };
  const payload = buildMergeReadinessCheckRunPayload({
    review,
    commitSha: headSha,
    completedAt: new Date().toISOString(),
    detailsUrl: process.env.MERGE_READINESS_DETAILS_URL || undefined,
  });

  const result = await github.createCheckRun({ repository, payload });
  process.stdout.write(`${JSON.stringify({
    repository,
    headSha,
    checkRunId: result.id,
    htmlUrl: result.html_url,
    conclusion: payload.conclusion,
    status: payload.status,
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});