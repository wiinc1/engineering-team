function parseBooleanEnv(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function shouldUseLocalPmRefinementDelegate(env = process.env) {
  const explicit = env.GOLDEN_PATH_LOCAL_PM_REFINEMENT;
  if (explicit != null && explicit !== '') {
    return parseBooleanEnv(explicit, false);
  }
  if (env.PM_REFINEMENT_DELEGATE_WORK === 'local') return true;
  return false;
}

function createLocalPmRefinementDelegateWork() {
  return async function localPmRefinementDelegateWork(payload = {}) {
    const specialist = String(payload.specialist || 'pm').trim() || 'pm';
    const taskId = String(payload.context?.taskId || 'intake-draft').trim() || 'intake-draft';
    const sessionId = `local-pm-refinement-${taskId}-${Date.now()}`;
    return {
      agentId: specialist,
      sessionId,
      output: 'Local PM refinement delegate acknowledged operator intake for execution contract drafting.',
      ownership: {
        specialistId: specialist,
        agentId: specialist,
        sessionId,
        runtime: 'golden-path-local-pm-delegate',
      },
    };
  };
}

module.exports = {
  shouldUseLocalPmRefinementDelegate,
  createLocalPmRefinementDelegateWork,
};