#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { submitFactoryRequirementsForQueue } = require('../lib/task-platform/factory-delivery');
const {
  hasFactoryItemRealDeliveryIntent,
  itemRealDelivery,
} = require('../lib/task-platform/factory-delivery-shared');
const { defaultFactoryCandidateProofPath } = require('../lib/task-platform/factory-phase-runner-options');
const { factoryCompletionFinalEvidencePath } = require('../lib/task-platform/factory-real-delivery-completion');
const { realDeliveryProofStatus } = require('../lib/task-platform/factory-delivery-queue-status');
const { factoryRealDeliveryPreflightSummary } = require('../lib/task-platform/factory-delivery-submit-preflight');

function readArg(name, fallback = '', argv = process.argv) {
  const index = argv.indexOf(name);
  return index === -1 || index === argv.length - 1 ? fallback : argv[index + 1];
}

function readArgs(name, argv = process.argv) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === name && index < argv.length - 1) values.push(argv[index + 1]);
  }
  return values;
}

function splitList(values = []) {
  return values
    .flatMap((value) => String(value || '').split(','))
    .map((value) => value.trim())
    .filter(Boolean);
}

function readChangedFiles(argv = process.argv) {
  return splitList([
    ...readArgs('--changed-file', argv),
    readArg('--changed-files', '', argv),
  ]);
}

function readJsonValue(name, argv = process.argv) {
  const raw = readArg(name, '', argv);
  if (!raw) return undefined;
  const content = raw.startsWith('@')
    ? fs.readFileSync(path.resolve(process.cwd(), raw.slice(1)), 'utf8')
    : raw;
  return JSON.parse(content);
}

function readJsonFile(name, argv = process.argv) {
  const filePath = readArg(name, '', argv);
  return filePath ? JSON.parse(fs.readFileSync(path.resolve(process.cwd(), filePath), 'utf8')) : undefined;
}

function readReleaseArtifactCommands(argv = process.argv) {
  const commands = {
    build: readArg('--release-build-command', '', argv),
    compatibility: readArg('--release-compatibility-command', '', argv),
    vulnerability: readArg('--release-vulnerability-command', '', argv),
    secret: readArg('--release-secret-command', '', argv),
  };
  return Object.values(commands).some(Boolean) ? commands : null;
}

function addSourceProofOptions(entry, argv) {
  const repository = readArg('--repository', readArg('--ci-repository', '', argv), argv);
  if (repository) entry.ciRepository = repository;
  const branchName = readArg('--branch', readArg('--branch-name', '', argv), argv);
  if (branchName) entry.branchName = branchName;
  const implementationCommitSha = readArg(
    '--implementation-commit-sha',
    readArg('--commit-sha', '', argv),
    argv,
  );
  if (implementationCommitSha) entry.implementationCommitSha = implementationCommitSha;
  const prUrl = readArg('--pr-url', '', argv);
  if (prUrl) entry.prUrl = prUrl;
  const prNumber = Number(readArg('--pr-number', '', argv));
  if (Number.isInteger(prNumber) && prNumber > 0) entry.prNumber = prNumber;
  if (argv.includes('--auto-merge')) entry.autoMerge = true;
  const checks = readJsonValue('--checks-json', argv) || readJsonFile('--checks-file', argv);
  if (checks) entry.checks = checks;
  const requiredChecks = readJsonValue('--required-checks-json', argv) || readJsonFile('--required-checks-file', argv);
  if (requiredChecks) entry.requiredChecks = requiredChecks;
  const branchProtection = readJsonValue('--branch-protection-json', argv) || readJsonFile('--branch-protection-file', argv);
  if (branchProtection) entry.branchProtection = branchProtection;
  const mergeReadiness = readJsonValue('--merge-readiness-json', argv) || readJsonFile('--merge-readiness-file', argv);
  if (mergeReadiness) entry.mergeReadiness = mergeReadiness;
}

function addReleaseProofOptions(entry, argv) {
  const rollbackTarget = readArg('--rollback-target', '', argv);
  if (rollbackTarget) entry.rollbackTarget = rollbackTarget;
  const rollbackPlan = readArg('--rollback-plan', '', argv);
  if (rollbackPlan) entry.rollbackPlan = rollbackPlan;
  const rollbackEvidence = readArg('--rollback-evidence', '', argv);
  if (rollbackEvidence) entry.rollbackEvidence = rollbackEvidence;
  if (argv.includes('--rollback-verified')) entry.rollbackVerified = true;
  const deploymentUrl = readArg('--deployment-url', '', argv);
  if (deploymentUrl) entry.deploymentUrl = deploymentUrl;
  const productionSafetyEvidence = readArg('--production-safety-evidence', '', argv);
  if (productionSafetyEvidence) entry.productionSafetyEvidence = productionSafetyEvidence;
  const productionUrl = readArg('--production-url', '', argv);
  if (productionUrl) entry.productionUrl = productionUrl;
  const releaseEnv = readArg('--release-env', '', argv);
  if (releaseEnv) entry.releaseEnv = releaseEnv;
  const healthCheckPath = readArg('--health-check-path', '', argv);
  if (healthCheckPath) entry.healthCheckPath = healthCheckPath;
  if (argv.includes('--require-health-commit')) entry.requireHealthCommit = true;
  const releaseArtifactCommands = readReleaseArtifactCommands(argv);
  if (releaseArtifactCommands) entry.releaseArtifactCommands = releaseArtifactCommands;
  const releaseArtifactDir = readArg('--release-artifact-dir', '', argv);
  if (releaseArtifactDir) entry.releaseArtifactDir = releaseArtifactDir;
  if (argv.includes('--use-existing-release-artifacts')) entry.useExistingReleaseArtifacts = true;
  const candidateProofPath = readArg('--candidate-proof', '', argv);
  if (candidateProofPath) entry.candidateProofPath = candidateProofPath;
  const finalEvidencePath = readArg('--final-evidence', '', argv)
    || readArg('--real-delivery-final-evidence', '', argv)
    || readArg('--real-autonomous-delivery-evidence', '', argv);
  if (finalEvidencePath) entry.finalEvidencePath = finalEvidencePath;
}

