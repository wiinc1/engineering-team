function firstAvailable(env, names) {
  for (const name of names) {
    const value = env[name];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function normalizeDeploymentUrl(value) {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

function buildVersionPayload(env = process.env, now = new Date()) {
  const deploymentHost = firstAvailable(env, [
    'VERCEL_URL',
    'DEPLOYMENT_URL',
    'PRODUCTION_URL',
  ]);

  return {
    status: 'healthy',
    environment: firstAvailable(env, ['VERCEL_ENV', 'NODE_ENV']),
    checkedAt: now.toISOString(),
    commitSha: firstAvailable(env, [
      'VERCEL_GIT_COMMIT_SHA',
      'GITHUB_SHA',
      'COMMIT_SHA',
    ]),
    deploymentUrl: normalizeDeploymentUrl(deploymentHost),
    source: 'vercel',
  };
}

module.exports = (req, res) => {
  const payload = buildVersionPayload();

  res.statusCode = 200;
  if (typeof res.setHeader === 'function') {
    res.setHeader('content-type', 'application/json');
  }
  res.end(JSON.stringify(payload));
};

module.exports.buildVersionPayload = buildVersionPayload;
module.exports.normalizeDeploymentUrl = normalizeDeploymentUrl;
