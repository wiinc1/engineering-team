const test = require('node:test');
const assert = require('node:assert/strict');
const {
  REQUIRED_SECTIONS_BY_TIER,
  contractMarkdown,
  createExecutionContractDraft,
  evaluateExecutionContractApprovalReadiness,
  validateExecutionContract,
} = require('../../lib/audit/execution-contracts');

const tierNames = Object.keys(REQUIRED_SECTIONS_BY_TIER);

function sectionBodiesFor(tier, suffix = '') {
  return Object.fromEntries(REQUIRED_SECTIONS_BY_TIER[tier].map((sectionId) => [
    sectionId,
    `Completed section ${sectionId}${suffix}.`,
  ]));
}

test('validates required Execution Contract sections for every template tier', () => {
  for (const tier of tierNames) {
    const complete = {
      template_tier: tier,
      owner: 'pm',
      required_sections: REQUIRED_SECTIONS_BY_TIER[tier],
      sections: Object.fromEntries(REQUIRED_SECTIONS_BY_TIER[tier].map((sectionId) => [
        sectionId,
        { id: sectionId, body: `Completed ${sectionId}` },
      ])),
    };
    assert.equal(validateExecutionContract(complete).status, 'valid', tier);

    const incomplete = {
      ...complete,
      sections: {
        ...complete.sections,
        [REQUIRED_SECTIONS_BY_TIER[tier][0]]: { id: REQUIRED_SECTIONS_BY_TIER[tier][0], body: 'TBD' },
      },
    };
    const validation = validateExecutionContract(incomplete);
    assert.equal(validation.status, 'invalid', tier);
    assert.deepEqual(validation.missingSections, [REQUIRED_SECTIONS_BY_TIER[tier][0]]);
  }
});

test('creates a PM-owned structured draft from Intake Draft history and versions material changes', () => {
  const history = [
    {
      event_type: 'task.refinement_requested',
      event_id: 'evt-refine',
      payload: { intake_draft: true, raw_requirements: 'Operator needs contract generation.' },
    },
    {
      event_type: 'task.created',
      event_id: 'evt-create',
      payload: { intake_draft: true, title: 'Contract generation', raw_requirements: 'Operator needs contract generation.' },
    },
  ];
  const summary = {
    task_id: 'TSK-102',
    title: 'Contract generation',
    intake_draft: true,
    operator_intake_requirements: 'Operator needs contract generation.',
  };

  const initial = createExecutionContractDraft({
    taskId: 'TSK-102',
    summary,
    history,
    actorId: 'pm-1',
    body: { templateTier: 'Complex' },
  });
  assert.equal(initial.contract.version, 1);
  assert.equal(initial.contract.owner, 'pm');
  assert.equal(initial.contract.template_source, 'docs/templates/USER_STORY_TEMPLATE.md');
  assert.equal(initial.contract.validation.status, 'invalid');
  assert.ok(initial.contract.sections['1'].body.includes('Operator needs contract generation.'));

  const updated = createExecutionContractDraft({
    taskId: 'TSK-102',
    summary,
    history,
    actorId: 'pm-1',
    previousContract: initial.contract,
    body: {
      templateTier: 'Complex',
      sections: {
        ...sectionBodiesFor('Complex', ' material update'),
        6: {
          title: 'Architecture & Integration',
          body: 'Completed section 6 material update.',
          ownerRole: 'architect',
          contributor: 'architect-1',
          approvalStatus: 'approved',
          approver: 'architect-lead',
          payloadSchemaVersion: 2,
          payloadJson: { architecture_decision: 'Use audit-backed contract projection.' },
          provenanceReferences: ['CONTEXT.md#execution-contract'],
        },
      },
      scopeBoundaries: {
        committedRequirements: ['Implementation must use the approved structured contract.'],
        outOfScope: ['Runtime engineer dispatch remains out of scope.'],
        deferredConsiderations: ['Deferred Considerations workflow is issue #110.'],
        followUpTasks: ['Contract Coverage Audit is issue #108.'],
      },
    },
  });
  assert.equal(updated.materialChange, true);
  assert.equal(updated.previousVersion, 1);
  assert.equal(updated.contract.version, 2);
  assert.equal(updated.contract.contract_id, 'EC-TSK-102-v2');
  assert.equal(updated.contract.source_intake_revision.refinement_event_id, 'evt-refine');
  assert.equal(updated.contract.policy_versions_used.committed_scope_policy, 'execution-contract-committed-scope.v1');
  assert.equal(updated.contract.validation.status, 'valid');
  assert.equal(updated.contract.sections['6'].owner_role, 'architect');
  assert.equal(updated.contract.sections['6'].contributor, 'architect-1');
  assert.equal(updated.contract.sections['6'].approval_status, 'approved');
  assert.equal(updated.contract.sections['6'].payload_schema_version, 2);
  assert.deepEqual(updated.contract.sections['6'].payload_json, { architecture_decision: 'Use audit-backed contract projection.' });
  assert.deepEqual(updated.contract.sections['6'].provenance_references, ['CONTEXT.md#execution-contract']);
  assert.deepEqual(updated.contract.committed_scope.committed_requirements.map((item) => item.text), ['Implementation must use the approved structured contract.']);
  assert.deepEqual(updated.contract.committed_scope.out_of_scope.map((item) => item.text), ['Runtime engineer dispatch remains out of scope.']);
  assert.deepEqual(updated.contract.committed_scope.deferred_considerations.map((item) => item.text), ['Deferred Considerations workflow is issue #110.']);
});

