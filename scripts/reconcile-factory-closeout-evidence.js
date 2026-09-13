#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { makeBearerToken } = require('../lib/task-platform/golden-path-shared');
const { extractFactoryApprovalProvenance } = require('../lib/task-platform/golden-path-human-review');
const { writeFactoryCloseoutReport } = require('../lib/task-platform/factory-closeout');

function readArg(argv, name, fallback = '') {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

function parseTaskIds(value) {
  return String(value || '').split(',').map((taskId) => taskId.trim()).filter(Boolean);
}

function loadFactoryEvidence(root, taskIds) {
  const deliveryDir = path.join(root, 'observability', 'factory-delivery');
  const selected = new Set(taskIds);
  return fs.readdirSync(deliveryDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const filePath = path.join(deliveryDir, name);
      return { filePath, evidence: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
    })
    .filter(({ evidence }) => selected.has(evidence.engineeringTeam?.taskId));
}

function auditContext(env = process.env) {
  const jwtSecret = env.AUTH_JWT_SECRET || env.GOLDEN_PATH_JWT_SECRET;
  if (!jwtSecret) throw new Error('AUTH_JWT_SECRET or GOLDEN_PATH_JWT_SECRET is required');
  return {
    baseUrl: String(env.FACTORY_BASE_URL || 'http://127.0.0.1:13000').replace(/\/+$/, ''),
    token: makeBearerToken({
      jwtSecret,
      tenantId: 'engineering-team',
      actorId: 'factory-closeout-reconciler',
      roles: ['reader', 'pm'],
    }),
  };
}

async function readTaskHistory(taskId, context, fetchImpl = fetch) {
  const response = await fetchImpl(
    `${context.baseUrl}/tasks/${encodeURIComponent(taskId)}/history?limit=500`,
    { headers: { accept: 'application/json', authorization: `Bearer ${context.token}` } },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`History read failed for ${taskId} (${response.status})`);
  return body;
}

function withApprovalProvenance(evidence, provenance) {
  const policy = evidence.phase1?.contract?.autoApprovalPolicy;
  if (!policy || typeof policy !== 'object') {
    throw new Error(`Factory evidence lacks an auto-approval policy for ${evidence.engineeringTeam?.taskId}`);
  }
  return {
    ...evidence,
    phase1: {
      ...evidence.phase1,
      contract: {
        ...evidence.phase1.contract,
        autoApprovalPolicy: { ...policy, auditProvenance: provenance },
      },
    },
  };
}

async function reconcileOne(root, record, context) {
  const taskId = record.evidence.engineeringTeam?.taskId;
  const history = await readTaskHistory(taskId, context);
  const provenance = extractFactoryApprovalProvenance(history);
  if (!provenance.humanReview || !provenance.approval) {
    throw new Error(`Complete review and approval provenance is unavailable for ${taskId}`);
  }
  const evidence = withApprovalProvenance(record.evidence, provenance);
  const evidencePath = path.relative(root, record.filePath);
  const written = writeFactoryCloseoutReport(evidence, {
    evidencePath,
    outputDir: path.join(root, 'observability', 'factory-closeout'),
  });
  return { taskId, evidencePath, closeoutPath: path.relative(root, written.outputPath) };
}

async function main(argv = process.argv.slice(2), options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const taskIds = parseTaskIds(readArg(argv, '--task-ids', process.env.COHORT_TASK_IDS));
  if (!taskIds.length) throw new Error('--task-ids or COHORT_TASK_IDS is required');
  const records = loadFactoryEvidence(root, taskIds);
  if (records.length !== taskIds.length) {
    const found = new Set(records.map(({ evidence }) => evidence.engineeringTeam?.taskId));
    throw new Error(`Factory evidence missing for: ${taskIds.filter((taskId) => !found.has(taskId)).join(', ')}`);
  }
  const context = options.context || auditContext();
  const results = [];
  for (const record of records) results.push(await reconcileOne(root, record, context));
  process.stdout.write(`${JSON.stringify({ ok: true, reconciled: results.length, results }, null, 2)}\n`);
  return results;
}

if (require.main === module) main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});

module.exports = {
  auditContext,
  loadFactoryEvidence,
  main,
  parseTaskIds,
  readTaskHistory,
  reconcileOne,
  withApprovalProvenance,
};
