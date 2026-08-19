#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  buildStagingDeployComponent,
  stagingConfiguration,
  stagingServiceEnvironment,
} = require('../lib/release-gates/staging-deployment');

function run(command, args, options = {}) {
  const output = execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
  return typeof output === 'string' ? output.trim() : '';
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function checkoutRevision(directory) {
  return run('git', ['rev-parse', 'HEAD'], { cwd: directory });
}

function verifyRelease(directory, revision) {
  if (checkoutRevision(directory) !== revision) {
    throw new Error(`Staging release does not match requested revision: ${directory}`);
  }
  run('git', ['fsck', '--no-dangling'], { cwd: directory });
  run('git', ['diff-index', '--quiet', 'HEAD', '--'], { cwd: directory });
  return true;
}

function prepareRelease(configuration) {
  fs.mkdirSync(path.dirname(configuration.releaseDir), { recursive: true });
  if (fs.existsSync(configuration.releaseDir)) {
    verifyRelease(configuration.releaseDir, configuration.revision);
    return { created: false, releaseDir: configuration.releaseDir };
  }
  const preparing = `${configuration.releaseDir}.preparing-${process.pid}`;
  run('git', ['clone', '--no-checkout', configuration.repositoryUrl, preparing]);
  try {
    run('git', ['checkout', '--detach', configuration.revision], { cwd: preparing });
    run('git', ['remote', 'remove', 'origin'], { cwd: preparing });
    run('npm', ['ci', '--cache', path.join(configuration.releaseRoot, '.npm'), '--prefer-offline'], {
      cwd: preparing,
      maxBuffer: 64 * 1024 * 1024,
    });
    verifyRelease(preparing, configuration.revision);
    fs.renameSync(preparing, configuration.releaseDir);
  } catch (error) {
    error.message = `Failed to prepare exact staging release ${configuration.revision}: ${error.message}`;
    throw error;
  }
  return { created: true, releaseDir: configuration.releaseDir };
}

async function hostedHealth(baseUrl) {
  const response = await fetch(`${baseUrl}/health`, {
    headers: { accept: 'application/json', 'user-agent': 'engineering-team-staging-deployer/1' },
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Hosted staging health returned HTTP ${response.status}.`);
  return { ok: true, status: response.status, url: `${baseUrl}/health` };
}

async function activateRelease(configuration) {
  const env = stagingServiceEnvironment(configuration);
  run(process.execPath, ['scripts/factory-stack.js', 'up', '--json', '--rebind-root'], {
    cwd: configuration.releaseDir,
    env,
    maxBuffer: 32 * 1024 * 1024,
    stdio: 'inherit',
  });
  const output = run(process.execPath, ['scripts/factory-stack.js', 'status', '--json'], {
    cwd: configuration.releaseDir,
    env,
    maxBuffer: 32 * 1024 * 1024,
  });
  const status = JSON.parse(output);
  if (status.ok !== true || status.health?.ok !== true) throw new Error('Local isolated staging stack did not become healthy.');
  const hosted = await hostedHealth(configuration.baseUrl);
  const automation = process.env.CI_JOB_URL || 'local:scripts/deploy-runtime-staging.js';
  for (const runtime of ['graphile', 'langgraph']) {
    writeJson(path.join(configuration.artifactDir, `${runtime}-staging-deploy.json`), buildStagingDeployComponent({
      automation,
      deploymentId: configuration.deploymentId,
      healthUrl: hosted.url,
      hostedHealth: hosted.ok,
      localHealth: status.health.ok,
      profile: 'staging',
      releaseDirectory: `releases/${configuration.revision}`,
      revision: configuration.revision,
      runtime,
    }));
  }
  return { artifactDir: configuration.artifactDir, hosted, status };
}

async function main() {
  const configuration = stagingConfiguration();
  const prepared = prepareRelease(configuration);
  const activated = await activateRelease(configuration);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    deploymentId: configuration.deploymentId,
    revision: configuration.revision,
    prepared,
    artifactDir: activated.artifactDir,
    hosted: activated.hosted,
  })}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      ok: false, code: error.code || 'staging_deploy_failed', message: error.message, reasons: error.reasons || [],
    })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  activateRelease, checkoutRevision, hostedHealth, main, prepareRelease, verifyRelease, writeJson,
};
