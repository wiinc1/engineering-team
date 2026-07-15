const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildReviewerRoutingTargets,
  buildSectionReviewPrompt,
  delegateReviewerSectionReviews,
  reviewerAlreadyApproved,
  shouldAutoDelegateSectionReviews,
} = require('../../lib/audit/execution-contract-reviewer-routing');
const {
  buildExecutionContractReviewerRoutingAction,
  createExecutionContractDraft,
  EXECUTION_CONTRACT_REVIEW_ACTION,
  REQUIRED_SECTIONS_BY_TIER,
  validateExecutionContract,
} = require('../../lib/audit/execution-contracts');

function sectionBodiesFor(tier) {
  return Object.fromEntries(
    REQUIRED_SECTIONS_BY_TIER[tier].map((sectionId) => [
      sectionId,
      `Completed refinement section ${sectionId}.`,
    ]),
  );
}

function standardContract() {
  return createExecutionContractDraft({
    taskId: 'TSK-REVIEW-ROUTE',
    summary: {
      task_id: 'TSK-REVIEW-ROUTE',
      title: 'Reviewer routing after PM refinement',
      intake_draft: true,
      operator_intake_requirements: 'Route reviewers after PM completes.',
    },
    history: [
      {
        event_type: 'task.created',
        event_id: 'evt-created',
        payload: { intake_draft: true, raw_requirements: 'Route reviewers after PM completes.' },
      },
    ],
    actorId: 'pm',
    body: {
      templateTier: 'Standard',
      sections: sectionBodiesFor('Standard'),
    },
  }).contract;
}

function withReviewerApproval(contract, roles) {
  const reviewers = { ...contract.reviewer_routing.reviewers };
  for (const role of roles) {
    reviewers[role] = { ...reviewers[role], status: 'approved', approved: true };
  }
  return {
    ...contract,
    reviewer_routing: { ...contract.reviewer_routing, reviewers },
  };
}

test('buildExecutionContractReviewerRoutingAction names required reviewers', () => {
  const contract = standardContract();
  const action = buildExecutionContractReviewerRoutingAction(contract);
  assert.match(action, /Architect/);
  assert.match(action, /UX Designer/);
  assert.match(action, /QA/);
  assert.match(action, /section reviews/);
});

test('buildExecutionContractReviewerRoutingAction switches to operator review when approvals are complete', () => {
  const contract = withReviewerApproval(standardContract(), ['architect', 'ux', 'qa']);
  assert.equal(buildExecutionContractReviewerRoutingAction(contract), EXECUTION_CONTRACT_REVIEW_ACTION);
});

test('validateExecutionContract treats payload_json section bodies as complete', () => {
  const contract = {
    template_tier: 'Standard',
    owner: 'pm',
    sections: Object.fromEntries(
      REQUIRED_SECTIONS_BY_TIER.Standard.map((sectionId) => [
        sectionId,
        {
          id: sectionId,
          body: ['3', '4', '11'].includes(sectionId)
            ? ''
            : `Completed refinement section ${sectionId}.`,
          payload_json: ['3', '4', '11'].includes(sectionId)
            ? { body: `Payload-backed section ${sectionId}.` }
            : undefined,
        },
      ]),
    ),
  };
  assert.equal(validateExecutionContract(contract).status, 'valid');
});

test('buildReviewerRoutingTargets maps required reviewers to section ids', () => {
  const contract = standardContract();
  const targets = buildReviewerRoutingTargets(contract);
  assert.deepEqual(targets.map((entry) => entry.role), ['architect', 'ux', 'qa']);
  assert.equal(targets[0].sectionIds[0], '6');
  assert.equal(targets[1].sectionIds[0], '3');
  assert.equal(targets[2].sectionIds[0], '4');
});

