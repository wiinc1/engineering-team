#!/usr/bin/env node
const {
  createGitHubBranchProtectionClient,
  verifyMergeReadinessBranchProtection,
} = require('../lib/task-platform/merge-readiness-branch-protection');

async function main() {
  const repository = process.argv[2] || process.env.GITHUB_REPOSITORY;
  const branch = process.argv[3] || process.env.GITHUB_DEFAULT_BRANCH || 'main';
  if (!repository) {
    process.stderr.write('usage: verify-merge-readiness-branch-protection <owner/repo> [branch]\n');
    process.exit(2);
  }
  const github = createGitHubBranchProtectionClient({});
  const result = await verifyMergeReadinessBranchProtection({ github, repository, branch });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== 'enforced') process.exit(1);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
