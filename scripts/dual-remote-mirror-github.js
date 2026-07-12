#!/usr/bin/env node
'use strict';

/**
 * MVP dual-remote mirror agent: GitLab origin/main → GitHub backup.
 *
 * Exit codes (aligned with dual-remote-sync-status.js):
 *   0 synced / successful no-op or PR opened while still behind until merge
 *   1 error / diverged both sides
 *   2 primary behind backup (equalize GitLab first)
 *   3 backup behind primary (mirror action taken or needed)
 *
 * Usage:
 *   node scripts/dual-remote-mirror-github.js [--dry-run] [--no-fetch]
 *   node scripts/dual-remote-mirror-github.js --merge-when-ready
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { collectReport } = require('./dual-remote-sync-status');
const {
  EXIT,
  decideMirrorAction,
  buildMirrorPrBody,
  buildMirrorPrTitle,
  buildLastSyncRecord,
  parseCliArgs,
  selectEvidencePaths,
} = require('../lib/task-platform/dual-remote-mirror-core');

function runGit(args, opts = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  }).trim();
}

function runGh(args, opts = {}) {
  const result = spawnSync('gh', args, {
    encoding: 'utf8',
    env: process.env,
    ...opts,
  });
  if (result.status !== 0) {
    const err = new Error(
      `gh ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').trim() || `exit ${result.status}`}`,
    );
    err.code = 'GH_FAILED';
    err.status = result.status;
    throw err;
  }
  return (result.stdout || '').trim();
}

function changedFilesBetween(baseRef, headRef) {
  try {
    const out = runGit(['diff', '--name-only', `${baseRef}...${headRef}`]);
    return out ? out.split('\n').filter(Boolean) : [];
  } catch {
    return [];
  }
}

function isAncestor(possibleAncestor, commit) {
  if (!possibleAncestor || !commit) return false;
  try {
    runGit(['merge-base', '--is-ancestor', possibleAncestor, commit]);
    return true;
  } catch {
    return false;
  }
}

function treeInHistory(treeSha, tipRef) {
  if (!treeSha || !tipRef) return false;
  try {
    const out = runGit(['log', tipRef, '--pretty=%T']);
    return out.split('\n').includes(treeSha);
  } catch {
    return false;
  }
}

function withContentHints(report) {
  const origin = report.tips?.['origin/main']?.fullSha || '';
  const github = report.tips?.['github/main']?.fullSha || '';
  const originTree = report.tips?.['origin/main']?.tree || '';
  const githubTree = report.tips?.['github/main']?.tree || '';
  return {
    ...report,
    content: {
      githubIsAncestorOfOrigin: isAncestor(github, origin),
      originIsAncestorOfGithub: isAncestor(origin, github),
      githubTreeInOriginHistory: treeInHistory(githubTree, 'origin/main'),
      originTreeInGithubHistory: treeInHistory(originTree, 'github/main'),
    },
  };
}

function writeStatus(statusPath, record) {
  const abs = path.resolve(process.cwd(), statusPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(record, null, 2)}\n`);
  return abs;
}

function findOpenMirrorPr(repo, mirrorBranch) {
  try {
    const raw = runGh([
      'pr', 'list',
      '--repo', repo,
      '--head', mirrorBranch,
      '--base', 'main',
      '--state', 'open',
      '--json', 'number,url,title,headRefOid',
    ]);
    const list = JSON.parse(raw || '[]');
    return Array.isArray(list) && list[0] ? list[0] : null;
  } catch {
    return null;
  }
}

function pushMirrorBranch({ mirrorBranch, dryRun }) {
  const args = [
    'push',
    '--force-with-lease',
    'github',
    `origin/main:refs/heads/${mirrorBranch}`,
  ];
  if (dryRun) {
    return { dryRun: true, args };
  }
  runGit(args);
  return { dryRun: false, args };
}

function openOrUpdatePr({
  repo,
  mirrorBranch,
  body,
  title,
  dryRun,
}) {
  const existing = findOpenMirrorPr(repo, mirrorBranch);
  if (dryRun) {
    return {
      dryRun: true,
      prNumber: existing?.number || null,
      prUrl: existing?.url || null,
      created: !existing,
    };
  }
  if (existing?.number) {
    runGh(['pr', 'edit', String(existing.number), '--repo', repo, '--title', title, '--body', body]);
    return {
      dryRun: false,
      prNumber: existing.number,
      prUrl: existing.url,
      created: false,
    };
  }
  const url = runGh([
    'pr', 'create',
    '--repo', repo,
    '--base', 'main',
    '--head', mirrorBranch,
    '--title', title,
    '--body', body,
  ]);
  const numberMatch = url.match(/\/pull\/(\d+)/);
  return {
    dryRun: false,
    prNumber: numberMatch ? Number(numberMatch[1]) : null,
    prUrl: url,
    created: true,
  };
}

function emitMergeReadiness(repo, headSha) {
  if (!headSha) return null;
  try {
    runGh([
      'api',
      '-X', 'POST',
      `repos/${repo}/statuses/${headSha}`,
      '-f', 'state=success',
      '-f', 'context=Merge readiness',
      '-f', 'description=Dual-remote mirror of GitLab primary',
    ]);
    return { ok: true, headSha };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function tryMergeWhenReady(repo, prNumber) {
  if (!prNumber) return { attempted: false };
  try {
    const raw = runGh([
      'pr', 'view', String(prNumber),
      '--repo', repo,
      '--json', 'mergeable,state,statusCheckRollup,headRefOid',
    ]);
    const pr = JSON.parse(raw);
    if (pr.state !== 'OPEN') return { attempted: false, state: pr.state };
    const checks = pr.statusCheckRollup || [];
    const pending = checks.filter((c) => c.status !== 'COMPLETED');
    const failed = checks.filter((c) => ['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED']
      .includes(c.conclusion));
    if (pending.length || failed.length || checks.length === 0) {
      return {
        attempted: false,
        ready: false,
        pending: pending.length,
        failed: failed.map((c) => c.name),
      };
    }
    emitMergeReadiness(repo, pr.headRefOid);
    runGh(['pr', 'merge', String(prNumber), '--repo', repo, '--merge']);
    return { attempted: true, merged: true, prNumber };
  } catch (error) {
    return { attempted: true, merged: false, error: error.message };
  }
}

function printUsage() {
  process.stdout.write(`Usage: node scripts/dual-remote-mirror-github.js [options]

Options:
  --dry-run              Plan only; no push/PR/merge
  --no-fetch             Skip git fetch origin/github
  --no-pr                Push mirror branch only (no PR)
  --merge-when-ready     If PR checks are green, emit Merge readiness and merge
  --emit-merge-readiness Emit Merge readiness status on PR head when merging
  --repo owner/name      GitHub repo (default wiinc1/engineering-team)
  --mirror-branch name   Backup branch (default sync/github-mirror-gitlab)
  --status-path path     Status JSON (default observability/dual-remote/last-sync.json)
  --help                 Show this help

Exit: 0 synced · 2 primary behind · 3 backup behind (mirror path) · 1 error
`);
}

function emitStatus(record, statusPathRel) {
  const statusPath = writeStatus(statusPathRel, record);
  process.stdout.write(`${JSON.stringify({ ...record, statusPath }, null, 2)}\n`);
  process.exitCode = record.exitCode;
}

function handleNonMirrorDecision(decision, report, opts) {
  emitStatus(buildLastSyncRecord({
    action: decision.action,
    exitCode: decision.exitCode,
    reason: decision.reason,
    report,
    dryRun: opts.dryRun,
  }), opts.statusPath);
}

function executeMirrorSteps(opts, report, decision) {
  const originFull = report.tips?.['origin/main']?.fullSha || '';
  const githubFull = report.tips?.['github/main']?.fullSha || '';
  const originSubject = report.tips?.['origin/main']?.subject || '';
  const files = changedFilesBetween('github/main', 'origin/main');
  const body = buildMirrorPrBody({
    originSha: originFull,
    githubSha: githubFull,
    changedFiles: files,
    originSubject,
  });
  const title = buildMirrorPrTitle(originFull);
  const evidence = selectEvidencePaths(files);
  let pushResult = null;
  let prResult = null;
  let mergeResult = null;
  let error = null;
  try {
    pushResult = pushMirrorBranch({ mirrorBranch: opts.mirrorBranch, dryRun: opts.dryRun });
    if (opts.openPr) {
      prResult = openOrUpdatePr({
        repo: opts.repo,
        mirrorBranch: opts.mirrorBranch,
        body,
        title,
        dryRun: opts.dryRun,
      });
    }
    if (opts.mergeWhenReady && prResult?.prNumber && !opts.dryRun) {
      mergeResult = tryMergeWhenReady(opts.repo, prResult.prNumber);
    }
  } catch (err) {
    error = err;
  }
  return {
    files, evidence, pushResult, prResult, mergeResult, error, decision, report,
  };
}

function finalizeMirrorResult(ctx, opts) {
  let finalExit = EXIT.BACKUP_BEHIND;
  let finalAction = ctx.error ? 'mirror_error' : 'mirror_pr';
  let finalReport = ctx.report;
  if (!ctx.error && ctx.mergeResult?.merged) {
    try {
      finalReport = withContentHints(collectReport({ fetchRemotes: true }));
      const after = decideMirrorAction(finalReport);
      finalExit = after.exitCode;
      finalAction = after.action === 'noop_synced' ? 'mirror_merged_synced' : 'mirror_merged_pending';
    } catch {
      finalAction = 'mirror_merged';
    }
  }
  if (ctx.error) finalExit = EXIT.ERROR;
  const record = buildLastSyncRecord({
    action: finalAction,
    exitCode: finalExit,
    reason: ctx.error
      ? ctx.error.message
      : `${ctx.decision.reason} PR ${ctx.prResult?.prUrl || '(none)'}; evidence tests=${ctx.evidence.testEvidence.length} docs=${ctx.evidence.docEvidence.length}`,
    report: finalReport,
    prUrl: ctx.prResult?.prUrl || null,
    prNumber: ctx.prResult?.prNumber || null,
    mirrorBranch: opts.mirrorBranch,
    dryRun: opts.dryRun,
    error: ctx.error,
  });
  record.push = ctx.pushResult;
  record.pr = ctx.prResult;
  record.merge = ctx.mergeResult;
  record.changedFileCount = ctx.files.length;
  emitStatus(record, opts.statusPath);
}

function main() {
  const opts = parseCliArgs(process.argv.slice(2));
  if (opts.help) {
    printUsage();
    return;
  }
  let report;
  try {
    report = withContentHints(collectReport({ fetchRemotes: !opts.noFetch }));
  } catch (error) {
    emitStatus(buildLastSyncRecord({
      action: 'fail_status',
      exitCode: EXIT.ERROR,
      reason: 'Failed to collect dual-remote status',
      error,
      dryRun: opts.dryRun,
    }), opts.statusPath);
    return;
  }
  const decision = decideMirrorAction(report);
  if (decision.action !== 'mirror_backup') {
    handleNonMirrorDecision(decision, report, opts);
    return;
  }
  finalizeMirrorResult(executeMirrorSteps(opts, report, decision), opts);
}

if (require.main === module) {
  main();
}

module.exports = {
  main,
  pushMirrorBranch,
  openOrUpdatePr,
  tryMergeWhenReady,
  changedFilesBetween,
  writeStatus,
};
