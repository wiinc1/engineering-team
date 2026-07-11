#!/usr/bin/env node
'use strict';

/**
 * GitLab #271 acceptance auditor: live OpenClaw as claim-path default.
 * Code-only by default; optional --live probes real gateway when present.
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  DEFAULT_LIVE_OPENCLAW_URL,
  FACTORY_PROOF_ERROR_CODES,
  resolveOpenClawBaseUrl,
  isOpenClawMockBaseUrl,
  resolveFactoryProofProfile,
} = require('../lib/task-platform/factory-proof-profile');
const { parseArgs, resolveUpstreamUrls } = require('../scripts/dev-golden-path/stack');
const { DEFAULTS } = require('../scripts/dev-golden-path/constants');
const { defaultOpenclawUrl } = require('../lib/task-platform/factory-stack/defaults');

function checkRunbook() {
  const text = fs.readFileSync(path.join(process.cwd(), 'docs/runbooks/golden-path-autonomous-delivery.md'), 'utf8');
  return {
    liveDefaultTable: /OpenClaw \(live default\).*18789/s.test(text) || /live default.*18789/i.test(text),
    mockOptIn: /use-openclaw-mock/.test(text),
    mockNonClaim: /not valid for operator-trusted|non-claim|mock only/i.test(text),
    failClosed: /fails closed|fail-closed|FACTORY_PROOF_PROFILE=live/i.test(text),
    noDefaultMockTable: !/\|\s*OpenClaw\s*\|\s*`http:\/\/127\.0\.0\.1:14001`\s*\|\s*\*\*Mock\*\*/.test(text),
  };
}

function checkPackageScripts() {
  const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
  const c = String(pkg.scripts['milestone-c:verify'] || '');
  const d = String(pkg.scripts['milestone-d:verify'] || '');
  const cFixture = String(pkg.scripts['milestone-c:verify:fixture'] || '');
  return {
    cVerifyNoFixture: c.includes('verify-milestone-c-agent') && !c.includes('allow-fixture-delegation'),
    dVerifyNoFixture: d.includes('verify-milestone-d-closeout') && !d.includes('allow-fixture-delegation'),
    fixtureOptInExists: cFixture.includes('allow-fixture-delegation'),
  };
}

