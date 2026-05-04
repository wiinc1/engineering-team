const { mapReviewToCheckRun } = require('./merge-readiness-github-check');

const MERGE_READINESS_PR_SUMMARY_VERSION = 'merge-readiness-pr-summary.v1';
const BLOCKING_SEVERITIES = new Set(['blocker', 'critical', 'error']);
const MERGE_READINESS_STATUSES = new Set(['pending', 'passed', 'blocked', 'stale', 'error']);
const SAFE_TEXT_KEYS = [
  'summary',
  'rationale',
  'reason',
  'reasonCode',
  'reason_code',
  'title',
  'label',
  'name',
  'id',
  'sourceId',
  'source_id',
  'status',
];

function readAny(input, ...keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(input || {}, key)) return input[key];
  }
  return undefined;
}

function toArray(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return value.split(',').map(item => item.trim()).filter(Boolean);
  return [value];
}

function firstSafeText(input, fallback = 'not provided') {
  if (input == null) return fallback;
  if (typeof input !== 'object') return compactText(input, fallback);
  for (const key of SAFE_TEXT_KEYS) {
    const value = readAny(input, key);
    if (value != null && typeof value !== 'object') return compactText(value, fallback);
  }
  return fallback;
}

function compactText(value, fallback = 'not provided', maxLength = 180) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trimEnd()}...` : text;
}

function escapeMarkdown(value) {
  return compactText(value, '').replace(/[\\`*_\[\]()]/g, '\\$&');
}

function inlineCode(value) {
  return `\`${compactText(value, '').replace(/`/g, "'")}\``;
}

function safeUrl(value) {
  const text = String(value || '').trim();
  return /^https?:\/\//i.test(text) ? text : null;
}

function reviewStatus(review = {}) {
  return readAny(review, 'reviewStatus', 'review_status') || 'pending';
}

function commitSha(review = {}) {
  return readAny(review, 'commitSha', 'commit_sha') || 'unknown';
}

function reviewId(review = {}) {
  return readAny(review, 'reviewId', 'review_id') || 'MergeReadinessReview';
}

function sourceInventory(review = {}) {
  return readAny(review, 'sourceInventory', 'source_inventory') || {};
}

function reviewedLogSources(review = {}) {
  return toArray(readAny(review, 'reviewedLogSources', 'reviewed_log_sources'));
}

function requiredSources(review = {}) {
  return toArray(readAny(sourceInventory(review), 'requiredSources', 'required_sources'));
}

function reviewedRequiredSources(review = {}) {
  const sources = requiredSources(review).filter(source => {
    const status = readAny(source, 'status', 'state');
    return !status || status === 'present' || status === 'reviewed' || status === 'satisfied';
  });
  return sources.length ? sources : reviewedLogSources(review);
}

function itemUrl(item = {}) {
  return safeUrl(readAny(item, 'sourceUrl', 'source_url', 'url', 'detailsUrl', 'details_url', 'htmlUrl', 'html_url'));
}

function itemLabel(item, fallback = 'evidence') {
  return firstSafeText(item, fallback);
}

function renderLinkedItem(item, fallback) {
  const label = escapeMarkdown(itemLabel(item, fallback));
  const url = itemUrl(item);
  return url ? `[${label}](${url})` : label;
}

function findings(review = {}) {
  return toArray(readAny(review, 'findings')).filter(item => item && typeof item === 'object');
}

function findingSeverity(finding = {}) {
  return String(readAny(finding, 'severity', 'level') || '').toLowerCase();
}

function findingStatus(finding = {}) {
  return String(readAny(finding, 'status', 'state', 'resolution') || '').toLowerCase();
}

function findingApprovals(finding = {}, review = {}) {
  const local = toArray(readAny(finding, 'approvals'));
  if (local.length) return local;
  const id = readAny(finding, 'id', 'findingId', 'finding_id', 'sourceId', 'source_id');
  const global = toArray(readAny(review, 'approvals'));
  const matching = global.filter(approval => {
    const target = readAny(approval, 'findingId', 'finding_id', 'sourceId', 'source_id', 'id');
    return target && id && String(target) === String(id);
  });
  return matching.length ? matching : global;
}

function isBlockingFinding(finding = {}) {
  return readAny(finding, 'blocking') === true || BLOCKING_SEVERITIES.has(findingSeverity(finding));
}

function isDeferredFinding(finding = {}, review = {}) {
  if (readAny(finding, 'deferred') === true) return true;
  if (['deferred', 'approved_deferred', 'waived'].includes(findingStatus(finding))) return true;
  return isBlockingFinding(finding) && findingApprovals(finding, review).length > 0 && readAny(finding, 'blocking') === false;
}

function findingSummary(finding = {}) {
  const id = readAny(finding, 'id', 'findingId', 'finding_id');
  const summary = firstSafeText(finding, 'No summary provided.');
  return id ? `${inlineCode(id)}: ${escapeMarkdown(summary)}` : escapeMarkdown(summary);
}

function findingRationale(finding = {}) {
  const rationale = readAny(finding, 'rationale', 'reason', 'reasonCode', 'reason_code');
  return escapeMarkdown(firstSafeText(rationale ?? finding, 'not provided'));
}

