#!/usr/bin/env node
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { PLAN_SCHEMA_VERSION, commandLine, hasFlag, readArg } = require('./plan-real-autonomous-delivery');
const { readPlanWithDigest } = require('./execute-real-autonomous-delivery-plan');
const { commitShaEvidenceFailure } = require('../lib/task-platform/real-commit-sha');
const { verifyRealAutonomousDeliveryEvidence } = require('../lib/task-platform/real-autonomous-delivery-evidence');

const EXECUTION_AUDIT_SCHEMA_VERSION = 'real-autonomous-delivery-plan-execution-audit.v1';
const EXECUTION_REPORT_SCHEMA_VERSION = 'real-autonomous-delivery-plan-execution.v1';
const FINAL_VERIFICATION_REPORT_SCHEMA_VERSION = 'real-autonomous-delivery-verification-report.v1';

function usageText() {
  return `${[
    'Usage: node scripts/verify-real-autonomous-delivery-plan-execution.js --plan <path> --pre-merge-report <path> --post-merge-report <path> [options]',
    'Audits saved-plan execution evidence for real autonomous delivery.',
    'Requires digest-bound pre-merge dry-run, post-merge execute, and final verification reports for the same plan.',
    'Options: --final-verification-report <path>, --json, --report <path>, --cwd <path>.',
  ].join('\n')}\n`;
}

function shouldPrintHelp(argv = process.argv) {
  return hasFlag('--help', argv) || hasFlag('-h', argv);
}

function optionsFromArgv(argv = process.argv, env = process.env) {
  return {
    planPath: readArg('--plan', readArg('--plan-report', env.REAL_DELIVERY_PLAN || '', argv), argv),
    preMergeReportPath: readArg('--pre-merge-report', env.REAL_DELIVERY_PRE_MERGE_EXECUTION_REPORT || '', argv),
    postMergeReportPath: readArg('--post-merge-report', env.REAL_DELIVERY_POST_MERGE_EXECUTION_REPORT || '', argv),
    finalVerificationReportPath: readArg('--final-verification-report', env.REAL_AUTONOMOUS_DELIVERY_VERIFICATION_REPORT || '', argv),
    reportPath: readArg('--report', readArg('--audit-report', '', argv), argv),
    json: hasFlag('--json', argv),
    cwd: readArg('--cwd', process.cwd(), argv),
  };
}

function readJsonArtifact(filePath, cwd, label, failures) {
  if (!filePath) {
    failures.push(`${label} path is required`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(path.resolve(cwd || process.cwd(), filePath), 'utf8'));
  } catch (error) {
    failures.push(`${label} cannot be read: ${error.message}`);
    return null;
  }
}

function expectedCommand(command = {}) {
  return {
    id: command.id || null,
    command: command.command || commandLine(command.argv || []),
  };
}

function sameDigest(report = {}, digest = {}) {
  return report.planDigest?.algorithm === digest.algorithm
    && report.planDigest?.value === digest.value;
}

function sha256File(filePath, cwd = process.cwd()) {
  try {
    return crypto.createHash('sha256')
      .update(fs.readFileSync(path.resolve(cwd, filePath)))
      .digest('hex');
  } catch {
    return null;
  }
}

function artifactDigestFailures(report = {}, options = {}) {
  const failures = [];
  for (const [key, label, filePath] of [
    ['evidence', 'evidence', report.evidencePath],
    ['candidateProof', 'candidate proof', report.candidateProofPath],
  ]) {
    if (!filePath) continue;
    const digest = report.artifactDigests?.[key];
    if (!digest) {
      failures.push(`final verification report artifactDigests.${key} is required`);
      continue;
    }
    if (digest.algorithm !== 'sha256') failures.push(`final verification report artifactDigests.${key}.algorithm must be sha256`);
    if (digest.path !== filePath) failures.push(`final verification report artifactDigests.${key}.path must match ${label} path`);
    const actual = sha256File(filePath, options.cwd);
    if (!actual) failures.push(`final verification report ${label} artifact cannot be read for digest verification`);
    else if (digest.value !== actual) {
      failures.push(`final verification report artifactDigests.${key}.value must match current ${label} artifact SHA-256`);
    }
  }
  return failures;
}

