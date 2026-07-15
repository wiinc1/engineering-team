'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  applyExecutionContractReviewerConsistency,
  mergeReviewerMaps,
  preserveReviewerRouting,
} = require('../../lib/audit/execution-contract-reviewer-consistency');

test('reviewer consistency preserves policy reasons and supplied attribution', () => {
  const normalized = { qa: { required: true, reasons: [{ code: 'qa_standard_plus' }] } };
  const merged = mergeReviewerMaps(normalized, { qa: { status: 'approved', actorId: 'qa-1' } });
  assert.equal(merged.qa.required, true);
  assert.equal(merged.qa.actorId, 'qa-1');
  assert.equal(merged.qa.reasons[0].code, 'qa_standard_plus');
  assert.equal(Object.isFrozen(merged.qa), true);
});

test('reviewer consistency retains roles present in only one reviewer projection', () => {
  const merged = mergeReviewerMaps(
    { qa: { required: true } },
    { security: { status: 'approved' } },
  );
  assert.deepEqual(merged.qa, { required: true });
  assert.deepEqual(merged.security, { status: 'approved' });
});

test('draft wrapper keeps top-level and routing reviewer projections consistent', () => {
  const exportsObject = {
    createExecutionContractDraft() {
      return { contract: { reviewer_routing: { reviewers: { sre: { reasons: [{ code: 'risk' }] } } }, reviewers: { sre: { status: 'pending' } } } };
    },
  };
  applyExecutionContractReviewerConsistency(exportsObject);
  const wrapped = exportsObject.createExecutionContractDraft;
  applyExecutionContractReviewerConsistency(exportsObject);
  const contract = wrapped({}).contract;
  assert.equal(exportsObject.createExecutionContractDraft, wrapped);
  assert.equal(contract.reviewers, contract.reviewer_routing.reviewers);
  assert.equal(contract.reviewers.sre.reasons[0].code, 'risk');
  assert.deepEqual(preserveReviewerRouting().reviewers, {});
});

test('reviewer consistency safely ignores exports without a draft factory', () => {
  const exportsObject = {};
  assert.equal(applyExecutionContractReviewerConsistency(exportsObject), exportsObject);
  assert.equal(applyExecutionContractReviewerConsistency(null), null);
});
