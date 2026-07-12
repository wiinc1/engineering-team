#!/usr/bin/env node
'use strict';

/**
 * Dual-remote mirror agent: GitLab origin/main → GitHub backup (E2E automation).
 *
 * Exit codes (aligned with dual-remote-sync-status.js):
 *   0 synced / merged-synced
 *   1 error / diverged
 *   2 primary behind backup
 *   3 backup behind (mirror in progress / waiting CI / timed out)
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
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
const {
  isMirrorHeadStale,
  shouldForcePushMirror,
} = require('../lib/task-platform/dual-remote-mirror-wait');
const {
  runGit,
  runGh,
  waitAndMerge,
  snapshotMergeWhenReady,
} = require('../lib/task-platform/dual-remote-mirror-ops');

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

function acquireLock(lockPathRel) {
  const abs = path.resolve(process.cwd(), lockPathRel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  try {
    const fd = fs.openSync(abs, 'wx');
    fs.writeFileSync(fd, `${JSON.stringify({ pid: process.pid, at: new Date().toISOString() })}\n`);
    fs.closeSync(fd);
    return { ok: true, path: abs };
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      try {
        const raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
        return { ok: false, path: abs, holder: raw };
      } catch {
        return { ok: false, path: abs, holder: null };
      }
    }
    throw error;
  }
}

function releaseLock(lockPathRel) {
  const abs = path.resolve(process.cwd(), lockPathRel);
  try {
    fs.unlinkSync(abs);
  } catch {
    // ignore
  }
}

function findOpenMirrorPr(repo, mirrorBranch) {
  try {
    const raw = runGh([
      'pr', 'list',
      '--repo', repo,
      '--head', mirrorBranch,
      '--base', 'main',
      '--state', 'open',
      '--json', 'number,url,title,headRefOid,statusCheckRollup',
    ]);
    const list = JSON.parse(raw || '[]');
    return Array.isArray(list) && list[0] ? list[0] : null;
  } catch {
    return null;
  }
}

function pushMirrorBranch({ mirrorBranch, dryRun }) {
  const args = ['push', '--force-with-lease', 'github', `origin/main:refs/heads/${mirrorBranch}`];
  if (dryRun) return { dryRun: true, args };
  runGit(args);
  return { dryRun: false, args };
}

function openOrUpdatePr({ repo, mirrorBranch, body, title, dryRun }) {
  const existing = findOpenMirrorPr(repo, mirrorBranch);
  if (dryRun) {
    return {
      dryRun: true,
      prNumber: existing?.number || null,
      prUrl: existing?.url || null,
      created: !existing,
      headRefOid: existing?.headRefOid || null,
    };
  }
  if (existing?.number) {
    runGh(['pr', 'edit', String(existing.number), '--repo', repo, '--title', title, '--body', body]);
    return {
      dryRun: false,
      prNumber: existing.number,
      prUrl: existing.url,
      created: false,
      headRefOid: existing.headRefOid || null,
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
    headRefOid: null,
  };
}

function runPreflight(opts) {
  if (opts.skipPreflight || opts.dryRun) return { ok: true, skipped: true };
  const checks = [];
  try {
    const maint = spawnSync(process.execPath, ['scripts/check-maintainability.js'], {
      encoding: 'utf8',
      cwd: process.cwd(),
      env: process.env,
    });
    checks.push({
      name: 'maintainability',
      ok: maint.status === 0,
      detail: (maint.stderr || maint.stdout || '').split('\n').slice(-5).join(' | '),
    });
  } catch (error) {
    checks.push({ name: 'maintainability', ok: false, detail: error.message });
  }
  try {
    const own = spawnSync('npm', ['run', 'ownership:lint'], {
      encoding: 'utf8',
      cwd: process.cwd(),
      env: process.env,
    });
    checks.push({
      name: 'ownership:lint',
      ok: own.status === 0,
      detail: (own.stderr || own.stdout || '').split('\n').slice(-3).join(' | '),
    });
  } catch (error) {
    checks.push({ name: 'ownership:lint', ok: false, detail: error.message });
  }
  const failed = checks.filter((c) => !c.ok);
  return {
    ok: failed.length === 0,
    checks,
    error: failed.length ? failed.map((f) => `${f.name}: ${f.detail}`).join('; ') : null,
  };
}

function ciInProgress(rollup = []) {
  return (rollup || []).some((c) => c.status && c.status !== 'COMPLETED');
}

function printUsage() {
  process.stdout.write(`Usage: node scripts/dual-remote-mirror-github.js [options]

Options:
  --dry-run              Plan only; no push/PR/merge
  --no-fetch             Skip git fetch origin/github
  --no-pr                Push mirror branch only (no PR)
  --merge-when-ready     Wait for CI, post Merge readiness, merge
  --no-wait              With --merge-when-ready, only snapshot (legacy)
  --skip-preflight       Skip maintainability/ownership preflight
  --wait-timeout-ms N    CI wait timeout (default 1500000)
  --wait-interval-ms N   Poll interval (default 45000)
  --repo owner/name      GitHub repo
  --mirror-branch name   Backup branch
  --status-path path     Status JSON
  --lock-path path       Single-flight lock file
  --help                 Show help

Exit: 0 synced · 2 primary behind · 3 backup behind · 1 error
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

function buildMirrorArtifacts(report) {
  const originFull = report.tips?.['origin/main']?.fullSha || '';
  const githubFull = report.tips?.['github/main']?.fullSha || '';
  const originSubject = report.tips?.['origin/main']?.subject || '';
  const files = changedFilesBetween('github/main', 'origin/main');
  return {
    originFull,
    githubFull,
    originSubject,
    files,
    body: buildMirrorPrBody({
      originSha: originFull,
      githubSha: githubFull,
      changedFiles: files,
      originSubject,
    }),
    title: buildMirrorPrTitle(originFull),
    evidence: selectEvidencePaths(files),
  };
}

async function runPushPrMerge(opts, arts, pushGate) {
  let pushResult;
  if (pushGate.allow) {
    pushResult = pushMirrorBranch({ mirrorBranch: opts.mirrorBranch, dryRun: opts.dryRun });
  } else {
    pushResult = { dryRun: opts.dryRun, skipped: true, reason: pushGate.reason };
  }
  let prResult = null;
  if (opts.openPr) {
    prResult = openOrUpdatePr({
      repo: opts.repo,
      mirrorBranch: opts.mirrorBranch,
      body: arts.body,
      title: arts.title,
      dryRun: opts.dryRun,
    });
  }
  let mergeResult = null;
  if (opts.mergeWhenReady && prResult?.prNumber && !opts.dryRun) {
    mergeResult = opts.noWait
      ? snapshotMergeWhenReady(opts.repo, prResult.prNumber)
      : await waitAndMerge(opts.repo, prResult.prNumber, opts);
  }
  return { pushResult, prResult, mergeResult };
}

async function executeMirrorSteps(opts, report, decision) {
  const arts = buildMirrorArtifacts(report);
  const existing = findOpenMirrorPr(opts.repo, opts.mirrorBranch);
  const pushGate = shouldForcePushMirror({
    hasOpenPr: Boolean(existing?.number),
    headStale: isMirrorHeadStale(arts.originFull, existing?.headRefOid),
    ciInProgress: ciInProgress(existing?.statusCheckRollup || []),
  });
  let pushResult = null;
  let prResult = null;
  let mergeResult = null;
  let preflight = null;
  let error = null;
  try {
    preflight = runPreflight(opts);
    if (!preflight.ok) throw new Error(`preflight failed: ${preflight.error}`);
    ({ pushResult, prResult, mergeResult } = await runPushPrMerge(opts, arts, pushGate));
  } catch (err) {
    error = err;
  }
  return {
    ...arts, pushResult, prResult, mergeResult, preflight, pushGate, error, decision, report,
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
      finalExit = EXIT.SYNCED;
    }
  } else if (!ctx.error && ctx.mergeResult && ctx.mergeResult.merged === false) {
    finalAction = ctx.mergeResult.reason?.includes('Timed out')
      ? 'mirror_wait_timeout'
      : 'mirror_wait_pending';
    finalExit = EXIT.BACKUP_BEHIND;
  }
  if (ctx.error) finalExit = EXIT.ERROR;
  const record = buildLastSyncRecord({
    action: finalAction,
    exitCode: finalExit,
    reason: ctx.error
      ? ctx.error.message
      : `${ctx.decision.reason} PR ${ctx.prResult?.prUrl || '(none)'}; merge=${ctx.mergeResult?.merged === true}`,
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
  record.preflight = ctx.preflight;
  record.pushGate = ctx.pushGate;
  record.changedFileCount = ctx.files.length;
  record.evidence = ctx.evidence;
  emitStatus(record, opts.statusPath);
}

async function main() {
  const opts = parseCliArgs(process.argv.slice(2));
  if (opts.help) {
    printUsage();
    return;
  }
  const lock = acquireLock(opts.lockPath);
  if (!lock.ok) {
    emitStatus(buildLastSyncRecord({
      action: 'lock_busy',
      exitCode: EXIT.ERROR,
      reason: `Another mirror agent holds lock ${lock.path}`,
      dryRun: opts.dryRun,
    }), opts.statusPath);
    return;
  }
  try {
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
    const ctx = await executeMirrorSteps(opts, report, decision);
    finalizeMirrorResult(ctx, opts);
  } finally {
    releaseLock(opts.lockPath);
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = EXIT.ERROR;
  });
}

module.exports = {
  main,
  pushMirrorBranch,
  openOrUpdatePr,
  waitAndMerge,
  changedFilesBetween,
  writeStatus,
  runPreflight,
  acquireLock,
  releaseLock,
};