function commandListFailures(label, report = {}, expectedCommands = []) {
  const failures = [];
  const actualCommands = Array.isArray(report.commands) ? report.commands : [];
  if (!Array.isArray(report.commands)) {
    failures.push(`${label} commands must be an array`);
    return failures;
  }
  if (actualCommands.length !== expectedCommands.length) {
    failures.push(`${label} command count must match selected plan commands`);
  }
  expectedCommands.forEach((command, index) => {
    const expected = expectedCommand(command);
    const actual = actualCommands[index] || {};
    if (actual.id !== expected.id) failures.push(`${label} command ${index + 1} id must match plan command ${expected.id}`);
    if (actual.command !== expected.command) failures.push(`${label} command ${expected.id} must match plan command text`);
    if (actual.ready !== true) failures.push(`${label} command ${expected.id} must be ready`);
  });
  return failures;
}

function resultFailures(label, report = {}, expectedCommands = []) {
  const failures = [];
  const results = Array.isArray(report.results) ? report.results : [];
  if (!Array.isArray(report.results)) {
    failures.push(`${label} results must be an array`);
    return failures;
  }
  if (results.length !== expectedCommands.length) failures.push(`${label} result count must match selected plan commands`);
  expectedCommands.forEach((command, index) => {
    const result = results[index] || {};
    if (result.id !== command.id) failures.push(`${label} result ${index + 1} id must match plan command ${command.id}`);
    if (result.status !== 0) failures.push(`${label} command ${command.id} must exit with status 0`);
    if (result.signal) failures.push(`${label} command ${command.id} must not terminate by signal`);
  });
  return failures;
}

function finalVerificationReportFailures(report = {}, plan = {}, options = {}) {
  const failures = [];
  if (!report || typeof report !== 'object') return ['final verification report is required'];
  if (report.schemaVersion !== FINAL_VERIFICATION_REPORT_SCHEMA_VERSION) {
    failures.push(`final verification report schemaVersion must be ${FINAL_VERIFICATION_REPORT_SCHEMA_VERSION}`);
  }
  if (report.ok !== true) failures.push('final verification report must be ok');
  if (Number(report.failureCount || 0) !== 0) failures.push('final verification report failureCount must be 0');
  if (Array.isArray(report.failures) && report.failures.length) {
    failures.push('final verification report failures must be empty');
  }
  const artifacts = plan.artifacts || {};
  if (artifacts.sourceEvidencePath && report.evidencePath !== artifacts.sourceEvidencePath) {
    failures.push('final verification report evidencePath must match planned final evidence command input');
  }
  if (artifacts.candidateProofPath && report.candidateProofPath !== artifacts.candidateProofPath) {
    failures.push('final verification report candidateProofPath must match planned candidate proof');
  }
  failures.push(...finalVerificationIdentityFailures(report, plan));
  if (options.requireArtifactDigests === true) {
    failures.push(...artifactDigestFailures(report, options));
  }
  failures.push(...independentFinalVerificationFailures(report, plan, options));
  return failures;
}

function independentFinalVerificationFailures(report = {}, plan = {}, options = {}) {
  if (options.requireIndependentVerification !== true && !options.realAutonomousDeliveryVerifier) return [];
  if (!report.evidencePath || !report.candidateProofPath) return [];
  const verifier = options.realAutonomousDeliveryVerifier || verifyRealAutonomousDeliveryEvidence;
  try {
    const result = verifier({
      evidencePath: report.evidencePath,
      candidateProofPath: report.candidateProofPath,
      repoRoot: options.cwd || process.cwd(),
      releaseEnv: plan.inputs?.releaseEnv || report.releaseEnv,
    });
    if (result?.ok === true) return [];
    const detail = Array.isArray(result?.failures) && result.failures.length
      ? result.failures.slice(0, 5).join('; ')
      : 'unknown verifier failure';
    return [`independent final verification must pass: ${detail}`];
  } catch (error) {
    return [`independent final verification could not run: ${error.message}`];
  }
}

function valueMismatchFailure(label, actual, expected) {
  if (!expected) return null;
  return actual === expected ? null : `final verification report ${label} must match saved plan`;
}

