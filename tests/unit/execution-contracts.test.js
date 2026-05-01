const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AUTO_APPROVAL_POLICY_VERSION,
  REQUIRED_SECTIONS_BY_TIER,
  approveExecutionContractArtifactBundle,
  buildExecutionContractAutoApprovalRecord,
  contractMarkdown,
  contractCoverageRequirements,
  createContractCoverageAudit,
  createExecutionContractDraft,
  createExecutionContractArtifactBundle,
  createExecutionContractVerificationReportSkeleton,
  deriveContractCoverageAuditProjection,
  evaluateContractCoverageAudit,
  evaluateExecutionContractApprovalReadiness,
  evaluateExecutionContractAutoApprovalPolicy,
  evaluateExecutionContractDispatchReadiness,
  evaluateExecutionContractDispatchPolicy,
  normalizeArtifactIdentity,
  validateContractCoverageAudit,
  validateExecutionContract,
} = require('../../lib/audit/execution-contracts');

const tierNames = Object.keys(REQUIRED_SECTIONS_BY_TIER);

function sectionBodiesFor(tier, suffix = '') {
  return Object.fromEntries(REQUIRED_SECTIONS_BY_TIER[tier].map((sectionId) => [
    sectionId,
    `Completed section ${sectionId}${suffix}.`,
  ]));
}