function approvalSummary(approval = {}) {
  const actor = readAny(approval, 'actorId', 'actor_id', 'reviewer', 'approvedBy', 'approved_by') || 'unknown approver';
  const approvedAt = readAny(approval, 'approvedAt', 'approved_at', 'timestamp', 'createdAt', 'created_at');
  const reason = readAny(approval, 'rationale', 'reason', 'summary');
  const parts = [inlineCode(actor)];
  if (approvedAt) parts.push(`at ${inlineCode(approvedAt)}`);
  if (reason) parts.push(`for ${escapeMarkdown(firstSafeText(reason))}`);
  return parts.join(' ');
}

function inaccessibleEvidence(review = {}) {
  const sources = requiredSources(review)
    .filter(source => String(readAny(source, 'status', 'state') || '').toLowerCase() === 'inaccessible');
  if (sources.length) return sources;
  return findings(review).filter(finding => readAny(finding, 'type') === 'required_evidence_inaccessible');
}

function followUpLinks(review = {}) {
  return toArray(readAny(review, 'followUpLinks', 'follow_up_links'));
}

function structuredReviewUrl(review = {}, options = {}) {
  return safeUrl(
    options.structuredReviewUrl
      || options.structured_review_url
      || readAny(review, 'structuredReviewUrl', 'structured_review_url', 'url', 'htmlUrl', 'html_url')
      || readAny(readAny(review, 'metadata') || {}, 'structuredReviewUrl', 'structured_review_url')
  );
}

function section(lines) {
  return lines.length ? lines.map(line => `  - ${line}`) : ['  - None.'];
}

function renderFindingSection(items) {
  return section(items.map(findingSummary));
}

function renderNonBlockingSection(items) {
  return section(items.map(finding => `${findingSummary(finding)}; rationale: ${findingRationale(finding)}`));
}

function renderDeferredSection(items, review) {
  return section(items.map(finding => {
    const approvals = findingApprovals(finding, review).map(approvalSummary).join('; ') || 'missing approval';
    return `${findingSummary(finding)}; approvals: ${approvals}`;
  }));
}

function renderInaccessibleEvidence(review) {
  return section(inaccessibleEvidence(review).map(item => {
    const reason = readAny(item, 'access_reason', 'reason', 'reasonCode', 'reason_code', 'summary');
    return `${renderLinkedItem(item, 'evidence')}; reason: ${escapeMarkdown(firstSafeText(reason ?? item))}`;
  }));
}

function renderFollowUps(review) {
  return section(followUpLinks(review).map(link => renderLinkedItem(link, 'follow-up')));
}

function renderStructuredReviewLink(review, options) {
  const url = structuredReviewUrl(review, options);
  const label = escapeMarkdown(reviewId(review));
  return url ? `[${label}](${url})` : label;
}

function renderMergeReadinessPrSummary(review = {}, options = {}) {
  const allFindings = findings(review);
  const deferred = allFindings.filter(finding => isBlockingFinding(finding) && isDeferredFinding(finding, review));
  const blocking = allFindings.filter(finding => isBlockingFinding(finding) && !deferred.includes(finding));
  const nonBlocking = allFindings.filter(finding => !isBlockingFinding(finding) && !isDeferredFinding(finding, review));
  return [
    '### Merge readiness summary',
    '',
    `- Review status: ${inlineCode(reviewStatus(review))}`,
    `- Commit SHA: ${inlineCode(commitSha(review))}`,
    '- Required sources reviewed:',
    ...section(reviewedRequiredSources(review).map(source => renderLinkedItem(source, 'source'))),
    '- Blocking findings:',
    ...renderFindingSection(blocking),
    '- Non-blocking findings with rationale:',
    ...renderNonBlockingSection(nonBlocking),
    '- Deferred blocking findings with approvals:',
    ...renderDeferredSection(deferred, review),
    '- Inaccessible evidence:',
    ...renderInaccessibleEvidence(review),
    '- Follow-up links:',
    ...renderFollowUps(review),
    `- Structured MergeReadinessReview: ${renderStructuredReviewLink(review, options)}`,
  ].join('\n') + '\n';
}

function extractPrSummaryReviewStatus(commentBody = '') {
  const match = String(commentBody || '').match(/Review status:\s*`?([a-z_]+)`?/i);
  const status = match ? match[1].toLowerCase() : null;
  return MERGE_READINESS_STATUSES.has(status) ? status : null;
}

function evaluateMergeReadinessSummaryPrecedence(options = {}) {
  const review = options.review || {};
  const commentStatus = extractPrSummaryReviewStatus(options.commentBody || options.prSummary || options.pr_summary);
  const authoritativeStatus = reviewStatus(review);
  return {
    sourceOfTruth: 'structured_review',
    policyVersion: MERGE_READINESS_PR_SUMMARY_VERSION,
    reviewId: reviewId(review),
    authoritativeStatus,
    commentStatus,
    commentConflict: Boolean(commentStatus && authoritativeStatus && commentStatus !== authoritativeStatus),
    gate: mapReviewToCheckRun(review, options.context || options),
  };
}

module.exports = {
  MERGE_READINESS_PR_SUMMARY_VERSION,
  evaluateMergeReadinessSummaryPrecedence,
  extractPrSummaryReviewStatus,
  renderMergeReadinessPrSummary,
};