function finalVerificationIdentityFailures(report = {}, plan = {}) {
  const inputs = plan.inputs || {};
  const expected = report.expected || {};
  const failures = [
    valueMismatchFailure('releaseEnv', report.releaseEnv, inputs.releaseEnv),
    valueMismatchFailure('expected.branch', expected.branch, inputs.branchName),
    valueMismatchFailure('expected.commitSha', expected.commitSha, inputs.implementationCommitSha),
    valueMismatchFailure('expected.prUrl', expected.prUrl, inputs.prUrl),
    valueMismatchFailure('expected.deploymentUrl', expected.deploymentUrl, inputs.deploymentUrl),
  ].filter(Boolean);
  const mergeCommitFailure = commitShaEvidenceFailure(expected.mergeCommitSha);
  if (!expected.mergeCommitSha) {
    failures.push('final verification report expected.mergeCommitSha is required');
  } else if (mergeCommitFailure) {
    failures.push(`final verification report expected.mergeCommitSha: ${mergeCommitFailure}`);
  }
  if (Number(inputs.prNumber) > 0 && Number(expected.prNumber) !== Number(inputs.prNumber)) {
    failures.push('final verification report expected.prNumber must match saved plan');
  }
  return failures;
}

function argvValue(argv = [], name) {
  const index = argv.indexOf(name);
  return index === -1 ? null : argv[index + 1] || null;
}

function finalVerificationCommandFailures(plan = {}, reportPath = '') {
  if (!reportPath || !plan) return [];
  const command = (plan.postMergeCommands || []).find((item) => item.id === 'final-verification');
  if (!command) return ['plan post-merge final-verification command is required'];
  if (!Array.isArray(command.argv)) return ['plan final-verification command argv is required'];
  const commandReportPath = argvValue(command.argv, '--report');
  if (!commandReportPath) return ['plan final-verification command must write --report'];
  return commandReportPath === reportPath
    ? []
    : ['plan final-verification command --report must match final verification report path'];
}

function finalVerificationReportPathFailures(plan = {}, options = {}, reportPath = '') {
  const plannedPath = plan?.artifacts?.finalVerificationReportPath || '';
  if (!plannedPath) return [];
  if (options.finalVerificationReportPath && options.finalVerificationReportPath !== plannedPath) {
    return ['final verification report path override must match saved plan artifact path'];
  }
  return reportPath === plannedPath ? [] : ['final verification report path must match saved plan artifact path'];
}

function loadPlanForAudit(options = {}, failures = []) {
  try {
    const loaded = readPlanWithDigest(options.planPath, options.cwd);
    return { plan: loaded.plan, planDigest: loaded.digest };
  } catch (error) {
    failures.push(`plan cannot be read: ${error.message}`);
    return { plan: null, planDigest: null };
  }
}

function finalVerificationReportPathFor(plan = {}, options = {}) {
  return options.finalVerificationReportPath || plan?.artifacts?.finalVerificationReportPath || '';
}

function readAuditArtifacts(options = {}, plan = {}, failures = []) {
  const finalVerificationReportPath = finalVerificationReportPathFor(plan, options);
  return {
    preMerge: readJsonArtifact(options.preMergeReportPath, options.cwd, 'pre-merge execution report', failures),
    postMerge: readJsonArtifact(options.postMergeReportPath, options.cwd, 'post-merge execution report', failures),
    finalVerification: readJsonArtifact(finalVerificationReportPath, options.cwd, 'final verification report', failures),
    finalVerificationReportPath,
  };
}

function planShapeFailures(plan = {}, options = {}) {
  const failures = [];
  if (!plan) return failures;
  if (plan.schemaVersion !== PLAN_SCHEMA_VERSION) failures.push(`plan schemaVersion must be ${PLAN_SCHEMA_VERSION}`);
  if (!Array.isArray(plan.commands) || plan.commands.length === 0) failures.push('plan pre-merge commands are required');
  if (!Array.isArray(plan.postMergeCommands) || plan.postMergeCommands.length === 0) failures.push('plan post-merge commands are required');
  if (!plan.artifacts?.finalVerificationReportPath && !options.finalVerificationReportPath) {
    failures.push('plan artifacts.finalVerificationReportPath is required');
  }
  failures.push(...finalVerificationReportPathFailures(
    plan,
    options,
    finalVerificationReportPathFor(plan, options),
  ));
  failures.push(...finalVerificationCommandFailures(
    plan,
    finalVerificationReportPathFor(plan, options),
  ));
  return failures;
}

function executionArtifactFailures(plan, planDigest, artifacts, options = {}) {
  const failures = [];
  if (!plan || !planDigest) return failures;
  if (artifacts.preMerge) {
    failures.push(...executionReportFailures('pre-merge execution report', artifacts.preMerge, {
      planDigest, stage: 'pre-merge', execute: false, dryRun: true, commands: plan.commands || [],
    }));
  }
  if (artifacts.postMerge) {
    failures.push(...executionReportFailures('post-merge execution report', artifacts.postMerge, {
      planDigest, stage: 'post-merge', execute: true, dryRun: false, commands: plan.postMergeCommands || [],
    }));
  }
  if (artifacts.finalVerification) {
    failures.push(...finalVerificationReportFailures(artifacts.finalVerification, plan, {
      cwd: options.cwd,
      requireArtifactDigests: true,
      requireIndependentVerification: true,
      realAutonomousDeliveryVerifier: options.realAutonomousDeliveryVerifier,
    }));
  }
  return failures;
}

