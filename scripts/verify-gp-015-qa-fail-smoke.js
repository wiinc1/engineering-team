#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { readArg, authHeaders, writeEvidence } = require('./golden-path-smoke-lib');

async function main() {
  const argv = process.argv;
  const baseUrl = readArg(argv, '--base-url', process.env.AUDIT_WORKERS_SMOKE_BASE_URL || 'http://127.0.0.1:13000');
  const jwtSecret = readArg(argv, '--jwt-secret', process.env.AUTH_JWT_SECRET || 'golden-path-local-dev-secret');
  const outputPath = readArg(argv, '--out', 'observability/gp-015-qa-fail-smoke.json');
  const evidencePath = readArg(argv, '--evidence', 'observability/golden-path-postgres-pilot.json');
  let taskId = readArg(argv, '--task-id', '');
  if (!taskId && fs.existsSync(path.resolve(evidencePath))) {
    const evidence = JSON.parse(fs.readFileSync(path.resolve(evidencePath), 'utf8'));
    taskId = evidence.engineeringTeam?.taskId || evidence.phaseResults?.phase1?.taskId || '';
  }
  if (!taskId) throw new Error('task id required via --task-id or golden-path evidence file');

  const history = await fetch(`${baseUrl.replace(/\/+$/, '')}/tasks/${encodeURIComponent(taskId)}/history`, {
    headers: authHeaders(jwtSecret, 'engineering-team', 'gp-015-smoke'),
  });
  const historyBody = await history.json();
  const initialFail = (historyBody.items || historyBody.events || []).find((event) => {
    if (event?.event_type !== 'task.qa_result_recorded') return false;
    const payload = event.payload || {};
    return payload.outcome === 'fail' && (payload.run_kind || payload.runKind) !== 'retest';
  });
  const evidence = writeEvidence(outputPath, {
    generatedAt: new Date().toISOString(),
    step: 'GP-015',
    baseUrl,
    taskId,
    summary: {
      passed: Boolean(initialFail),
      runId: initialFail?.payload?.run_id || initialFail?.payload?.runId || null,
      outcome: initialFail?.payload?.outcome || null,
      runKind: initialFail?.payload?.run_kind || initialFail?.payload?.runKind || null,
    },
  });
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  if (!evidence.summary.passed) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});