function addRiskAndTestOptions(entry, argv) {
  const testCommands = readArgs('--test-command', argv);
  if (testCommands.length) entry.testCommands = testCommands;
  const riskLevel = readArg('--risk-level', '', argv);
  if (riskLevel) entry.riskLevel = riskLevel;
  if (argv.includes('--production-safe')) entry.productionSafe = true;
}

function buildInlineRequirement(argv = process.argv) {
  const title = readArg('--title', '', argv);
  const requirements = readArg('--requirements', readArg('--body', '', argv), argv);
  const changeKind = readArg('--change-kind', readArg('--kind', '', argv), argv);
  const changedFiles = readChangedFiles(argv);
  const entry = { title, requirements, templateTier: readArg('--tier', changeKind || changedFiles.length ? 'Standard' : 'Simple', argv) };
  if (changeKind) entry.changeKind = changeKind;
  if (changedFiles.length) entry.changedFiles = changedFiles;
  addSourceProofOptions(entry, argv);
  addRiskAndTestOptions(entry, argv);
  addReleaseProofOptions(entry, argv);
  return entry;
}

function loadRequirements(inputPath) {
  const resolved = path.resolve(process.cwd(), inputPath);
  const payload = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.requirements)) return payload.requirements;
  if (payload.title || payload.requirements || payload.description) return [payload];
  throw new Error('Requirements file must be an array or { requirements: [...] }');
}

function submittedItemSummary(item = {}, config = {}) {
  const realDelivery = itemRealDelivery(item);
  const realDeliveryRequested = hasFactoryItemRealDeliveryIntent(item);
  const summary = {
    id: item.id,
    title: item.title,
    templateTier: item.templateTier,
    changeKind: item.changeKind || null,
    changedFiles: item.changedFiles || [],
    stage: item.stage,
    evidencePath: item.evidencePath,
  };
  const candidateProofPath = item.realDeliveryCandidateProofPath
    || item.candidateProofPath
    || realDelivery.candidateProofPath
    || realDelivery.realDeliveryCandidateProofPath
    || (realDeliveryRequested ? defaultFactoryCandidateProofPath(config, item) : null);
  if (candidateProofPath) summary.candidateProofPath = candidateProofPath;
  if (realDelivery.releaseArtifactDir) summary.releaseArtifactDir = realDelivery.releaseArtifactDir;
  if (realDelivery.useExistingReleaseArtifacts === true) summary.useExistingReleaseArtifacts = true;
  const realDeliveryStatus = realDeliveryProofStatus(item, config);
  if (realDeliveryStatus) {
    summary.realDelivery = {
      ...realDeliveryStatus,
      preflight: factoryRealDeliveryPreflightSummary(item, config, item.stage || 'queued'),
    };
  }
  const finalEvidencePath = item.realAutonomousDeliveryEvidencePath
    || item.realDeliveryFinalEvidencePath
    || item.finalEvidencePath
    || realDelivery.finalEvidencePath
    || realDelivery.realAutonomousDeliveryEvidencePath
    || realDelivery.realDeliveryFinalEvidencePath
    || (realDeliveryRequested ? factoryCompletionFinalEvidencePath(config, item) : null);
  if (finalEvidencePath) summary.finalEvidencePath = finalEvidencePath;
  return summary;
}

async function main() {
  const inputPath = readArg('--file', readArg('--in', ''));
  const inlineEntry = buildInlineRequirement();
  let entries = [];

  if (inputPath) {
    entries = loadRequirements(inputPath);
  } else if (inlineEntry.title && inlineEntry.requirements) {
    entries = [inlineEntry];
  } else {
    throw new Error('Provide --file <json> or --title and --requirements');
  }

  const queueBackend = readArg('--queue-backend', process.env.FACTORY_QUEUE_BACKEND || 'postgres');
  const deliveryDir = readArg('--delivery-dir', process.env.FACTORY_DELIVERY_DIR || '');
  const submitConfig = {
    baseUrl: readArg('--base-url', process.env.FACTORY_BASE_URL || 'http://127.0.0.1:13000'),
    queuePath: readArg('--queue', process.env.FACTORY_QUEUE_PATH || 'observability/factory-delivery-queue.json'),
    queueBackend,
    allowFileQueue: process.argv.includes('--allow-file-queue'),
    deliveryDir: deliveryDir || undefined,
    factoryQueueDatabaseUrl: readArg(
      '--database-url',
      process.env.FACTORY_QUEUE_DATABASE_URL || process.env.DATABASE_URL || '',
    ),
    operatorUrl: readArg('--operator-url', process.env.FACTORY_OPERATOR_URL || ''),
    forgeAdapterUrl: readArg('--forgeadapter-url', process.env.FORGEADAPTER_BASE_URL || ''),
    githubToken: readArg('--github-token', process.env.GITHUB_TOKEN || process.env.GH_TOKEN || ''),
  };
  const result = await submitFactoryRequirementsForQueue(entries, submitConfig);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    queueBackend,
    queuePath: result.queuePath,
    queueTable: result.queueTable,
    submitted: result.created.length,
    items: result.created.map((item) => submittedItemSummary(item, submitConfig)),
    next: 'npm run factory:orchestrator -- --once',
  }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildInlineRequirement,
  loadRequirements,
  readArg,
  readArgs,
  readChangedFiles,
  readJsonFile,
  readJsonValue,
  submittedItemSummary,
};
