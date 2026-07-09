const PLACEHOLDER_HOST_PATTERN = /(^|\.)example(?:\.(?:com|net|org|test))?$|\.example$|\.test$|\.invalid$/i;

function isPrivateIpv4(hostname) {
  const match = String(hostname || '').match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => part < 0 || part > 255)) return false;
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 169 && parts[1] === 254)
    || parts[0] === 0;
}

function normalizeHostname(hostname) {
  return String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
}

function isPrivateIpv6(hostname) {
  const normalized = normalizeHostname(hostname);
  if (!normalized.includes(':')) return false;
  if (normalized === '::1' || normalized === '::') return true;
  const first = normalized.split(':')[0] || '';
  const firstWord = Number.parseInt(first, 16);
  if (!Number.isFinite(firstWord)) return false;
  return (firstWord >= 0xfc00 && firstWord <= 0xfdff)
    || (firstWord >= 0xfe80 && firstWord <= 0xfebf);
}

function parseHttpUrl(value) {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isLocalOrPrivateUrl(value) {
  const parsed = parseHttpUrl(value);
  if (!parsed) return false;
  const hostname = normalizeHostname(parsed.hostname);
  return hostname === 'localhost'
    || hostname.endsWith('.local')
    || isPrivateIpv4(hostname)
    || isPrivateIpv6(hostname);
}

function isPlaceholderHostedUrl(value) {
  const parsed = parseHttpUrl(value);
  return parsed ? PLACEHOLDER_HOST_PATTERN.test(parsed.hostname.toLowerCase()) : false;
}

function hostedUrlFailure(label, value) {
  if (!parseHttpUrl(value)) return `${label} must be a valid http(s) URL`;
  if (isLocalOrPrivateUrl(value)) return `${label} must be hosted and non-local`;
  if (isPlaceholderHostedUrl(value)) return `${label} must not use placeholder or reserved domains`;
  return null;
}

module.exports = {
  hostedUrlFailure,
  isLocalOrPrivateUrl,
  isPlaceholderHostedUrl,
};
