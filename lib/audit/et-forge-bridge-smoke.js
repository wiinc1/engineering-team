const fs = require('node:fs');
const path = require('node:path');
const {
  resolveEtForgeDispatchConfig,
  handleEtForgeDispatchEvent,
} = require('../task-platform/et-forge-dispatch-bridge');

function resolveOptions(options = {}) {
  return {
    fetchImpl: options.fetchImpl || fetch,
    outputPath: options.outputPath || 'observability/et-forge-bridge-smoke.json',
    forgeAdapterBaseUrl: String(
      options.forgeAdapterBaseUrl
      || process.env.FORGEADAPTER_BASE_URL
      || process.env.STAGING_FORGEADAPTER_BASE_URL
      || '',
    ).trim(),
    engineeringTeamBaseUrl: String(
      options.engineeringTeamBaseUrl
      || process.env.ENGINEERING_TEAM_BASE_URL
      || process.env.STAGING_BASE_URL
      || process.env.AUDIT_WORKERS_SMOKE_BASE_URL
      || '',
    ).trim(),
    enabled: options.enabled ?? process.env.ET_FORGE_DISPATCH_ENABLED,
    lifecycleTaskId: options.lifecycleTaskId || process.env.ET_FORGE_LIFECYCLE_TASK_ID || 'TSK-BRIDGESMOKE',
    probeLiveForge: options.probeLiveForge !== false,
  };
}

async function probeForgeHealth(fetchImpl, baseUrl) {
  if (!baseUrl) {
    return { skipped: true, reason: 'forge_adapter_url_missing' };
  }
  const response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/health`);
  return {
    skipped: false,
    ok: response.ok,
    status: response.status,
    url: `${baseUrl.replace(/\/+$/, '')}/health`,
  };
}

async function runConfigDryRun(options = {}) {
  const resolved = resolveOptions(options);
  const config = resolveEtForgeDispatchConfig({
    ...process.env,
    ET_FORGE_DISPATCH_ENABLED: resolved.enabled ?? process.env.ET_FORGE_DISPATCH_ENABLED,
    FORGEADAPTER_BASE_URL: resolved.forgeAdapterBaseUrl || process.env.FORGEADAPTER_BASE_URL,
    ENGINEERING_TEAM_BASE_URL: resolved.engineeringTeamBaseUrl || process.env.ENGINEERING_TEAM_BASE_URL,
    ET_FORGE_LIFECYCLE_TASK_ID: resolved.lifecycleTaskId,
  });

  const calls = [];
  const dryRunConfig = {
    ...config,
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method || 'GET' });
      if (String(url).includes('/forge-execution-readiness')) {
        return { ok: true, status: 200, json: async () => ({ taskId: resolved.lifecycleTaskId }) };
      }
      if (String(url).endsWith('/start')) {
        return { ok: true, status: 202, json: async () => ({ jobId: 'job_bridge_smoke' }) };
      }
      throw new Error(`unexpected url ${url}`);
    },
  };

  const dispatch = await handleEtForgeDispatchEvent({
    event_type: 'task.execution_contract_approved',
    task_id: resolved.lifecycleTaskId,
    payload: { version: 1 },
  }, dryRunConfig);

  return {
    configEnabled: config.enabled === true,
    dispatchHandled: dispatch.handled === true,
    dispatchAction: dispatch.action || null,
    calls,
  };
}

async function runEtForgeBridgeSmoke(options = {}) {
  const resolved = resolveOptions(options);
  const evidence = {
    schemaVersion: '1.0',
    kind: 'et-forge-bridge-smoke',
    generatedAt: new Date().toISOString(),
    summary: { passed: false, checks: [] },
    config: {},
    dryRun: null,
    forgeHealth: null,
  };

  const config = resolveEtForgeDispatchConfig({
    ...process.env,
    ET_FORGE_DISPATCH_ENABLED: resolved.enabled ?? process.env.ET_FORGE_DISPATCH_ENABLED,
    FORGEADAPTER_BASE_URL: resolved.forgeAdapterBaseUrl || process.env.FORGEADAPTER_BASE_URL,
    ENGINEERING_TEAM_BASE_URL: resolved.engineeringTeamBaseUrl || process.env.ENGINEERING_TEAM_BASE_URL,
    ET_FORGE_LIFECYCLE_TASK_ID: resolved.lifecycleTaskId,
  });
  evidence.config = {
    enabled: config.enabled,
    forgeAdapterBaseUrl: config.forgeAdapterBaseUrl || null,
    engineeringTeamBaseUrl: config.engineeringTeamBaseUrl || null,
    lifecycleTaskId: config.lifecycleTaskId || null,
  };

  evidence.summary.checks.push({
    name: 'bridge_enabled',
    ok: config.enabled === true,
    enabled: config.enabled,
  });
  evidence.summary.checks.push({
    name: 'forge_adapter_url_configured',
    ok: Boolean(config.forgeAdapterBaseUrl),
    forgeAdapterBaseUrl: config.forgeAdapterBaseUrl || null,
  });
  evidence.summary.checks.push({
    name: 'engineering_team_url_configured',
    ok: Boolean(config.engineeringTeamBaseUrl),
    engineeringTeamBaseUrl: config.engineeringTeamBaseUrl || null,
  });

  evidence.dryRun = await runConfigDryRun(resolved);
  evidence.summary.checks.push({
    name: 'contract_approval_dry_run',
    ok: evidence.dryRun.dispatchHandled === true,
    action: evidence.dryRun.dispatchAction,
  });

  if (resolved.probeLiveForge && config.forgeAdapterBaseUrl) {
    evidence.forgeHealth = await probeForgeHealth(resolved.fetchImpl, config.forgeAdapterBaseUrl);
    evidence.summary.checks.push({
      name: 'forge_adapter_health',
      ok: evidence.forgeHealth.skipped === true || evidence.forgeHealth.ok === true,
      status: evidence.forgeHealth.status ?? null,
      skipped: evidence.forgeHealth.skipped === true,
    });
  }

  evidence.summary.passed = evidence.summary.checks.every((check) => check.ok);
  fs.mkdirSync(path.dirname(path.resolve(resolved.outputPath)), { recursive: true });
  fs.writeFileSync(path.resolve(resolved.outputPath), `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

module.exports = {
  runEtForgeBridgeSmoke,
  runConfigDryRun,
  probeForgeHealth,
};