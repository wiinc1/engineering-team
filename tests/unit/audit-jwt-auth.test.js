const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { verifyHmacJwt } = require('../../lib/auth/jwt');

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
