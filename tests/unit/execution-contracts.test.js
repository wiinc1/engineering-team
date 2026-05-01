const test = require('node:test');
const assert = require('node:assert/strict');
const {
  REQUIRED_SECTIONS_BY_TIER,
  approveExecutionContractArtifactBundle,
  contractMarkdown,
  createExecutionContractDraft,
  createExecutionContractArtifactBundle,
  evaluateExecutionContractApprovalReadiness,
  normalizeArtifactIdentity,
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
