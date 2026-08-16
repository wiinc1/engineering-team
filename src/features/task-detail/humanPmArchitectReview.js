/**
 * Browser helper for product-path human PM/Architect acceptance (Q6 / GitLab #275).
 * Posts to audit API: POST .../execution-contract:human-pm-architect-review
 */

export const HUMAN_PM_ARCHITECT_REVIEW_RESOURCE = 'execution-contract:human-pm-architect-review';

/**
 * @param {object} options
 * @param {string} options.taskId
 * @param {string} [options.apiBaseUrl] base URL without trailing slash (e.g. '' for same-origin)
 * @param {object} [options.body]
 * @param {RequestInit} [options.fetchInit]
 * @param {typeof fetch} [options.fetchImpl]
 */
export async function submitHumanPmArchitectReview({
  taskId,
  apiBaseUrl = '',
  body = {},
  fetchInit = {},
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!taskId) {
    throw new Error('taskId is required to record human PM/Architect acceptance');
  }
  const base = String(apiBaseUrl || '').replace(/\/$/, '');
  const url = `${base}/tasks/${encodeURIComponent(taskId)}/${HUMAN_PM_ARCHITECT_REVIEW_RESOURCE}`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(fetchInit.headers || {}),
    },
    credentials: fetchInit.credentials || 'include',
    body: JSON.stringify({
      role: body.role || 'both',
      reason: body.reason || body.comment || 'Human acceptance of agent-authored PM/Architect proposals (Q6).',
      actorType: body.actorType || 'human',
      ...body,
    }),
    ...fetchInit,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || payload?.message || 'Human PM/Architect review failed');
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export function humanPmArchitectGateFromDetail(detail = {}) {
  const contract = detail?.context?.executionContract?.latest
    || detail?.executionContract?.latest
    || null;
  const gate = detail?.context?.executionContract?.approvalSummary?.pmArchitectHumanReviewGate
    || detail?.context?.executionContract?.latest?.pmArchitectHumanReviewGate
    || null;
  return { contract, gate, resource: HUMAN_PM_ARCHITECT_REVIEW_RESOURCE };
}
