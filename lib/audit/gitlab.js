function verifyGitLabWebhookToken(headerToken, expectedSecret) {
  const token = String(headerToken || '').trim();
  const secret = String(expectedSecret || '').trim();
  if (!secret) {
    throw new Error('GITLAB_WEBHOOK_SECRET is not configured');
  }
  if (!token || token !== secret) {
    throw new Error('Invalid GitLab webhook token');
  }
}

function projectPath(payload = {}) {
  return String(
    payload.project?.path_with_namespace
    || payload.project?.pathWithNamespace
    || '',
  ).trim() || null;
}

function issueIid(payload = {}) {
  const raw = payload.object_attributes?.iid ?? payload.issue?.iid;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function issueUrl(payload = {}) {
  const direct = payload.object_attributes?.url || payload.issue?.url;
  if (direct) return String(direct).trim();

  const projectWebUrl = String(payload.project?.web_url || '').replace(/\/+$/, '');
  const iid = issueIid(payload);
  if (projectWebUrl && iid != null) {
    return `${projectWebUrl}/-/issues/${iid}`;
  }
  return null;
}

function issueAction(payload = {}) {
  return String(payload.object_attributes?.action || payload.action || '').trim().toLowerCase();
}

function issueLabels(payload = {}) {
  const fromRoot = Array.isArray(payload.labels) ? payload.labels : [];
  const fromAttributes = Array.isArray(payload.object_attributes?.labels)
    ? payload.object_attributes.labels
    : [];
  return [...fromRoot, ...fromAttributes]
    .map((label) => String(label?.title || label?.name || label).trim().toLowerCase())
    .filter(Boolean);
}

function issueTitle(payload = {}) {
  return String(payload.object_attributes?.title || payload.issue?.title || '').trim();
}

function issueDescription(payload = {}) {
  return String(payload.object_attributes?.description || payload.issue?.description || '').trim();
}

function isIssueHook(payload = {}) {
  return String(payload.object_kind || '').trim().toLowerCase() === 'issue';
}

module.exports = {
  verifyGitLabWebhookToken,
  projectPath,
  issueIid,
  issueUrl,
  issueAction,
  issueLabels,
  issueTitle,
  issueDescription,
  isIssueHook,
};