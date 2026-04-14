const crypto = require('crypto');
const BROWSER_AUTH_CODE_TOKEN_USE = 'browser_auth_code';
const DEFAULT_JWKS_CACHE_MS = 5 * 60 * 1000;

function base64UrlDecode(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, 'base64').toString('utf8');
}

function base64UrlDecodeBuffer(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, 'base64');
}

function parseJwt(token) {
  if (!token) throw new Error('missing bearer token');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('invalid jwt format');
  const [headerPart, payloadPart, signaturePart] = parts;
  return {
    headerPart,
    payloadPart,
    signaturePart,
    header: JSON.parse(base64UrlDecode(headerPart)),
    payload: JSON.parse(base64UrlDecode(payloadPart)),
  };
}

function assertStandardClaims(payload, options = {}) {
  const now = Math.floor((options.nowMs || Date.now()) / 1000);
  if (payload.exp && now >= payload.exp) throw new Error('jwt expired');
  if (payload.nbf && now < payload.nbf) throw new Error('jwt not active yet');
  if (options.issuer && payload.iss !== options.issuer) throw new Error('jwt issuer mismatch');
  if (options.audience) {
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud].filter(Boolean);
    if (!audiences.includes(options.audience)) throw new Error('jwt audience mismatch');
  }
}

function getVerifyAlgorithm(alg) {
  switch (alg) {
    case 'RS256': return { algorithm: 'RSA-SHA256' };
    case 'RS384': return { algorithm: 'RSA-SHA384' };
    case 'RS512': return { algorithm: 'RSA-SHA512' };
    case 'PS256': return {
      algorithm: 'sha256',
      keyOptions: { padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST },
    };
    case 'PS384': return {
      algorithm: 'sha384',
      keyOptions: { padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST },
    };
    case 'PS512': return {
      algorithm: 'sha512',
      keyOptions: { padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST },
    };
    case 'ES256': return { algorithm: 'sha256' };
    case 'ES384': return { algorithm: 'sha384' };
    case 'ES512': return { algorithm: 'sha512' };
    default: throw new Error(`unsupported jwt alg: ${alg}`);
  }
}

function verifyJwkJwt(token, jwk, options = {}) {
  const { headerPart, payloadPart, signaturePart, header, payload } = parseJwt(token);
  const { algorithm, keyOptions } = getVerifyAlgorithm(header.alg);
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const signature = base64UrlDecodeBuffer(signaturePart);
  const verified = crypto.verify(
    algorithm,
    Buffer.from(`${headerPart}.${payloadPart}`),
    keyOptions ? { key, ...keyOptions } : key,
    signature,
  );
  if (!verified) throw new Error('invalid jwt signature');
  assertStandardClaims(payload, options);
  return payload;
}

function verifyHmacJwt(token, secret, options = {}) {
  if (!secret) throw new Error('AUTH_JWT_SECRET is required');
  const { headerPart, payloadPart, signaturePart, header, payload } = parseJwt(token);

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
  assertStandardClaims(payload, options);
  return payload;
}

