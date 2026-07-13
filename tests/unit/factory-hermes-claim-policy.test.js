'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  HERMES_CLAIM_DECISION,
  HERMES_CLAIM_ERROR_CODES,
  isHermesMockBaseUrl,
  classifyHermesEndpoint,
  resolveHermesClaimRole,
  isHermesRequiredForClaim,
  evaluateHermesClaimTopology,
  assertHermesEligibleForClaim,
  describeHermesForStackHealth,
} = require('../../lib/task-platform/factory-hermes-claim-policy');
const {
  evaluateHermesClaimTopology: evaluateFromProofProfile,
  assertHermesEligibleForClaim: assertFromProofProfile,
} = require('../../lib/task-platform/factory-proof-profile');
const {
  buildForgeadapterEnv,
  DEFAULT_PORTS,
} = require('../../lib/task-platform/factory-stack/defaults');

describe('factory-hermes-claim-policy (GitLab #272)', () => {
  it('records de-scope decision for Simple / live claim profiles', () => {
    assert.equal(HERMES_CLAIM_DECISION.issue, 272);
    assert.equal(HERMES_CLAIM_DECISION.role, 'non-critical');
    assert.ok(HERMES_CLAIM_DECISION.claimProfiles.includes('live'));
    assert.ok(HERMES_CLAIM_DECISION.claimProfiles.includes('simple-factory'));
    assert.match(HERMES_CLAIM_DECISION.summary, /non-critical|out of scope/i);
  });

  it('classifies hermes-mock ports and service names as mock', () => {
    assert.equal(isHermesMockBaseUrl('http://127.0.0.1:14002'), true);
    assert.equal(isHermesMockBaseUrl('http://127.0.0.1:14002/health'), true);
    assert.equal(isHermesMockBaseUrl('http://hermes-mock:8080'), true);
    assert.equal(isHermesMockBaseUrl('http://127.0.0.1:18789'), false);
    assert.equal(isHermesMockBaseUrl(''), false);
    assert.equal(classifyHermesEndpoint(''), 'unset');
    assert.equal(classifyHermesEndpoint('http://127.0.0.1:14002'), 'mock');
    assert.equal(classifyHermesEndpoint('http://hermes.example.internal:8080'), 'real');
  });

  it('defaults claim role to non-critical (de-scoped)', () => {
    const env = {};
    assert.equal(resolveHermesClaimRole(env), 'non-critical');
    assert.equal(isHermesRequiredForClaim(env), false);
  });

  it('allows claim success when Hermes is unset under default de-scope', () => {
    const evaluation = evaluateHermesClaimTopology({
      hermesUrl: '',
      env: {},
      proofProfile: 'live',
    });
    assert.equal(evaluation.ok, true);
    assert.equal(evaluation.required, false);
    assert.equal(evaluation.claimTopology, false);
    assert.equal(evaluation.classification, 'unset');
    assert.match(evaluation.note, /#272|non-critical|unset/i);
  });

  it('allows claim success when only hermes-mock is configured under de-scope', () => {
    const evaluation = evaluateHermesClaimTopology({
      hermesUrl: 'http://127.0.0.1:14002',
      env: { HERMES_BASE_URL: 'http://127.0.0.1:14002' },
      proofProfile: 'live',
    });
    assert.equal(evaluation.ok, true);
    assert.equal(evaluation.required, false);
    assert.equal(evaluation.classification, 'mock');
    assert.match(evaluation.note, /non-claim|opt-in|#272/i);
  });

  it('fails closed on mock Hermes when claim role is forced required', () => {
    const evaluation = evaluateHermesClaimTopology({
      hermesUrl: 'http://127.0.0.1:14002',
      env: { FACTORY_HERMES_CLAIM_ROLE: 'required' },
      proofProfile: 'live',
    });
    assert.equal(evaluation.ok, false);
    assert.equal(evaluation.required, true);
    assert.equal(evaluation.code, HERMES_CLAIM_ERROR_CODES.MOCK_FORBIDDEN);
    assert.throws(
      () => assertHermesEligibleForClaim({
        hermesUrl: 'http://127.0.0.1:14002',
        env: { HERMES_REQUIRED_FOR_FACTORY_CLAIM: 'true' },
        proofProfile: 'live',
      }),
      (error) => {
        assert.equal(error.code, HERMES_CLAIM_ERROR_CODES.MOCK_FORBIDDEN);
        assert.match(String(error.message), /hermes-mock|#272/i);
        return true;
      },
    );
  });

  it('fails closed when Hermes required but URL unset', () => {
    const evaluation = evaluateHermesClaimTopology({
      hermesUrl: '',
      env: { FACTORY_HERMES_CLAIM_ROLE: 'required' },
      proofProfile: 'live',
    });
    assert.equal(evaluation.ok, false);
    assert.equal(evaluation.code, HERMES_CLAIM_ERROR_CODES.REQUIRED_UNAVAILABLE);
  });

  it('accepts real Hermes URL when claim role is required', () => {
    const evaluation = evaluateHermesClaimTopology({
      hermesUrl: 'http://127.0.0.1:19090',
      env: { FACTORY_HERMES_CLAIM_ROLE: 'required' },
      proofProfile: 'live',
    });
    assert.equal(evaluation.ok, true);
    assert.equal(evaluation.classification, 'real');
    assert.equal(evaluation.required, true);
    assert.doesNotThrow(() => assertHermesEligibleForClaim({
      hermesUrl: 'http://127.0.0.1:19090',
      env: { FACTORY_HERMES_CLAIM_ROLE: 'required' },
      proofProfile: 'live',
    }));
  });

  it('describeHermesForStackHealth marks default Hermes as optional non-claim', () => {
    const described = describeHermesForStackHealth({
      hermesUrl: 'http://127.0.0.1:14002',
      env: {},
      proofProfile: 'live',
    });
    assert.equal(described.optional, true);
    assert.equal(described.liveClaimRequired, false);
    assert.equal(described.mockAllowedForClaims, false);
    assert.equal(described.ok, true);
  });

  it('factory-proof-profile re-exports the same shipped Hermes policy helpers', () => {
    const a = evaluateHermesClaimTopology({ hermesUrl: '', env: {}, proofProfile: 'live' });
    const b = evaluateFromProofProfile({ hermesUrl: '', env: {}, proofProfile: 'live' });
    assert.deepEqual(a, b);
    assert.doesNotThrow(() => assertFromProofProfile({ hermesUrl: '', env: {}, proofProfile: 'live' }));
  });

  it('forgeadapter env does not default HERMES_BASE_URL to hermes-mock', () => {
    const prev = process.env.HERMES_BASE_URL;
    try {
      delete process.env.HERMES_BASE_URL;
      const env = buildForgeadapterEnv();
      assert.equal(Object.prototype.hasOwnProperty.call(env, 'HERMES_BASE_URL'), false);
      assert.notEqual(env.HERMES_BASE_URL, `http://127.0.0.1:${DEFAULT_PORTS.hermesMock}`);
    } finally {
      if (prev === undefined) delete process.env.HERMES_BASE_URL;
      else process.env.HERMES_BASE_URL = prev;
    }
  });

  it('forgeadapter env preserves explicit HERMES_BASE_URL when set', () => {
    const prev = process.env.HERMES_BASE_URL;
    try {
      process.env.HERMES_BASE_URL = 'http://127.0.0.1:19090';
      const env = buildForgeadapterEnv();
      assert.equal(env.HERMES_BASE_URL, 'http://127.0.0.1:19090');
    } finally {
      if (prev === undefined) delete process.env.HERMES_BASE_URL;
      else process.env.HERMES_BASE_URL = prev;
    }
  });
});
