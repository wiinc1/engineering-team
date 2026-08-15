'use strict';

const policy = require('./factory-hermes-claim-policy');

function parseBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function resolveHermesClaimForProof(options, env, explicitProfile) {
  return policy.assertHermesEligibleForClaim({
    hermesUrl: options.hermesUrl || env.HERMES_BASE_URL || '',
    env,
    proofProfile: explicitProfile || 'live',
  });
}

function attachHermesClaimToProof(proof, hermesClaim) {
  return { ...proof, hermesClaim };
}

module.exports = { ...policy, attachHermesClaimToProof, parseBoolean, resolveHermesClaimForProof };
