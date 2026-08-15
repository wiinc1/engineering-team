'use strict';

function mergeReviewerMaps(normalized = {}, supplied = {}) {
  const roles = new Set([...Object.keys(normalized), ...Object.keys(supplied)]);
  return Object.freeze(Object.fromEntries([...roles].map((role) => [
    role,
    Object.freeze({ ...(supplied[role] || {}), ...(normalized[role] || {}) }),
  ])));
}

function preserveReviewerRouting(contract = {}) {
  const routing = contract.reviewer_routing || {};
  const reviewers = mergeReviewerMaps(routing.reviewers, contract.reviewers);
  return Object.freeze({
    ...contract,
    reviewer_routing: Object.freeze({ ...routing, reviewers }),
    reviewers,
  });
}

function applyExecutionContractReviewerConsistency(exportsObject) {
  const original = exportsObject?.createExecutionContractDraft;
  if (typeof original !== 'function' || original.__reviewerConsistencyWrapped) return exportsObject;
  const wrapped = function createExecutionContractDraft(input) {
    const result = original(input);
    return Object.freeze({ ...result, contract: preserveReviewerRouting(result.contract) });
  };
  wrapped.__reviewerConsistencyWrapped = true;
  exportsObject.createExecutionContractDraft = wrapped;
  return exportsObject;
}

module.exports = {
  applyExecutionContractReviewerConsistency,
  mergeReviewerMaps,
  preserveReviewerRouting,
};
