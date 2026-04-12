const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { signBrowserAuthCode, verifyBrowserAuthCode, verifyHmacJwt } = require('../../lib/auth/jwt');

function sign(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

test('verifies HS256 bearer tokens', () => {
  const secret = 'test-secret';
  const token = sign({ sub: 'principal-engineer', tenant_id: 'tenant-a', roles: ['admin'], exp: Math.floor(Date.now() / 1000) + 60 }, secret);
  const claims = verifyHmacJwt(token, secret);
  assert.equal(claims.sub, 'principal-engineer');
  assert.equal(claims.tenant_id, 'tenant-a');
});

test('signs and verifies trusted browser auth codes with normalized claims', () => {
  const secret = 'browser-auth-secret';
  const authCode = signBrowserAuthCode({
    actorId: 'pm-1',
    tenantId: 'tenant-a',
    roles: ['pm', 'reader'],
  }, secret, {
    issuer: 'internal-auth',
    audience: 'browser-shell',
  });

  const verified = verifyBrowserAuthCode(authCode, secret, {
    issuer: 'internal-auth',
    audience: 'browser-shell',
  });

  assert.equal(verified.actorId, 'pm-1');
  assert.equal(verified.tenantId, 'tenant-a');
  assert.deepEqual(verified.roles, ['pm', 'reader']);
  assert.equal(verified.claims.sub, 'pm-1');
  assert.equal(verified.claims.tenant_id, 'tenant-a');
  assert.deepEqual(verified.claims.roles, ['pm', 'reader']);
  assert.equal(verified.claims.token_use, 'browser_auth_code');
  assert.equal(verified.claims.iss, 'internal-auth');
  assert.equal(verified.claims.aud, 'browser-shell');
  assert.equal(typeof verified.claims.iat, 'number');
  assert.equal(typeof verified.claims.exp, 'number');
});
