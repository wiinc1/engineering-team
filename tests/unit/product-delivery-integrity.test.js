const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const RUNNABLE_SURFACE_HEAD_SHA = execFileSync('git', ['rev-parse', 'main'], { encoding: 'utf8' }).trim();
const {
  PRODUCT_DELIVERY_INTEGRITY_POLICY_VERSION,
  normalizeDesignScope,
  normalizeProductDeliveryContractFields,
  buildUiAcceptanceCriteriaSection,
  evaluateRunnableSurfaceVerification,
  assertEngineerSubmissionProductDelivery,
  assertProductReconciliationAllowsQaPass,
  assertProductCloseoutDelivery,
  buildProductDeliveryCloseoutChecklistItem,
  assertQaResultProductDelivery,
  deriveProductDeliveryProjection,
  intakeTextSuggestsUiUx,
  defaultOperatorVerificationPathForIntake,
  visualGateOverrideEnabled,
} = require('../../lib/audit/product-delivery-integrity');
const {
  createExecutionContractDraft,
  evaluateExecutionContractApprovalReadiness: evaluateApproval,
  REQUIRED_SECTIONS_BY_TIER,
} = require('../../lib/audit/execution-contracts');

function uiContractBody(overrides = {}) {
  return {
    templateTier: 'Standard',
    riskFlags: ['human_workflow', 'desktop_visual_validation'],
    dispatchSignals: { workCategory: 'ui_ux' },
    sections: Object.fromEntries(
      REQUIRED_SECTIONS_BY_TIER.Standard.map((id) => [id, `Completed section ${id}.`]),
    ),
    reviewers: {
      architect: { status: 'approved', approved: true },
      ux: { status: 'approved', approved: true },
      qa: { status: 'approved', approved: true },
      sre: { status: 'approved', approved: true },
    },
    designScope: {
      mode: 'behavior_only',
      issueUrl: 'https://github.com/wiinc1/engineering-team/issues/279',
      screenshotPath: 'docs/design/assets/command-console-redesign-target.png',
      parityBar: 'Inspector and queue selection only; no full #279 chrome.',
    },
    runnableSurface: {
      branch: 'main',
      serveUrl: 'http://127.0.0.1:15173',
      mergePolicy: 'required_before_submission_final',
    },
    ...overrides,
  };
}

function createUiContract(overrides = {}) {
  return createExecutionContractDraft({
    taskId: 'TSK-PDI',
    summary: {
      task_id: 'TSK-PDI',
      title: 'Command Center UI',
      intake_draft: true,
      operator_intake_requirements: 'Queue-first Command Center with inspector.',
    },
    history: [{
      event_type: 'task.created',
      payload: {
        intake_draft: true,
        title: 'Command Center UI',
        raw_requirements: 'Queue-first Command Center with inspector.',
      },
    }],
    actorId: 'pm',
    body: uiContractBody(overrides),
  }).contract;
}

test('normalizeDesignScope requires mode for UI-facing contracts', () => {
  const missing = normalizeDesignScope({}, { contract: { dispatch_signals: { work_category: 'ui_ux' } } });
  assert.equal(missing.validation.status, 'missing');

  const valid = normalizeDesignScope({
    mode: 'behavior_only',
    issueUrl: 'https://github.com/wiinc1/engineering-team/issues/279',
    parityBar: 'Inspector only',
    screenshotPath: 'docs/design/assets/command-console-redesign-target.png',
  }, { contract: { dispatch_signals: { work_category: 'ui_ux' } } });
  assert.equal(valid.mode, 'behavior_only');
  assert.equal(valid.validation.status, 'valid');
});

test('createExecutionContractDraft stores design_scope and runnable_surface anchors', () => {
  const contract = createUiContract();
  assert.equal(contract.design_scope.mode, 'behavior_only');
  assert.equal(contract.runnable_surface.branch, 'main');
  assert.equal(contract.runnable_surface.serve_url, 'http://127.0.0.1:15173');
  assert.equal(contract.operator_verification_path.route, '/tasks?view=list');
  assert.equal(contract.product_delivery_integrity.policy_version, PRODUCT_DELIVERY_INTEGRITY_POLICY_VERSION);
});

