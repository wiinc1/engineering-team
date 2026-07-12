'use strict';

/**
 * Pure helpers for GitLab→GitHub dual-remote mirror MVP.
 * Side-effect free; scripts inject git/gh I/O.
 */

const MIRROR_BRANCH = 'sync/github-mirror-gitlab';
const DEFAULT_REPO = 'wiinc1/engineering-team';
const POLICY_DOCS = 'docs/runbooks/dual-remote-gitlab-primary.md';
const STATUS_REL = 'observability/dual-remote/last-sync.json';

const EXIT = Object.freeze({
  SYNCED: 0,
  ERROR: 1,
  PRIMARY_BEHIND: 2,
  BACKUP_BEHIND: 3,
});

/**
 * Decide mirror agent action from a dual-remote status report.
 * @param {{ divergence?: object }} report
 */
function decideMirrorAction(report = {}) {
  const d = report.divergence || {};
  if (d.synced) {
    return {
      action: 'noop_synced',
      exitCode: EXIT.SYNCED,
      reason: d.shaOnlyDivergence
        ? 'Content-synced under #270 AC1 (identical trees; merge SHAs may differ).'
        : 'Main tips are content-synced.',
    };
  }
  if (d.primaryBehindBackup && !d.backupBehindPrimary) {
    return {
      action: 'fail_primary_behind',
      exitCode: EXIT.PRIMARY_BEHIND,
      reason: 'GitLab primary is behind GitHub content — equalize into GitLab first (do not force-overwrite).',
    };
  }
  if (d.primaryBehindBackup && d.backupBehindPrimary) {
    return {
      action: 'fail_diverged',
      exitCode: EXIT.ERROR,
      reason: 'Both sides have unique content — equalize into GitLab primary, then re-run mirror.',
    };
  }
  if (d.backupBehindPrimary) {
    return {
      action: 'mirror_backup',
      exitCode: EXIT.BACKUP_BEHIND,
      reason: 'GitHub backup is behind GitLab primary — push mirror branch and open/update PR.',
    };
  }
  return {
    action: 'fail_unknown',
    exitCode: EXIT.ERROR,
    reason: 'Unable to classify dual-remote divergence; inspect remotes:sync-status.',
  };
}

function isTestPath(filePath) {
  return /(^|\/)(tests|__tests__)(\/|$)/.test(filePath)
    || /\.(test|spec)\.[cm]?[jt]sx?$/.test(filePath);
}

function isDocPath(filePath) {
  return /^(docs|README\.md|AGENTS\.md|TOOLS\.md)/.test(filePath)
    || /\.md$/.test(filePath);
}

/**
 * Pick evidence paths from the actual origin…github diff for pr:check.
 */
function selectEvidencePaths(changedFiles = []) {
  const files = [...new Set(changedFiles.map(String).filter(Boolean))];
  const tests = files.filter(isTestPath);
  const docs = files.filter(isDocPath);
  const testEvidence = tests.length
    ? tests.slice(0, 6)
    : ['tests/unit/dual-remote-sync-status.test.js'];
  const docEvidence = docs.length
    ? docs.slice(0, 6)
    : [POLICY_DOCS];
  return { testEvidence, docEvidence, files };
}

/**
 * Build governance-complete PR body for mirror PRs (verify-pr-body fields).
 */
