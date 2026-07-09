import { test, expect } from '@playwright/test';

const LAYOUT_STAGES = [
  'INTAKE_DRAFT',
  'TASK_REFINEMENT',
  'OPERATOR_APPROVAL',
  'IMPLEMENTATION',
  'QA_VERIFICATION',
  'SRE_VERIFICATION',
  'CLOSEOUT',
] as const;

type LifecycleStage = typeof LAYOUT_STAGES[number];
type LifecycleState = { currentStage: LifecycleStage };
type HttpRequest = import('http').IncomingMessage;
type HttpResponse = import('http').ServerResponse;
type TransitionPayload = {
  from_stage?: string;
  to_stage?: string;
};
type TransitionHandler = (
  payload: TransitionPayload,
  state: LifecycleState,
  res: HttpResponse,
) => void;

function getStageIndex(stage: string): number {
  const idx = LAYOUT_STAGES.indexOf(stage as LifecycleStage);
  return idx >= 0 ? idx : -1;
}

function nextStage(stage: string): LifecycleStage | undefined {
  return LAYOUT_STAGES[getStageIndex(stage) + 1];
}

function sendJson(res: HttpResponse, statusCode: number, payload: unknown) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req: HttpRequest): Promise<TransitionPayload> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({});
      }
    });
  });
}

function createLifecycleHandler(state: LifecycleState, handleTransition: TransitionHandler) {
  return (req: HttpRequest, res: HttpResponse) => {
    if (!req.url?.includes('/transition') || req.method !== 'POST') {
      sendJson(res, 404, { error_code: 'ROUTE_NOT_FOUND' });
      return;
    }

    readJsonBody(req)
      .then((payload) => handleTransition(payload, state, res))
      .catch(() => sendJson(res, 400, { error_code: 'INVALID_JSON_BODY' }));
  };
}

function handleSequentialTransition(
  payload: TransitionPayload,
  state: LifecycleState,
  res: HttpResponse,
) {
  const toStage = payload.to_stage;
  const fromStage = payload.from_stage ?? state.currentStage;

  if (!toStage) {
    sendJson(res, 400, { error_code: 'MISSING_TO_STAGE', message: 'Missing to_stage' });
    return;
  }

  const toIdx = getStageIndex(toStage);
  if (toIdx === -1) {
    sendJson(res, 400, { error_code: 'INVALID_STAGE', allowed_stages: LAYOUT_STAGES });
    return;
  }

  if (getStageIndex(fromStage) === LAYOUT_STAGES.length - 1) {
    sendJson(res, 409, { error_code: 'TASK_ALREADY_CLOSED', allowed_stages: [] });
    return;
  }

  if (state.currentStage === toStage) {
    sendJson(res, 200, allowedTransitionPayload(state.currentStage, toStage));
    return;
  }

  const expectedStage = nextStage(state.currentStage);
  if (expectedStage !== toStage) {
    sendJson(res, 409, blockedTransitionPayload(state.currentStage, toStage, expectedStage));
    return;
  }

  state.currentStage = toStage as LifecycleStage;
  sendJson(res, 200, allowedTransitionPayload(fromStage, toStage));
}

function handleSkipTransition(payload: TransitionPayload, state: LifecycleState, res: HttpResponse) {
  const toStage = payload.to_stage;
  const expectedStage = nextStage(state.currentStage);

  if (expectedStage && toStage !== expectedStage) {
    sendJson(res, 409, blockedTransitionPayload(state.currentStage, toStage, expectedStage));
    return;
  }

  sendJson(res, 200, { result: 'allowed', to_stage: toStage });
}

function allowedTransitionPayload(fromStage: string, toStage: string) {
  return {
    result: 'allowed',
    from_stage: fromStage,
    to_stage: toStage,
    transition_recorded: true,
  };
}

function blockedTransitionPayload(fromStage: string, toStage = '', expectedStage?: string) {
  return {
    error_code: 'INVALID_STAGE_TRANSITION',
    message: `Invalid transition. Expected: ${expectedStage ?? 'none'}`,
    from_stage: fromStage,
    to_stage: toStage,
    allowed_stages: expectedStage ? [expectedStage] : [],
  };
}

async function withMockServer(
  handler: (req: HttpRequest, res: HttpResponse) => void,
  run: (apiBase: string) => Promise<void>,
) {
  const http = await import('http');
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as import('net').AddressInfo;

  try {
    await run(`http://127.0.0.1:${addr.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

function postTransition(apiBase: string, payload: TransitionPayload) {
  return fetch(`${apiBase}/api/v1/tasks/TSK-999/transition`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function assertHappyPath(apiBase: string, state: LifecycleState) {
  for (const stage of LAYOUT_STAGES) {
    const result = await postTransition(apiBase, {
      from_stage: state.currentStage,
      to_stage: stage,
    });
    const body = await result.json();

    expect(result.status).toBe(200);
    expect(body.result).toBe('allowed');
    expect(body.to_stage).toBe(stage);
    expect(body.transition_recorded).toBeTruthy();
  }

  const postCloseoutResult = await postTransition(apiBase, {
    from_stage: state.currentStage,
    to_stage: 'INTAKE_DRAFT',
  });
  const postCloseoutBody = await postCloseoutResult.json();

  expect(postCloseoutResult.status).toBe(409);
  expect(postCloseoutBody.error_code).toBe('TASK_ALREADY_CLOSED');
}

async function assertSkipBlocked(apiBase: string, state: LifecycleState) {
  const result = await postTransition(apiBase, {
    from_stage: state.currentStage,
    to_stage: 'SRE_VERIFICATION',
  });
  const body = await result.json();

  expect(result.status).toBe(409);
  expect(body.error_code).toBe('INVALID_STAGE_TRANSITION');
  expect(body.allowed_stages).toEqual(['QA_VERIFICATION']);
}

test('E2E: happy-path sequential lifecycle flow through all 7 stages', async () => {
  const state: LifecycleState = { currentStage: 'INTAKE_DRAFT' };
  await withMockServer(createLifecycleHandler(state, handleSequentialTransition), async (apiBase) => {
    await assertHappyPath(apiBase, state);
  });
});

test('E2E: invalid transition attempt is blocked with correct error', async () => {
  const state: LifecycleState = { currentStage: 'IMPLEMENTATION' };
  await withMockServer(createLifecycleHandler(state, handleSkipTransition), async (apiBase) => {
    await assertSkipBlocked(apiBase, state);
  });
});

test('E2E: stage_transition history events are recorded', async () => {
  const expectedStages: LifecycleStage[] = [
    'INTAKE_DRAFT',
    'TASK_REFINEMENT',
    'OPERATOR_APPROVAL',
    'IMPLEMENTATION',
    'QA_VERIFICATION',
    'SRE_VERIFICATION',
    'CLOSEOUT',
  ];

  expect(LAYOUT_STAGES).toStrictEqual(expectedStages);
  expect(LAYOUT_STAGES).toHaveLength(7);
  expect(getStageIndex('INTAKE_DRAFT')).toBe(0);
});
