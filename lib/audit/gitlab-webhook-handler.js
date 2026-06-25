const crypto = require('node:crypto');
const { verifyGitLabWebhookToken, isIssueHook } = require('./gitlab');
const { processGitLabIssueIntakeWebhook } = require('./gitlab-intake-normalizer');

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

function parseWebhookEnvelope(req, rawBody) {
  const payload = rawBody.length ? JSON.parse(rawBody.toString('utf8')) : {};
  return {
    payload,
    eventName: String(req.headers['x-gitlab-event'] || payload.event_type || payload.object_kind || '').trim(),
    deliveryId: String(
      req.headers['x-gitlab-event-uuid']
      || req.headers['x-gitlab-delivery']
      || crypto.createHash('sha256').update(rawBody).digest('hex'),
    ).trim(),
    action: String(payload.object_attributes?.action || payload.action || '').trim(),
  };
}

function verifyIncomingWebhook(req, options = {}) {
  try {
    verifyGitLabWebhookToken(
      req.headers['x-gitlab-token'],
      options.gitlabWebhookSecret || process.env.GITLAB_WEBHOOK_SECRET,
    );
  } catch (error) {
    throw createHttpError(401, 'invalid_gitlab_token', error.message);
  }
}

async function handleGitLabWebhookRequest({
  req,
  store,
  taskPlatform,
  createIntakeDraft,
  options = {},
  logger = null,
  requestId = null,
}) {
  const rawBody = await parseRawBody(req);
  verifyIncomingWebhook(req, options);
  const { payload, eventName, deliveryId, action } = parseWebhookEnvelope(req, rawBody);

  if (isIssueHook(payload) || eventName.toLowerCase() === 'issue hook') {
    return processGitLabIssueIntakeWebhook({
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

  return {
    status: 202,
    body: {
      received: true,
      ignored: true,
      reason: 'unsupported_event',
      event: eventName || payload.object_kind || null,
    },
  };
}

module.exports = {
  handleGitLabWebhookRequest,
  parseRawBody,
};