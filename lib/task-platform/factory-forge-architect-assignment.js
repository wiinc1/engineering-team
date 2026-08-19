const { apiGet, apiSend } = require('./golden-path-shared');

const RETRYABLE_ASSIGNMENT_CODES = new Set([
  'task_not_found',
  'execution_contract_not_found',
  'execution_contract_not_approved',
  'post_approval_gates_unsatisfied',
]);

function assignmentErrorCode(response = {}) {
  return response.body?.error?.code || null;
}

function requestContext(config = {}) {
  return {
    fetchImpl: config.fetchImpl,
    baseUrl: config.baseUrl,
    tenantId: config.tenantId,
    actorId: config.actorId,
    jwtSecret: config.jwtSecret,
  };
}

async function assertExistingAssignmentHasLiveEvidence(config, forgeTaskId) {
  if (config.requireRealEvidence !== true) return;
  const history = await apiGet(
    requestContext(config),
    `/tasks/${encodeURIComponent(forgeTaskId)}/history?limit=500`,
    ['admin', 'reader'],
  );
  const assignment = history.body?.items?.find(
    (event) => event.event_type === 'task.architect_engineer_assignment_recorded',
  );
  if (!history.ok || assignment?.payload?.delegation?.delegated !== true) {
    throw new Error(`${forgeTaskId} existing architect assignment lacks live delegated OpenClaw evidence`);
  }
}

async function requestFactoryForgeArchitectAssignment(config, forgeTaskId, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 30000);
  const intervalMs = Number(options.intervalMs || 300);
  const deadline = Date.now() + timeoutMs;
  let response = null;

  while (Date.now() < deadline) {
    response = await apiSend(requestContext(config), `/tasks/${encodeURIComponent(forgeTaskId)}/execution-contract/architect-engineer-assignment`, 'POST', [
      'admin',
      'architect',
      'reader',
    ], {
      delegate: true,
      actorType: 'agent',
    });

    if (response.ok) {
      const delegation = response.body?.data?.delegation || null;
      if (config.requireRealEvidence === true && delegation?.delegated !== true) {
        throw new Error(`${forgeTaskId} architect assignment did not produce live delegated OpenClaw evidence`);
      }
      return response;
    }

    const code = assignmentErrorCode(response);
    if (code === 'architect_engineer_assignment_already_recorded') {
      await assertExistingAssignmentHasLiveEvidence(config, forgeTaskId);
      return { ...response, ok: true, skipped: true, reason: code };
    }
    if (!RETRYABLE_ASSIGNMENT_CODES.has(code)) break;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `${forgeTaskId} architect assignment failed (${response?.status || 0}): ${JSON.stringify(response?.body || {})}`,
  );
}

module.exports = {
  assignmentErrorCode,
  assertExistingAssignmentHasLiveEvidence,
  requestFactoryForgeArchitectAssignment,
};
