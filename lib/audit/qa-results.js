function normalizeArray(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  }
  return String(value || '')
    .split(/\n+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function deriveImplementationHistory(history = []) {
  return history
    .filter((event) => event?.event_type === 'task.engineer_submission_recorded')
    .map((event) => ({
      eventId: event.event_id,
      version: Number(event.payload?.version) || 1,
      commitSha: event.payload?.commit_sha || '',
      prUrl: event.payload?.pr_url || '',
      primaryReference: event.payload?.primary_reference || null,
      submittedAt: event.occurred_at || null,
      submittedBy: event.actor_id || null,
    }))
    .sort((left, right) => (right.version || 0) - (left.version || 0));
}

function deriveQaResults(history = []) {
  const items = history
    .filter((event) => event?.event_type === 'task.qa_result_recorded')
    .map((event) => {
      const payload = event.payload || {};
      return {
        runId: payload.run_id || event.event_id,
        outcome: payload.outcome || 'fail',
        runKind: payload.run_kind || 'initial',
        summary: payload.summary || '',
        scenarios: normalizeArray(payload.scenarios),
        findings: normalizeArray(payload.findings),
        reproductionSteps: normalizeArray(payload.reproduction_steps),
        stackTraces: normalizeArray(payload.stack_traces),
        envLogs: normalizeArray(payload.env_logs),
        reTestScope: normalizeArray(payload.retest_scope),
        implementationVersion: Number(payload.implementation_version) || 0,
        implementationReference: payload.implementation_reference || null,
        priorRunId: payload.prior_run_id || null,
        routedToStage: payload.routed_to_stage || null,
        submittedAt: event.occurred_at || null,
        submittedBy: event.actor_id || null,
        escalationPackage: payload.escalation_package || null,
      };
    })
    .sort((left, right) => String(right.submittedAt || '').localeCompare(String(left.submittedAt || '')));

  return {
    items,
    latest: items[0] || null,
    latestFailed: items.find((item) => item.outcome === 'fail') || null,
    summary: {
      total: items.length,
      passedCount: items.filter((item) => item.outcome === 'pass').length,
      failedCount: items.filter((item) => item.outcome === 'fail').length,
      retestCount: items.filter((item) => item.runKind === 'retest').length,
    },
  };
}

module.exports = {
  deriveImplementationHistory,
  deriveQaResults,
  normalizeArray,
};
