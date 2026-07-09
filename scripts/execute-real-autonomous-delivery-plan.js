#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const {
  PLAN_SCHEMA_VERSION,
  commandLine,
  hasFlag,
  readArg,
} = require('./plan-real-autonomous-delivery');

function usageText() {
  return `${[
    'Usage: node scripts/execute-real-autonomous-delivery-plan.js --plan <path> [options]',
    'Validates a saved real-delivery plan and refuses blocked or unready commands.',
    'Options: --stage pre-merge|post-merge|all, --command <id>, --execute, --json, --report <path>.',
    'Default mode is dry-run; use --execute only after the plan is ready and required env vars are present.',
  ].join('\n')}\n`;
}

function shouldPrintHelp(argv = process.argv) {
  return hasFlag('--help', argv) || hasFlag('-h', argv);
}

function optionsFromArgv(argv = process.argv, env = process.env) {
  return {
    planPath: readArg('--plan', readArg('--plan-report', '', argv), argv),
    stage: readArg('--stage', 'pre-merge', argv),
    commandId: readArg('--command', '', argv),
    execute: hasFlag('--execute', argv),
    json: hasFlag('--json', argv),
    reportPath: readArg('--report', readArg('--execution-report', '', argv), argv),
    cwd: readArg('--cwd', process.cwd(), argv),
    env,
  };
}