test('routes required reviewers deterministically from tier and risk flags with explainable reasons', () => {
  const history = [{
    event_type: 'task.created',
    event_id: 'evt-create',
    payload: { intake_draft: true, title: 'Reviewer routing', raw_requirements: 'Route reviewer approvals.' },
  }];
  const summary = {
    task_id: 'TSK-103',
    title: 'Reviewer routing',
    intake_draft: true,
    operator_intake_requirements: 'Route reviewer approvals.',
  };

  const { contract } = createExecutionContractDraft({
    taskId: 'TSK-103',
    summary,
    history,
    actorId: 'pm-1',
    body: {
      templateTier: 'Standard',
      riskFlags: ['deployment', 'security', 'human_workflow'],
      sections: sectionBodiesFor('Standard'),
      reviewers: {
        qa: { status: 'approved', actorId: 'qa-1' },
        architect: { status: 'approved', actorId: 'architect-1' },
        ux: { status: 'approved', actorId: 'ux-1' },
        sre: { status: 'approved', actorId: 'sre-1' },
        principalEngineer: { status: 'approved', actorId: 'principal-1' },
      },
    },
  });

  assert.deepEqual(contract.reviewer_routing.required_role_approvals, ['architect', 'ux', 'qa', 'sre', 'principalEngineer']);
  assert.equal(contract.reviewers.qa.reasons[0].code, 'qa_standard_plus');
  assert.ok(contract.reviewers.sre.reasons.some((reason) => reason.code === 'sre_operational_risk'));
  assert.ok(contract.reviewers.principalEngineer.reasons.some((reason) => reason.code === 'principal_high_risk_engineering'));
  assert.deepEqual(contract.risk_flags.map((flag) => flag.id), ['deployment', 'security', 'human_workflow']);
});

test('uses stricter reviewer routing unless PM records an operator-visible downgrade rationale', () => {
  const history = [{
    event_type: 'task.created',
    event_id: 'evt-create',
    payload: { intake_draft: true, title: 'Strict reviewer routing', raw_requirements: 'Resolve model disagreement.' },
  }];
  const summary = {
    task_id: 'TSK-103-STRICT',
    title: 'Strict reviewer routing',
    intake_draft: true,
    operator_intake_requirements: 'Resolve model disagreement.',
  };

  const strictModel = createExecutionContractDraft({
    taskId: 'TSK-103-STRICT',
    summary,
    history,
    actorId: 'pm-1',
    body: {
      templateTier: 'Simple',
      sections: sectionBodiesFor('Simple'),
      reviewers: {
        principalEngineer: { required: true, status: 'pending' },
      },
    },
  });
  assert.equal(strictModel.contract.reviewers.principalEngineer.required, true);
  assert.ok(strictModel.contract.reviewers.principalEngineer.reasons.some((reason) => reason.code === 'stricter_model_wins'));

  const downgraded = createExecutionContractDraft({
    taskId: 'TSK-103-STRICT',
    summary,
    history,
    actorId: 'pm-1',
    body: {
      templateTier: 'Simple',
      sections: sectionBodiesFor('Simple'),
      reviewers: {
        principalEngineer: {
          required: true,
          status: 'not_required',
          downgradeRationale: 'No production, security, data, or ambiguity trigger exists for this constrained fixture-only change.',
        },
      },
    },
  });
  assert.equal(downgraded.contract.reviewers.principalEngineer.required, false);
  assert.equal(downgraded.contract.reviewers.principalEngineer.downgraded, true);
  assert.match(downgraded.contract.reviewer_routing.downgrade_rationales[0].rationale, /fixture-only/);

  const deterministicWins = createExecutionContractDraft({
    taskId: 'TSK-103-STRICT',
    summary,
    history,
    actorId: 'pm-1',
    body: {
      templateTier: 'Simple',
      riskFlags: ['security'],
      sections: sectionBodiesFor('Simple'),
      reviewers: {
        principalEngineer: {
          required: false,
          status: 'not_required',
          downgradeRationale: 'PM believes principal review is unnecessary.',
        },
      },
    },
  });
  assert.equal(deterministicWins.contract.reviewers.principalEngineer.required, true);
  assert.ok(deterministicWins.contract.reviewers.principalEngineer.reasons.some((reason) => reason.code === 'stricter_rules_win'));
});