test('approval readiness blocks ui_ux contracts without design_scope', () => {
  const contract = createUiContract({ designScope: null });
  delete contract.design_scope;
  const readiness = evaluateApproval({
    ...contract,
    reviewers: {
      ...contract.reviewers,
      qa: { ...contract.reviewers.qa, status: 'approved', approved: true },
    },
  });
  assert.equal(readiness.canApprove, false);
  assert.ok((readiness.blockedReasons || []).some((reason) => reason.code === 'missing_design_scope')
    || (readiness.missingRequiredApprovals || []).some((entry) => (
      (entry.reasons || []).some((reason) => reason.code === 'missing_design_scope')
    )));
});

test('buildUiAcceptanceCriteriaSection emits observable product outcomes', () => {
  const body = buildUiAcceptanceCriteriaSection({
    designScope: { mode: 'behavior_only', parity_bar: 'Inspector only' },
    operatorPath: { route: '/tasks?view=list', on_load: 'Queue visible', on_select: 'Inspector opens' },
  });
  assert.match(body, /Given an operator opens \/tasks\?view=list/);
  assert.match(body, /Inspector opens/);
  assert.match(body, /on-load screenshot evidence/);
});

test('evaluateRunnableSurfaceVerification accepts HEAD commit on main', () => {
  const head = RUNNABLE_SURFACE_HEAD_SHA;
  const contract = createUiContract();
  const verification = evaluateRunnableSurfaceVerification({
    contract,
    commitSha: head,
    options: { repoRoot: process.cwd() },
  });
  assert.equal(verification.verified, true);
});

