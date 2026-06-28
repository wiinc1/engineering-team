const { execFileSync } = require('node:child_process');

const PRODUCT_DELIVERY_INTEGRITY_POLICY_VERSION = 'product-delivery-integrity.v1';

const DESIGN_SCOPE_MODES = new Set(['design_full', 'design_mvp', 'behavior_only']);

const MERGE_POLICIES = new Set(['required_before_submission_final', 'stack_serves_worktree']);

const VISUAL_RISK_FLAGS = new Set(['desktop_visual_validation', 'human_workflow']);

const UI_AFFECTING_RISK_FLAGS = new Set([
  'human_workflow',
  'desktop_visual_validation',
  'design_system_compliance',
  'frontend_regression',
  'ui',
  'ux',
  'accessibility',
]);

const DEFAULT_RUNNABLE_SURFACE = Object.freeze({
  branch: 'main',
  serve_url: 'http://127.0.0.1:15173',
  merge_policy: 'required_before_submission_final',
});

const DEFAULT_FORGE_ARTIFACT = Object.freeze({
  worktree_allowed: true,
});

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeUrl(value) {
  const text = normalizeText(value);
  if (!text) return null;
  try {
    const parsed = new URL(text);
    return parsed.href.replace(/\/$/, '');
  } catch {
    return null;
  }
}

function contractRiskFlagIds(contract = {}) {
  return (contract.risk_flags || []).map((entry) => entry?.id || entry).filter(Boolean);
}

function contractWorkCategory(contract = {}) {
  const signals = contract.dispatch_signals || contract.dispatchSignals || {};
  return normalizeText(signals.work_category || signals.workCategory).toLowerCase();
}

function contractAffectsUi(contract = {}) {
  if (contract.product_delivery_integrity?.affects_ui === true) return true;
  if (contractAffectsUiFromForge(contract)) return true;
  if (contractWorkCategory(contract) === 'ui_ux') return true;
  const riskFlags = contractRiskFlagIds(contract);
  return riskFlags.some((flag) => UI_AFFECTING_RISK_FLAGS.has(flag));
}

function contractAffectsUiFromForge(contract = {}) {
  const forge = contract.forge_dispatch || contract.forgeDispatch || {};
  if (forge.affects_ui != null || forge.affectsUi != null) {
    return Boolean(forge.affects_ui ?? forge.affectsUi);
  }
  return false;
}

function normalizeDesignScope(input = {}, context = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const mode = normalizeText(source.mode || source.designScopeMode || source.design_scope_mode).toLowerCase();
  const issueUrl = normalizeUrl(source.issueUrl || source.issue_url);
  const screenshotPath = normalizeText(source.screenshotPath || source.screenshot_path || source.designAnchorScreenshotPath);
  const parityBar = normalizeText(source.parityBar || source.parity_bar);
  const inScope = normalizeStringList(source.inScope || source.in_scope);
  const outOfScope = normalizeStringList(source.outOfScope || source.out_of_scope);

  const normalized = {
    policy_version: PRODUCT_DELIVERY_INTEGRITY_POLICY_VERSION,
    mode: DESIGN_SCOPE_MODES.has(mode) ? mode : null,
    issue_url: issueUrl,
    screenshot_path: screenshotPath || null,
    parity_bar: parityBar || null,
    in_scope: inScope,
    out_of_scope: outOfScope,
  };

  if (!normalized.mode && contractAffectsUi(context.contract || {})) {
    normalized.validation = {
      status: 'missing',
      missing: ['mode'],
    };
  } else if (normalized.mode) {
    const missing = [];
    if (!normalized.issue_url) missing.push('issue_url');
    if (!normalized.parity_bar) missing.push('parity_bar');
    if (normalized.mode !== 'behavior_only' && !normalized.screenshot_path) {
      missing.push('screenshot_path');
    }
    normalized.validation = missing.length
      ? { status: 'invalid', missing }
      : { status: 'valid', missing: [] };
  } else {
    normalized.validation = { status: 'not_required', missing: [] };
  }

  return normalized;
}

