const crypto = require('node:crypto');

const PASSWORD_HASH_VERSION = 'scrypt.v1';
const DEFAULT_PASSWORD_POLICY = Object.freeze({
  minLength: 12,
  maxLength: 128,
});
const DEFAULT_SCRYPT_PARAMS = Object.freeze({
  keyLength: 64,
  saltBytes: 16,
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
});

function createCredentialError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 400;
  return error;
}

function validatePasswordPolicy(password, policy = DEFAULT_PASSWORD_POLICY) {
  if (typeof password !== 'string') {
    throw createCredentialError('invalid_password', 'Password is required.');
  }
  if (password.length < policy.minLength) {
    throw createCredentialError(
      'password_too_short',
      `Password must be at least ${policy.minLength} characters.`
    );
  }
  if (password.length > policy.maxLength) {
    throw createCredentialError(
      'password_too_long',
      `Password must be ${policy.maxLength} characters or fewer.`
    );
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw createCredentialError(
      'password_complexity',
      'Password must include at least one letter and one number.'
    );
  }
}

function encodeParams(params) {
  return [
    `N=${params.N}`,
    `r=${params.r}`,
    `p=${params.p}`,
    `keylen=${params.keyLength}`,
  ].join(',');
}

function parseParams(encoded) {
  const entries = String(encoded || '')
    .split(',')
    .map((item) => item.split('='))
    .filter(([key, value]) => key && value);
  const parsed = Object.fromEntries(entries.map(([key, value]) => [key, Number(value)]));
  return {
    N: parsed.N,
    r: parsed.r,
    p: parsed.p,
    keyLength: parsed.keylen,
  };
}

function derivePasswordKey(password, salt, params = DEFAULT_SCRYPT_PARAMS) {
  return crypto.scryptSync(password, salt, params.keyLength, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: params.maxmem,
  });
}

function hashPassword(password, options = {}) {
  const policy = options.policy || DEFAULT_PASSWORD_POLICY;
  const params = { ...DEFAULT_SCRYPT_PARAMS, ...(options.scryptParams || {}) };
  validatePasswordPolicy(password, policy);
  const salt = crypto.randomBytes(params.saltBytes).toString('base64url');
  const key = derivePasswordKey(password, salt, params).toString('base64url');
  return `${PASSWORD_HASH_VERSION}$${encodeParams(params)}$${salt}$${key}`;
}

function parsePasswordHash(encodedHash) {
  const [version, encodedParams, salt, hash] = String(encodedHash || '').split('$');
  if (version !== PASSWORD_HASH_VERSION || !encodedParams || !salt || !hash) {
    throw createCredentialError('unsupported_password_hash', 'Password hash is not supported.');
  }
  const params = parseParams(encodedParams);
  if (!params.N || !params.r || !params.p || !params.keyLength) {
    throw createCredentialError('unsupported_password_hash', 'Password hash parameters are invalid.');
  }
  return { version, params, salt, hash };
}

function verifyPassword(password, encodedHash) {
  let parsed;
  try {
    parsed = parsePasswordHash(encodedHash);
  } catch {
    return false;
  }
  const candidate = derivePasswordKey(password, parsed.salt, {
    ...DEFAULT_SCRYPT_PARAMS,
    ...parsed.params,
  });
  const expected = Buffer.from(parsed.hash, 'base64url');
  return expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate);
}

function needsPasswordRehash(encodedHash, options = {}) {
  try {
    const parsed = parsePasswordHash(encodedHash);
    const expected = { ...DEFAULT_SCRYPT_PARAMS, ...(options.scryptParams || {}) };
    return (
      parsed.version !== PASSWORD_HASH_VERSION ||
      parsed.params.N !== expected.N ||
      parsed.params.r !== expected.r ||
      parsed.params.p !== expected.p ||
      parsed.params.keyLength !== expected.keyLength
    );
  } catch {
    return true;
  }
}

module.exports = {
  DEFAULT_PASSWORD_POLICY,
  PASSWORD_HASH_VERSION,
  hashPassword,
  needsPasswordRehash,
  parsePasswordHash,
  validatePasswordPolicy,
  verifyPassword,
};
