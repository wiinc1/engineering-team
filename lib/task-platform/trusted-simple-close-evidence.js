'use strict';

/**
 * GitLab #274 — trusted Simple close evidence package.
 * Session-proof implementer JSON is not valid here; real PR URL + merge SHA required.
 */

const fs = require('node:fs');
const path = require('node:path');
const { commitShaEvidenceFailure } = require('./real-commit-sha');
const { assertRealPhase6AutoMerge } = require('./golden-path-phase6-auto-merge-proof');
const {
  isTrustedDeliveryMode,
  assertRealImplementerArtifacts,
  prNumberFromUrl,
} = require('./factory-agent-phases');

const DEFAULT_PILOT_PR_NUMBER = 271;
const SCHEMA_VERSION = 'trusted-simple-close-evidence.v1';

function parseBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function normalizeTier(value) {
  const tier = String(value || 'Simple').trim();
  if (!tier) return 'Simple';
  return tier.charAt(0).toUpperCase() + tier.slice(1).toLowerCase();
}

function isTrustedSimpleCloseRequired(options = {}, env = process.env) {
  if (options.sessionProofOnly === true || options.allowSyntheticEvidence === true) return false;
  if (options.trustedDelivery === true || options.requireTrustedSimpleClose === true) return true;
  if (isTrustedDeliveryMode(options, env)) {
    const tier = normalizeTier(options.templateTier || options.tier || 'Simple');
    return tier === 'Simple';
  }
  return parseBoolean(env.FF_FACTORY_TRUSTED_SIMPLE_CLOSE, false)
    || parseBoolean(env.FACTORY_TRUSTED_DELIVERY, false);
}

function extractPrNumber(prUrl, prNumber) {
  const fromUrl = prNumberFromUrl(prUrl);
  const provided = Number(prNumber) || null;
  return fromUrl || provided || null;
}

/**
 * Fail-closed validation of a trusted Simple close evidence package.
 * @param {object} evidence
 * @param {object} [options]
 */
function assertTrustedSimpleCloseEvidence(evidence = {}, options = {}) {
  const failures = [];
  const tier = normalizeTier(evidence.templateTier || evidence.tier || options.templateTier || 'Simple');
  if (tier !== 'Simple' && options.allowNonSimple !== true) {
    failures.push(`templateTier must be Simple for trusted Simple close (got ${tier})`);
  }

  const branchName = evidence.branchName || evidence.branch || evidence.github?.branchName;
  const commitSha = evidence.implementationCommitSha
    || evidence.commitSha
    || evidence.github?.commitSha
    || evidence.implementation?.commitSha;
  const prUrl = evidence.prUrl || evidence.pullRequestUrl || evidence.github?.prUrl;
  const prNumber = extractPrNumber(prUrl, evidence.prNumber || evidence.github?.prNumber);
  const mergeCommitSha = evidence.mergeCommitSha
    || evidence.merge_commit_sha
    || evidence.github?.mergeCommitSha
    || evidence.autoMerge?.mergeCommitSha;
  const mergedAt = evidence.mergedAt || evidence.merged_at || evidence.autoMerge?.mergedAt || evidence.github?.mergedAt;
  const merged = evidence.merged === true
    || evidence.autoMerge?.merged === true
    || evidence.github?.merged === true;

  try {
    assertRealImplementerArtifacts({
      branchName,
      commitSha,
      prUrl,
      prNumber,
    });
  } catch (error) {
    failures.push(error.message);
  }

  if (prNumber === DEFAULT_PILOT_PR_NUMBER) {
    failures.push('default pilot PR #271 is not valid trusted Simple close evidence');
  }

  const mergeProof = {
    simulated: evidence.autoMerge?.simulated === true || evidence.simulated === true,
    skipped: evidence.autoMerge?.skipped === true || evidence.autoMergeSkipped === true,
    merged,
    mergeCommitSha,
    mergedAt,
    reason: evidence.autoMerge?.reason || evidence.reason || null,
  };

  try {
    assertRealPhase6AutoMerge(mergeProof);
  } catch (error) {
    failures.push(error.message);
  }

  if (!evidence.prUrl && !evidence.github?.prUrl && prUrl) {
    // ok — will normalize into package
  }

  if (failures.length) {
    throw new Error(`Trusted Simple close evidence invalid (GitLab #274): ${failures.join('; ')}`);
  }

  return {
    ok: true,
    templateTier: 'Simple',
    branchName,
    commitSha,
    prUrl,
    prNumber,
    mergeCommitSha,
    mergedAt,
    merged: true,
  };
}