function normalizeRunnableSurface(input = {}, context = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const affectsUi = contractAffectsUi(context.contract || {});
  const branch = normalizeText(source.branch) || DEFAULT_RUNNABLE_SURFACE.branch;
  const serveUrl = normalizeUrl(source.serveUrl || source.serve_url) || DEFAULT_RUNNABLE_SURFACE.serve_url;
  const mergePolicy = normalizeText(source.mergePolicy || source.merge_policy).toLowerCase()
    || DEFAULT_RUNNABLE_SURFACE.merge_policy;

  const normalized = {
    policy_version: PRODUCT_DELIVERY_INTEGRITY_POLICY_VERSION,
    branch,
    serve_url: serveUrl,
    merge_policy: MERGE_POLICIES.has(mergePolicy) ? mergePolicy : DEFAULT_RUNNABLE_SURFACE.merge_policy,
    forge_worktree_path: normalizeText(source.forgeWorktreePath || source.forge_worktree_path) || null,
  };

  if (!affectsUi) {
    normalized.validation = { status: 'not_required', missing: [] };
    return normalized;
  }

  const missing = [];
  if (!normalized.branch) missing.push('branch');
  if (!normalized.serve_url) missing.push('serve_url');
  normalized.validation = missing.length
    ? { status: 'invalid', missing }
    : { status: 'valid', missing: [] };

  return normalized;
}

function normalizeDesignAnchor(designScope = {}, input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    issue_url: normalizeUrl(source.issueUrl || source.issue_url) || designScope.issue_url || null,
    screenshot_path: normalizeText(source.screenshotPath || source.screenshot_path)
      || designScope.screenshot_path
      || null,
  };
}

function normalizeOperatorVerificationPath(input = {}, context = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const runnable = context.runnableSurface || normalizeRunnableSurface({}, context);
  const defaults = {
    url: `${runnable.serve_url}/sign-in`,
    login: 'admin@golden-path.local / <seeded>',
    nav: 'Task workspace (not task detail, not inbox)',
    route: '/tasks?view=list',
    on_load: 'Queue-first Command Center chrome is visible on first paint.',
    on_select: 'Persistent inspector opens with selected task context.',
    out_of_scope_routes: ['/tasks/:id', '/inbox/*', '/overview/*'],
  };

  const normalized = {
    policy_version: PRODUCT_DELIVERY_INTEGRITY_POLICY_VERSION,
    url: normalizeUrl(source.url) || defaults.url,
    login: normalizeText(source.login) || defaults.login,
    nav: normalizeText(source.nav) || defaults.nav,
    route: normalizeText(source.route) || defaults.route,
    on_load: normalizeText(source.onLoad || source.on_load) || defaults.on_load,
    on_select: normalizeText(source.onSelect || source.on_select) || defaults.on_select,
    out_of_scope_routes: normalizeStringList(source.outOfScopeRoutes || source.out_of_scope_routes)
      .length
      ? normalizeStringList(source.outOfScopeRoutes || source.out_of_scope_routes)
      : defaults.out_of_scope_routes,
  };

  if (!contractAffectsUi(context.contract || {})) {
    normalized.validation = { status: 'not_required', missing: [] };
    return normalized;
  }

  const missing = ['url', 'route', 'on_load', 'on_select']
    .filter((field) => !normalized[field]);
  normalized.validation = missing.length
    ? { status: 'invalid', missing }
    : { status: 'valid', missing: [] };

  return normalized;
}

