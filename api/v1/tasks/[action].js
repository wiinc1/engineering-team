const {
  LifecycleStageGuard,
  LifecycleTransitionError,
  StageTransitionRecorder,
  LIFECYCLE_STAGES,
} = require('../../../lib/audit/lifecycle-enforcement');

const guard = new LifecycleStageGuard();

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        return resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch (err) {
        return reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify(data));
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function resolveAction(parsedUrl) {
  const segments = parsedUrl.pathname.split('/').filter(Boolean);
  const actionIndex = segments.indexOf('[action]');
  return actionIndex !== -1
    ? segments[actionIndex + 1]
    : (segments[segments.length - 1] || null);
}

function rejectInvalidMethod(req, res) {
  if (!req.method || !['POST', 'PUT'].includes(req.method.toUpperCase())) {
    sendJSON(res, 405, {
      error_code: 'METHOD_NOT_ALLOWED',
      message: `HTTP ${req.method} not allowed on lifecycle transitions. Use POST or PUT.`,
      allowed_methods: ['POST', 'PUT'],
    });
    return true;
  }
  return false;
}

async function readRequestBody(req, res) {
  try {
    return await parseBody(req);
  } catch (err) {
    sendJSON(res, 400, {
      error_code: 'INVALID_JSON_BODY',
      message: 'Request body must be valid JSON.',
    });
    return null;
  }
}

function rejectInvalidTargetStage(body, res) {
  const toStage = body.to_stage;

  if ((toStage === undefined || toStage === null) && !hasOwn(body, 'to_stage')) {
    sendJSON(res, 400, {
      error_code: 'MISSING_TO_STAGE',
      message: 'Request body must include a "to_stage" field.',
    });
    return true;
  }

  if (!LIFECYCLE_STAGES.includes(toStage)) {
    sendJSON(res, 400, {
      error_code: 'INVALID_STAGE',
      message: `Unknown stage: "${toStage}".`,
      allowed_stages: LIFECYCLE_STAGES,
    });
    return true;
  }

  return false;
}

function normalizeFromStage(body) {
  const fromStageRaw = hasOwn(body, 'from_stage') ? body.from_stage : null;
  return typeof fromStageRaw === 'string' && fromStageRaw !== '' ? fromStageRaw : null;
}

function validateLifecycleTransition(fromStage, toStage, res) {
  if (fromStage === null) return { result: 'allowed', transitionError: null };

  try {
    guard.validateTransition(fromStage, toStage);
    return { result: 'allowed', transitionError: null };
  } catch (err) {
    if (err instanceof LifecycleTransitionError) {
      return { result: 'blocked', transitionError: err };
    }
    sendJSON(res, 500, {
      error_code: 'INTERNAL_ERROR',
      message: 'Lifecycle validation failed unexpectedly.',
    });
    return { result: null, transitionError: null };
  }
}

function createMemoryStore() {
  return {
    appendEvent: async (data) => {
      return { recorded: true, ...data };
    },
    getTaskHistory: () => [],
  };
}

async function recordTransition(taskId, body, fromStage, toStage, result) {
  const recorder = new StageTransitionRecorder(createMemoryStore());
  return recorder.record(taskId, {
    ...body,
    from_stage: fromStage || 'NONE',
    to_stage: toStage,
    result,
  });
}

function rejectBlockedTransition(res, fromStage, toStage, transitionError) {
  const allowedTransitions = guard.getAllowedTransitions(fromStage);
  return sendJSON(res, 409, {
    error_code: 'INVALID_STAGE_TRANSITION',
    message: transitionError.message,
    from_stage: fromStage,
    to_stage: toStage,
    allowed_stages: allowedTransitions.length > 0
      ? allowedTransitions
      : LIFECYCLE_STAGES.filter((stage) => stage !== fromStage),
  });
}

module.exports = async function (req, res) {
  const parsedUrl = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
  if (rejectInvalidMethod(req, res)) return;

  const body = await readRequestBody(req, res);
  if (body === null) return;
  if (rejectInvalidTargetStage(body, res)) return;

  const toStage = body.to_stage;
  const fromStage = normalizeFromStage(body);
  const validation = validateLifecycleTransition(fromStage, toStage, res);
  if (validation.result === null) return;

  const action = resolveAction(parsedUrl);
  const taskId = action || parsedUrl.searchParams.get('taskId') || 'unknown';
  const historyEntry = await recordTransition(taskId, body, fromStage, toStage, validation.result);

  if (validation.transitionError) {
    return rejectBlockedTransition(res, fromStage, toStage, validation.transitionError);
  }

  return sendJSON(res, 200, {
    result: 'allowed',
    from_stage: fromStage,
    to_stage: toStage,
    transition_recorded: true,
    history_entry: historyEntry,
  });
};