function lowRiskSimpleSections(suffix = '') {
  return {
    ...sectionBodiesFor('Simple', suffix),
    2: [
      'Given a low-risk Simple contract, when the policy evaluates it, then approval can be recorded by policy.',
      'Given the work closes successfully, when metrics update, then autonomous delivery rate includes it.',
    ].join('\n'),
    4: 'Run focused unit coverage for the policy and API path before shipping.',
    11: 'Rollback by reverting the policy change or disabling the low-risk Simple auto-approval feature flag.',
    12: 'No production observability change is required; existing workflow metrics remain stable.',
    15: 'Done when the policy result, Task detail, artifacts, and metrics are verified.',
    16: 'Validate in staging with one Simple contract before rollout.',
    17: 'Operator handoff includes the policy rationale and approval timestamp.',
  };
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

test('allows policy auto-approval only for low-risk Simple Execution Contracts', () => {
  const contract = createExecutionContractDraft({
    taskId: 'TSK-107-SIMPLE',
    summary: {
      task_id: 'TSK-107-SIMPLE',
      title: 'Low-risk Simple auto approval',
      intake_draft: true,
      operator_intake_requirements: 'Approve low-risk Simple work by policy.',
    },
    history: [{ event_type: 'task.created', event_id: 'evt-107-simple', payload: { intake_draft: true } }],
    actorId: 'pm-107',
    body: {
      templateTier: 'Simple',
      sections: lowRiskSimpleSections(),
      autoApprovalSignals: {
        unresolvedDependencies: [],
        productionSensitivePaths: [],
      },
    },
  }).contract;

  const approvalSummary = evaluateExecutionContractApprovalReadiness(contract);
  const policy = evaluateExecutionContractAutoApprovalPolicy({ contract, approvalSummary });
  assert.equal(policy.policy_version, AUTO_APPROVAL_POLICY_VERSION);
  assert.equal(policy.canAutoApprove, true);
  assert.equal(policy.operatorApprovalRequired, false);
  assert.equal(policy.criteria.templateTier, 'Simple');
  assert.equal(policy.criteria.acceptanceCriteriaComplete, true);
  assert.equal(policy.criteria.rollbackPathClear, true);

  const record = buildExecutionContractAutoApprovalRecord({
    policy,
    approvedAt: '2026-05-01T12:00:00.000Z',
    actorId: 'pm-107',
    body: { autoApprovalRationale: 'Policy approved low-risk Simple work.' },
  });
  assert.equal(record.approved_by_policy, true);
  assert.equal(record.policy_version, AUTO_APPROVAL_POLICY_VERSION);
  assert.equal(record.approval_mode, 'policy');
  assert.equal(record.rationale, 'Policy approved low-risk Simple work.');
  assert.equal(record.approved_at, '2026-05-01T12:00:00.000Z');
});

test('blocks policy auto-approval when risk flags, dependencies, sensitive paths, or rollback gaps exist', () => {
  const riskyContract = createExecutionContractDraft({
    taskId: 'TSK-107-RISK',
    summary: {
      task_id: 'TSK-107-RISK',
      title: 'Risk blocks auto approval',
      intake_draft: true,
      operator_intake_requirements: 'Risk flags require explicit Operator Approval.',
    },
    history: [{ event_type: 'task.created', event_id: 'evt-107-risk', payload: { intake_draft: true } }],
    actorId: 'pm-107',
    body: {
      templateTier: 'Simple',
      riskFlags: ['deployment'],
      sections: lowRiskSimpleSections(' risk flagged'),
      reviewers: {
        sre: { status: 'approved', actorId: 'sre-107' },
      },
      autoApprovalSignals: {
        unresolvedDependencies: ['Waiting on rollout owner.'],
        productionSensitivePaths: ['Production auth callback config.'],
      },
    },
  }).contract;

  const riskyPolicy = evaluateExecutionContractAutoApprovalPolicy({
    contract: riskyContract,
    approvalSummary: evaluateExecutionContractApprovalReadiness(riskyContract),
  });
  assert.equal(riskyPolicy.canAutoApprove, false);
  assert.equal(riskyPolicy.operatorApprovalRequired, true);
  assert.ok(riskyPolicy.blockingReasons.some((reason) => reason.code === 'risk_flags_require_operator_approval'));
  assert.ok(riskyPolicy.blockingReasons.some((reason) => reason.code === 'unresolved_dependencies_present'));
  assert.ok(riskyPolicy.blockingReasons.some((reason) => reason.code === 'production_auth_security_data_model_path_present'));

  const missingRollbackContract = {
    ...riskyContract,
    risk_flags: [],
    auto_approval_signals: { unresolved_dependencies: [], production_sensitive_paths: [], rollback_path: 'Ship with normal rollout notes.' },
  };
  const missingRollbackPolicy = evaluateExecutionContractAutoApprovalPolicy({
    contract: missingRollbackContract,
    approvalSummary: { canApprove: true, missingRequiredApprovals: [], unresolvedBlockingQuestions: [] },
  });
  assert.equal(missingRollbackPolicy.canAutoApprove, false);
  assert.ok(missingRollbackPolicy.blockingReasons.some((reason) => reason.code === 'clear_rollback_path_required'));
});

test('evaluates risk-based engineer tier dispatch policy with explainable routing and QA parallelism', () => {
  const standard = createExecutionContractDraft({
    taskId: 'TSK-106-STANDARD',
    summary: {
      task_id: 'TSK-106-STANDARD',
      title: 'Standard dispatch policy',
      intake_draft: true,
      operator_intake_requirements: 'Route Standard work to Sr with QA in parallel.',
    },
    history: [{ event_type: 'task.created', event_id: 'evt-106-standard', payload: { intake_draft: true } }],
    actorId: 'pm-106',
    body: {
      templateTier: 'Standard',
      sections: {
        ...sectionBodiesFor('Standard', ' dispatch policy'),
        4: 'Write failing unit tests, integration tests, and browser coverage before implementation.',
      },
      reviewers: {
        architect: { status: 'approved' },
        ux: { status: 'approved' },
        qa: { status: 'approved' },
      },
    },
  }).contract;

  const standardPolicy = evaluateExecutionContractDispatchPolicy({ contract: standard });
  assert.equal(standardPolicy.canDispatch, true);
  assert.equal(standardPolicy.selectedEngineerTier, 'Sr');
  assert.equal(standardPolicy.selectedAssignee, 'engineer-sr');
  assert.equal(standardPolicy.qaDispatch.parallelAllowed, true);
  assert.ok(standardPolicy.selectionReasons.some((reason) => reason.code === 'sr_default_standard_plus'));
  assert.deepEqual(standardPolicy.metricsPolicy.excludedMetrics, ['lines_of_code', 'raw_task_count']);

  const simpleDocs = createExecutionContractDraft({
    taskId: 'TSK-106-JR',
    summary: {
      task_id: 'TSK-106-JR',
      title: 'Docs-only dispatch policy',
      intake_draft: true,
      operator_intake_requirements: 'Constrained docs-only work can go to Jr when tests are explicit.',
    },
    history: [{ event_type: 'task.created', event_id: 'evt-106-jr', payload: { intake_draft: true } }],
    actorId: 'pm-106',
    body: {
      templateTier: 'Simple',
      sections: {
        ...sectionBodiesFor('Simple', ' constrained docs'),
        4: 'Pending documentation smoke test checks generated report links before implementation closes.',
      },
      dispatchSignals: {
        workCategory: 'docs',
        proposedEngineerTier: 'Jr',
      },
    },
  }).contract;

  const jrPolicy = evaluateExecutionContractDispatchPolicy({
    contract: simpleDocs,
    proposedEngineerTier: 'Jr',
    proposedAssignee: 'engineer-jr',
  });
  assert.equal(jrPolicy.canDispatch, true);
  assert.equal(jrPolicy.selectedEngineerTier, 'Jr');
  assert.equal(jrPolicy.contractSignals.clearTestPlan, true);
  assert.ok(jrPolicy.selectionReasons.some((reason) => reason.code === 'jr_constrained_simple_work'));
});

test('blocks unsafe Jr dispatch and requires Principal review for Principal triggers', () => {
  const simpleFeature = createExecutionContractDraft({
    taskId: 'TSK-106-BLOCK-JR',
    summary: {
      task_id: 'TSK-106-BLOCK-JR',
      title: 'Simple feature without test plan',
      intake_draft: true,
      operator_intake_requirements: 'A feature change without a clear failing or pending test plan.',
    },
    history: [{ event_type: 'task.created', event_id: 'evt-106-block-jr', payload: { intake_draft: true } }],
    actorId: 'pm-106',
    body: {
      templateTier: 'Simple',
      sections: {
        ...sectionBodiesFor('Simple', ' feature scope'),
        4: 'Manual reviewer judgment after implementation.',
      },
      dispatchSignals: {
        workCategory: 'feature',
      },
    },
  }).contract;

  const blockedJr = evaluateExecutionContractDispatchPolicy({
    contract: simpleFeature,
    proposedEngineerTier: 'Jr',
    proposedAssignee: 'engineer-jr',
  });
  assert.equal(blockedJr.canDispatch, false);
  assert.equal(blockedJr.selectedEngineerTier, 'Sr');
  assert.equal(blockedJr.rerouted, true);
  assert.ok(blockedJr.blockingReasons.some((reason) => reason.code === 'jr_requires_clear_test_plan'));
  assert.ok(blockedJr.blockingReasons.some((reason) => reason.code === 'jr_requires_constrained_simple_scope'));

  const principalRisk = createExecutionContractDraft({
    taskId: 'TSK-106-PRINCIPAL',
    summary: {
      task_id: 'TSK-106-PRINCIPAL',
      title: 'Security dispatch policy',
      intake_draft: true,
      operator_intake_requirements: 'Security-sensitive implementation needs Principal review.',
    },
    history: [{ event_type: 'task.created', event_id: 'evt-106-principal', payload: { intake_draft: true } }],
    actorId: 'pm-106',
    body: {
      templateTier: 'Standard',
      riskFlags: ['security'],
      sections: {
        ...sectionBodiesFor('Standard', ' security scope'),
        4: 'Write failing authorization-boundary tests before implementation.',
      },
      reviewers: {
        architect: { status: 'approved' },
        ux: { status: 'approved' },
        qa: { status: 'approved' },
        principalEngineer: { status: 'pending' },
      },
    },
  }).contract;

  const principalBlocked = evaluateExecutionContractDispatchPolicy({
    contract: principalRisk,
    proposedEngineerTier: 'Sr',
    proposedAssignee: 'engineer-sr',
  });
  assert.equal(principalBlocked.canDispatch, false);
  assert.equal(principalBlocked.selectedEngineerTier, 'Principal');
  assert.ok(principalBlocked.blockingReasons.some((reason) => reason.code === 'principal_review_required'));
  assert.ok(principalBlocked.blockingReasons.some((reason) => reason.code === 'principal_tier_required'));

  const principalApproved = {
    ...principalRisk,
    reviewer_routing: {
      ...principalRisk.reviewer_routing,
      reviewers: {
        ...principalRisk.reviewer_routing.reviewers,
        principalEngineer: {
          ...principalRisk.reviewer_routing.reviewers.principalEngineer,
          status: 'approved',
          approved: true,
        },
      },
    },
    reviewers: {
      ...principalRisk.reviewers,
      principalEngineer: {
        ...principalRisk.reviewers.principalEngineer,
        status: 'approved',
        approved: true,
      },
    },
  };
  const principalReady = evaluateExecutionContractDispatchPolicy({
    contract: principalApproved,
    proposedEngineerTier: 'Principal',
    proposedAssignee: 'engineer-principal',
  });
  assert.equal(principalReady.canDispatch, true);
  assert.equal(principalReady.principalReview.satisfied, true);
});

test('failure-loop policy returns failing work to the implementing engineer before Principal escalation triggers', () => {
  const initialFailure = evaluateExecutionContractDispatchPolicy({
    contract: { task_id: 'TSK-106-FAIL', template_tier: 'Standard', risk_flags: [] },
    implementingEngineerTier: 'Sr',
    implementingAssignee: 'engineer-sr',
  });
  assert.equal(initialFailure.failureLoop.returnToImplementingEngineerFirst, true);
  assert.equal(initialFailure.failureLoop.principalEscalationRequired, false);
  assert.deepEqual(initialFailure.failureLoop.escalationChain, ['qa', 'engineer']);

  const repeatedFailure = evaluateExecutionContractDispatchPolicy({
    contract: { task_id: 'TSK-106-FAIL', template_tier: 'Standard', risk_flags: [] },
    implementingEngineerTier: 'Sr',
    implementingAssignee: 'engineer-sr',
    failureContext: { priorFailedQaCount: 1 },
  });
  assert.equal(repeatedFailure.failureLoop.returnToImplementingEngineerFirst, true);
  assert.equal(repeatedFailure.failureLoop.principalEscalationRequired, true);
  assert.deepEqual(repeatedFailure.failureLoop.escalationChain, ['qa', 'engineer', 'principalEngineer', 'pm']);
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

test('generates a reviewable repo artifact bundle with display-ID paths, approval routing, and PR guidance', () => {
  const history = [{
    event_type: 'task.created',
    event_id: 'evt-create',
    payload: { intake_draft: true, title: 'Repo artifacts', raw_requirements: 'Generate durable repo artifacts.' },
  }];
  const summary = {
    task_id: 'opaque-internal-104',
    title: 'Repo artifacts',
    intake_draft: true,
    operator_intake_requirements: 'Generate durable repo artifacts.',
  };
  const { contract } = createExecutionContractDraft({
    taskId: 'opaque-internal-104',
    summary,
    history,
    actorId: 'pm-1',
    body: {
      templateTier: 'Standard',
      sections: {
        ...sectionBodiesFor('Standard'),
        4: { body: 'QA owns verification expectations.', ownerRole: 'qa', approvalStatus: 'approved' },
        6: { body: 'Architect owns integration details.', ownerRole: 'architect', approvalStatus: 'approved' },
        10: { body: 'UX owns task detail links.', ownerRole: 'ux', approvalStatus: 'approved' },
        11: { body: 'SRE owns rollout notes.', ownerRole: 'sre', approvalStatus: 'approved' },
      },
      reviewers: {
        architect: { status: 'approved' },
        ux: { status: 'approved' },
        qa: { status: 'approved' },
      },
    },
  });
  const approvedHistory = [
    { event_type: 'task.execution_contract_version_recorded', sequence_number: 1, payload: { version: 1, contract } },
    { event_type: 'task.execution_contract_approved', sequence_number: 2, payload: { version: 1, approval_summary: { nonBlockingComments: [] } } },
  ];

  const bundle = createExecutionContractArtifactBundle({
    taskId: 'opaque-internal-104',
    contract,
    history: approvedHistory,
    actorId: 'pm-1',
    generatedAt: '2026-04-30T17:00:00.000Z',
    approvalSummary: { nonBlockingComments: [] },
    body: {
      displayId: 'TSK-104',
      title: 'Implement Refinement Decision Logs and Task-ID Artifact Generation',
    },
  });

  assert.equal(bundle.policy_version, 'execution-contract-artifact-bundle.v1');
  assert.equal(bundle.bundle_id, 'ART-TSK-104-v1');
  assert.equal(bundle.task_id, 'opaque-internal-104');
  assert.equal(bundle.source_task_id, 'opaque-internal-104');
  assert.equal(bundle.display_id, 'TSK-104');
  assert.equal(bundle.environment, 'production');
  assert.equal(bundle.slug, 'implement-refinement-decision-logs-and-task-id-artifact-generation');
  assert.equal(bundle.title, 'Implement Refinement Decision Logs and Task-ID Artifact Generation');
  assert.equal(bundle.contract_id, 'EC-opaque-internal-104-v1');
  assert.equal(bundle.contract_version, 1);
  assert.equal(bundle.status, 'pending_approval');
  assert.equal(bundle.generated_at, '2026-04-30T17:00:00.000Z');
  assert.equal(bundle.generated_by, 'pm-1');
  assert.equal(bundle.amendment, null);
  assert.equal(bundle.generated_artifacts.user_story.path, 'docs/user-stories/TSK-104-implement-refinement-decision-logs-and-task-id-artifact-generation.md');
  assert.equal(bundle.generated_artifacts.refinement_decision_log.path, 'docs/refinement/TSK-104-implement-refinement-decision-logs-and-task-id-artifact-generation.md');
  assert.equal(bundle.generated_artifacts.user_story.type, 'generated_markdown_user_story');
  assert.equal(bundle.generated_artifacts.refinement_decision_log.type, 'refinement_decision_log');
  assert.equal(bundle.generated_artifacts.user_story.immutable_after_approval, true);
  assert.equal(bundle.generated_artifacts.refinement_decision_log.immutable_after_approval, true);
  assert.match(bundle.generated_artifacts.user_story.content, /Authoritative Source: structured Task execution_contract data/);
  assert.match(bundle.generated_artifacts.refinement_decision_log.content, /Artifact Bundle: ART-TSK-104-v1/);
  assert.match(bundle.generated_artifacts.refinement_decision_log.content, /Architect: required before commit/);
  assert.deepEqual(bundle.links, [
    {
      rel: 'generated_user_story',
      label: 'Generated user story',
      path: 'docs/user-stories/TSK-104-implement-refinement-decision-logs-and-task-id-artifact-generation.md',
    },
    {
      rel: 'refinement_decision_log',
      label: 'Refinement Decision Log',
      path: 'docs/refinement/TSK-104-implement-refinement-decision-logs-and-task-id-artifact-generation.md',
    },
  ]);
  assert.deepEqual(bundle.approval_routing.section_owner_roles, ['architect', 'ux', 'qa', 'sre']);
  assert.deepEqual(bundle.approval_routing.required_roles, ['pm', 'architect', 'ux', 'qa', 'sre']);
  assert.equal(bundle.approval_routing.pm_approval_required, true);
  assert.equal(bundle.approval_routing.operator_approval_required, false);
  assert.deepEqual(bundle.approval_routing.operator_approval_reasons, []);
  assert.equal(bundle.approval_summary.canCommit, false);
  assert.deepEqual(bundle.commit_policy.blocked_reasons, [
    'missing_pm_approval',
    'missing_architect_approval',
    'missing_ux_approval',
    'missing_qa_approval',
    'missing_sre_approval',
  ]);
  assert.equal(bundle.commit_policy.requires_reviewable_bundle_before_commit, true);
  assert.equal(bundle.commit_policy.requires_pm_approval_before_commit, true);
  assert.equal(bundle.commit_policy.commit_allowed, false);
  assert.equal(bundle.commit_policy.github_issue_creation.default_off, true);
  assert.equal(bundle.commit_policy.github_issue_creation.requested, false);
  assert.equal(bundle.commit_policy.github_issue_creation.will_create_issue, false);
  assert.match(bundle.commit_policy.github_issue_creation.note, /not created by default/);
  assert.equal(bundle.pr_guidance.title, '[TSK-104] Implement Refinement Decision Logs and Task-ID Artifact Generation');
  assert.deepEqual(bundle.pr_guidance.required_links, [
    { label: 'Task', target: 'TSK-104' },
    {
      label: 'Generated user story',
      target: 'docs/user-stories/TSK-104-implement-refinement-decision-logs-and-task-id-artifact-generation.md',
    },
    {
      label: 'Refinement Decision Log',
      target: 'docs/refinement/TSK-104-implement-refinement-decision-logs-and-task-id-artifact-generation.md',
    },
    {
      label: 'Evidence report',
      target: 'docs/reports/TSK-104-implement-refinement-decision-logs-and-task-id-artifact-generation-verification.md',
    },
  ]);
  assert.equal(bundle.pr_guidance.body_template, [
    'Task: TSK-104',
    'Generated user story: docs/user-stories/TSK-104-implement-refinement-decision-logs-and-task-id-artifact-generation.md',
    'Refinement Decision Log: docs/refinement/TSK-104-implement-refinement-decision-logs-and-task-id-artifact-generation.md',
    'Evidence report: docs/reports/TSK-104-implement-refinement-decision-logs-and-task-id-artifact-generation-verification.md',
  ].join('\n'));
  assert.ok(bundle.pr_guidance.required_links.every((link) => !String(link.target).includes('opaque-internal-104')));

  const approved = approveExecutionContractArtifactBundle({
    bundle,
    actorId: 'pm-1',
    approvedAt: '2026-04-30T18:00:00.000Z',
    body: {
      approvals: {
        pm: { status: 'approved', actorId: 'pm-1' },
        architect: { status: 'approved', actorId: 'architect-1' },
        ux: { status: 'approved', actorId: 'ux-1' },
        qa: { status: 'approved', actorId: 'qa-1' },
        sre: { status: 'approved', actorId: 'sre-1' },
      },
    },
  });
  assert.equal(approved.status, 'approved_for_commit');
  assert.equal(approved.approved_at, '2026-04-30T18:00:00.000Z');
  assert.equal(approved.approved_by, 'pm-1');
  assert.equal(approved.commit_policy.approved_at, '2026-04-30T18:00:00.000Z');
  assert.equal(approved.commit_policy.approved_by, 'pm-1');
  assert.equal(approved.commit_policy.commit_allowed, true);
  assert.deepEqual(approved.commit_policy.blocked_reasons, []);
});

test('generated repo artifacts expose policy auto-approval rationale', () => {
  const contract = createExecutionContractDraft({
    taskId: 'TSK-107',
    summary: {
      task_id: 'TSK-107',
      title: 'Low-risk Simple auto approval',
      intake_draft: true,
      operator_intake_requirements: 'Make policy auto-approval visible in generated artifacts.',
    },
    history: [{ event_type: 'task.created', event_id: 'evt-107-artifacts', payload: { intake_draft: true } }],
    actorId: 'pm-107',
    body: {
      templateTier: 'Simple',
      sections: lowRiskSimpleSections(' artifacts'),
    },
  }).contract;
  const policy = evaluateExecutionContractAutoApprovalPolicy({
    contract,
    approvalSummary: evaluateExecutionContractApprovalReadiness(contract),
  });
  const autoApproval = buildExecutionContractAutoApprovalRecord({
    policy,
    approvedAt: '2026-05-01T13:00:00.000Z',
    actorId: 'pm-107',
    body: {},
  });
  const approvedContract = { ...contract, status: 'approved', auto_approval: autoApproval };

  const bundle = createExecutionContractArtifactBundle({
    taskId: 'TSK-107',
    contract: approvedContract,
    history: [
      { event_type: 'task.execution_contract_version_recorded', sequence_number: 1, payload: { version: 1, contract } },
      { event_type: 'task.execution_contract_approved', sequence_number: 2, payload: { version: 1, auto_approval: autoApproval } },
    ],
    actorId: 'pm-107',
    generatedAt: '2026-05-01T13:05:00.000Z',
    approvalSummary: { nonBlockingComments: [] },
    body: {
      displayId: 'TSK-107',
      title: 'Implement Low-Risk Simple Task Auto-Approval Policy',
    },
  });

  assert.match(bundle.generated_artifacts.user_story.content, /## Auto-Approval Policy/);
  assert.match(bundle.generated_artifacts.user_story.content, new RegExp(AUTO_APPROVAL_POLICY_VERSION));
  assert.match(bundle.generated_artifacts.user_story.content, /Approved At: 2026-05-01T13:00:00.000Z/);
  assert.match(bundle.generated_artifacts.refinement_decision_log.content, /Operator Approval was recorded by execution-contract-low-risk-simple-auto-approval\.v1/);
});

test('generates verification report skeletons from approved contract evidence and evaluates dispatch readiness', () => {
  const contract = {
    task_id: 'opaque-internal-105',
    version: 2,
    contract_id: 'EC-opaque-internal-105-v2',
    template_tier: 'Standard',
    risk_flags: [{ id: 'deployment' }],
    sections: {
      2: { title: 'Acceptance Criteria', body: 'Given an approved Standard contract, then a report skeleton is generated.' },
      4: { title: 'Automated Test Deliverables', body: 'Run unit, API, e2e, browser, and governance checks.' },
      8: { title: 'Security & Compliance', body: 'Reject direct event writes that bypass the dedicated report endpoint.' },
      11: { title: 'Deployment & Release Strategy', body: 'Ship only after the skeleton event exists and checks pass.' },
      12: { title: 'Monitoring & Observability', body: 'Record workflow audit events for skeleton generation.' },
      15: { title: 'Definition of Done', body: 'Dispatch is blocked until required skeleton evidence exists.' },
      16: { title: 'Production Validation Strategy', body: 'Validate the generated report link in task detail.' },
      17: { title: 'Compliance & Handoff', body: 'Operator review confirms skeleton scope only.' },
    },
  };

  const beforeReport = evaluateExecutionContractDispatchReadiness({ contract });
  assert.equal(beforeReport.skeletonRequired, true);
  assert.equal(beforeReport.canDispatch, false);
  assert.deepEqual(beforeReport.missingRequiredArtifacts, ['verification_report_skeleton']);

  const report = createExecutionContractVerificationReportSkeleton({
    taskId: 'opaque-internal-105',
    contract,
    actorId: 'pm-105',
    generatedAt: '2026-04-30T20:00:00.000Z',
    body: {
      displayId: 'TSK-105',
      title: 'Generate verification report skeletons from approved Execution Contracts',
    },
  });

  assert.equal(report.policy_version, 'execution-contract-verification-report-skeleton.v1');
  assert.equal(report.report_id, 'VR-TSK-105-v2');
  assert.equal(report.display_id, 'TSK-105');
  assert.equal(report.contract_version, 2);
  assert.equal(report.required, true);
  assert.equal(report.path, 'docs/reports/TSK-105-generate-verification-report-skeletons-from-approved-execution-contracts-verification.md');
  assert.equal(report.required_evidence.test, 'Run unit, API, e2e, browser, and governance checks.');
  assert.match(report.content, /## Required Evidence From Approved Contract/);
  assert.match(report.content, /### Test Evidence/);
  assert.match(report.content, /Reject direct event writes that bypass the dedicated report endpoint/);
  assert.match(report.content, /Validate the generated report link in task detail/);

  const afterReport = evaluateExecutionContractDispatchReadiness({ contract, verificationReport: report });
  assert.equal(afterReport.skeletonRequired, true);
  assert.equal(afterReport.canDispatch, true);
  assert.deepEqual(afterReport.missingRequiredArtifacts, []);

  const simpleNoRisk = {
    task_id: 'TSK-SIMPLE',
    version: 1,
    template_tier: 'Simple',
    risk_flags: [],
    sections: {},
  };
  const optional = evaluateExecutionContractDispatchReadiness({ contract: simpleNoRisk });
  assert.equal(optional.skeletonRequired, false);
  assert.equal(optional.canDispatch, true);

  const simpleWithRisk = {
    ...simpleNoRisk,
    risk_flags: ['security'],
  };
  const riskBearing = evaluateExecutionContractDispatchReadiness({ contract: simpleWithRisk });
  assert.equal(riskBearing.skeletonRequired, true);
  assert.equal(riskBearing.canDispatch, false);
});

test('keeps non-production artifact names collision-safe and requires operator approval for exception triggers', () => {
  const identity = normalizeArtifactIdentity({
    taskId: 'TSK-123',
    body: { environment: 'staging' },
  });
  assert.equal(identity.display_id, 'STG-123');
  assert.equal(identity.collision_safe, true);

  const contract = {
    task_id: 'TSK-123',
    version: 1,
    contract_id: 'EC-TSK-123-v1',
    template_tier: 'Simple',
    template_source: 'docs/templates/USER_STORY_TEMPLATE.md',
    sections: {
      1: { title: 'User Story', body: 'As a PM, I want generated artifacts.', owner_role: 'pm' },
      2: { title: 'Acceptance Criteria', body: 'Given non-blocking comments, operator approval is required.', owner_role: 'pm' },
    },
    committed_scope: { committed_requirements: [{ id: 'REQ-1', text: 'Generate artifacts.' }] },
  };
  const bundle = createExecutionContractArtifactBundle({
    taskId: 'TSK-123',
    contract,
    history: [{ event_type: 'task.execution_contract_approved', payload: { version: 1 } }],
    approvalSummary: {
      nonBlockingComments: [{ id: 'c-1', body: 'Accepted as non-blocking.', state: 'open' }],
    },
    body: {
      environment: 'staging',
      title: 'Generated Artifacts',
      approvals: {
        pm: { status: 'approved', actorId: 'pm-1' },
      },
    },
  });

  assert.equal(bundle.display_id, 'STG-123');
  assert.equal(bundle.approval_routing.operator_approval_required, true);
  assert.deepEqual(bundle.approval_routing.operator_approval_reasons.map((reason) => reason.code), ['accepts_unresolved_non_blocking_comments']);
  assert.deepEqual(bundle.approval_routing.required_roles, ['pm', 'operator']);
  assert.deepEqual(bundle.approval_summary.missingRequiredApprovals.map((item) => item.role), ['operator']);
  assert.deepEqual(bundle.commit_policy.blocked_reasons, ['missing_operator_approval']);
  assert.equal(bundle.commit_policy.commit_allowed, false);
});

test('uses a versioned artifact path instead of silently editing an approved generated story', () => {
  const previous = {
    task_id: 'TSK-104',
    version: 1,
    contract_id: 'EC-TSK-104-v1',
    template_tier: 'Simple',
    template_source: 'docs/templates/USER_STORY_TEMPLATE.md',
    sections: {
      1: { title: 'User Story', body: 'As a PM, I want the first approved story.', owner_role: 'pm' },
      2: { title: 'Acceptance Criteria', body: 'Given v1, then preserve it.', owner_role: 'pm' },
    },
    committed_scope: { committed_requirements: [{ id: 'REQ-1', text: 'Preserve v1.' }] },
  };
  const next = {
    ...previous,
    version: 2,
    contract_id: 'EC-TSK-104-v2',
    sections: {
      ...previous.sections,
      2: { title: 'Acceptance Criteria', body: 'Given v2, then generate a versioned artifact.', owner_role: 'pm' },
    },
    committed_scope: { committed_requirements: [{ id: 'REQ-1', text: 'Generate v2 with an amendment path.' }] },
  };
  const bundle = createExecutionContractArtifactBundle({
    taskId: 'TSK-104',
    contract: next,
    history: [
      { event_type: 'task.execution_contract_version_recorded', sequence_number: 1, payload: { version: 1, contract: previous } },
      { event_type: 'task.execution_contract_approved', sequence_number: 2, payload: { version: 1 } },
      { event_type: 'task.execution_contract_version_recorded', sequence_number: 3, payload: { version: 2, contract: next } },
      { event_type: 'task.execution_contract_approved', sequence_number: 4, payload: { version: 2 } },
    ],
    body: {
      displayId: 'TSK-104',
      title: 'Generated Artifacts',
    },
  });

  assert.equal(bundle.generated_artifacts.user_story.path, 'docs/user-stories/TSK-104-generated-artifacts-v2.md');
  assert.equal(bundle.generated_artifacts.refinement_decision_log.path, 'docs/refinement/TSK-104-generated-artifacts-v2.md');
  assert.equal(bundle.amendment.strategy, 'versioned_story_path');
  assert.equal(bundle.amendment.previousApprovedVersion, 1);
  assert.equal(bundle.amendment.reason, 'Approved generated stories are immutable for material changes.');
  assert.match(bundle.generated_artifacts.user_story.content, /previous generated story remains immutable/i);
  assert.match(bundle.generated_artifacts.refinement_decision_log.content, /uses a versioned artifact path for v2/);
  assert.ok(bundle.approval_routing.operator_approval_reasons.some((reason) => reason.code === 'changes_committed_requirement'));
});

test('honors artifact slug and GitHub issue request aliases without defaulting to opaque IDs', () => {
  const contract = {
    task_id: 'TSK-104',
    version: 1,
    contract_id: 'EC-TSK-104-v1',
    template_tier: 'Simple',
    sections: {
      1: { title: 'User Story', body: 'As a PM, I want artifact aliases.', owner_role: 'pm' },
      2: { title: 'Acceptance Criteria', body: 'Given aliases, then generation honors them.', owner_role: 'pm' },
    },
  };

  for (const [aliasName, aliasBody] of [
    ['slug', { slug: 'operator-cleanup' }],
    ['artifactSlug', { artifactSlug: 'camel-cleanup' }],
    ['artifact_slug', { artifact_slug: 'snake-cleanup' }],
  ]) {
    const bundle = createExecutionContractArtifactBundle({
      taskId: 'TSK-104',
      contract,
      body: {
        displayId: 'TSK-104',
        title: 'Ignored when slug alias is present',
        ...aliasBody,
      },
    });
    assert.equal(bundle.slug, Object.values(aliasBody)[0], aliasName);
    assert.equal(bundle.generated_artifacts.user_story.path, `docs/user-stories/TSK-104-${Object.values(aliasBody)[0]}.md`, aliasName);
  }

  for (const [aliasName, aliasBody] of [
    ['createGithubIssue', { createGithubIssue: true }],
    ['create_github_issue', { create_github_issue: true }],
    ['githubIssueRequested', { githubIssueRequested: true }],
    ['github_issue_requested', { github_issue_requested: true }],
  ]) {
    const bundle = createExecutionContractArtifactBundle({
      taskId: 'TSK-104',
      contract,
      body: {
        displayId: 'TSK-104',
        title: 'GitHub Issue Alias',
        ...aliasBody,
      },
    });
    assert.equal(bundle.commit_policy.github_issue_creation.requested, true, aliasName);
    assert.equal(bundle.commit_policy.github_issue_creation.will_create_issue, true, aliasName);
    assert.match(bundle.commit_policy.github_issue_creation.note, /explicitly requested/, aliasName);
  }
});

test('honors artifact approval aliases and approval fallback policies', () => {
  const baseBundle = createExecutionContractArtifactBundle({
    taskId: 'TSK-104',
    contract: {
      task_id: 'TSK-104',
      version: 1,
      contract_id: 'EC-TSK-104-v1',
      template_tier: 'Simple',
      sections: {
        1: { title: 'User Story', body: 'As a PM, I want approval aliases.', owner_role: 'pm' },
        2: { title: 'Acceptance Criteria', body: 'Given aliases, then approval honors them.', owner_role: 'pm' },
      },
    },
    body: {
      displayId: 'TSK-104',
      title: 'Approval Aliases',
    },
  });

  const camelApproved = createExecutionContractArtifactBundle({
    taskId: 'TSK-104',
    contract: {
      task_id: 'TSK-104',
      version: 1,
      contract_id: 'EC-TSK-104-v1',
      template_tier: 'Simple',
      sections: {
        1: { title: 'User Story', body: 'As a PM, I want approval aliases.', owner_role: 'pm' },
        2: { title: 'Acceptance Criteria', body: 'Given aliases, then approval honors them.', owner_role: 'pm' },
      },
    },
    body: {
      displayId: 'TSK-104',
      title: 'Approval Aliases',
      artifactApprovals: { pm: { status: 'approved', actorId: 'pm-1' } },
    },
  });
  assert.equal(camelApproved.status, 'approved_for_commit');

  const snakeApproved = createExecutionContractArtifactBundle({
    taskId: 'TSK-104',
    contract: {
      task_id: 'TSK-104',
      version: 1,
      contract_id: 'EC-TSK-104-v1',
      template_tier: 'Simple',
      sections: {
        1: { title: 'User Story', body: 'As a PM, I want approval aliases.', owner_role: 'pm' },
        2: { title: 'Acceptance Criteria', body: 'Given aliases, then approval honors them.', owner_role: 'pm' },
      },
    },
    body: {
      displayId: 'TSK-104',
      title: 'Approval Aliases',
      artifact_approvals: { pm: { status: 'approved', actorId: 'pm-1' } },
    },
  });
  assert.equal(snakeApproved.status, 'approved_for_commit');

  const fallbackRequiredRoles = approveExecutionContractArtifactBundle({
    bundle: {
      ...baseBundle,
      approval_routing: undefined,
      approval_summary: { requiredRoles: ['pm', 'operator'] },
      approvals: { pm: { status: 'approved', approved: true, role: 'pm' } },
      commit_policy: { github_issue_creation: { default_off: true } },
      identity: { valid_for_committed_repo: false },
    },
    body: {
      artifact_approvals: {
        operator: { status: 'approved', actorId: 'operator-1' },
      },
    },
  });
  assert.equal(fallbackRequiredRoles.status, 'approved_for_commit');
  assert.equal(fallbackRequiredRoles.commit_policy.commit_allowed, false);
  assert.deepEqual(fallbackRequiredRoles.commit_policy.blocked_reasons, ['invalid_artifact_display_id']);
  assert.equal(fallbackRequiredRoles.commit_policy.github_issue_creation.default_off, true);
  assert.equal(fallbackRequiredRoles.approvals.pm.status, 'approved');
  assert.equal(fallbackRequiredRoles.approvals.operator.status, 'approved');

  const defaultPmApproval = approveExecutionContractArtifactBundle({
    bundle: {
      identity: { valid_for_committed_repo: true },
      commit_policy: {},
    },
    body: {
      artifactApprovals: {
        pm: { status: 'approved', actorId: 'pm-1' },
      },
    },
  });
  assert.equal(defaultPmApproval.status, 'approved_for_commit');
  assert.equal(defaultPmApproval.commit_policy.commit_allowed, true);

  const pendingOperator = approveExecutionContractArtifactBundle({
    bundle: {
      ...baseBundle,
      approval_routing: {
        required_roles: ['pm', 'operator'],
        operator_approval_required: true,
        operator_approval_reasons: [{ code: 'scope_mismatch', detail: 'Scope mismatch.' }],
      },
      identity: { valid_for_committed_repo: true },
    },
    body: {
      approvals: {
        pm: { status: 'approved', actorId: 'pm-1' },
      },
    },
  });
  assert.equal(pendingOperator.status, 'pending_approval');
  assert.equal(pendingOperator.approval_summary.operatorApprovalRequired, true);
  assert.deepEqual(pendingOperator.approval_summary.operatorApprovalReasons, [{ code: 'scope_mismatch', detail: 'Scope mismatch.' }]);
  assert.deepEqual(pendingOperator.commit_policy.blocked_reasons, ['missing_operator_approval']);
});

test('builds Contract Coverage Audit rows only from committed scope and excludes Deferred Considerations', () => {
  const { contract } = createExecutionContractDraft({
    taskId: 'TSK-108',
    summary: { title: 'Contract Coverage Audit', operator_intake_requirements: 'Add coverage gate.' },
    body: {
      templateTier: 'Simple',
      sections: lowRiskSimpleSections(),
      scopeBoundaries: {
        committedRequirements: [
          { id: 'REQ-108-1', text: 'Engineer submits a coverage matrix before QA.', sourceSectionId: '2' },
          { id: 'REQ-108-2', text: 'QA validates automated evidence before QA Verification.', sourceSectionId: '2' },
        ],
        deferredConsiderations: [
          'Deferred Consideration queue is tracked separately and is not committed scope.',
        ],
      },
    },
    actorId: 'pm-108',
  });
  contract.status = 'approved';
  contract.committed_scope.commitment_status = 'committed';

  const requirements = contractCoverageRequirements(contract);
  assert.deepEqual(requirements.map((requirement) => requirement.id), ['REQ-108-1', 'REQ-108-2']);
  assert.deepEqual(requirements.map((requirement) => requirement.coverage_area), ['acceptance_criteria', 'acceptance_criteria']);
  assert.equal(requirements.some((requirement) => /Deferred Consideration/.test(requirement.text)), false);

  const { audit, readiness } = createContractCoverageAudit({
    taskId: 'TSK-108',
    contract,
    implementationAttempt: 1,
    actorId: 'engineer-108',
    body: {
      rows: [
        {
          requirementId: 'REQ-108-1',
          status: 'covered',
          implementationEvidence: ['commit abc1234'],
          verificationEvidence: ['node --test tests/unit/execution-contracts.test.js'],
        },
        {
          requirementId: 'REQ-108-2',
          status: 'covered',
          implementationEvidence: ['commit abc1234'],
          verificationEvidence: [{ label: 'Manual reviewer looked at the screen', kind: 'manual' }],
        },
      ],
    },
  });

  assert.equal(audit.contract_version, 1);
  assert.equal(audit.implementation_attempt, 1);
  assert.equal(audit.rows.length, 2);
  assert.equal(readiness.status, 'implementation_incomplete');
  assert.ok(readiness.blocking_exceptions.some((exception) => exception.reason_code === 'manual_only_verification_evidence'));
});

test('validates Contract Coverage Audit closure, Markdown, and autonomy-confidence outcomes', () => {
  const contract = {
    task_id: 'TSK-108',
    version: 2,
    contract_id: 'EC-TSK-108-v2',
    template_tier: 'Complex',
    committed_scope: {
      commitment_status: 'committed',
      committed_requirements: [
        { id: 'REQ-108-AC', text: 'Coverage rows map to acceptance criteria.', source_section_id: '2' },
        { id: 'REQ-108-QA', text: 'QA validation has automated evidence.', source_section_id: '4' },
        { id: 'REQ-108-OBS', text: 'Coverage outcome feeds autonomy confidence.', source_section_id: '12' },
      ],
      deferred_considerations: [
        { id: 'DEF-108', text: 'Future Deferred Consideration queue.' },
      ],
    },
  };
  const { audit } = createContractCoverageAudit({
    taskId: 'TSK-108',
    contract,
    implementationAttempt: 3,
    body: {
      rows: [
        {
          requirementId: 'REQ-108-AC',
          status: 'covered',
          implementationEvidence: ['commit feed123'],
          verificationEvidence: ['npm run test:unit'],
        },
        {
          requirementId: 'REQ-108-QA',
          status: 'covered',
          implementationEvidence: ['PR #128'],
          verificationEvidence: ['npm run test:e2e'],
        },
        {
          requirementId: 'REQ-108-OBS',
          status: 'not_applicable',
          notApplicableRationale: 'Autonomy metrics are emitted by existing audit metric plumbing.',
        },
      ],
    },
  });

  const { validation } = validateContractCoverageAudit({
    audit,
    contract,
    history: [
      {
        event_type: 'task.execution_contract_verification_report_generated',
        payload: { verification_report: { path: 'docs/reports/TSK-108-contract-coverage-audit-verification.md' } },
      },
    ],
    actorId: 'qa-108',
  });

  assert.equal(validation.status, 'closed');
  assert.equal(validation.gate_closed, true);
  assert.equal(validation.can_start_qa_verification, true);
  assert.equal(validation.autonomy_confidence_signal.outcome, 'neutral');
  assert.match(validation.markdown.content, /## Contract Coverage Audit/);
  assert.match(validation.markdown.content, /REQ-108-OBS/);

  const negative = evaluateContractCoverageAudit({
    contract,
    audit: {
      ...audit,
      rows: audit.rows.map((row) => row.requirement_id === 'REQ-108-QA'
        ? { ...row, status: 'partial', verification_evidence: [] }
        : row),
    },
  });
  assert.equal(negative.status, 'implementation_incomplete');
  assert.equal(negative.autonomy_confidence_signal.outcome, 'negative');

  const projection = deriveContractCoverageAuditProjection([
    {
      event_type: 'task.contract_coverage_audit_submitted',
      sequence_number: 1,
      occurred_at: '2026-05-01T00:00:00.000Z',
      actor_id: 'engineer-108',
      payload: { coverage_audit: audit },
    },
    {
      event_type: 'task.contract_coverage_audit_validated',
      sequence_number: 2,
      occurred_at: '2026-05-01T00:01:00.000Z',
      actor_id: 'qa-108',
      payload: { audit_id: audit.audit_id, validation },
    },
  ], contract);
  assert.equal(projection.active, true);
  assert.equal(projection.latest.status, 'closed');
  assert.equal(projection.validation.status, 'closed');
  assert.equal(projection.audits[0].implementationAttempt, 3);
});