async function main() {
  const liveProbe = process.argv.includes('--live');
  const criteria = [];

  // AC1 / scope: default URL is live
  const defaultUrl = resolveOpenClawBaseUrl({ argv: [], env: {}, preferDefaultLive: true });
  criteria.push({
    id: 'AC1-default-url',
    ok: defaultUrl === DEFAULT_LIVE_OPENCLAW_URL || /:18789\b/.test(defaultUrl),
    detail: `resolveOpenClawBaseUrl preferDefaultLive → ${defaultUrl}`,
  });

  const stackDefaults = parseArgs(['node', 'stack.js', 'up']);
  criteria.push({
    id: 'SCOPE-stack-default-not-mock',
    ok: stackDefaults.useOpenclawMock === false && /18789/.test(DEFAULTS.openclawLiveUrl || ''),
    detail: `useOpenclawMock=${stackDefaults.useOpenclawMock} liveUrl=${DEFAULTS.openclawLiveUrl}`,
  });

  const resolved = await resolveUpstreamUrls({
    ...stackDefaults,
    externalOpenclaw: '',
    externalHermes: 'http://127.0.0.1:14002',
    useOpenclawMock: false,
    skipMocks: true,
  });
  criteria.push({
    id: 'SCOPE-resolveUpstream-live',
    ok: /:18789\b/.test(resolved.openclawUrl || ''),
    detail: `resolveUpstreamUrls → ${resolved.openclawUrl}`,
  });

  criteria.push({
    id: 'SCOPE-factory-stack-env',
    ok: /:18789\b/.test(defaultOpenclawUrl()),
    detail: `defaultOpenclawUrl → ${defaultOpenclawUrl()}`,
  });

  // Default profile without flags → live @ 18789
  try {
    const proof = await resolveFactoryProofProfile({
      argv: ['node', 'verify-milestone-c-agent.js'],
      env: {},
      probe: { available: true, baseUrl: DEFAULT_LIVE_OPENCLAW_URL, latencyMs: 1 },
    });
    criteria.push({
      id: 'AC1-milestone-default-profile',
      ok: proof.profile === 'live' && /18789/.test(proof.openclawBaseUrl || ''),
      detail: `profile=${proof.profile} url=${proof.openclawBaseUrl}`,
    });
  } catch (error) {
    criteria.push({
      id: 'AC1-milestone-default-profile',
      ok: false,
      detail: error.message,
    });
  }

  // AC2: mock cannot satisfy live
  let mockRejected = false;
  try {
    await resolveFactoryProofProfile({
      argv: ['node', 'verify'],
      env: { FACTORY_PROOF_PROFILE: 'live', OPENCLAW_BASE_URL: 'http://127.0.0.1:14001' },
      openclawUrl: 'http://127.0.0.1:14001',
      probe: { available: true, baseUrl: 'http://127.0.0.1:14001', latencyMs: 1 },
    });
  } catch (error) {
    mockRejected = error.code === FACTORY_PROOF_ERROR_CODES.MOCK_GATEWAY_FORBIDDEN;
  }
  criteria.push({
    id: 'AC2-mock-cannot-satisfy-live',
    ok: mockRejected && isOpenClawMockBaseUrl('http://127.0.0.1:14001'),
    detail: mockRejected
      ? 'MOCK_GATEWAY_FORBIDDEN on :14001 under live profile'
      : 'mock gateway was accepted under live profile',
  });

  // AC2: down gateway fails closed
  let downRejected = false;
  try {
    await resolveFactoryProofProfile({
      argv: ['node', 'verify'],
      env: { FACTORY_PROOF_PROFILE: 'live' },
      openclawUrl: DEFAULT_LIVE_OPENCLAW_URL,
      probe: {
        available: false,
        baseUrl: DEFAULT_LIVE_OPENCLAW_URL,
        errorCode: FACTORY_PROOF_ERROR_CODES.GATEWAY_UNAVAILABLE,
        errorMessage: 'ECONNREFUSED',
      },
    });
  } catch (error) {
    downRejected = error.code === FACTORY_PROOF_ERROR_CODES.GATEWAY_UNAVAILABLE;
  }
  criteria.push({
    id: 'AC2-down-gateway-fail-closed',
    ok: downRejected,
    detail: downRejected ? 'GATEWAY_UNAVAILABLE' : 'down gateway not rejected',
  });

  // Fixture runner under live
  let fixtureRejected = false;
  try {
    await resolveFactoryProofProfile({
      argv: ['node', 'verify'],
      env: {
        FACTORY_PROOF_PROFILE: 'live',
        SPECIALIST_DELEGATION_RUNNER: 'node tests/fixtures/specialist-runtime-runner.js',
      },
      openclawUrl: DEFAULT_LIVE_OPENCLAW_URL,
      probe: { available: true, baseUrl: DEFAULT_LIVE_OPENCLAW_URL, latencyMs: 1 },
    });
  } catch (error) {
    fixtureRejected = error.code === FACTORY_PROOF_ERROR_CODES.FIXTURE_FORBIDDEN;
  }
  criteria.push({
    id: 'SCOPE-fixture-runner-fail-closed',
    ok: fixtureRejected,
    detail: fixtureRejected ? 'FIXTURE_FORBIDDEN' : 'fixture runner accepted under live',
  });

  const runbook = checkRunbook();
  criteria.push({
    id: 'SCOPE-runbook-claim-topology',
    ok: Object.values(runbook).every(Boolean),
    detail: JSON.stringify(runbook),
  });

  const scripts = checkPackageScripts();
  criteria.push({
    id: 'SCOPE-package-verify-defaults',
    ok: Object.values(scripts).every(Boolean),
    detail: JSON.stringify(scripts),
  });

  if (liveProbe) {
    try {
      const live = await resolveFactoryProofProfile({
        argv: ['node', 'verify', '--live-openclaw'],
        env: { ...process.env, FACTORY_PROOF_PROFILE: 'live' },
      });
      criteria.push({
        id: 'LIVE-gateway-probe',
        ok: live.profile === 'live' && !isOpenClawMockBaseUrl(live.openclawBaseUrl),
        detail: `live probe url=${live.openclawBaseUrl}`,
      });
    } catch (error) {
      criteria.push({
        id: 'LIVE-gateway-probe',
        ok: false,
        detail: `${error.code || 'ERR'}: ${error.message}`,
      });
    }
  }

  const report = {
    issue: 271,
    title: 'Make live OpenClaw the stack default claim path (not :14001 mock)',
    ok: criteria.every((c) => c.ok),
    criteria,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
  process.exitCode = 1;
});
