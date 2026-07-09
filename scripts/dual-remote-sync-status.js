#!/usr/bin/env node
/**
 * Report dual-remote health: GitLab (origin) is primary, GitHub is backup.
 */
const { execFileSync } = require('node:child_process');

function run(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function safe(args, fallback = '') {
  try {
    return run(args);
  } catch {
    return fallback;
  }
}

function remediationFor(onlyOrigin, onlyGithub) {
  if (onlyGithub > 0) {
    return [
      'GitLab primary is behind GitHub backup.',
      'Push github/main to origin as sync/gitlab-primary-main and merge the GitLab MR into main.',
      'See docs/runbooks/dual-remote-gitlab-primary.md',
    ];
  }
  if (onlyOrigin > 0) {
    return [
      'GitHub backup is behind GitLab primary.',
      'Open/merge a GitHub PR from the GitLab tip, or push origin/main tip to a github branch and PR.',
    ];
  }
  return ['Remotes are content-synced at main tips (SHAs may still differ if merge commits differ).'];
}

function main() {
  safe(['fetch', 'origin']);
  safe(['fetch', 'github']);
  const originMain = safe(['rev-parse', '--short', 'origin/main'], '(missing)');
  const githubMain = safe(['rev-parse', '--short', 'github/main'], '(missing)');
  const originTip = safe(['log', '-1', '--oneline', 'origin/main'], '');
  const githubTip = safe(['log', '-1', '--oneline', 'github/main'], '');
  const counts = safe(['rev-list', '--left-right', '--count', 'origin/main...github/main'], '0\t0');
  const [onlyOrigin, onlyGithub] = counts.split(/\s+/).map((n) => Number(n) || 0);
  const originAhead = safe(['log', '--oneline', 'github/main..origin/main']);
  const githubAhead = safe(['log', '--oneline', 'origin/main..github/main']);
  const report = {
    policy: {
      primary: 'origin (GitLab)',
      backup: 'github (GitHub)',
      docs: 'docs/runbooks/dual-remote-gitlab-primary.md',
    },
    tips: {
      'origin/main': { sha: originMain, subject: originTip },
      'github/main': { sha: githubMain, subject: githubTip },
    },
    divergence: {
      commitsOnlyOnOrigin: onlyOrigin,
      commitsOnlyOnGithub: onlyGithub,
      synced: onlyOrigin === 0 && onlyGithub === 0,
      primaryBehindBackup: onlyGithub > 0,
      backupBehindPrimary: onlyOrigin > 0,
    },
    onlyOnOrigin: originAhead ? originAhead.split('\n').filter(Boolean).slice(0, 15) : [],
    onlyOnGithub: githubAhead ? githubAhead.split('\n').filter(Boolean).slice(0, 15) : [],
    remediation: remediationFor(onlyOrigin, onlyGithub),
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.divergence.primaryBehindBackup) process.exitCode = 2;
  else if (report.divergence.backupBehindPrimary) process.exitCode = 3;
}

main();