test('assertEngineerSubmissionProductDelivery rejects commits not on runnable branch', () => {
  const contract = createUiContract();
  assert.throws(() => assertEngineerSubmissionProductDelivery({
    contract,
    submission: { commit_sha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' },
    options: { repoRoot: process.cwd() },
  }), (error) => error.code === 'runnable_surface_not_merged');
});

test('assertQaResultProductDelivery blocks pass without visual evidence for desktop_visual_validation', () => {
  const contract = createUiContract();
  assert.throws(() => assertQaResultProductDelivery({
    contract,
    body: {},
    outcome: 'pass',
    options: {},
  }), (error) => error.code === 'missing_visual_qa_evidence');
});

test('assertQaResultProductDelivery accepts pass with complete visual evidence payload', () => {
  const contract = createUiContract();
  const result = assertQaResultProductDelivery({
    contract,
    body: {
      visualEvidence: {
        screenshotPath: 'observability/product-visual/tsk-pdi-on-load.png',
        routePath: '/tasks?view=list',
        viewportWidth: 1280,
        capturePhase: 'on_load',
        comparabilityNote: 'Compared to design anchor screenshot.',
        goldenPathBrowserProfile: 'playwright.golden-path',
      },
    },
    outcome: 'pass',
    options: { allowVisualGateOverride: true },
  });
  assert.equal(result.allowed, true);
  assert.equal(result.visual_evidence.capture_phase, 'on_load');
});

test('deriveProductDeliveryProjection reports divergence when platform advanced without visual proof', () => {
  const contract = createUiContract();
  const head = RUNNABLE_SURFACE_HEAD_SHA;
  const history = [
    {
      event_type: 'task.engineer_submission_recorded',
      payload: { commit_sha: head, version: 1 },
    },
    {
      event_type: 'task.qa_result_recorded',
      payload: { outcome: 'pass', summary: 'Automated checks only.' },
    },
  ];
  const projection = deriveProductDeliveryProjection({
    state: { current_stage: 'SRE_MONITORING' },
    history,
    contract,
    options: { repoRoot: process.cwd() },
  });
  assert.equal(projection.runnable_surface_verified, true);
  assert.equal(projection.visual_verified, false);
  assert.equal(projection.status, 'in_progress');
});

test('visualGateOverrideEnabled honors VISUAL_GATE_OVERRIDE', () => {
  const previous = process.env.VISUAL_GATE_OVERRIDE;
  process.env.VISUAL_GATE_OVERRIDE = '1';
  assert.equal(visualGateOverrideEnabled(), true);
  process.env.VISUAL_GATE_OVERRIDE = previous;
});

test('assertProductReconciliationAllowsQaPass blocks pass after failed reconciliation', () => {
  const history = [{
    event_type: 'task.product_delivery_reconciled',
    event_id: 'evt-reconcile-failed',
    payload: {
      status: 'failed',
      mismatch_reason: 'operator_reported_ui_mismatch',
    },
  }];
  assert.throws(() => assertProductReconciliationAllowsQaPass({
    history,
    outcome: 'pass',
    options: {},
  }), (error) => error.code === 'product_delivery_reconciliation_required');
});

test('assertProductReconciliationAllowsQaPass allows fail outcome even after failed reconciliation', () => {
  const history = [{
    event_type: 'task.product_delivery_reconciled',
    payload: { status: 'failed', mismatch_reason: 'operator_reported_ui_mismatch' },
  }];
  const result = assertProductReconciliationAllowsQaPass({
    history,
    outcome: 'fail',
    options: {},
  });
  assert.equal(result.allowed, true);
  assert.equal(result.skipped, 'non_pass_outcome');
});

test('assertProductCloseoutDelivery blocks closeout when product delivery is not verified', () => {
  const contract = createUiContract();
  const head = RUNNABLE_SURFACE_HEAD_SHA;
  const history = [
    {
      event_type: 'task.engineer_submission_recorded',
      payload: { commit_sha: head, version: 1 },
    },
    {
      event_type: 'task.qa_result_recorded',
      payload: { outcome: 'pass', summary: 'Platform QA without visual evidence.' },
    },
  ];
  assert.throws(() => assertProductCloseoutDelivery({
    contract,
    history,
    options: { repoRoot: process.cwd() },
  }), (error) => error.code === 'product_delivery_not_verified');
});

test('assertProductCloseoutDelivery allows closeout when runnable surface and visual evidence are complete', () => {
  const contract = createUiContract();
  const head = RUNNABLE_SURFACE_HEAD_SHA;
  const history = [
    {
      event_type: 'task.engineer_submission_recorded',
      payload: { commit_sha: head, version: 1 },
    },
    {
      event_type: 'task.qa_result_recorded',
      payload: {
        outcome: 'pass',
        visual_evidence: {
          screenshot_path: 'observability/product-visual/tsk-pdi-closeout.png',
          route_path: '/tasks?view=list',
          viewport_width: 1280,
          capture_phase: 'on_load',
          comparability_note: 'Golden-path on-load screenshot matches operator verification path.',
        },
      },
    },
  ];
  const result = assertProductCloseoutDelivery({
    contract,
    history,
    options: { repoRoot: process.cwd() },
  });
  assert.equal(result.allowed, true);
  assert.equal(result.product_delivery.status, 'verified');
});

test('buildProductDeliveryCloseoutChecklistItem reports blocked state after failed reconciliation', () => {
  const contract = createUiContract();
  const item = buildProductDeliveryCloseoutChecklistItem({
    contract,
    history: [{
      event_type: 'task.product_delivery_reconciled',
      payload: { status: 'failed', mismatch_reason: 'operator_reported_ui_mismatch' },
    }],
    options: { repoRoot: process.cwd() },
  });
  assert.equal(item.key, 'product-delivery');
  assert.equal(item.status, 'blocked');
  assert.match(item.detail, /reconciliation failed/i);
});

test('intakeTextSuggestsUiUx detects UI-facing intake language', () => {
  assert.equal(intakeTextSuggestsUiUx('Queue-first Command Center with inspector.'), true);
  assert.equal(intakeTextSuggestsUiUx('Update Postgres migration for audit store.'), false);
});

test('defaultOperatorVerificationPathForIntake anchors task workspace route', () => {
  const path = defaultOperatorVerificationPathForIntake();
  assert.equal(path.route, '/tasks?view=list');
  assert.ok(path.outOfScopeRoutes.includes('/tasks/:id'));
});