/**
 * Build a durable evidence package from real inputs (does not invent SHAs/PRs).
 */
function buildTrustedSimpleCloseEvidence(input = {}, options = {}) {
  const templateTier = normalizeTier(input.templateTier || options.templateTier || 'Simple');
  const branchName = input.branchName || input.branch;
  const commitSha = input.implementationCommitSha || input.commitSha;
  const prUrl = input.prUrl || input.pullRequestUrl;
  const prNumber = extractPrNumber(prUrl, input.prNumber);
  const mergeCommitSha = input.mergeCommitSha || input.merge_commit_sha;
  const mergedAt = input.mergedAt || input.merged_at || new Date().toISOString();
  const packageBody = {
    schemaVersion: SCHEMA_VERSION,
    issue: 274,
    mode: 'trusted_delivery',
    templateTier,
    branchName,
    implementationCommitSha: commitSha,
    commitSha,
    prUrl,
    prNumber,
    mergeCommitSha,
    mergedAt,
    merged: true,
    autoMerge: {
      simulated: false,
      skipped: false,
      merged: true,
      mergeCommitSha,
      mergedAt,
      reason: input.autoMergeReason || 'eligible_simple_green_checks',
    },
    github: {
      branchName,
      commitSha,
      prUrl,
      prNumber,
      mergeCommitSha,
      mergedAt,
      merged: true,
    },
    checks: input.checks || input.requiredChecks || ['unit tests', 'Merge readiness'],
    mergeReadiness: input.mergeReadiness || { status: 'ready', source: input.mergeReadinessSource || 'operator_or_ci' },
    recordedAt: new Date().toISOString(),
    notes: input.notes || 'Trusted Simple close evidence package (GitLab #274).',
  };

  assertTrustedSimpleCloseEvidence(packageBody, options);
  return packageBody;
}

function writeTrustedSimpleCloseEvidence(filePath, evidence) {
  const resolved = path.resolve(process.cwd(), filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const validated = assertTrustedSimpleCloseEvidence(evidence);
  const body = {
    ...evidence,
    ...validated,
    schemaVersion: evidence.schemaVersion || SCHEMA_VERSION,
  };
  fs.writeFileSync(resolved, `${JSON.stringify(body, null, 2)}\n`);
  return { path: resolved, evidence: body };
}

/**
 * Factory/orchestrator option helper: force trusted Simple real-evidence flags.
 */
function applyTrustedSimpleCloseOptions(options = {}, env = process.env) {
  if (!isTrustedSimpleCloseRequired(options, env)) {
    return { ...options, trustedSimpleClose: false };
  }
  return {
    ...options,
    templateTier: normalizeTier(options.templateTier || 'Simple'),
    trustedDelivery: true,
    requireRealEvidence: true,
    collectRealEvidence: true,
    autoMerge: options.autoMerge !== false,
    trustedSimpleClose: true,
    sessionProofOnly: false,
    allowSyntheticEvidence: false,
  };
}

module.exports = {
  SCHEMA_VERSION,
  DEFAULT_PILOT_PR_NUMBER,
  isTrustedSimpleCloseRequired,
  assertTrustedSimpleCloseEvidence,
  buildTrustedSimpleCloseEvidence,
  writeTrustedSimpleCloseEvidence,
  applyTrustedSimpleCloseOptions,
  extractPrNumber,
  // re-export for auditor convenience
  isTrustedDeliveryMode,
  assertRealImplementerArtifacts,
  assertRealPhase6AutoMerge,
  commitShaEvidenceFailure,
};
