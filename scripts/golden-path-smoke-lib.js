const crypto = require('node:crypto');
const { signHmacJwt } = require('../lib/auth/jwt');

function readArg(argv, name, fallback = '') {
  const index = argv.indexOf(name);
  return index === -1 || index === argv.length - 1 ? fallback : argv[index + 1];
}

function githubSignature(secret, body) {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
}

function authHeaders(jwtSecret, tenantId = 'engineering-team', actorId = 'golden-path-smoke') {
  const now = Math.floor(Date.now() / 1000);
  const token = signHmacJwt({
    sub: actorId,
    tenant_id: tenantId,
    roles: ['admin', 'qa'],
    iat: now,
    exp: now + 300,
  }, jwtSecret);
  return { accept: 'application/json', authorization: `Bearer ${token}` };
}

function writeEvidence(outputPath, evidence) {
  const fs = require('node:fs');
  const path = require('node:path');
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(path.resolve(outputPath), `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

module.exports = {
  readArg,
  githubSignature,
  authHeaders,
  writeEvidence,
};