function executionReportFailures(label, report = {}, expectations = {}) {
  const failures = [];
  const expectedCommands = expectations.commands || [];
  if (!report || typeof report !== 'object') return [`${label} report is required`];
  if (report.schemaVersion !== EXECUTION_REPORT_SCHEMA_VERSION) {
    failures.push(`${label} schemaVersion must be ${EXECUTION_REPORT_SCHEMA_VERSION}`);
  }
  if (report.ok !== true) failures.push(`${label} report must be ok`);
  if (report.planSchemaVersion !== PLAN_SCHEMA_VERSION) failures.push(`${label} planSchemaVersion must be ${PLAN_SCHEMA_VERSION}`);
  if (!sameDigest(report, expectations.planDigest)) failures.push(`${label} planDigest must match saved plan SHA-256`);
  if (report.stage !== expectations.stage) failures.push(`${label} stage must be ${expectations.stage}`);
  if (report.execute !== expectations.execute) failures.push(`${label} execute must be ${expectations.execute}`);
  if (report.dryRun !== expectations.dryRun) failures.push(`${label} dryRun must be ${expectations.dryRun}`);
  if (report.commandCount !== expectedCommands.length) failures.push(`${label} commandCount must match selected plan commands`);
  if (Array.isArray(report.failures) && report.failures.length) failures.push(`${label} report failures must be empty`);
  failures.push(...commandListFailures(label, report, expectedCommands));
  if (expectations.execute === true) failures.push(...resultFailures(label, report, expectedCommands));
  else if (Array.isArray(report.results) && report.results.length) failures.push(`${label} dry-run results must be empty`);
  return failures;
}

function auditPlanExecutionEvidence(options = {}) {
  const failures = [];
  const { plan, planDigest } = loadPlanForAudit(options, failures);
  const artifacts = readAuditArtifacts(options, plan, failures);
  failures.push(...planShapeFailures(plan, options));
  failures.push(...executionArtifactFailures(plan, planDigest, artifacts, options));
  return {
    ok: failures.length === 0,
    schemaVersion: EXECUTION_AUDIT_SCHEMA_VERSION,
    planPath: options.planPath || null,
    preMergeReportPath: options.preMergeReportPath || null,
    postMergeReportPath: options.postMergeReportPath || null,
    finalVerificationReportPath: artifacts.finalVerificationReportPath || null,
    planDigest,
    failureCount: failures.length,
    failures,
  };
}

function writeJsonReport(reportPath, report, cwd = process.cwd()) {
  if (!reportPath) return null;
  const resolved = path.resolve(cwd, reportPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`);
  return resolved;
}

function printHumanReport(report, output = process) {
  if (report.ok) output.stdout.write('PASS  real-delivery-plan-execution-audit: saved-plan execution evidence is consistent\n');
  for (const failure of report.failures) output.stderr.write(`FAIL  real-delivery-plan-execution-audit: ${failure}\n`);
}

function main(argv = process.argv, env = process.env) {
  if (shouldPrintHelp(argv)) {
    process.stdout.write(usageText());
    return { ok: true, help: true };
  }
  const options = optionsFromArgv(argv, env);
  const report = auditPlanExecutionEvidence(options);
  writeJsonReport(options.reportPath, report, options.cwd);
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else printHumanReport(report);
  if (!report.ok) process.exitCode = 1;
  return report;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  EXECUTION_AUDIT_SCHEMA_VERSION,
  EXECUTION_REPORT_SCHEMA_VERSION,
  FINAL_VERIFICATION_REPORT_SCHEMA_VERSION,
  artifactDigestFailures,
  auditPlanExecutionEvidence,
  argvValue,
  commandListFailures,
  executionReportFailures,
  finalVerificationCommandFailures,
  finalVerificationIdentityFailures,
  finalVerificationReportPathFailures,
  finalVerificationReportFailures,
  main,
  optionsFromArgv,
  resultFailures,
  shouldPrintHelp,
  usageText,
  writeJsonReport,
};
