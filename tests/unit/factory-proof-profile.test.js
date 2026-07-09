const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FACTORY_PROOF_ERROR_CODES,
  FIXTURE_WARNING,
  isFixtureSessionId,
  isFixtureDelegationRunner,
  probeOpenClawGateway,
  resolveFactoryProofProfile,
  applyFactoryProofProfileToEnv,
  validateLiveSessionEvidence,
  collectAgentSessionEvidence,
} = require('../../lib/task-platform/factory-proof-profile');

test('probeOpenClawGateway reports available on successful health response', async () => {
  const probe = await probeOpenClawGateway({
    baseUrl: 'http://openclaw.test',
    fetchImpl: async () => ({ ok: true, status: 200 }),
  });
  assert.equal(probe.available, true);
  assert.equal(probe.baseUrl, 'http://openclaw.test');
  assert.ok(Number.isFinite(probe.latencyMs));
});

test('probeOpenClawGateway reports unavailable when all probe targets fail', async () => {
  const probe = await probeOpenClawGateway({
    baseUrl: 'http://openclaw.test',
    fetchImpl: async () => {
      throw new Error('ECONNREFUSED');
    },
  });
  assert.equal(probe.available, false);
  assert.equal(probe.errorCode, FACTORY_PROOF_ERROR_CODES.GATEWAY_UNAVAILABLE);
});

test('resolveFactoryProofProfile selects live when gateway probe succeeds', async () => {
  const proof = await resolveFactoryProofProfile({
    argv: ['node', 'verify'],
    env: {},
    openclawUrl: 'http://127.0.0.1:18789',
    probe: { available: true, baseUrl: 'http://127.0.0.1:18789', latencyMs: 5 },
  });
  assert.equal(proof.profile, 'live');
  assert.equal(proof.fixtureDelegation, false);
  assert.match(proof.runner, /openclaw-specialist-runner\.js/);
});

test('resolveFactoryProofProfile fails closed when gateway unavailable on primary path', async () => {
  await assert.rejects(
    () => resolveFactoryProofProfile({
      argv: ['node', 'verify'],
      env: {},
      openclawUrl: 'http://127.0.0.1:18789',
      probe: {
        available: false,
        baseUrl: 'http://127.0.0.1:18789',
        errorCode: FACTORY_PROOF_ERROR_CODES.GATEWAY_UNAVAILABLE,
        errorMessage: 'ECONNREFUSED',
      },
    }),
    (error) => error.code === FACTORY_PROOF_ERROR_CODES.GATEWAY_UNAVAILABLE,
  );
});

test('resolveFactoryProofProfile allows explicit fixture opt-in', async () => {
  const proof = await resolveFactoryProofProfile({
    argv: ['node', 'verify', '--allow-fixture-delegation'],
    env: {},
  });
  assert.equal(proof.profile, 'fixture');
  assert.equal(proof.fixtureAllowed, true);
  assert.equal(proof.warning, FIXTURE_WARNING);
  assert.match(proof.runner, /specialist-runtime-runner\.js/);
});

test('applyFactoryProofProfileToEnv sets live runner and non-fixture flags', () => {
  const env = {};
  applyFactoryProofProfileToEnv({
    profile: 'live',
    fixtureDelegation: false,
    openclawBaseUrl: 'http://127.0.0.1:18789',
    runner: 'node scripts/openclaw-specialist-runner.js',
  }, env);
  assert.equal(env.FACTORY_PROOF_PROFILE, 'live');
  assert.equal(env.FACTORY_USE_FIXTURE_DELEGATION, 'false');
  assert.equal(env.FF_REAL_SPECIALIST_DELEGATION, 'true');
  assert.equal(env.OPENCLAW_BASE_URL, 'http://127.0.0.1:18789');
  assert.match(env.SPECIALIST_DELEGATION_RUNNER, /openclaw-specialist-runner/);
});

test('fixture session detection recognizes fixture markers', () => {
  assert.equal(isFixtureSessionId('runtime-session-abc'), true);
  assert.equal(isFixtureSessionId('fixture-session-1'), true);
  assert.equal(isFixtureSessionId('sess_live_9f3a'), false);
  assert.equal(isFixtureDelegationRunner('node tests/fixtures/specialist-runtime-runner.js'), true);
});

test('validateLiveSessionEvidence accepts live sessions and rejects fixture attribution', () => {
  const live = validateLiveSessionEvidence({
    profile: 'live',
    runner: 'node scripts/openclaw-specialist-runner.js',
    factoryEvidence: {
      phase2: { api: { implementerAgent: { sessionId: 'sess_live_implementer', agentId: 'sr-engineer' } } },
      phase3: { api: { qaAgent: { sessionId: 'sess_live_qa', agentId: 'qa-engineer' } } },
    },
  });
  assert.equal(live.ok, true);
  assert.equal(live.liveSessions.length, 2);

  const fixture = validateLiveSessionEvidence({
    profile: 'live',
    runner: 'node tests/fixtures/specialist-runtime-runner.js',
    factoryEvidence: {
      phase2: { api: { implementerAgent: { sessionId: 'runtime-session-1', ownership: { runtime: 'fixture-openclaw' } } } },
    },
  });
  assert.equal(fixture.ok, false);
  assert.ok(fixture.errors.some((e) => e.code === FACTORY_PROOF_ERROR_CODES.FIXTURE_FORBIDDEN));
  assert.ok(fixture.errors.some((e) => e.code === FACTORY_PROOF_ERROR_CODES.FIXTURE_ATTRIBUTION));
});

test('collectAgentSessionEvidence walks nested factory evidence', () => {
  const sessions = collectAgentSessionEvidence({
    phase1: { api: { pmRefinementSessionId: 'sess_pm' } },
    phase2: { api: { implementerAgent: { sessionId: 'sess_eng' } } },
  });
  assert.equal(sessions.length, 2);
  assert.deepEqual(sessions.map((s) => s.sessionId).sort(), ['sess_eng', 'sess_pm']);
});

test('explicit fixture proof profile disables real-evidence preflight mode', () => {
  const {
    assertGoldenPathRealEvidencePreflight,
  } = require('../../lib/task-platform/golden-path-real-evidence-preflight');
  const result = assertGoldenPathRealEvidencePreflight({
    agentDrivenPhases: true,
    proofProfile: 'fixture',
  }, { context: 'fixture smoke' });
  assert.equal(result.required, false);
});