function signHmacJwt(payload, secret, header = { alg: 'HS256', typ: 'JWT' }) {
  if (!secret) throw new Error('AUTH_JWT_SECRET is required');

  const headerPart = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadPart = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${headerPart}.${payloadPart}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${headerPart}.${payloadPart}.${signature}`;
}

function normalizeRoles(roles) {
  return Array.isArray(roles)
    ? roles.map((value) => String(value || '').trim()).filter(Boolean)
    : String(roles || '').split(',').map((value) => value.trim()).filter(Boolean);
}

function signBrowserAuthCode({ actorId, tenantId, roles }, secret, options = {}) {
  const normalizedRoles = normalizeRoles(roles);
  const now = Math.floor((options.nowMs || Date.now()) / 1000);
  const payload = {
    sub: String(actorId || '').trim(),
    tenant_id: String(tenantId || '').trim(),
    roles: normalizedRoles,
    token_use: BROWSER_AUTH_CODE_TOKEN_USE,
    iat: now,
    exp: now + (Number.isFinite(options.ttlSeconds) ? options.ttlSeconds : 300),
  };

  if (!payload.sub || !payload.tenant_id || !payload.roles.length) {
    throw new Error('browser auth code requires actor, tenant, and roles');
  }
  if (options.issuer) payload.iss = options.issuer;
  if (options.audience) payload.aud = options.audience;
  return signHmacJwt(payload, secret);
}

function verifyBrowserAuthCode(authCode, secret, options = {}) {
  const claims = verifyHmacJwt(authCode, secret, {
    issuer: options.issuer,
    audience: options.audience,
  });
  const roles = normalizeRoles(claims.roles);

  if (claims.token_use !== BROWSER_AUTH_CODE_TOKEN_USE) {
    throw new Error('invalid auth code purpose');
  }
  if (!claims.sub || !claims.tenant_id || !roles.length) {
    throw new Error('invalid auth code claims');
  }

  return {
    actorId: claims.sub,
    tenantId: claims.tenant_id,
    roles,
    claims,
  };
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
    roles: normalizeRoles(roles),
    claims,
    authType: 'jwt',
  };
}

function normalizeJwksDocument(document) {
  if (Array.isArray(document)) return document;
  if (Array.isArray(document?.keys)) return document.keys;
  throw new Error('invalid jwks payload');
}

function parseCacheControlMaxAge(headerValue) {
  const match = String(headerValue || '').match(/max-age=(\d+)/i);
  return match ? Number.parseInt(match[1], 10) * 1000 : null;
}

function createJwtVerifier(options = {}) {
  const config = {
    secret: options.secret,
    issuer: options.issuer,
    audience: options.audience,
    jwks: options.jwks || null,
    jwksUrl: options.jwksUrl || null,
    jwksCacheMs: Number.isFinite(options.jwksCacheMs) ? options.jwksCacheMs : DEFAULT_JWKS_CACHE_MS,
  };
  const cache = {
    keys: normalizeJwksDocument(config.jwks || []),
    expiresAt: config.jwks ? Number.POSITIVE_INFINITY : 0,
  };

  async function loadJwks(forceRefresh = false) {
    if (config.jwks) return cache.keys;
    if (!config.jwksUrl) return null;
    if (!forceRefresh && cache.keys.length && Date.now() < cache.expiresAt) return cache.keys;

    const response = await fetch(config.jwksUrl, { headers: { accept: 'application/json' } });
    if (!response.ok) {
      throw new Error(`jwks fetch failed with status ${response.status}`);
    }
    const body = await response.json();
    cache.keys = normalizeJwksDocument(body);
    cache.expiresAt = Date.now() + (parseCacheControlMaxAge(response.headers.get('cache-control')) || config.jwksCacheMs);
    return cache.keys;
  }

  return {
    async verify(token, verifyOptions = {}) {
      const merged = {
        issuer: verifyOptions.issuer ?? config.issuer,
        audience: verifyOptions.audience ?? config.audience,
        nowMs: verifyOptions.nowMs,
      };
      const { header } = parseJwt(token);

      if (header.alg === 'HS256' && config.secret) {
        return verifyHmacJwt(token, config.secret, merged);
      }

      const kid = String(header.kid || '').trim();
      let keys = await loadJwks(false);
      if (keys?.length) {
        let jwk = kid ? keys.find((candidate) => candidate.kid === kid) : keys[0];
        if (!jwk && config.jwksUrl) {
          keys = await loadJwks(true);
          jwk = kid ? keys.find((candidate) => candidate.kid === kid) : keys[0];
        }
        if (!jwk) throw new Error(`jwt signing key not found for kid: ${kid || 'none'}`);
        return verifyJwkJwt(token, jwk, merged);
      }

      if (config.secret) {
        return verifyHmacJwt(token, config.secret, merged);
      }

      throw new Error('JWT verification is not configured');
    },
  };
}

module.exports = {
  BROWSER_AUTH_CODE_TOKEN_USE,
  createJwtVerifier,
  signBrowserAuthCode,
  signHmacJwt,
  verifyBrowserAuthCode,
  verifyJwkJwt,
  verifyHmacJwt,
  getBearerToken,
  buildPrincipalFromClaims,
};
