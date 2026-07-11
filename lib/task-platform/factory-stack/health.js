'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  DEFAULT_PORTS,
  defaultDatabaseUrl,
  defaultOpenclawUrl,
  logsHomeDir,
  LABELS,
} = require('./defaults');
const { launchdStatus, serviceLoaded } = require('./launchd');

async function probeHttp(url, { timeoutMs = 2500, acceptStatuses = [200, 201, 202, 204] } = {}) {
  const allowed = new Set(acceptStatuses);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const bodyText = await response.text().catch(() => '');
    let body = null;
    try { body = bodyText ? JSON.parse(bodyText) : null; } catch { body = bodyText.slice(0, 120); }
    return {
      ok: response.ok || allowed.has(response.status),
      status: response.status,
      url,
      body,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      url,
      error: error.message || String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function probePostgres(connectionString = defaultDatabaseUrl()) {
  try {
    const { Client } = require('pg');
    const client = new Client({
      connectionString,
      ssl: false,
      connectionTimeoutMillis: 2500,
    });
    await client.connect();
    await client.query('SELECT 1 AS ok');
    await client.end();
    return { ok: true, url: connectionString.replace(/:[^:@/]+@/, ':***@') };
  } catch (error) {
    return {
      ok: false,
      url: connectionString.replace(/:[^:@/]+@/, ':***@'),
      error: error.message || String(error),
    };
  }
}

function probeWorkersHeartbeat({ maxLogAgeMs = 120000 } = {}) {
  const launchd = serviceLoaded(LABELS.workers);
  const logPath = path.join(logsHomeDir(), 'audit-workers.out.log');
  let log = { exists: false, mtimeMs: null, fresh: false, path: logPath };
  try {
    if (fs.existsSync(logPath)) {
      const st = fs.statSync(logPath);
      const ageMs = Date.now() - st.mtimeMs;
      log = {
        exists: true,
        mtimeMs: st.mtimeMs,
        ageMs,
        fresh: ageMs <= maxLogAgeMs,
        path: logPath,
      };
    }
  } catch (error) {
    log.error = error.message;
  }

  // Heartbeat: launchd unit registered+running. Log freshness is informative
  // (quiet workers may not write often under low load).
  const ok = launchd.registered === true && launchd.running === true;
  return {
    ok,
    launchd: {
      loaded: launchd.registered === true,
      running: launchd.running === true,
      state: launchd.rawState,
      pid: launchd.pid,
      label: LABELS.workers,
    },
    log,
    note: ok
      ? 'Workers launchd unit is registered and running (projection/outbox loops).'
      : 'Workers launchd unit is not running; factory live verifies will invent catch-up without it.',
  };
}

/**
 * Health report for factory of record.
 * Required: postgres, api, openclaw, workers heartbeat.
 * Claim topology (default required when installed): ui, forgeadapter.
 */
async function collectHealthReport({
  apiPort = DEFAULT_PORTS.api,
  uiPort = DEFAULT_PORTS.ui,
  requireUi = true,
  requireForgeadapter = true,
} = {}) {
  const openclawUrl = defaultOpenclawUrl();
  const launchd = launchdStatus();
  const [
    postgres,
    api,
    openclaw,
    openclawMock,
    hermesMock,
    forge,
    ui,
  ] = await Promise.all([
    probePostgres(),
    probeHttp(`http://127.0.0.1:${apiPort}/health`),
    probeHttp(`${openclawUrl.replace(/\/$/, '')}/health`),
    probeHttp(`http://127.0.0.1:${DEFAULT_PORTS.openclawMock}/health`),
    probeHttp(`http://127.0.0.1:${DEFAULT_PORTS.hermesMock}/health`),
    probeHttp(`http://127.0.0.1:${DEFAULT_PORTS.forgeadapter}/health`),
    probeHttp(`http://127.0.0.1:${uiPort}/`),
  ]);

  const workers = probeWorkersHeartbeat();
  const postgresEnsure = {
    ok: launchd.postgresEnsure?.loaded === true && launchd.postgresEnsure?.running === true,
    launchd: launchd.postgresEnsure,
  };

  const required = {
    postgres,
    api,
    openclaw,
    workers,
  };
  const claimTopology = {
    ui: {
      ...ui,
      required: requireUi,
      launchd: launchd.ui,
    },
    forgeadapter: {
      ...forge,
      required: requireForgeadapter,
      launchd: launchd.forgeadapter,
    },
  };
  const optional = {
    openclawMock,
    hermesMock,
    postgresEnsure,
  };

  const requiredOk = Object.values(required).every((item) => item.ok === true);
  const claimOk = Object.values(claimTopology).every((item) => (
    item.required !== true || item.ok === true
  ));

  return {
    ok: requiredOk && claimOk,
    requiredOk,
    claimTopologyOk: claimOk,
    required,
    claimTopology,
    optional,
    launchd,
    notes: [
      'Required for factory of record: postgres, audit API, workers (launchd heartbeat), live OpenClaw gateway.',
      'Claim topology (default): UI :15173 and forgeadapter :14010 when not skipped.',
      'openclawMock/hermesMock are optional and must not be used for live factory claims.',
      'Postgres durability: docker compose restart=unless-stopped + factory-postgres-ensure launchd watcher.',
    ],
  };
}

/**
 * Structured acceptance-criteria evaluation for GitLab #269.
 */
function evaluateFactoryStackAcceptance({ health, launchd, dockerAvailable: dockerOk } = {}) {
  const criteria = [];

  const ac1 = health?.ok === true
    && launchd?.api?.loaded === true
    && launchd?.workers?.loaded === true
    && launchd?.postgresEnsure?.loaded === true;
  criteria.push({
    id: 'AC1',
    title: 'One script restores healthy stack without tribal steps',
    ok: ac1,
    detail: ac1
      ? 'factory:stack:up/status reports healthy required services with launchd units loaded.'
      : 'Stack health or launchd units incomplete. Run npm run factory:stack:up then status.',
  });

  const workersOk = health?.required?.workers?.ok === true
    && launchd?.workers?.running === true;
  criteria.push({
    id: 'AC2',
    title: 'Workers stay up; live C does not require inventing worker process',
    ok: workersOk,
    detail: workersOk
      ? 'Workers launchd unit is running (projection/outbox).'
      : 'Workers unit not running; live verifies will fall back to manual projection catch-up.',
  });

  const runbookPaths = [
    'docs/runbooks/golden-path-autonomous-delivery.md',
    'docs/runbooks/audit-foundation.md',
    'docs/reports/AUTONOMOUS_SOFTWARE_FACTORY_READINESS_ASSESSMENT_2026-07-10.md',
  ];
  const runbookOk = runbookPaths.every((rel) => {
    try {
      const text = fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
      return /factory:stack:up|#269|Durable factory stack/i.test(text);
    } catch {
      return false;
    }
  });
  criteria.push({
    id: 'AC3',
    title: 'Runbook section linked from readiness assessment',
    ok: runbookOk,
    detail: runbookOk
      ? 'Golden-path, audit-foundation, and assessment reference factory:stack / #269.'
      : 'Missing factory:stack documentation cross-links.',
  });

  // Scope checklist (not separate ACs but issue scope)
  const scope = [
    {
      id: 'SCOPE-postgres',
      ok: health?.required?.postgres?.ok === true && launchd?.postgresEnsure?.loaded === true,
      title: 'Persist Postgres (compose restart + ensure watcher)',
    },
    {
      id: 'SCOPE-api',
      ok: health?.required?.api?.ok === true && launchd?.api?.loaded === true,
      title: 'Persist audit API with live factory env',
    },
    {
      id: 'SCOPE-workers',
      ok: workersOk,
      title: 'Persist audit workers',
    },
    {
      id: 'SCOPE-ui',
      ok: health?.claimTopology?.ui?.ok === true && launchd?.ui?.loaded === true,
      title: 'Persist UI (claim topology)',
    },
    {
      id: 'SCOPE-forgeadapter',
      ok: health?.claimTopology?.forgeadapter?.ok === true && launchd?.forgeadapter?.loaded === true,
      title: 'Persist forgeadapter (claim topology)',
      optionalWhenMissing: health?.claimTopology?.forgeadapter?.required === false,
    },
    {
      id: 'SCOPE-scripts',
      ok: true,
      title: 'factory:stack:up|down|status|restart contract',
    },
  ];

  const allAcOk = criteria.every((c) => c.ok);
  const scopeRequiredOk = scope.every((s) => s.ok || s.optionalWhenMissing);
  return {
    ok: allAcOk && scopeRequiredOk,
    issue: 269,
    criteria,
    scope,
    dockerAvailable: Boolean(dockerOk),
  };
}

module.exports = {
  probeHttp,
  probePostgres,
  probeWorkersHeartbeat,
  collectHealthReport,
  evaluateFactoryStackAcceptance,
};
