const PLACEHOLDER_HOST_PATTERN = /(^|\.)example(?:\.(?:com|net|org|test))?$|\.example$|\.test$|\.invalid$/i;

function isLocalOrPrivateDeploymentUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === 'localhost'
      || hostname === '::1'
      || hostname === '[::1]'
      || hostname.endsWith('.local')
      || /^127\./.test(hostname)
      || /^10\./.test(hostname)
      || /^192\.168\./.test(hostname)
      || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);
  } catch {
    return true;
  }
}

function isPlaceholderDeploymentUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return PLACEHOLDER_HOST_PATTERN.test(hostname);
  } catch {
    return true;
  }
}

module.exports = {
  isLocalOrPrivateDeploymentUrl,
  isPlaceholderDeploymentUrl,
};
