const crypto = require('node:crypto');
const {
  verifyGitHubWebhookSignature,
  inferTaskIdsFromWebhook,
  normalizeWebhookPr,
} = require('./github');
const {
  assertGitHubSyncEnabled,
} = require('./feature-flags');
const { processGitHubIssueIntakeWebhook } = require('./github-intake-normalizer');

function uniqTaskRefs(refs = []) {
  const seen = new Set();
  const unique = [];
  for (const ref of refs) {
    if (!ref?.taskId || !ref?.tenantId) continue;
    const key = `${ref.tenantId}::${ref.taskId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ taskId: ref.taskId, tenantId: ref.tenantId });
  }
  return unique;
}

async function resolveWebhookTaskRefs(store, taskIds = [], linkedPr = null) {
  const [resolved, linked] = await Promise.all([
    typeof store.resolveTaskRefs === 'function' ? store.resolveTaskRefs(taskIds) : [],
    linkedPr && typeof store.findTaskRefsByLinkedPr === 'function' ? store.findTaskRefsByLinkedPr(linkedPr) : [],
  ]);
  return uniqTaskRefs([...(resolved || []), ...(linked || [])]);
}

async function parseRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function createHttpError(statusCode, code, message, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function prSyncEventType(eventName, payload = {}) {
  const isPrComment = eventName === 'issue_comment' && payload.issue?.pull_request;
  return isPrComment ? 'task.github_pr_comment_recorded' : 'task.github_pr_synced';
}

async function appendPrSyncEvents({
  store,
  matchedTasks,
  payload,
  eventName,
  deliveryId,
  linkedPr,
  eventType,
  action,
}) {
  for (const { taskId, tenantId } of matchedTasks) {
    await store.appendEvent({
      taskId,
      tenantId,
      eventType,
      actorId: `github:${payload.sender?.login || 'webhook'}`,
      actorType: 'system',
      idempotencyKey: `github:${deliveryId}:${eventName}:${taskId}`,
      payload: {
        delivery_id: deliveryId,
        github_event: eventName,
        github_action: action,
        linked_pr: { ...linkedPr, task_id: taskId },
        comment_body: payload.comment?.body || null,
        comment_url: payload.comment?.html_url || null,
        sync_status: 'ok',
      },
      source: 'github-webhook',
    });
  }
}

function prSyncSuccessBody({ deliveryId, eventName, action, matchedTasks }) {
  return {
    status: 202,
    body: {
      received: true,
      deliveryId,
      event: eventName,
      action,
      matchedTaskIds: matchedTasks.map((task) => task.taskId),
      matchedTasks,
    },
  };
}

async function processGitHubPullRequestWebhook({
  store,
  payload = {},
  eventName = '',
  deliveryId = '',
  logger = null,
  requestId = null,
  options = {},
}) {
  assertGitHubSyncEnabled(options);

  const linkedPr = normalizeWebhookPr(payload);
  const matchedTasks = await resolveWebhookTaskRefs(store, inferTaskIdsFromWebhook(eventName, payload), linkedPr);
  if (!linkedPr || !matchedTasks.length) {
    return {
      status: 202,
      body: { received: true, ignored: true, reason: 'no_linked_task', event: eventName || null, deliveryId },
    };
  }

  const action = String(payload.action || '').trim() || 'unknown';
  await appendPrSyncEvents({
    store,
    matchedTasks,
    payload,
    eventName,
    deliveryId,
    linkedPr,
    eventType: prSyncEventType(eventName, payload),
    action,
  });
  logger?.info?.({
    feature: 'ff_github_sync',
    action: 'github_webhook_processed',
    outcome: 'success',
    request_id: requestId,
    delivery_id: deliveryId,
    github_event: eventName,
    github_action: action,
    matched_task_count: matchedTasks.length,
  });
  return prSyncSuccessBody({ deliveryId, eventName, action, matchedTasks });
}

function parseWebhookEnvelope(req, rawBody) {
  const payload = rawBody.length ? JSON.parse(rawBody.toString('utf8')) : {};
  return {
    payload,
    eventName: String(req.headers['x-github-event'] || '').trim(),
    deliveryId: String(req.headers['x-github-delivery'] || crypto.createHash('sha256').update(rawBody).digest('hex')).trim(),
    action: String(payload.action || '').trim(),
  };
}

function verifyIncomingWebhook(req, rawBody, options = {}) {
  try {
    verifyGitHubWebhookSignature(
      rawBody,
      req.headers['x-hub-signature-256'],
      options.githubWebhookSecret || process.env.GITHUB_WEBHOOK_SECRET,
    );
  } catch (error) {
    throw createHttpError(401, 'invalid_github_signature', error.message);
  }
}

async function handleGitHubWebhookRequest({
  req,
  store,
  taskPlatform,
  createIntakeDraft,
  options = {},
  logger = null,
  requestId = null,
}) {
  const rawBody = await parseRawBody(req);
  verifyIncomingWebhook(req, rawBody, options);
  const { payload, eventName, deliveryId, action } = parseWebhookEnvelope(req, rawBody);

  if (eventName === 'issues') {
    return processGitHubIssueIntakeWebhook({
      store,
      taskPlatform,
      createIntakeDraft,
      payload,
      action,
      deliveryId,
      options,
      logger,
      requestId,
    });
  }

  const isPrComment = eventName === 'issue_comment' && payload.issue?.pull_request;
  if (eventName === 'pull_request' || isPrComment) {
    return processGitHubPullRequestWebhook({
      store,
      payload,
      eventName,
      deliveryId,
      logger,
      requestId,
      options,
    });
  }

  return {
    status: 202,
    body: {
      received: true,
      ignored: true,
      reason: 'unsupported_event',
      event: eventName || null,
    },
  };
}

module.exports = {
  handleGitHubWebhookRequest,
  parseRawBody,
  processGitHubPullRequestWebhook,
  resolveWebhookTaskRefs,
  uniqTaskRefs,
};