'use strict';

const { DEFAULT_PORTS, defaultDatabaseUrl, defaultOpenclawUrl } = require('./defaults');

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

async function collectHealthReport({ apiPort = DEFAULT_PORTS.api } = {}) {
  const openclawUrl = defaultOpenclawUrl();
  const [postgres, api, openclaw, openclawMock, hermesMock, forge] = await Promise.all([
    probePostgres(),
    probeHttp(`http://127.0.0.1:${apiPort}/health`),
    probeHttp(`${openclawUrl.replace(/\/$/, '')}/health`),
    probeHttp(`http://127.0.0.1:${DEFAULT_PORTS.openclawMock}/health`),
    probeHttp(`http://127.0.0.1:${DEFAULT_PORTS.hermesMock}/health`),
    probeHttp(`http://127.0.0.1:${DEFAULT_PORTS.forgeadapter}/health`),
  ]);

  const required = { postgres, api, openclaw };
  const optional = {
    openclawMock,
    hermesMock,
    forgeadapter: forge,
  };
  const requiredOk = Object.values(required).every((item) => item.ok === true);
  return {
    ok: requiredOk,
    required,
    optional,
    notes: [
      'Required for factory of record: postgres, audit API, live OpenClaw gateway.',
      'openclawMock/hermesMock are optional and must not be used for live factory claims.',
      'forgeadapter is optional when STAGING_SKIP_FORGE_* is used for local live proof.',
    ],
  };
}

module.exports = {
  probeHttp,
  probePostgres,
  collectHealthReport,
};