test('approval readiness blocks missing role approvals and unresolved blocking questions while surfacing non-blocking comments', () => {
  const history = [{
    event_type: 'task.created',
    event_id: 'evt-create',
    payload: { intake_draft: true, title: 'Approval gates', raw_requirements: 'Gate operator approval.' },
  }];
  const summary = {
    task_id: 'TSK-103-GATES',
    title: 'Approval gates',
    intake_draft: true,
    operator_intake_requirements: 'Gate operator approval.',
  };
  const { contract } = createExecutionContractDraft({
    taskId: 'TSK-103-GATES',
    summary,
    history,
    actorId: 'pm-1',
    body: {
      templateTier: 'Standard',
      sections: sectionBodiesFor('Standard'),
      reviewers: {
        architect: { status: 'approved' },
        ux: { status: 'approved' },
        qa: { status: 'pending' },
      },
      reviewFeedback: {
        questions: [{ id: 'q-1', body: 'Which rollback path should be used?', blocking: true, state: 'open' }],
        comments: [{ id: 'c-1', body: 'Consider adding a dashboard after this slice.', blocking: false, state: 'open' }],
      },
    },
  });

  let readiness = evaluateExecutionContractApprovalReadiness(contract);
  assert.equal(readiness.canApprove, false);
  assert.deepEqual(readiness.missingRequiredApprovals.map((item) => item.role), ['qa']);
  assert.deepEqual(readiness.unresolvedBlockingQuestions.map((item) => item.id), ['q-1']);
  assert.deepEqual(readiness.nonBlockingComments.map((item) => item.id), ['c-1']);

  const ready = {
    ...contract,
    reviewers: {
      ...contract.reviewers,
      qa: { ...contract.reviewers.qa, status: 'approved', approved: true },
    },
    reviewer_routing: {
      ...contract.reviewer_routing,
      reviewers: {
        ...contract.reviewer_routing.reviewers,
        qa: { ...contract.reviewer_routing.reviewers.qa, status: 'approved', approved: true },
      },
    },
    review_feedback: {
      ...contract.review_feedback,
      questions: [{ id: 'q-1', body: 'Which rollback path should be used?', blocking: true, state: 'resolved' }],
    },
  };
  readiness = evaluateExecutionContractApprovalReadiness(ready);
  assert.equal(readiness.canApprove, true);
  assert.deepEqual(readiness.nonBlockingComments.map((item) => item.id), ['c-1']);
});

test('versions material changes to structured section payload and metadata', () => {
  const history = [
    {
      event_type: 'task.created',
      event_id: 'evt-create',
      payload: { intake_draft: true, title: 'Structured metadata', raw_requirements: 'Capture structured metadata changes.' },
    },
  ];
  const summary = {
    task_id: 'TSK-102-META',
    title: 'Structured metadata',
    intake_draft: true,
    operator_intake_requirements: 'Capture structured metadata changes.',
  };
  const initial = createExecutionContractDraft({
    taskId: 'TSK-102-META',
    summary,
    history,
    actorId: 'pm-1',
    body: {
      templateTier: 'Standard',
      sections: {
        ...sectionBodiesFor('Standard'),
        6: {
          title: 'Architecture & Integration',
          body: 'Completed section 6.',
          ownerRole: 'architect',
          contributor: 'architect-1',
          approvalStatus: 'pending',
          payloadSchemaVersion: 1,
          payloadJson: { integration: { mode: 'draft' } },
          provenanceReferences: ['CONTEXT.md'],
        },
      },
    },
  });

  const updated = createExecutionContractDraft({
    taskId: 'TSK-102-META',
    summary,
    history,
    actorId: 'pm-1',
    previousContract: initial.contract,
    body: {
      templateTier: 'Standard',
      sections: {
        ...sectionBodiesFor('Standard'),
        6: {
          title: 'Architecture & Integration',
          body: 'Completed section 6.',
          ownerRole: 'architect',
          contributor: 'architect-1',
          approvalStatus: 'approved',
          approver: 'architect-lead',
          payloadSchemaVersion: 2,
          payloadJson: { integration: { mode: 'approved' } },
          provenanceReferences: ['CONTEXT.md', 'docs/adr/ADD-2026-04-29-committed-requirements-and-contract-coverage.md'],
        },
      },
    },
  });

  assert.equal(updated.materialChange, true);
  assert.equal(updated.previousVersion, 1);
  assert.equal(updated.contract.version, 2);
});

test('generates Markdown from structured data without making Markdown authoritative', () => {
  const contract = {
    task_id: 'TSK-102',
    version: 3,
    template_tier: 'Standard',
    template_source: 'docs/templates/USER_STORY_TEMPLATE.md',
    sections: {
      1: { title: 'User Story', body: 'As a PM, I want a structured contract.' },
      2: { title: 'Acceptance Criteria', body: 'Given a contract, when Markdown is generated, then it reflects structured sections.' },
    },
  };
  const markdown = contractMarkdown(contract);
  assert.match(markdown, /Execution Contract Version: v3/);
  assert.match(markdown, /Authoritative Source: structured Task execution_contract data/);
  assert.match(markdown, /not the authoritative source/);
  assert.match(markdown, /## 1\. User Story/);
});