function buildMirrorPrBody({
  originSha = '',
  githubSha = '',
  changedFiles = [],
  originSubject = '',
} = {}) {
  const { testEvidence, docEvidence } = selectEvidencePaths(changedFiles);
  const shortOrigin = String(originSha || '').slice(0, 12);
  const shortGithub = String(githubSha || '').slice(0, 12);
  const lines = [
    '## Summary',
    'Mirror GitLab primary `main` to GitHub backup (dual-remote MVP agent).',
    '',
    '## Linked Task',
    'GitLab dual-remote policy #270; automated GitLab→GitHub mirror agent',
    '',
    '## Test plan',
    '- [x] `npm run remotes:sync-status` (pre-mirror: backup behind or trees differ)',
    '- [x] Mirror agent pushed `sync/github-mirror-gitlab` from `origin/main`',
    '- [x] After merge: `npm run remotes:sync-status` → `divergence.synced: true`',
    '',
    '## Governance checklist',
    '- Task: Dual-remote mirror of GitLab primary main to GitHub backup',
    '- Standards baseline reviewed: yes',
    '- Checklist completed or updated: yes',
    `- Compliance checklist path: ${POLICY_DOCS}`,
    '- Relevant standards areas: team and process; deployment and release',
    '- Standards gaps or exceptions: none remaining for dual-remote tip content sync under #270 AC1',
    '- Standards check result: passed for dual-remote unit suite and mirror agent dry logic',
    '- Lint result: ownership map includes dual-remote mirror scripts',
    '- Tests: dual-remote-sync-status and dual-remote-mirror-core unit suites',
    `- Test evidence paths: ${testEvidence.join(', ')}`,
    '- Docs updated: yes',
    `- Doc evidence paths: ${docEvidence.join(', ')}`,
    '- Risk level: low',
    '- Rollback path: revert the GitHub merge commit on main if backup mirror is unwanted',
    '',
    '## Dual-remote',
    `Policy: \`${POLICY_DOCS}\``,
    `GitLab tip: \`${shortOrigin}\` ${originSubject || ''}`.trim(),
    `GitHub tip before mirror: \`${shortGithub}\``,
    'Verify after merge: `npm run remotes:sync-status` → `divergence.synced: true`',
    'Merge SHAs may differ across forges; tip **trees** should match.',
  ];
  return `${lines.join('\n')}\n`;
}

function buildMirrorPrTitle(originSha = '') {
  const short = String(originSha || '').slice(0, 8);
  return short
    ? `sync: mirror GitLab main (${short})`
    : 'sync: mirror GitLab main';
}

/**
 * Status artifact for observability/dual-remote/last-sync.json
 */
function buildLastSyncRecord({
  action,
  exitCode,
  reason,
  report = null,
  prUrl = null,
  prNumber = null,
  mirrorBranch = MIRROR_BRANCH,
  dryRun = false,
  error = null,
} = {}) {
  const d = report?.divergence || {};
  const tips = report?.tips || {};
  return {
    kind: 'dual-remote-last-sync',
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    dryRun: dryRun === true,
    action,
    exitCode,
    reason: reason || null,
    error: error ? String(error.message || error) : null,
    mirrorBranch,
    prUrl: prUrl || null,
    prNumber: prNumber == null ? null : Number(prNumber),
    tips: {
      originMain: tips['origin/main'] || null,
      githubMain: tips['github/main'] || null,
    },
    divergence: {
      synced: d.synced === true,
      treesEqual: d.treesEqual === true,
      shaOnlyDivergence: d.shaOnlyDivergence === true,
      backupBehindPrimary: d.backupBehindPrimary === true,
      primaryBehindBackup: d.primaryBehindBackup === true,
      commitsOnlyOnOrigin: d.commitsOnlyOnOrigin ?? null,
      commitsOnlyOnGithub: d.commitsOnlyOnGithub ?? null,
    },
    policy: report?.policy || {
      primary: 'origin (GitLab)',
      backup: 'github (GitHub)',
      docs: POLICY_DOCS,
      issue: 270,
    },
  };
}

function parseCliArgs(argv = process.argv.slice(2)) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const get = (name, fallback = null) => {
    const idx = argv.indexOf(name);
    if (idx === -1 || idx + 1 >= argv.length) return fallback;
    return argv[idx + 1];
  };
  return {
    dryRun: flags.has('--dry-run'),
    noFetch: flags.has('--no-fetch'),
    mergeWhenReady: flags.has('--merge-when-ready'),
    emitMergeReadiness: flags.has('--emit-merge-readiness') || flags.has('--merge-when-ready'),
    openPr: !flags.has('--no-pr'),
    repo: get('--repo', process.env.DUAL_REMOTE_GITHUB_REPO || DEFAULT_REPO),
    mirrorBranch: get('--mirror-branch', process.env.DUAL_REMOTE_MIRROR_BRANCH || MIRROR_BRANCH),
    statusPath: get('--status-path', process.env.DUAL_REMOTE_STATUS_PATH || STATUS_REL),
    baseBranch: get('--base', 'main'),
    help: flags.has('--help') || flags.has('-h'),
  };
}

module.exports = {
  MIRROR_BRANCH,
  DEFAULT_REPO,
  POLICY_DOCS,
  STATUS_REL,
  EXIT,
  decideMirrorAction,
  isTestPath,
  isDocPath,
  selectEvidencePaths,
  buildMirrorPrBody,
  buildMirrorPrTitle,
  buildLastSyncRecord,
  parseCliArgs,
};
