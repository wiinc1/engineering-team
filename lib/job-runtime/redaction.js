'use strict';

const SECRET_KEY_PATTERN = /(^|_)(authorization|cmd|command|cookie|credential|database_url|executable|module|password|passwd|script|secret|sql|token)($|_)/i;
const SECRET_VALUE_PATTERNS = Object.freeze([
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\//i,
  /\b(?:api[_-]?key|password|secret|token)\s*[:=]\s*\S+/i,
]);
const REDACTED = '[REDACTED]';

function isSecretLikeKey(key) {
  return SECRET_KEY_PATTERN.test(String(key).replace(/([a-z])([A-Z])/g, '$1_$2'));
}

function isSecretLikeValue(value) {
  return typeof value === 'string' && SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

function findSecretPath(value, path = '$', seen = new Set()) {
  if (isSecretLikeValue(value)) return path;
  if (!value || typeof value !== 'object') return null;
  if (seen.has(value)) return path;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (isSecretLikeKey(key) || isSecretLikeValue(child)) return `${path}.${key}`;
    const nested = findSecretPath(child, `${path}.${key}`, seen);
    if (nested) return nested;
  }
  return null;
}

function redact(value, seen = new WeakSet()) {
  if (isSecretLikeValue(value)) return REDACTED;
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return REDACTED;
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redact(item, seen));
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    isSecretLikeKey(key) ? REDACTED : redact(child, seen),
  ]));
}

module.exports = {
  REDACTED,
  findSecretPath,
  isSecretLikeKey,
  isSecretLikeValue,
  redact,
};