function normalizeForgeArtifactPolicy(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const worktreeAllowed = source.worktreeAllowed ?? source.worktree_allowed;
  return {
    worktree_allowed: worktreeAllowed == null ? DEFAULT_FORGE_ARTIFACT.worktree_allowed : worktreeAllowed === true,
  };
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeText(entry)).filter(Boolean);
  }
  return normalizeText(value)
    .split(/\n+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeProductDeliveryContractFields(body = {}, context = {}) {
  const contract = context.contract || {};
  const designScope = normalizeDesignScope(
    body.designScope || body.design_scope || contract.design_scope || contract.designScope || {},
    { contract },
  );
  const runnableSurface = normalizeRunnableSurface(
    body.runnableSurface || body.runnable_surface || contract.runnable_surface || contract.runnableSurface || {},
    { contract },
  );
  const operatorVerificationPath = normalizeOperatorVerificationPath(
    body.operatorVerificationPath || body.operator_verification_path
      || contract.operator_verification_path
      || contract.operatorVerificationPath
      || {},
    { contract, runnableSurface },
  );
  const designAnchor = normalizeDesignAnchor(
    designScope,
    body.designAnchor || body.design_anchor || contract.design_anchor || contract.designAnchor || {},
  );
  const forgeArtifact = normalizeForgeArtifactPolicy(
    body.forgeArtifact || body.forge_artifact || contract.forge_artifact || contract.forgeArtifact || {},
  );

  const enrichedContract = {
    ...contract,
    design_scope: designScope,
    runnable_surface: runnableSurface,
    operator_verification_path: operatorVerificationPath,
  };

  return {
    design_scope: designScope,
    runnable_surface: runnableSurface,
    operator_verification_path: operatorVerificationPath,
    design_anchor: designAnchor,
    forge_artifact: forgeArtifact,
    product_delivery_integrity: {
      policy_version: PRODUCT_DELIVERY_INTEGRITY_POLICY_VERSION,
      affects_ui: contractAffectsUi(enrichedContract),
    },
  };
}

function buildUiAcceptanceCriteriaSection({
  designScope = {},
  operatorPath = {},
  templatePath = 'docs/templates/UI_ACCEPTANCE_CRITERIA.md',
} = {}) {
  const mode = designScope.mode || 'behavior_only';
  const parity = designScope.parity_bar || 'Behavior-only delivery without full design parity.';
  const route = operatorPath.route || '/tasks?view=list';
  const onLoad = operatorPath.on_load || 'Queue-first Command Center chrome is visible on first paint.';
  const onSelect = operatorPath.on_select || 'Persistent inspector opens with selected task context.';

  return [
    'Acceptance Criteria',
    `Design scope: ${mode}`,
    `Parity bar: ${parity}`,
    `Template: ${templatePath}`,
    '',
    `1. Given an operator opens ${route} at the runnable surface URL, when the page finishes loading, then ${onLoad}`,
    `2. Given the Command Center is visible, when the operator selects a task from the queue/list/board, then ${onSelect}`,
    '3. Given the desktop layout renders on first paint, when reviewed against the design anchor screenshot, then visible regions match the declared design scope mode.',
    '4. Given visual verification is required, when QA records results, then on-load screenshot evidence is captured at the runnable surface URL with route path and comparability notes.',
    '5. Given engineer submission is final, when the submission commit is checked against the runnable branch, then the commit is merged to the declared runnable surface branch.',
  ].join('\n');
}

function augmentExecutionContractApprovalReadiness(readiness = {}, contract = {}) {
  if (!contractAffectsUi(contract)) {
    return readiness;
  }

  const designScope = contract.design_scope || contract.designScope || {};
  const missing = [...(readiness.missingRequiredApprovals || [])];
  const blockedReasons = [...(readiness.blockedReasons || [])];

  if (!designScope.mode || designScope.validation?.status === 'missing') {
    missing.push({
      role: 'pm',
      label: 'PM',
      status: 'pending',
      reasons: [{
        code: 'missing_design_scope',
        detail: 'UI/UX contracts require design_scope.mode (design_full, design_mvp, or behavior_only).',
      }],
    });
    blockedReasons.push({
      source: 'product_delivery_integrity',
      code: 'missing_design_scope',
      detail: 'Contract approval is blocked until design scope is anchored for UI work.',
    });
  } else if (designScope.validation?.status === 'invalid') {
    blockedReasons.push({
      source: 'product_delivery_integrity',
      code: 'invalid_design_scope',
      detail: `Design scope is incomplete: ${(designScope.validation.missing || []).join(', ')}`,
    });
  }

  const runnableSurface = contract.runnable_surface || contract.runnableSurface || {};
  if (runnableSurface.validation?.status === 'invalid') {
    blockedReasons.push({
      source: 'product_delivery_integrity',
      code: 'invalid_runnable_surface',
      detail: `Runnable surface declaration is incomplete: ${(runnableSurface.validation.missing || []).join(', ')}`,
    });
  }

  const blocked = missing.length > readiness.missingRequiredApprovals?.length
    || blockedReasons.length > (readiness.blockedReasons || []).length
    || designScope.validation?.status === 'invalid'
    || runnableSurface.validation?.status === 'invalid';

  return {
    ...readiness,
    status: blocked ? 'blocked' : readiness.status,
    canApprove: readiness.canApprove === true && !blocked,
    missingRequiredApprovals: missing,
    blockedReasons,
    productDeliveryIntegrity: {
      policy_version: PRODUCT_DELIVERY_INTEGRITY_POLICY_VERSION,
      design_scope_required: true,
      design_scope_mode: designScope.mode || null,
      runnable_surface_required: true,
    },
  };
}

function visualGateOverrideEnabled(options = {}) {
  if (options.allowVisualGateOverride === true) return true;
  const env = options.env || process.env;
  return ['1', 'true', 'yes', 'on'].includes(String(env.VISUAL_GATE_OVERRIDE || env.PRODUCT_DELIVERY_GATE_OVERRIDE || '').trim().toLowerCase());
}

function resolveRepoRoot(options = {}) {
  return options.repoRoot || process.cwd();
}

function resolveBranchHead(branch, options = {}) {
  const repoRoot = resolveRepoRoot(options);
  try {
    return execFileSync('git', ['rev-parse', branch], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function isCommitAncestorOfBranch(commitSha, branch, options = {}) {
  const sha = normalizeText(commitSha).toLowerCase();
  const targetBranch = normalizeText(branch);
  if (!sha || !targetBranch) {
    return { verified: false, reason: 'missing_commit_or_branch' };
  }

  const repoRoot = resolveRepoRoot(options);
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', sha, targetBranch], {
      cwd: repoRoot,
      stdio: 'ignore',
    });
    return {
      verified: true,
      verified_branch: targetBranch,
      verified_branch_head: resolveBranchHead(targetBranch, options),
      verified_at: new Date().toISOString(),
    };
  } catch {
    return {
      verified: false,
      verified_branch: targetBranch,
      verified_branch_head: resolveBranchHead(targetBranch, options),
      verified_at: new Date().toISOString(),
      reason: 'runnable_surface_not_merged',
    };
  }
}

function evaluateRunnableSurfaceVerification({ contract = {}, commitSha = '', options = {} } = {}) {
  if (!contractAffectsUi(contract)) {
    return { required: false, verified: true };
  }

  const runnable = contract.runnable_surface || contract.runnableSurface || normalizeRunnableSurface({}, { contract });
  const sha = normalizeText(commitSha);
  if (!sha) {
    return {
      required: true,
      verified: false,
      reason: 'missing_commit_sha',
      runnable_surface: runnable,
    };
  }

  if (visualGateOverrideEnabled(options)) {
    return {
      required: true,
      verified: true,
      override: true,
      runnable_surface: runnable,
      verified_branch: runnable.branch,
      verified_at: new Date().toISOString(),
    };
  }

  if (runnable.merge_policy === 'stack_serves_worktree' && runnable.forge_worktree_path) {
    try {
      const worktreeHead = execFileSync('git', ['-C', runnable.forge_worktree_path, 'rev-parse', 'HEAD'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      const verified = worktreeHead.startsWith(sha) || sha.startsWith(worktreeHead);
      return {
        required: true,
        verified,
        mode: 'stack_serves_worktree',
        runnable_surface: runnable,
        verified_branch: runnable.branch,
        verified_branch_head: worktreeHead,
        verified_at: new Date().toISOString(),
        reason: verified ? null : 'runnable_surface_not_merged',
      };
    } catch {
      return {
        required: true,
        verified: false,
        mode: 'stack_serves_worktree',
        runnable_surface: runnable,
        reason: 'worktree_head_unavailable',
      };
    }
  }

  const result = isCommitAncestorOfBranch(sha, runnable.branch, options);
  return {
    required: true,
    verified: result.verified === true,
    runnable_surface: runnable,
    ...result,
  };
}

function contractRequiresDesktopVisualValidation(contract = {}) {
  return contractRiskFlagIds(contract).includes('desktop_visual_validation');
}

function contractRequiresHumanWorkflowGate(contract = {}) {
  return contractRiskFlagIds(contract).includes('human_workflow');
}

function normalizeVisualEvidence(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    screenshot_path: normalizeText(source.screenshotPath || source.screenshot_path) || null,
    screenshot_uri: normalizeText(source.screenshotUri || source.screenshot_uri) || null,
    route_path: normalizeText(source.routePath || source.route_path) || null,
    viewport_width: Number(source.viewportWidth || source.viewport_width) || null,
    capture_phase: normalizeText(source.capturePhase || source.capture_phase || 'on_load').toLowerCase(),
    comparability_note: normalizeText(source.comparabilityNote || source.comparability_note) || null,
    design_anchor_path: normalizeText(source.designAnchorPath || source.design_anchor_path) || null,
    golden_path_browser_profile: normalizeText(source.goldenPathBrowserProfile || source.golden_path_browser_profile) || null,
  };
}

function validateVisualEvidence(evidence = {}, {
  contract = {},
  requireOnLoad = true,
  requireGoldenPathProfile = false,
} = {}) {
  const missing = [];
  if (!evidence.screenshot_path && !evidence.screenshot_uri) missing.push('screenshot');
  if (!evidence.route_path) missing.push('route_path');
  if (requireOnLoad && evidence.capture_phase !== 'on_load') missing.push('on_load_capture');
  if ((evidence.viewport_width || 0) < 1280) missing.push('viewport_width');
  if (!evidence.comparability_note) missing.push('comparability_note');

  if (requireGoldenPathProfile && evidence.golden_path_browser_profile !== 'playwright.golden-path') {
    missing.push('golden_path_browser_profile');
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}

function assertEngineerSubmissionProductDelivery({ contract = null, submission = {}, options = {} } = {}) {
  if (!contract || !contractAffectsUi(contract)) {
    return { allowed: true, verification: { required: false, verified: true } };
  }

  const verification = evaluateRunnableSurfaceVerification({
    contract,
    commitSha: submission.commit_sha || submission.commitSha,
    options,
  });

  if (verification.required && !verification.verified) {
    const error = new Error('Engineer submission commit is not merged to the runnable surface branch.');
    error.statusCode = 409;
    error.code = 'runnable_surface_not_merged';
    error.details = {
      commit_sha: submission.commit_sha || submission.commitSha || null,
      runnable_surface: verification.runnable_surface,
      verification,
    };
    throw error;
  }

  if (contractRequiresDesktopVisualValidation(contract) && !visualGateOverrideEnabled(options)) {
    const visualEvidence = normalizeVisualEvidence(submission.visual_evidence || submission.visualEvidence || {});
    const visualCheck = validateVisualEvidence(visualEvidence, {
      contract,
      requireOnLoad: true,
      requireGoldenPathProfile: false,
    });
    if (!visualCheck.valid) {
      const error = new Error('Desktop visual validation requires screenshot evidence on engineer submission.');
      error.statusCode = 409;
      error.code = 'missing_visual_evidence';
      error.details = {
        missing: visualCheck.missing,
        required_risk_flag: 'desktop_visual_validation',
      };
      throw error;
    }
  }

  return {
    allowed: true,
    verification,
    runnable_surface_verified: verification.verified === true,
    verified_branch: verification.verified_branch || null,
    verified_at: verification.verified_at || null,
  };
}

function assertProductReconciliationAllowsQaPass({
  history = [],
  outcome = '',
  options = {},
} = {}) {
  if (String(outcome).toLowerCase() !== 'pass') {
    return { allowed: true, skipped: 'non_pass_outcome' };
  }
  if (visualGateOverrideEnabled(options)) {
    return { allowed: true, override: true };
  }

  const reconciliation = findLatestProductReconciliation(history);
  if (reconciliation?.status === 'failed') {
    const error = new Error('QA pass is blocked until product delivery is reconciled after an operator-reported mismatch.');
    error.statusCode = 409;
    error.code = 'product_delivery_reconciliation_required';
    error.details = {
      mismatch_reason: reconciliation.mismatchReason || null,
      reconciliation_event_id: reconciliation.eventId || null,
      guidance: 'Run scripts/reconcile-product-delivery.js after merging to the runnable surface branch.',
    };
    throw error;
  }

  return { allowed: true, reconciliation: reconciliation || null };
}

function assertProductCloseoutDelivery({
  contract = null,
  history = [],
  options = {},
} = {}) {
  if (!contract || !contractAffectsUi(contract)) {
    return { allowed: true, required: false };
  }

  if (visualGateOverrideEnabled(options)) {
    return {
      allowed: true,
      required: true,
      override: true,
      product_delivery: deriveProductDeliveryProjection({ history, contract, options }),
    };
  }

  const productDelivery = deriveProductDeliveryProjection({ history, contract, options });
  if (productDelivery.status !== 'verified') {
    const error = new Error('Product closeout requires verified product_delivery for UI-affecting tasks.');
    error.statusCode = 409;
    error.code = 'product_delivery_not_verified';
    error.details = {
      product_delivery: productDelivery,
      guidance: productDelivery.visual_verified === false
        ? 'Attach golden-path on-load screenshot evidence and record a QA pass before closeout.'
        : 'Merge engineer submission onto the runnable surface branch, then rerun product verification.',
    };
    throw error;
  }

  return { allowed: true, required: true, product_delivery: productDelivery };
}

function buildProductDeliveryCloseoutChecklistItem({
  contract = null,
  history = [],
  options = {},
} = {}) {
  if (!contract || !contractAffectsUi(contract)) {
    return null;
  }

  const productDelivery = deriveProductDeliveryProjection({ history, contract, options });
  const reconciliation = findLatestProductReconciliation(history);
  let status = 'pending';
  let detail = 'Product delivery verification has not started.';

  if (reconciliation?.status === 'failed') {
    status = 'blocked';
    detail = `Product reconciliation failed (${reconciliation.mismatchReason || 'operator_reported_ui_mismatch'}). Reconcile before closeout.`;
  } else if (productDelivery.status === 'verified') {
    status = 'ready';
    detail = 'Runnable surface and visual verification are complete.';
  } else if (productDelivery.status === 'in_progress') {
    status = 'blocked';
    detail = productDelivery.visual_verified === false
      ? 'Platform QA passed but product visual verification is incomplete.'
      : 'Runnable surface verification is incomplete.';
  } else if (productDelivery.status === 'failed') {
    status = 'blocked';
    detail = 'Product delivery verification failed and must be reconciled.';
  }

  return {
    key: 'product-delivery',
    label: 'Product delivery verified',
    status,
    detail,
    product_delivery: productDelivery,
  };
}

function intakeTextSuggestsUiUx(text = '') {
  const normalized = String(text || '').toLowerCase();
  return /\b(ui|ux|user interface|user experience|command center|layout|design system|visual|screenshot|desktop ui|navigation|inspector|workspace|accessibility|wireframe|mockup)\b/.test(normalized);
}

function defaultOperatorVerificationPathForIntake() {
  return {
    url: `${DEFAULT_RUNNABLE_SURFACE.serve_url}/sign-in`,
    login: 'admin@golden-path.local / <seeded>',
    nav: 'Task workspace (not task detail, not inbox)',
    route: '/tasks?view=list',
    onLoad: 'Queue-first Command Center chrome is visible on first paint.',
    onSelect: 'Persistent inspector opens with selected task context.',
    outOfScopeRoutes: ['/tasks/:id', '/inbox/*', '/overview/*'],
  };
}

function assertQaResultProductDelivery({
  contract = null,
  body = {},
  outcome = '',
  options = {},
  history = [],
} = {}) {
  if (!contract || !contractAffectsUi(contract)) {
    return { allowed: true };
  }

  if (String(outcome).toLowerCase() !== 'pass') {
    return { allowed: true, skipped: 'non_pass_outcome' };
  }

  assertProductReconciliationAllowsQaPass({ history, outcome, options });

  const visualEvidence = normalizeVisualEvidence(body.visualEvidence || body.visual_evidence || {});
  const requiresVisual = contractRequiresDesktopVisualValidation(contract);

  if (requiresVisual && !visualGateOverrideEnabled(options)) {
    const visualCheck = validateVisualEvidence(visualEvidence, {
      contract,
      requireOnLoad: true,
      requireGoldenPathProfile: true,
    });
    if (!visualCheck.valid) {
      const error = new Error('QA pass requires on-load visual evidence for desktop_visual_validation tasks.');
      error.statusCode = 409;
      error.code = 'missing_visual_qa_evidence';
      error.details = {
        missing: visualCheck.missing,
        required_risk_flag: 'desktop_visual_validation',
      };
      throw error;
    }
  }

  if (contractRequiresHumanWorkflowGate(contract) && !visualGateOverrideEnabled(options)) {
    const humanSignoff = body.humanVisualSignoffRecorded === true
      || body.human_visual_signoff_recorded === true
      || body.uxReviewerApproved === true
      || body.ux_reviewer_approved === true;
    if (!humanSignoff && !visualEvidence.screenshot_path && !visualEvidence.screenshot_uri) {
      const error = new Error('QA pass requires human visual sign-off or screenshot reference for human_workflow tasks.');
      error.statusCode = 409;
      error.code = 'missing_human_visual_signoff';
      error.details = {
        required_risk_flag: 'human_workflow',
      };
      throw error;
    }
  }

  return {
    allowed: true,
    visual_evidence: visualEvidence,
  };
}

function findLatestEngineerSubmission(history = []) {
  const submissions = (Array.isArray(history) ? history : [])
    .filter((entry) => entry?.event_type === 'task.engineer_submission_recorded');
  if (!submissions.length) return null;
  return submissions.reduce((latest, entry) => {
    const version = Number(entry?.payload?.version || 0);
    const latestVersion = Number(latest?.payload?.version || 0);
    if (version > latestVersion) return entry;
    if (version < latestVersion) return latest;
    const entrySeq = Number(entry?.sequence_number || 0);
    const latestSeq = Number(latest?.sequence_number || 0);
    return entrySeq >= latestSeq ? entry : latest;
  });
}

function resolveSubmissionCommitSha({ history = [], state = {}, submission = null } = {}) {
  const resolvedSubmission = submission || findLatestEngineerSubmission(history);
  return normalizeText(
    resolvedSubmission?.payload?.commit_sha
    || resolvedSubmission?.payload?.commitSha
    || state?.implementation_commit_sha
    || state?.implementationCommitSha
    || null,
  ) || null;
}

function findLatestProductReconciliation(history = []) {
  const event = history.find((entry) => entry?.event_type === 'task.product_delivery_reconciled') || null;
  if (!event) return null;
  const payload = event.payload || {};
  return {
    eventId: event.event_id || null,
    recordedAt: event.occurred_at || null,
    actorId: event.actor_id || null,
    status: payload.status || 'recorded',
    mismatchReason: payload.mismatch_reason || payload.mismatchReason || null,
    commitSha: payload.commit_sha || payload.commitSha || null,
    runnableSurfaceVerified: payload.runnable_surface_verified === true,
  };
}

function derivePlatformDeliveryProjection({ state = {}, history = [], contract = null } = {}) {
  const latestQa = history.find((entry) => entry?.event_type === 'task.qa_result_recorded') || null;
  const qaVisual = normalizeVisualEvidence(
    latestQa?.payload?.visual_evidence || latestQa?.payload?.visualEvidence || {},
  );
  const visualEvidence = (qaVisual.screenshot_path || qaVisual.screenshot_uri) ? qaVisual : null;
  return {
    stage: state.current_stage || null,
    forge_execution_state: state.forge_execution_state || state.forgeExecutionState || null,
    gates: {
      ux: contract?.reviewers?.ux?.approved === true ? 'approved' : 'pending',
      qa: latestQa?.payload?.outcome === 'pass' ? 'approved' : (latestQa ? 'failed' : 'pending'),
    },
    visual_evidence: visualEvidence,
  };
}

function deriveProductDeliveryProjection({
  state = {},
  history = [],
  contract = null,
  options = {},
} = {}) {
  if (!contract || !contractAffectsUi(contract)) {
    return {
      status: 'not_required',
      runnable_surface_verified: null,
      visual_verified: null,
      design_scope_mode: null,
      last_verified_commit: null,
    };
  }

  const submission = findLatestEngineerSubmission(history);
  const submissionPayload = submission?.payload || {};
  const commitSha = resolveSubmissionCommitSha({ history, state, submission });
  const verification = commitSha
    ? evaluateRunnableSurfaceVerification({ contract, commitSha, options })
    : { verified: false };

  const qaPass = history.find((entry) => (
    entry?.event_type === 'task.qa_result_recorded'
    && String(entry.payload?.outcome || '').toLowerCase() === 'pass'
  )) || null;
  const qaVisual = normalizeVisualEvidence(qaPass?.payload?.visual_evidence || qaPass?.payload?.visualEvidence || {});
  const visualCheck = qaPass
    ? validateVisualEvidence(qaVisual, { contract, requireOnLoad: true })
    : { valid: false };

  const reconciliation = findLatestProductReconciliation(history);
  const designScope = contract.design_scope || contract.designScope || {};

  let status = 'not_started';
  if (reconciliation && reconciliation.status === 'failed') {
    status = 'failed';
  } else if (verification.verified && visualCheck.valid) {
    status = 'verified';
  } else if (submission || qaPass) {
    status = 'in_progress';
  }

  return {
    status,
    runnable_surface_verified: verification.verified === true,
    visual_verified: visualCheck.valid === true,
    design_scope_mode: designScope.mode || null,
    last_verified_commit: verification.verified ? commitSha : null,
    operator_verification_path: contract.operator_verification_path || contract.operatorVerificationPath || null,
    reconciliation: reconciliation || null,
  };
}

function deriveDeliveryLayersProjection(context = {}) {
  const contract = context.contract
    || context.executionContract?.latest
    || null;
  return {
    platform_delivery: derivePlatformDeliveryProjection(context),
    product_delivery: deriveProductDeliveryProjection({ ...context, contract }),
  };
}

function buildProductReconciliationReport({
  taskId,
  contract = null,
  history = [],
  state = {},
  options = {},
} = {}) {
  const submission = findLatestEngineerSubmission(history);
  const commitSha = resolveSubmissionCommitSha({ history, state, submission });
  const closed = state?.closed === true || String(state?.current_stage || '').toUpperCase() === 'DONE';
  const verification = commitSha
    ? evaluateRunnableSurfaceVerification({ contract, commitSha, options })
    : { verified: false, reason: 'missing_engineer_submission' };

  const productDelivery = deriveProductDeliveryProjection({ state, history, contract, options });
  if (closed && productDelivery.status === 'verified') {
    return {
      task_id: taskId,
      generated_at: new Date().toISOString(),
      policy_version: PRODUCT_DELIVERY_INTEGRITY_POLICY_VERSION,
      commit_sha: commitSha || productDelivery.last_verified_commit || null,
      runnable_surface: contract?.runnable_surface || contract?.runnableSurface || null,
      verification: productDelivery.runnable_surface_verified
        ? { verified: true, reason: 'closed_task_projection' }
        : verification,
      product_delivery: productDelivery,
      guidance: 'Task is closed with verified product delivery projection. Reconciliation report is informational.',
    };
  }

  return {
    task_id: taskId,
    generated_at: new Date().toISOString(),
    policy_version: PRODUCT_DELIVERY_INTEGRITY_POLICY_VERSION,
    commit_sha: commitSha,
    runnable_surface: contract?.runnable_surface || contract?.runnableSurface || null,
    verification,
    product_delivery: productDelivery,
    guidance: verification.verified
      ? 'Runnable surface matches submission commit. Continue visual verification if product_delivery.visual_verified is false.'
      : 'Merge or cherry-pick submission commit onto runnable surface branch, then rerun golden-path browser verification.',
  };
}

module.exports = {
  PRODUCT_DELIVERY_INTEGRITY_POLICY_VERSION,
  DESIGN_SCOPE_MODES,
  DEFAULT_RUNNABLE_SURFACE,
  contractAffectsUi,
  intakeTextSuggestsUiUx,
  defaultOperatorVerificationPathForIntake,
  normalizeDesignScope,
  normalizeRunnableSurface,
  normalizeOperatorVerificationPath,
  normalizeProductDeliveryContractFields,
  buildUiAcceptanceCriteriaSection,
  augmentExecutionContractApprovalReadiness,
  evaluateRunnableSurfaceVerification,
  assertEngineerSubmissionProductDelivery,
  assertProductReconciliationAllowsQaPass,
  assertProductCloseoutDelivery,
  buildProductDeliveryCloseoutChecklistItem,
  assertQaResultProductDelivery,
  derivePlatformDeliveryProjection,
  deriveProductDeliveryProjection,
  deriveDeliveryLayersProjection,
  buildProductReconciliationReport,
  findLatestEngineerSubmission,
  resolveSubmissionCommitSha,
  normalizeVisualEvidence,
  validateVisualEvidence,
  visualGateOverrideEnabled,
};