test('buildSectionReviewPrompt asks for structured JSON review output', () => {
  const contract = standardContract();
  const prompt = buildSectionReviewPrompt({
    taskId: 'TSK-REVIEW-ROUTE',
    role: 'architect',
    sectionId: '6',
    contract,
    summary: { title: 'Reviewer routing after PM refinement' },
  });
  assert.match(prompt, /architect reviewer/i);
  assert.match(prompt, /Return ONLY valid JSON/);
  assert.match(prompt, /section 6/i);
});

test('reviewerAlreadyApproved treats approved reviewer statuses as complete', () => {
  const contract = withReviewerApproval(standardContract(), ['architect']);
  assert.equal(reviewerAlreadyApproved(contract, 'architect'), true);
  assert.equal(reviewerAlreadyApproved(contract, 'ux'), false);
});

function createReviewerVersionHarness(baseContract) {
  let latestVersion = baseContract.version;
  const contractsByVersion = new Map([[latestVersion, baseContract]]);
  const requestedVersions = [];
  return {
    requestedVersions,
    loadLatestContract: async () => contractsByVersion.get(latestVersion),
    recordSectionReview: async ({ version, sectionId, body }) => {
      requestedVersions.push({ version, sectionId, role: body.reviewerRole });
      latestVersion += 1;
      const previous = contractsByVersion.get(version);
      const nextContract = {
        ...previous,
        version: latestVersion,
        reviewer_routing: {
          ...previous.reviewer_routing,
          reviewers: {
            ...previous.reviewer_routing.reviewers,
            [body.reviewerRole]: { status: 'approved', approved: true },
          },
        },
      };
      contractsByVersion.set(latestVersion, nextContract);
      return { review: { role: body.reviewerRole, sectionId, status: 'approved' }, contract: nextContract };
    },
  };
}

test('delegateReviewerSectionReviews reloads latest contract version between reviewers', async () => {
  const original = standardContract();
  const baseContract = {
    ...original,
    version: 4,
    reviewer_routing: {
      ...original.reviewer_routing,
      required_role_approvals: ['architect', 'ux', 'qa'],
      reviewers: { ...original.reviewer_routing.reviewers, sre: { required: false, status: 'not_required' } },
    },
  };
  const harness = createReviewerVersionHarness(baseContract);

  const result = await delegateReviewerSectionReviews({
    store: {},
    context: { tenantId: 'engineering-team', actorId: 'pm' },
    taskId: 'TSK-REVIEW-ROUTE',
    contract: baseContract,
    summary: { title: 'Reviewer routing after PM refinement' },
    options: {
      autoDelegateSectionReviews: true,
      reviewDelegate: async ({ target }) => ({
        agentId: target.role,
        message: JSON.stringify({ status: 'approved', comment: `${target.role} approved.` }),
        attribution: { delegated: true },
      }),
    },
    recordSectionReview: harness.recordSectionReview,
    loadLatestContract: harness.loadLatestContract,
    idempotencyKey: 'test-reviewer-routing',
  });

  assert.equal(result.failures.length, 0);
  assert.equal(result.reviews.filter((entry) => !entry.skipped).length, 3);
  assert.deepEqual(harness.requestedVersions.map((entry) => entry.version), [4, 5, 6]);
  assert.deepEqual(
    harness.requestedVersions.map((entry) => entry.role),
    ['architect', 'ux', 'qa'],
  );
});

test('shouldAutoDelegateSectionReviews follows OpenClaw PM refinement defaults', () => {
  assert.equal(
    shouldAutoDelegateSectionReviews({ env: { GOLDEN_PATH_OPENCLAW_PM_REFINEMENT: 'true' } }),
    true,
  );
  assert.equal(
    shouldAutoDelegateSectionReviews({ env: { PM_REFINEMENT_DELEGATE_WORK: 'openclaw' } }),
    true,
  );
  assert.equal(
    shouldAutoDelegateSectionReviews({ autoDelegateSectionReviews: false, env: { GOLDEN_PATH_OPENCLAW_PM_REFINEMENT: 'true' } }),
    false,
  );
});
