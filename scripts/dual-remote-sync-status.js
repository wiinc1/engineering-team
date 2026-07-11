#!/usr/bin/env node
/**
 * Report dual-remote health: GitLab (origin) is primary, GitHub is backup.
 *
 * GitLab #270 AC1 bar:
 * - synced when zero unique commits on either side, OR
 * - trees are identical at main tips even if merge-commit SHAs differ (SHA-only divergence).
 */
const { execFileSync } = require('node:child_process');

function run(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf8', ...opts }).trim();
}

function safe(args, fallback = '') {
  try {
    return run(args);
  } catch {
    return fallback;
  }
}

function parseLeftRightCount(counts) {
  const [left, right] = String(counts || '0\t0').split(/\s+/).map((n) => Number(n) || 0);
  return { onlyOrigin: left, onlyGithub: right };
}

/**
 * Pure evaluation of #270 dual-remote sync bar.
 * @param {{ onlyOrigin: number, onlyGithub: number, originTree: string, githubTree: string }} input
 */
function evaluateDualRemoteSync(input = {}) {
  const onlyOrigin = Number(input.onlyOrigin) || 0;
  const onlyGithub = Number(input.onlyGithub) || 0;
  const originTree = String(input.originTree || '').trim();
  const githubTree = String(input.githubTree || '').trim();
  const treesComparable = Boolean(originTree && githubTree);
  const treesEqual = treesComparable && originTree === githubTree;
  const commitSynced = onlyOrigin === 0 && onlyGithub === 0;
  const shaOnlyDivergence = !commitSynced && treesEqual;
  // #270 AC1: synced commits OR intentional SHA-only differences with identical trees
  const synced = commitSynced || treesEqual;
  return {
    commitsOnlyOnOrigin: onlyOrigin,
    commitsOnlyOnGithub: onlyGithub,
    commitSynced,
    treesEqual,
    treesComparable,
    shaOnlyDivergence,
    synced,
    primaryBehindBackup: onlyGithub > 0 && !treesEqual,
    backupBehindPrimary: onlyOrigin > 0 && !treesEqual,
    issue270Bar: 'synced when commit sets match OR main tip trees are identical (SHA-only merge commits allowed)',
  };
}

function remediationFor(divergence) {
  if (divergence.synced && divergence.shaOnlyDivergence) {
    return [
      'Remotes are content-synced under GitLab #270 AC1 (identical trees; merge-commit SHAs differ).',
      'No content mirror required. Optional: leave SHA-only differences as intentional forge-local merge commits.',
      'See docs/runbooks/dual-remote-gitlab-primary.md',
    ];
  }
  if (divergence.synced) {
    return ['Remotes are content-synced at main tips (SHAs may still differ if merge commits differ).'];
  }
  if (divergence.commitsOnlyOnGithub > 0 && divergence.commitsOnlyOnOrigin > 0) {
    return [
      'Both sides have unique commits and tip trees differ.',
      'Equalize into GitLab primary: merge github/main into a sync branch on origin, MR → main, then mirror origin/main to GitHub.',
      'See docs/runbooks/dual-remote-gitlab-primary.md',
    ];
  }
  if (divergence.commitsOnlyOnGithub > 0) {
    return [
      'GitLab primary is behind GitHub backup (content or unique commits).',
      'Push github/main to origin as sync/gitlab-primary-main and merge the GitLab MR into main.',
      'See docs/runbooks/dual-remote-gitlab-primary.md',
    ];
  }
  if (divergence.commitsOnlyOnOrigin > 0) {
    return [
      'GitHub backup is behind GitLab primary.',
      'Open/merge a GitHub PR from the GitLab tip, or push origin/main tip to a github branch and PR.',
      'See docs/runbooks/dual-remote-gitlab-primary.md',
    ];
  }
  return ['Inspect trees and tips; see docs/runbooks/dual-remote-gitlab-primary.md'];
}

function collectReport({ fetchRemotes = true } = {}) {
  if (fetchRemotes) {
    safe(['fetch', 'origin']);
    safe(['fetch', 'github']);
  }
  const originMain = safe(['rev-parse', '--short', 'origin/main'], '(missing)');
  const githubMain = safe(['rev-parse', '--short', 'github/main'], '(missing)');
  const originFull = safe(['rev-parse', 'origin/main'], '');
  const githubFull = safe(['rev-parse', 'github/main'], '');
  const originTip = safe(['log', '-1', '--oneline', 'origin/main'], '');
  const githubTip = safe(['log', '-1', '--oneline', 'github/main'], '');
  const originTree = safe(['rev-parse', 'origin/main^{tree}'], '');
  const githubTree = safe(['rev-parse', 'github/main^{tree}'], '');
  const counts = safe(['rev-list', '--left-right', '--count', 'origin/main...github/main'], '0\t0');
  const { onlyOrigin, onlyGithub } = parseLeftRightCount(counts);
  const originAhead = safe(['log', '--oneline', 'github/main..origin/main']);
  const githubAhead = safe(['log', '--oneline', 'origin/main..github/main']);
  const divergence = evaluateDualRemoteSync({
    onlyOrigin,
    onlyGithub,
    originTree,
    githubTree,
  });
  return {
    policy: {
      primary: 'origin (GitLab)',
      backup: 'github (GitHub)',
      docs: 'docs/runbooks/dual-remote-gitlab-primary.md',
      issue: 270,
    },
    tips: {
      'origin/main': {
        sha: originMain,
        fullSha: originFull || null,
        subject: originTip,
        tree: originTree || null,
      },
      'github/main': {
        sha: githubMain,
        fullSha: githubFull || null,
        subject: githubTip,
        tree: githubTree || null,
      },
    },
    divergence,
    onlyOnOrigin: originAhead ? originAhead.split('\n').filter(Boolean).slice(0, 15) : [],
    onlyOnGithub: githubAhead ? githubAhead.split('\n').filter(Boolean).slice(0, 15) : [],
    remediation: remediationFor(divergence),
  };
}

function main() {
  const report = collectReport({ fetchRemotes: true });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.divergence.synced) {
    if (report.divergence.primaryBehindBackup) process.exitCode = 2;
    else if (report.divergence.backupBehindPrimary) process.exitCode = 3;
    else process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  evaluateDualRemoteSync,
  parseLeftRightCount,
  remediationFor,
  collectReport,
  main,
};
