const crypto = require('crypto');

function base64UrlDecode(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, 'base64').toString('utf8');
}

function verifyHmacJwt(token, secret, options = {}) {
  if (!token) throw new Error('missing bearer token');
  if (!secret) throw new Error('AUTH_JWT_SECRET is required');

  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('invalid jwt format');
  const [headerPart, payloadPart, signaturePart] = parts;
  const header = JSON.parse(base64UrlDecode(headerPart));
  const payload = JSON.parse(base64UrlDecode(payloadPart));

  if (header.alg !== 'HS256') throw new Error(`unsupported jwt alg: ${header.alg}`);

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${headerPart}.${payloadPart}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const actual = Buffer.from(signaturePart);
  const wanted = Buffer.from(expected);
  if (actual.length !== wanted.length || !crypto.timingSafeEqual(actual, wanted)) {
    throw new Error('invalid jwt signature');
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now >= payload.exp) throw new Error('jwt expired');
  if (payload.nbf && now < payload.nbf) throw new Error('jwt not active yet');
  if (options.issuer && payload.iss !== options.issuer) throw new Error('jwt issuer mismatch');
  if (options.audience) {
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud].filter(Boolean);
    if (!audiences.includes(options.audience)) throw new Error('jwt audience mismatch');
  }

  return payload;
}

function getBearerToken(req) {
  const authorization = req.headers.authorization || req.headers.Authorization;
  if (!authorization) return null;
  const [scheme, token] = authorization.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token;
}

function buildPrincipalFromClaims(claims, options = {}) {
  const rolesClaim = options.rolesClaim || 'roles';
  const tenantClaim = options.tenantClaim || 'tenant_id';
  const actorClaim = options.actorClaim || 'sub';
  const roles = claims[rolesClaim];
  return {
    tenantId: claims[tenantClaim] || null,
    actorId: claims[actorClaim] || null,
    roles: Array.isArray(roles) ? roles : String(roles || '').split(',').map(value => value.trim()).filter(Boolean),
    claims,
    authType: 'jwt',
  };
}

module.exports = {
  verifyHmacJwt,
  getBearerToken,
  buildPrincipalFromClaims,
};
