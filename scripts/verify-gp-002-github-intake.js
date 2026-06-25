#!/usr/bin/env node
const { runGp002GithubIntakeVerify } = require('../lib/audit/gp-002-github-intake-verify');

function readArg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 || index === process.argv.length - 1 ? fallback : process.argv[index + 1];
}

runGp002GithubIntakeVerify({
  baseUrl: readArg('--base-url'),
  jwtSecret: readArg('--jwt-secret'),
  githubWebhookSecret: readArg('--webhook-secret'),
  outputDir: readArg('--output-dir', process.env.GP_002_EVIDENCE_DIR || 'observability/gp-002-staging'),
  stackStatePath: readArg('--stack-state'),
  issueNumber: readArg('--issue-number'),
  waitMs: readArg('--wait-ms'),
  maxAttempts: readArg('--max-attempts'),
  hosted: process.argv.includes('--hosted'),
})
  .then(({ evidence, complete }) => {
    process.stdout.write(`${JSON.stringify({
      ok: evidence.summary.passed,
      milestone: 'GP-002',
      title: 'Forge issue intake normalizer (GitLab default)',
      outputDir: evidence.outputDir,
      summary: evidence.summary,
      complete: complete.summary,
      artifacts: evidence.artifacts,
    }, null, 2)}\n`);
    if (!evidence.summary.passed) process.exitCode = 1;
  })
  .catch((error) => {
    process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
    process.exitCode = 1;
  });