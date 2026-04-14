const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const http = require('http');
const { createJwtVerifier, signBrowserAuthCode, verifyBrowserAuthCode, verifyHmacJwt } = require('../../lib/auth/jwt');

function sign(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function signRs256(payload, privateKey, header = { alg: 'RS256', typ: 'JWT', kid: 'kid-1' }) {
  const headerPart = Buffer.from(JSON.stringify(header)).toString('base64url');
  const bodyPart = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.sign('RSA-SHA256', Buffer.from(`${headerPart}.${bodyPart}`), privateKey).toString('base64url');
  return `${headerPart}.${bodyPart}.${signature}`;
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

test('verifies RS256 bearer tokens against JWKS and supports custom claim mapping', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const verifier = createJwtVerifier({
    jwks: { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'kid-1', use: 'sig', alg: 'RS256' }] },
    issuer: 'https://idp.example.test/',
    audience: 'engineering-team-api',
  });
  const token = signRs256({
    sub: 'ignored-sub',
    actor: 'pm-42',
    tenant: 'tenant-prod',
    groups: ['pm', 'reader'],
    iss: 'https://idp.example.test/',
    aud: 'engineering-team-api',
    exp: Math.floor(Date.now() / 1000) + 60,
  }, privateKey);

  const claims = await verifier.verify(token);
  assert.equal(claims.actor, 'pm-42');
  assert.equal(claims.tenant, 'tenant-prod');
  assert.deepEqual(claims.groups, ['pm', 'reader']);
});

test('refreshes JWKS when a new kid appears without recreating the verifier', async () => {
  const first = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const second = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  let rotation = 0;
  const server = http.createServer((req, res) => {
    if (req.url !== '/.well-known/jwks.json') {
      res.writeHead(404);
      return res.end();
    }
    const key = rotation === 0 ? first.publicKey : second.publicKey;
    const kid = rotation === 0 ? 'kid-1' : 'kid-2';
    res.writeHead(200, {
      'content-type': 'application/json',
      'cache-control': 'max-age=60',
    });
    res.end(JSON.stringify({ keys: [{ ...key.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' }] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const { port } = server.address();
    const verifier = createJwtVerifier({
      jwksUrl: `http://127.0.0.1:${port}/.well-known/jwks.json`,
      issuer: 'https://idp.example.test/',
      audience: 'engineering-team-api',
    });

    const firstToken = signRs256({
      sub: 'pm-1',
      tenant_id: 'tenant-a',
      roles: ['pm'],
      iss: 'https://idp.example.test/',
      aud: 'engineering-team-api',
      exp: Math.floor(Date.now() / 1000) + 60,
    }, first.privateKey, { alg: 'RS256', typ: 'JWT', kid: 'kid-1' });

    const secondToken = signRs256({
      sub: 'pm-2',
      tenant_id: 'tenant-b',
      roles: ['reader'],
      iss: 'https://idp.example.test/',
      aud: 'engineering-team-api',
      exp: Math.floor(Date.now() / 1000) + 60,
    }, second.privateKey, { alg: 'RS256', typ: 'JWT', kid: 'kid-2' });

    const firstClaims = await verifier.verify(firstToken);
    assert.equal(firstClaims.sub, 'pm-1');

    rotation = 1;
    const secondClaims = await verifier.verify(secondToken);
    assert.equal(secondClaims.sub, 'pm-2');
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});
