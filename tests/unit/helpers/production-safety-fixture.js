function digest(seed) {
  const hex = Buffer.from(String(seed || '0')).toString('hex') || '00';
  return hex.repeat(64).slice(0, 64);
}

function validationArtifact(key, {
  commitSha,
  deploymentUrl,
  status = 'passed',
  commitVerified = false,
} = {}) {
  return {
    path: `observability/release/artifacts/${key}.json`,
    digest_algorithm: 'sha256',
    digest: digest(key[0] || '0'),
    status,
    commit_sha: commitSha,
    deployment_url: deploymentUrl || null,
    commit_verified: commitVerified,
  };
}

function productionSafetyEvidence({
  environment = 'staging',
  deploymentUrl,
  commitSha,
  validatedAt = '2026-07-05T00:00:00.000Z',
} = {}) {
  return {
    environment,
    deployment_url: deploymentUrl,
    commit_sha: commitSha,
    validation_status: 'passed',
    production_safe: true,
    risk_level: 'low',
    validated_at: validatedAt,
    validation_artifacts: {
      source: 'release-artifacts',
      artifact_dir: 'observability/release/artifacts',
      artifacts: {
        build: validationArtifact('build', { commitSha }),
        compatibility: validationArtifact('compatibility-report', { commitSha }),
        vulnerability: validationArtifact('vulnerability-scan', { commitSha }),
        secret: validationArtifact('secret-scan', { commitSha }),
        health: validationArtifact('post-deploy-health', {
          commitSha,
          deploymentUrl,
          status: 'healthy',
          commitVerified: true,
        }),
      },
    },
  };
}

module.exports = {
  productionSafetyEvidence,
};