function readPlan(planPath, cwd = process.cwd()) {
  if (!planPath) throw new Error('--plan is required');
  const resolved = path.resolve(cwd, planPath);
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function stableJson(value) {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function planDigestForObject(plan = {}) {
  return {
    algorithm: 'sha256',
    value: sha256(stableJson(plan)),
    source: 'object',
  };
}

function readPlanWithDigest(planPath, cwd = process.cwd()) {
  if (!planPath) throw new Error('--plan is required');
  const resolved = path.resolve(cwd, planPath);
  const text = fs.readFileSync(resolved, 'utf8');
  return {
    plan: JSON.parse(text),
    digest: {
      algorithm: 'sha256',
      value: sha256(text),
      source: 'file',
    },
  };
}

function commandGroups(plan = {}, stage = 'pre-merge') {
  if (stage === 'pre-merge') return plan.commands || [];
  if (stage === 'post-merge') return plan.postMergeCommands || [];
  if (stage === 'all') return [...(plan.commands || []), ...(plan.postMergeCommands || [])];
  throw new Error('--stage must be pre-merge, post-merge, or all');
}

function selectCommands(plan = {}, options = {}) {
  const commands = commandGroups(plan, options.stage || 'pre-merge');
  if (!options.commandId) return commands;
  return commands.filter((item) => item.id === options.commandId);
}

function commandFailures(command = {}) {
  const failures = [];
  if (!command.id) failures.push('plan command is missing id');
  if (command.ready !== true) failures.push(`plan command ${command.id || '(unknown)'} is not ready`);
  if (Array.isArray(command.blockedBy) && command.blockedBy.length) {
    failures.push(`plan command ${command.id || '(unknown)'} is blocked: ${command.blockedBy.join('; ')}`);
  }
  if (!Array.isArray(command.argv) || !command.argv.length) {
    failures.push(`plan command ${command.id || '(unknown)'} is missing argv`);
  } else if (command.argv.some((arg) => typeof arg !== 'string')) {
    failures.push(`plan command ${command.id || '(unknown)'} argv must contain strings only`);
  }
  return failures;
}

function planExecutionFailures(plan = {}, commands = [], options = {}) {
  const failures = [];
  if (plan.schemaVersion !== PLAN_SCHEMA_VERSION) {
    failures.push(`plan schemaVersion must be ${PLAN_SCHEMA_VERSION}`);
  }
  if (plan.ok !== true) failures.push('plan is not ok');
  if (plan.blocked === true) failures.push('plan is blocked');
  if (Array.isArray(plan.failures) && plan.failures.length) {
    failures.push(`plan has failures: ${plan.failures.join('; ')}`);
  }
  if (!commands.length) {
    failures.push(options.commandId ? `plan command ${options.commandId} was not found` : 'plan has no selected commands');
  }
  for (const command of commands) failures.push(...commandFailures(command));
  return failures;
}

function requiredEnvFailures(commands = [], env = process.env) {
  const failures = [];
  for (const command of commands) {
    for (const key of command.requires || []) {
      if (!env[key]) failures.push(`command ${command.id} requires ${key}`);
    }
  }
  return failures;
}

function materializeArg(arg, env = process.env) {
  const match = String(arg).match(/^\$([A-Z_][A-Z0-9_]*)$/);
  if (!match) return { ok: true, value: String(arg) };
  const value = env[match[1]];
  if (!value) return { ok: false, failure: `${match[1]} is required to materialize ${arg}` };
  return { ok: true, value };
}

function materializeCommand(command = {}, env = process.env) {
  const argv = [];
  const failures = [];
  for (const arg of command.argv || []) {
    const materialized = materializeArg(arg, env);
    if (materialized.ok) argv.push(materialized.value);
    else failures.push(`command ${command.id} ${materialized.failure}`);
  }
  return { argv, failures };
}

function executableCommands(commands = [], env = process.env) {
  const results = [];
  const failures = [];
  for (const command of commands) {
    const materialized = materializeCommand(command, env);
    if (materialized.failures.length) failures.push(...materialized.failures);
    results.push({
      id: command.id,
      argv: materialized.argv,
      command: commandLine(materialized.argv),
    });
  }
  return { commands: results, failures };
}

function executionReport(plan, commands, options = {}, failures = [], results = []) {
  return {
    ok: failures.length === 0,
    schemaVersion: 'real-autonomous-delivery-plan-execution.v1',
    planSchemaVersion: plan?.schemaVersion || null,
    planPath: options.planPath || null,
    planDigest: options.planDigest || planDigestForObject(plan),
    reportPath: options.reportPath || null,
    stage: options.stage || 'pre-merge',
    commandId: options.commandId || null,
    execute: options.execute === true,
    dryRun: options.execute !== true,
    commandCount: commands.length,
    failures,
    commands: commands.map((item) => ({
      id: item.id,
      command: item.command || commandLine(item.argv || []),
      ready: item.ready === true,
      requires: item.requires || [],
    })),
    results,
  };
}

function writeJsonReport(reportPath, report, cwd = process.cwd()) {
  if (!reportPath) return null;
  const resolved = path.resolve(cwd, reportPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`);
  return resolved;
}

function executePlan(plan = {}, options = {}) {
  const env = options.env || process.env;
  const commands = selectCommands(plan, options);
  const failures = planExecutionFailures(plan, commands, options);
  if (options.execute === true) {
    failures.push(...requiredEnvFailures(commands, env));
    failures.push(...executableCommands(commands, env).failures);
  }
  if (failures.length) return executionReport(plan, commands, options, failures);
  if (options.execute !== true) return executionReport(plan, commands, options);

  const spawnImpl = options.spawnImpl || spawnSync;
  const results = [];
  for (const command of executableCommands(commands, env).commands) {
    const result = spawnImpl(command.argv[0], command.argv.slice(1), {
      cwd: options.cwd || process.cwd(),
      env,
      stdio: options.json ? 'pipe' : 'inherit',
      encoding: 'utf8',
    });
    results.push({ id: command.id, status: result.status, signal: result.signal || null });
    if (result.status !== 0) {
      return executionReport(plan, commands, options, [
        `command ${command.id} failed with exit status ${result.status}`,
      ], results);
    }
  }
  return executionReport(plan, commands, options, [], results);
}

function printHumanReport(report, output = process) {
  if (report.ok && report.dryRun) output.stdout.write(`PASS  real-delivery-plan-execute: ${report.commandCount} commands ready for dry-run\n`);
  else if (report.ok) output.stdout.write(`PASS  real-delivery-plan-execute: executed ${report.commandCount} commands\n`);
  for (const failure of report.failures) output.stderr.write(`FAIL  real-delivery-plan-execute: ${failure}\n`);
  for (const command of report.commands) output.stdout.write(`${report.dryRun ? 'DRY-RUN' : 'RUN'} ${command.id}: ${command.command}\n`);
}

function main(argv = process.argv, env = process.env) {
  if (shouldPrintHelp(argv)) {
    process.stdout.write(usageText());
    return { ok: true, help: true };
  }
  const options = optionsFromArgv(argv, env);
  const { plan, digest } = readPlanWithDigest(options.planPath, options.cwd);
  const report = executePlan(plan, { ...options, planDigest: digest });
  const writtenReportPath = writeJsonReport(options.reportPath, report, options.cwd);
  if (writtenReportPath) report.reportPath = options.reportPath;
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
  commandFailures,
  executePlan,
  executableCommands,
  materializeArg,
  materializeCommand,
  optionsFromArgv,
  planDigestForObject,
  planExecutionFailures,
  readPlan,
  readPlanWithDigest,
  requiredEnvFailures,
  selectCommands,
  sha256,
  stableJson,
  shouldPrintHelp,
  usageText,
  writeJsonReport,
};
