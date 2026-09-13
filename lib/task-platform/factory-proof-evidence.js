'use strict';

const fs = require('node:fs');
const {
  FACTORY_PROOF_ERROR_CODES,
  createFactoryProofError,
  isFixtureDelegationRunner,
  isFixtureSessionId,
  isFixtureOwnership,
} = require('./factory-proof-profile-resolve');

function extractSessionCandidates(value, bucket = []) {
  if (!value || typeof value !== 'object') return bucket;
  if (Array.isArray(value)) {
    for (const item of value) extractSessionCandidates(item, bucket);
    return bucket;
  }
  const sessionId = value.sessionId || value.session_id || value.pmRefinementSessionId || value.architectSessionId;
  if (sessionId) {
    bucket.push({
      sessionId: String(sessionId),
      agentId: value.agentId || value.runtimeAgentId || value.specialistId || null,
      ownership: value.ownership || null,
      pathHint: value.role || value.phase || null,
    });
  }
  for (const nested of Object.values(value)) {
    if (nested && typeof nested === 'object') extractSessionCandidates(nested, bucket);
  }
  return bucket;
}

function collectAgentSessionEvidence(factoryEvidence = {}) {
  return extractSessionCandidates(factoryEvidence, []);
}

function partitionSessions(sessions) {
  const liveSessions = sessions.filter((entry) => (
    entry.sessionId
    && !isFixtureSessionId(entry.sessionId)
    && !isFixtureOwnership(entry.ownership || {})
  ));
  const fixtureSessions = sessions.filter((entry) => (
    isFixtureSessionId(entry.sessionId) || isFixtureOwnership(entry.ownership || {})
  ));
  return { liveSessions, fixtureSessions };
}

function validateLiveSessionEvidence({
  factoryEvidence = {},
  profile = 'live',
  runner = '',
  requireAtLeastOneSession = true,
} = {}) {
  if (profile === 'fixture') {
    return {
      ok: true,
      profile,
      fixtureDelegation: true,
      sessions: collectAgentSessionEvidence(factoryEvidence),
      errors: [],
    };
  }

  const errors = [];
  if (isFixtureDelegationRunner(runner)) {
    errors.push({
      code: FACTORY_PROOF_ERROR_CODES.FIXTURE_FORBIDDEN,
      message: 'Live factory proof cannot use the fixture specialist runner',
    });
  }

  const sessions = collectAgentSessionEvidence(factoryEvidence);
  const { liveSessions, fixtureSessions } = partitionSessions(sessions);
  if (fixtureSessions.length > 0) {
    errors.push({
      code: FACTORY_PROOF_ERROR_CODES.FIXTURE_ATTRIBUTION,
      message: 'Fixture session attribution is not valid under live factory proof',
      sessions: fixtureSessions.map((s) => s.sessionId),
    });
  }
  if (requireAtLeastOneSession && liveSessions.length === 0) {
    errors.push({
      code: FACTORY_PROOF_ERROR_CODES.MISSING_SESSION,
      message: 'Live factory proof requires at least one real agent sessionId',
    });
  }

  return {
    ok: errors.length === 0,
    profile,
    fixtureDelegation: false,
    sessions,
    liveSessions,
    fixtureSessions,
    errors,
  };
}

function assertLiveProofAllowsCompletion(proof, validation) {
  if (proof?.profile === 'live' && validation && !validation.ok) {
    const first = validation.errors[0] || {};
    throw createFactoryProofError(
      first.code || FACTORY_PROOF_ERROR_CODES.MISSING_SESSION,
      first.message || 'Live factory proof completion blocked',
      { validation },
    );
  }
}

function attachProofMetadata(target = {}, proof = {}, validation = null) {
  return {
    ...target,
    proofProfile: proof.profile || null,
    fixtureDelegation: Boolean(proof.fixtureDelegation),
    runtimeProvider: proof.runtimeProvider || null,
    openclawBaseUrl: proof.openclawBaseUrl || null,
    proofProbe: proof.probe
      ? {
        available: proof.probe.available,
        baseUrl: proof.probe.baseUrl || null,
        latencyMs: proof.probe.latencyMs ?? null,
        errorCode: proof.probe.errorCode || null,
      }
      : null,
    sessionEvidence: validation
      ? {
        ok: validation.ok,
        liveSessionCount: validation.liveSessions?.length || 0,
        fixtureSessionCount: validation.fixtureSessions?.length || 0,
        sessions: (validation.liveSessions || validation.sessions || []).slice(0, 12).map((s) => ({
          sessionId: s.sessionId,
          agentId: s.agentId,
        })),
        errors: validation.errors || [],
      }
      : null,
  };
}

function loadFactoryEvidenceFromResult(evidence = {}) {
  let factoryEvidence = evidence.factoryEvidence || evidence.factory?.factoryEvidence || {};
  const factoryEvidencePath = evidence.artifacts?.factoryEvidence;
  if ((!factoryEvidence || !Object.keys(factoryEvidence).length) && factoryEvidencePath && fs.existsSync(factoryEvidencePath)) {
    factoryEvidence = JSON.parse(fs.readFileSync(factoryEvidencePath, 'utf8'));
  }
  return factoryEvidence;
}

function finalizeLiveProofEvidence(evidence, proof, env = process.env) {
  const factoryEvidence = loadFactoryEvidenceFromResult(evidence);
  const validation = validateLiveSessionEvidence({
    factoryEvidence,
    profile: proof.profile,
    runner: env.SPECIALIST_DELEGATION_RUNNER,
    requireAtLeastOneSession: proof.profile === 'live',
  });
  Object.assign(evidence, attachProofMetadata(evidence, proof, validation));
  if (proof.profile === 'live') {
    evidence.summary = evidence.summary || { passed: false, checks: [] };
    evidence.summary.checks = evidence.summary.checks || [];
    evidence.summary.checks.push({
      name: 'live_session_evidence',
      ok: validation.ok,
      liveSessionCount: validation.liveSessions?.length || 0,
      errors: validation.errors,
    });
    evidence.summary.passed = evidence.summary.checks.every((check) => check.ok);
    if (!validation.ok) assertLiveProofAllowsCompletion(proof, validation);
  }
  return { evidence, validation };
}

function writeMilestoneVerifyReport({
  evidence,
  proof,
  milestone,
  title,
  outputDir,
}) {
  process.stdout.write(`${JSON.stringify({
    ok: evidence.summary.passed,
    milestone,
    title,
    outputDir,
    proofProfile: proof.profile,
    fixtureDelegation: proof.fixtureDelegation,
    openclawBaseUrl: proof.openclawBaseUrl,
    summary: evidence.summary,
    artifacts: evidence.artifacts,
    milestoneDComplete: evidence.artifacts?.milestoneDComplete || undefined,
  }, null, 2)}\n`);
  if (!evidence.summary.passed) process.exitCode = 1;
}

module.exports = {
  collectAgentSessionEvidence,
  validateLiveSessionEvidence,
  assertLiveProofAllowsCompletion,
  attachProofMetadata,
  loadFactoryEvidenceFromResult,
  finalizeLiveProofEvidence,
  writeMilestoneVerifyReport,
};
