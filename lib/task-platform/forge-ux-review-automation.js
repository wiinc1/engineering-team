const {
  resolveEtForgeDispatchConfig,
  resolveForgeReviewChildSessionId,
  findForgeReviewGate,
  resolveForgeCloseoutGates,
  maybeCompleteForgeUxReviewGate,
  handleForgeUxDelegationCompletion,
} = require('./et-forge-dispatch-bridge');

function resolveForgeUxReviewAutomationConfig(env = process.env) {
  return resolveEtForgeDispatchConfig(env);
}

function taskRequiresForgeUxReviewGate(readinessBody = {}, runtime = {}) {
  return resolveForgeCloseoutGates(readinessBody, runtime).includes('ux');
}

module.exports = {
  resolveForgeUxReviewAutomationConfig,
  resolveForgeReviewChildSessionId,
  findForgeReviewGate,
  taskRequiresForgeUxReviewGate,
  maybeCompleteForgeUxReviewGate,
  handleForgeUxDelegationCompletion,
};