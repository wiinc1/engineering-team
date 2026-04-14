function normalizeLinkedPr(entry, fallbackTaskId) {
  if (entry == null) return null;
  if (typeof entry === 'string' || typeof entry === 'number') {
    return {
      id: String(entry),
      number: typeof entry === 'number' || /^\d+$/.test(String(entry)) ? Number(entry) : null,
      title: `PR ${entry}`,
      url: null,
      repository: null,
      state: 'open',
      merged: false,
      draft: false,
      targetTaskId: fallbackTaskId || null,
      updatedAt: null,
    };
  }

  const id = entry.id || entry.pr_id || entry.node_id || entry.url || entry.html_url || (entry.number != null ? `pr-${entry.number}` : null);
  if (!id) return null;

  const state = String(entry.state || entry.status || (entry.merged ? 'merged' : 'open')).toLowerCase();
  return {
    id: String(id),
    number: entry.number != null ? Number(entry.number) : null,
    title: entry.title || (entry.number != null ? `PR #${entry.number}` : 'Linked pull request'),
    url: entry.url || entry.html_url || null,
    repository: entry.repository || entry.repo || null,
    state,
    merged: Boolean(entry.merged || state === 'merged'),
    draft: Boolean(entry.draft),
    targetTaskId: entry.task_id || entry.taskId || fallbackTaskId || null,
    updatedAt: entry.updated_at || entry.updatedAt || entry.closed_at || entry.closedAt || entry.merged_at || entry.mergedAt || null,
    branch: entry.branch || entry.head_ref || entry.headRef || null,
    commentUrl: entry.comment_url || entry.commentUrl || null,
    commentAuthor: entry.comment_author || entry.commentAuthor || null,
  };
}

function linkedPrIdentity(pr) {
  const normalized = normalizeLinkedPr(pr);
  if (!normalized) return null;
  return {
    id: normalized.id || null,
    number: normalized.number != null ? Number(normalized.number) : null,
    url: normalized.url || null,
    repository: normalized.repository || null,
  };
}

function linkedPrMatches(left, right) {
  const a = linkedPrIdentity(left);
  const b = linkedPrIdentity(right);
  if (!a || !b) return false;
  if (a.id && b.id && a.id === b.id) return true;
  if (a.url && b.url && a.url === b.url) return true;
  return a.number != null
    && b.number != null
    && a.number === b.number
    && a.repository
    && b.repository
    && a.repository === b.repository;
}

function mergeLinkedPrs(previous = [], incoming = [], fallbackTaskId) {
  const merged = new Map();
  for (const entry of previous.map((item) => normalizeLinkedPr(item, fallbackTaskId)).filter(Boolean)) {
    merged.set(entry.id, entry);
  }
  for (const next of incoming.map((item) => normalizeLinkedPr(item, fallbackTaskId)).filter(Boolean)) {
    const existing = merged.get(next.id);
    if (!existing) {
      merged.set(next.id, next);
      continue;
    }
    const existingUpdatedAt = Date.parse(existing.updatedAt || 0) || 0;
    const nextUpdatedAt = Date.parse(next.updatedAt || 0) || 0;
    if (nextUpdatedAt >= existingUpdatedAt) {
      merged.set(next.id, { ...existing, ...next });
    }
  }
  return [...merged.values()];
}

function payloadLinkedPrs(payload = {}, taskId) {
  const payloadPrs = [
    ...(Array.isArray(payload.linked_prs) ? payload.linked_prs : []),
    ...(Array.isArray(payload.linkedPrs) ? payload.linkedPrs : []),
    ...(Array.isArray(payload.pull_requests) ? payload.pull_requests : []),
    ...(Array.isArray(payload.pullRequests) ? payload.pullRequests : []),
  ];
  if (payload.linked_pr) payloadPrs.push(payload.linked_pr);
  if (payload.linkedPr) payloadPrs.push(payload.linkedPr);
  if (payload.pull_request) payloadPrs.push(payload.pull_request);
  if (payload.pullRequest) payloadPrs.push(payload.pullRequest);
  if (payload.pr_number != null || payload.pr_url || payload.pr_title) {
    payloadPrs.push({
      number: payload.pr_number,
      url: payload.pr_url,
      title: payload.pr_title,
      state: payload.pr_state,
      merged: payload.pr_merged,
      repository: payload.pr_repository,
      updated_at: payload.pr_updated_at,
    });
  }
  return payloadPrs.map((entry) => normalizeLinkedPr(entry, taskId)).filter(Boolean);
}

function collectLinkedPrs(history = [], relationships = {}, taskId) {
  let linkedPrs = mergeLinkedPrs([], Array.isArray(relationships?.linked_prs) ? relationships.linked_prs : [], taskId);
  for (const event of history) {
    linkedPrs = mergeLinkedPrs(linkedPrs, payloadLinkedPrs(event?.payload || {}, taskId), taskId);
  }
  return linkedPrs;
}

function summarizePrStatus(linkedPrs = []) {
  if (!linkedPrs.length) return { label: 'No linked PRs', state: 'empty', total: 0, mergedCount: 0, openCount: 0, draftCount: 0 };
  const mergedCount = linkedPrs.filter((pr) => pr.merged).length;
  const draftCount = linkedPrs.filter((pr) => pr.draft).length;
  const openCount = linkedPrs.filter((pr) => !pr.merged && pr.state !== 'closed').length;
  const state = mergedCount === linkedPrs.length ? 'done' : draftCount ? 'draft' : openCount ? 'active' : 'mixed';
  const label = mergedCount === linkedPrs.length
    ? `${mergedCount} linked PRs merged`
    : draftCount
      ? `${draftCount} draft PR${draftCount === 1 ? '' : 's'} in progress`
      : openCount
        ? `${openCount} open PR${openCount === 1 ? '' : 's'} linked`
        : `${linkedPrs.length} linked PRs`;
  return { label, state, total: linkedPrs.length, mergedCount, openCount, draftCount };
}

function openLinkedPrs(linkedPrs = []) {
  return linkedPrs.filter((pr) => !pr.merged && pr.state !== 'closed');
}

module.exports = {
  collectLinkedPrs,
  linkedPrIdentity,
  linkedPrMatches,
  mergeLinkedPrs,
  normalizeLinkedPr,
  openLinkedPrs,
  payloadLinkedPrs,
  summarizePrStatus,
};
