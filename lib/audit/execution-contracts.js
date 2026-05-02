const crypto = require('crypto');
const { normalizeContextProvenance } = require('./control-plane');

const EXECUTION_CONTRACT_TEMPLATE_SOURCE = 'docs/templates/USER_STORY_TEMPLATE.md';
const EXECUTION_CONTRACT_OWNER = 'pm';
const EXECUTION_CONTRACT_WAITING_STATE = 'execution_contract_refinement';
const EXECUTION_CONTRACT_NEXT_ACTION = 'Complete Execution Contract required sections before operator review.';
const EXECUTION_CONTRACT_REVIEW_ACTION = 'Execution Contract is ready for operator review.';
const EXECUTION_CONTRACT_APPROVED_ACTION = 'Approved Execution Contract is ready for future implementation dispatch.';
const REVIEWER_ROUTING_POLICY_VERSION = 'execution-contract-reviewer-routing.v1';
const APPROVAL_GATES_POLICY_VERSION = 'execution-contract-approval-gates.v1';
const ARTIFACT_BUNDLE_POLICY_VERSION = 'execution-contract-artifact-bundle.v1';
const ARTIFACT_BUNDLE_APPROVAL_POLICY_VERSION = 'execution-contract-artifact-bundle-approval.v1';
const ARTIFACT_BUNDLE_REVIEW_ACTION = 'Generated artifact bundle requires PM and section-owner approval before commit.';
const ARTIFACT_BUNDLE_APPROVED_ACTION = 'Generated artifact bundle is approved for commit.';
const VERIFICATION_REPORT_SKELETON_POLICY_VERSION = 'execution-contract-verification-report-skeleton.v1';
const VERIFICATION_REPORT_GENERATED_ACTION = 'Verification report skeleton exists and implementation preparation may proceed when other gates pass.';
const DISPATCH_POLICY_VERSION = 'execution-contract-dispatch-policy.v1';
const AUTO_APPROVAL_POLICY_VERSION = 'execution-contract-low-risk-simple-auto-approval.v1';
const CONTRACT_COVERAGE_AUDIT_POLICY_VERSION = 'execution-contract-coverage-audit.v1';
const CONTRACT_COVERAGE_AUDIT_ACTION = 'Contract Coverage Audit matrix submitted; QA validation is required before QA Verification.';
const CONTRACT_COVERAGE_AUDIT_CLOSED_ACTION = 'Contract Coverage Audit closed; QA Verification may begin.';

const TEMPLATE_TIERS = Object.freeze(['Simple', 'Standard', 'Complex', 'Epic']);
const STANDARD_OR_ABOVE_TIERS = Object.freeze(['Standard', 'Complex', 'Epic']);
const ENGINEER_TIERS = Object.freeze(['Jr', 'Sr', 'Principal']);
const ENGINEER_TIER_TO_ASSIGNEE = Object.freeze({
  Jr: 'engineer-jr',
  Sr: 'engineer-sr',
  Principal: 'engineer-principal',
});
const ASSIGNEE_TO_ENGINEER_TIER = Object.freeze(Object.fromEntries(
  Object.entries(ENGINEER_TIER_TO_ASSIGNEE).map(([tier, assignee]) => [assignee, tier]),
));
const JR_ELIGIBLE_WORK_CATEGORIES = new Set(['tests', 'fixtures', 'docs', 'clear_refactor']);
const PRINCIPAL_TRIGGER_RISK_FLAGS = new Set(['high_risk_engineering', 'security', 'auth']);
const AUTO_APPROVAL_SENSITIVE_PATTERNS = Object.freeze([
  ['production_auth', /\b(prod|production)\s+(auth|authentication|authorization|identity|session)\b/i],
  ['authentication', /\b(prod|production)\s+(auth|authentication|authorization|oidc|session|magic[-\s]?link)\b|\b(auth|authentication|authorization|oidc|session|magic[-\s]?link)\s+(path|callback|config|configuration|flow|boundary|change|changes)\b/i],
  ['security', /\b(prod|production)\s+(security|permission|permissions|compliance|secret|secrets|credential|credentials)\b|\b(security|permission|permissions|compliance|secret|secrets|credential|credentials)\s+(path|boundary|config|configuration|change|changes|rule|rules|policy|policies)\b/i],
  ['data_model', /\b(data[-\s]?model|schema|migration|database|persistence|pii)\b/i],
]);
const AUTO_APPROVAL_NEGATION_PATTERN = /\b(no|none|without|not|n\/a)\b/i;

const SECTION_CATALOG = Object.freeze([
  ['1', 'User Story'],
  ['2', 'Acceptance Criteria'],
  ['2a', 'Standards Alignment'],
  ['3', 'Workflow & User Journey'],
  ['4', 'Automated Test Deliverables'],
  ['5', 'Data Model & Schema'],
  ['6', 'Architecture & Integration'],
  ['7', 'API Design'],
  ['8', 'Security & Compliance'],
  ['8a', 'Standardized Error Logging'],
  ['8b', 'AI Implementation Guide'],
  ['9', 'Performance & Scalability'],
  ['10', 'UI/UX Requirements'],
  ['11', 'Deployment & Release Strategy'],
  ['12', 'Monitoring & Observability'],
  ['13', 'Cost & Resource Impact'],
  ['14', 'Dependencies & Risks'],
  ['15', 'Definition of Done'],
  ['16', 'Production Validation Strategy'],
  ['17', 'Compliance & Handoff'],
]);

const SECTION_TITLES = Object.freeze(Object.fromEntries(SECTION_CATALOG));
const SECTION_ORDER = Object.freeze(SECTION_CATALOG.map(([id]) => id));

const REQUIRED_SECTIONS_BY_TIER = Object.freeze({
  Simple: Object.freeze(['1', '2', '4', '11', '12', '15', '16', '17']),
  Standard: Object.freeze(['1', '2', '3', '4', '6', '7', '10', '11', '12', '15', '16', '17']),
  Complex: Object.freeze(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '14', '15', '16', '17']),
  Epic: Object.freeze(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17']),
});

const PLACEHOLDER_SECTION_BODIES = new Set(['tbd', 'todo', 'pending', 'n/a']);
const REVIEWER_ROLE_ORDER = Object.freeze(['pm', 'architect', 'ux', 'qa', 'sre', 'principalEngineer']);
const REVIEWER_ROLE_LABELS = Object.freeze({
  pm: 'Product Manager',
  architect: 'Architect',
  ux: 'UX Designer',
  qa: 'QA',
  sre: 'SRE',
  principalEngineer: 'Principal Engineer',
});
const ARTIFACT_ROLE_ORDER = Object.freeze([...REVIEWER_ROLE_ORDER, 'operator']);
const ARTIFACT_ROLE_LABELS = Object.freeze({
  ...REVIEWER_ROLE_LABELS,
  operator: 'Operator',
});
const APPROVED_REVIEW_STATUSES = new Set(['approved', 'accepted', 'complete', 'completed', 'signed_off', 'signed-off']);
const CONTRACT_COVERAGE_COVERED_STATUSES = new Set(['covered', 'complete', 'verified', 'passed']);
const CONTRACT_COVERAGE_INCOMPLETE_STATUSES = new Set(['partial', 'incomplete', 'uncovered', 'missing', 'failed', 'rejected', 'implementation_incomplete']);
const CONTRACT_COVERAGE_EXCEPTION_STATUSES = new Set(['excepted', 'exception', 'scope_exception']);
const CONTRACT_COVERAGE_NOT_APPLICABLE_STATUSES = new Set(['not_applicable', 'not-applicable', 'n_a', 'na']);
const MANUAL_EVIDENCE_PATTERN = /\b(manual|human[-\s]?only|operator[-\s]?only)\b/i;
const ROLE_ALIASES = Object.freeze({
  productmanager: 'pm',
  product_manager: 'pm',
  pm: 'pm',
  architect: 'architect',
  architecture: 'architect',
  ux: 'ux',
  uxdesigner: 'ux',
  ux_designer: 'ux',
  designer: 'ux',
  qa: 'qa',
  qualityassurance: 'qa',
  quality_assurance: 'qa',
  sre: 'sre',
  site_reliability: 'sre',
  site_reliability_engineer: 'sre',
  principal: 'principalEngineer',
  principalengineer: 'principalEngineer',
  principal_engineer: 'principalEngineer',
  principalEngineer: 'principalEngineer',
});

const RISK_FLAG_DEFINITIONS = Object.freeze({
  deployment: Object.freeze(['deployment', 'deploy', 'release', 'rollout', 'rollback']),
  observability: Object.freeze(['observability', 'monitoring', 'metrics', 'logs', 'traces', 'telemetry', 'alerting', 'alerts']),
  reliability: Object.freeze(['reliability', 'resilience', 'availability', 'slo', 'sla', 'latency', 'error_budget']),
  auth: Object.freeze(['auth', 'authentication', 'authorization', 'identity', 'oidc', 'session', 'magic_link', 'magic-link', 'production_authentication']),
  data: Object.freeze(['data', 'database', 'schema', 'migration', 'data_model', 'data-model', 'persistence', 'pii']),
  production_behavior: Object.freeze(['production', 'prod', 'production_behavior', 'production-behavior', 'runtime_behavior', 'runtime-behavior']),
  technical: Object.freeze(['technical', 'architecture', 'architectural', 'integration', 'system_design', 'system-design']),
  api: Object.freeze(['api', 'endpoint', 'contract', 'openapi']),
  security: Object.freeze(['security', 'compliance', 'permissions', 'authorization_boundary', 'authorization-boundary']),
  feasibility: Object.freeze(['feasibility', 'unclear_feasibility', 'technical_ambiguity', 'ambiguous_feasibility']),
  human_workflow: Object.freeze(['human_workflow', 'human-workflow', 'workflow', 'role_workflow', 'role-workflow', 'operator_approval', 'operator-approval', 'task_detail', 'task-detail', 'task_list', 'task-list', 'board', 'user_facing', 'user-facing', 'ui', 'ux', 'accessibility']),
  high_risk_engineering: Object.freeze(['high_risk_engineering', 'high-risk-engineering', 'principal', 'principal_engineer', 'critical_path', 'critical-path', 'cross_cutting_architecture', 'cross-cutting-architecture', 'irreversible', 'hard_to_rollback', 'hard-to-rollback', 'ambiguous_system_boundaries', 'ambiguous-system-boundaries', 'performance', 'data_model_migration', 'data-model-migration', 'repeated_failed_attempts', 'repeated-failed-attempts', 'architect_sr_disagreement', 'architect-sr-disagreement', 'feasibility_disagreement']),
});

const RISK_FLAG_ALIAS_TO_ID = Object.freeze(Object.fromEntries(Object.entries(RISK_FLAG_DEFINITIONS).flatMap(([id, aliases]) => (
  aliases.map((alias) => [alias.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase(), id])
))));

function normalizeTemplateTier(value, fallback = null) {
  const normalized = String(value || '').trim().toLowerCase();
  return TEMPLATE_TIERS.find((tier) => tier.toLowerCase() === normalized) || fallback;
}

function normalizeEngineerTier(value, fallback = null) {
  const normalized = String(value || '').trim().toLowerCase();
  return ENGINEER_TIERS.find((tier) => tier.toLowerCase() === normalized) || fallback;
}

function engineerTierFromAssigneeId(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'engineer-principal' || normalized === 'principal-engineer') return 'Principal';
  if (normalized === 'engineer-sr' || normalized === 'sr-engineer' || normalized === 'senior-engineer') return 'Sr';
  if (normalized === 'engineer-jr' || normalized === 'jr-engineer' || normalized === 'junior-engineer') return 'Jr';
  return ASSIGNEE_TO_ENGINEER_TIER[String(value || '').trim()] || null;
}

function engineerAssigneeForTier(value) {
  const tier = normalizeEngineerTier(value, null);
  return tier ? ENGINEER_TIER_TO_ASSIGNEE[tier] : null;
}

function sectionTitle(sectionId) {
  return SECTION_TITLES[sectionId] || `Section ${sectionId}`;
}

function orderedSectionIds(sectionIds = []) {
  const unique = [...new Set(sectionIds.filter(Boolean).map(String))];
  return unique.sort((a, b) => {
    const aIndex = SECTION_ORDER.indexOf(a);
    const bIndex = SECTION_ORDER.indexOf(b);
    if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });
}

function normalizeSectionBody(value) {
  return String(value || '').trim();
}

function normalizeStructuredList(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (entry && typeof entry === 'object') return entry;
      return String(entry || '').trim();
    }).filter((entry) => (typeof entry === 'string' ? Boolean(entry) : Boolean(entry)));
  }
  return String(value || '')
    .split(/\n+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeRole(value, fallback = EXECUTION_CONTRACT_OWNER) {
  const normalized = normalizeSectionBody(value).toLowerCase();
  return normalized || fallback;
}

function normalizeSectionStatus(value, fallback = 'draft') {
  const normalized = normalizeSectionBody(value).toLowerCase();
  return normalized || fallback;
}

function normalizeApprovalStatus(value, approvals = []) {
  const normalized = normalizeSectionBody(value).toLowerCase();
  if (normalized) return normalized;
  return approvals.length ? 'approved' : 'pending';
}

function normalizePayloadJson(sectionId, body, value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  return {
    section_id: sectionId,
    body,
  };
}

function normalizeSectionEntry(sectionId, value, requiredSections = []) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const body = normalizeSectionBody(value.body ?? value.content ?? value.value);
    const approvals = Array.isArray(value.approvals) ? value.approvals.map(String).filter(Boolean) : [];
    const contributor = normalizeSectionBody(value.contributor) || null;
    const approver = normalizeSectionBody(value.approver) || approvals[0] || null;
    const ownerRole = normalizeRole(value.ownerRole ?? value.owner_role ?? value.owner);
    const payloadJson = normalizePayloadJson(sectionId, body, value.payloadJson ?? value.payload_json ?? value.payload);
    return {
      id: sectionId,
      title: normalizeSectionBody(value.title) || sectionTitle(sectionId),
      body,
      owner: normalizeSectionBody(value.owner) || ownerRole,
      owner_role: ownerRole,
      section_status: normalizeSectionStatus(value.sectionStatus ?? value.section_status, body ? 'complete' : 'draft'),
      contributor,
      contributors: Array.isArray(value.contributors) ? value.contributors.map(String).filter(Boolean) : [],
      approver,
      approvals,
      approval_status: normalizeApprovalStatus(value.approvalStatus ?? value.approval_status, approvals),
      payload_schema_version: Number(value.payloadSchemaVersion ?? value.payload_schema_version ?? 1) || 1,
      payload_json: payloadJson,
      provenance_references: normalizeStructuredList(value.provenanceReferences ?? value.provenance_references),
      required: requiredSections.includes(sectionId),
    };
  }
  const body = normalizeSectionBody(value);
  return {
    id: sectionId,
    title: sectionTitle(sectionId),
    body,
    owner: EXECUTION_CONTRACT_OWNER,
    owner_role: EXECUTION_CONTRACT_OWNER,
    section_status: body ? 'complete' : 'draft',
    contributor: null,
    contributors: [],
    approver: null,
    approvals: [],
    approval_status: 'pending',
    payload_schema_version: 1,
    payload_json: normalizePayloadJson(sectionId, body, null),
    provenance_references: [],
    required: requiredSections.includes(sectionId),
  };
}

function normalizeSections(inputSections = {}, requiredSections = []) {
  const source = inputSections && typeof inputSections === 'object' && !Array.isArray(inputSections)
    ? inputSections
    : {};
  const allSectionIds = orderedSectionIds([...requiredSections, ...Object.keys(source)]);
  return Object.fromEntries(allSectionIds.map((sectionId) => [
    sectionId,
    normalizeSectionEntry(sectionId, source[sectionId], requiredSections),
  ]));
}

function normalizeSectionInput(body = {}) {
  return body.sections && typeof body.sections === 'object'
    ? body.sections
    : body.sectionBodies && typeof body.sectionBodies === 'object'
      ? body.sectionBodies
      : {};
}

function buildDraftSections({ taskId, title, rawRequirements, templateTier, sections = {} }) {
  const requiredSections = REQUIRED_SECTIONS_BY_TIER[templateTier] || REQUIRED_SECTIONS_BY_TIER.Standard;
  const generatedSections = {
    1: {
      title: sectionTitle('1'),
      body: [
        'As a Software Factory operator,',
        `I want ${title || taskId} refined from the Intake Draft,`,
        'so that implementation waits until the execution contract is complete and approved.',
        '',
        'Business Context & Success Metrics:',
        rawRequirements || 'Raw operator intake was not available.',
      ].join('\n'),
    },
  };
  return normalizeSections({ ...generatedSections, ...sections }, requiredSections);
}

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function canonicalReviewerRole(value) {
  const normalized = normalizeKey(value);
  return ROLE_ALIASES[normalized] || null;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value == null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['true', 'yes', 'y', '1', 'required'].includes(normalized)) return true;
  if (['false', 'no', 'n', '0', 'optional', 'not_required', 'not-required'].includes(normalized)) return false;
  return fallback;
}

function normalizeReviewerStatus(value, fallback) {
  const normalized = normalizeSectionBody(value).toLowerCase();
  return normalized || fallback;
}

function normalizeReviewerInputMap(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const normalized = {};
  for (const [key, entry] of Object.entries(source)) {
    const role = canonicalReviewerRole(key);
    if (!role) continue;
    normalized[role] = entry && typeof entry === 'object' && !Array.isArray(entry)
      ? entry
      : { status: String(entry || '').trim() };
  }
  return normalized;
}

function normalizeRiskFlagEntry(entry) {
  if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
    const enabled = entry.enabled ?? entry.required ?? entry.active ?? true;
    if (!normalizeBoolean(enabled, true)) return null;
    const rawId = entry.id ?? entry.key ?? entry.name ?? entry.flag ?? entry.type ?? entry.value;
    const id = RISK_FLAG_ALIAS_TO_ID[normalizeKey(rawId)] || normalizeKey(rawId);
    if (!id) return null;
    return {
      id,
      label: normalizeSectionBody(entry.label ?? entry.name ?? rawId) || id,
      source: normalizeSectionBody(entry.source) || 'input',
    };
  }
  const id = RISK_FLAG_ALIAS_TO_ID[normalizeKey(entry)] || normalizeKey(entry);
  if (!id) return null;
  return {
    id,
    label: normalizeSectionBody(entry) || id,
    source: 'input',
  };
}

function normalizeRiskFlags(value) {
  let entries = [];
  if (Array.isArray(value)) {
    entries = value;
  } else if (value && typeof value === 'object') {
    entries = Object.entries(value).flatMap(([key, entry]) => {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        return [{ id: key, ...entry }];
      }
      return normalizeBoolean(entry, false) ? [key] : [];
    });
  } else {
    entries = String(value || '')
      .split(/[,\n]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  const deduped = new Map();
  for (const entry of entries) {
    const normalized = normalizeRiskFlagEntry(entry);
    if (!normalized) continue;
    if (!deduped.has(normalized.id)) deduped.set(normalized.id, normalized);
  }
  return [...deduped.values()];
}

function roleReason(source, code, detail, flags = []) {
  return {
    source,
    code,
    detail,
    risk_flags: flags,
  };
}

function riskFlagSet(riskFlags = []) {
  return new Set(riskFlags.map((flag) => flag.id));
}

function matchingRiskFlags(ids, candidateIds) {
  return candidateIds.filter((id) => ids.has(id));
}

function deterministicReviewerReasons(templateTier, riskFlags = []) {
  const ids = riskFlagSet(riskFlags);
  const standardOrAbove = STANDARD_OR_ABOVE_TIERS.includes(templateTier);
  const hasAnyRisk = riskFlags.length > 0;
  const architectFlags = matchingRiskFlags(ids, ['technical', 'api', 'data', 'security', 'feasibility']);
  const uxFlags = matchingRiskFlags(ids, ['human_workflow']);
  const sreFlags = matchingRiskFlags(ids, ['deployment', 'observability', 'reliability', 'auth', 'data', 'production_behavior']);
  const principalFlags = matchingRiskFlags(ids, ['high_risk_engineering', 'security', 'auth']);

  const reasons = Object.fromEntries(REVIEWER_ROLE_ORDER.map((role) => [role, []]));
  reasons.pm.push(roleReason('tier', 'pm_refinement_owner', 'Product Manager owns Execution Contract refinement and operator presentation.'));
  if (standardOrAbove) {
    reasons.architect.push(roleReason('tier', 'architect_standard_plus', 'Architect review is required for Standard, Complex, and Epic Execution Contracts.'));
    reasons.ux.push(roleReason('tier', 'ux_standard_plus', 'Standard, Complex, and Epic contracts include human workflow or UI/UX review sections.'));
    reasons.qa.push(roleReason('tier', 'qa_standard_plus', 'QA approval is required for Standard, Complex, and Epic Execution Contracts.'));
  }
  if (!standardOrAbove && hasAnyRisk) {
    reasons.qa.push(roleReason('risk', 'qa_simple_with_risk', 'QA approval is required for Simple contracts when risk flags are present.', riskFlags.map((flag) => flag.id)));
  }
  if (architectFlags.length) {
    reasons.architect.push(roleReason('risk', 'architect_risk_flags', 'Architect review is required for technical, API, data, security, or feasibility risk.', architectFlags));
  }
  if (uxFlags.length) {
    reasons.ux.push(roleReason('risk', 'ux_human_workflow_risk', 'UX review is required when human workflow, role queues, approval, accessibility, or user-facing behavior is affected.', uxFlags));
  }
  if (sreFlags.length) {
    reasons.sre.push(roleReason('risk', 'sre_operational_risk', 'SRE pre-implementation review is required when deployment, observability, reliability, authentication, data, or production behavior is affected.', sreFlags));
  }
  if (principalFlags.length) {
    reasons.principalEngineer.push(roleReason('risk', 'principal_high_risk_engineering', 'Principal Engineer review is required for high-risk engineering triggers.', principalFlags));
  }
  return reasons;
}

function reviewerDowngradeRationale(body = {}, reviewerInput = {}, role) {
  const source = body.reviewerDowngradeRationales
    || body.reviewer_downgrade_rationales
    || body.downgradeRationales
    || body.downgrade_rationales
    || {};
  const mapped = source && typeof source === 'object' && !Array.isArray(source)
    ? normalizeReviewerInputMap(source)
    : {};
  return normalizeSectionBody(
    reviewerInput[role]?.operatorVisibleDowngradeRationale
    ?? reviewerInput[role]?.operator_visible_downgrade_rationale
    ?? reviewerInput[role]?.downgradeRationale
    ?? reviewerInput[role]?.downgrade_rationale
    ?? mapped[role]?.rationale
    ?? mapped[role]?.body
    ?? mapped[role]?.summary
    ?? mapped[role]?.value
    ?? mapped[role]
    ?? body.operatorVisibleDowngradeRationale
    ?? body.operator_visible_downgrade_rationale
    ?? body.downgradeRationale
    ?? body.downgrade_rationale,
  );
}

function reviewerStatusFromInput(entry = {}, role, required) {
  if (entry.approved === true) return 'approved';
  if (entry.approvalStatus || entry.approval_status) return normalizeReviewerStatus(entry.approvalStatus ?? entry.approval_status, required ? 'pending' : 'not_required');
  if (entry.status) return normalizeReviewerStatus(entry.status, required ? 'pending' : 'not_required');
  if (role === 'pm') return 'owner';
  return required ? 'pending' : 'not_required';
}

function reviewerIsApproved(role, reviewer = {}) {
  const status = normalizeReviewerStatus(reviewer.status, '');
  if (role === 'pm' && status === 'owner') return true;
  return APPROVED_REVIEW_STATUSES.has(status);
}

function normalizeReviewerRouting(body = {}, templateTier, riskFlags = normalizeRiskFlags(body.riskFlags ?? body.risk_flags ?? body.risks ?? body.risk)) {
  const reviewerInput = normalizeReviewerInputMap(body.reviewers);
  const modelJudgment = body.modelJudgment || body.model_judgment || {};
  const modelReviewerInput = normalizeReviewerInputMap(modelJudgment.reviewers || body.modelReviewers || body.model_reviewers || body.reviewers);
  const deterministicReasons = deterministicReviewerReasons(templateTier, riskFlags);
  const reviewers = {};
  const downgradeRationales = [];

  for (const role of REVIEWER_ROLE_ORDER) {
    const input = reviewerInput[role] || {};
    const modelInput = modelReviewerInput[role] || {};
    const ruleReasons = deterministicReasons[role] || [];
    const ruleRequired = ruleReasons.length > 0;
    const modelRequired = normalizeBoolean(modelInput.required ?? input.required, false);
    const downgradeRationale = reviewerDowngradeRationale(body, reviewerInput, role);
    const downgraded = !ruleRequired && modelRequired && Boolean(downgradeRationale);
    const required = ruleRequired || (modelRequired && !downgraded);
    const reasons = [...ruleReasons];

    if (modelRequired) {
      reasons.push(roleReason('model_judgment', 'model_requires_reviewer', 'Model judgment selected this reviewer as required.'));
    }
    if (ruleRequired && normalizeBoolean(input.required, true) === false) {
      reasons.push(roleReason('deterministic_override', 'stricter_rules_win', 'Deterministic reviewer rules are stricter than the supplied judgment, so the role remains required.'));
    }
    if (!ruleRequired && modelRequired && !downgraded) {
      reasons.push(roleReason('model_judgment', 'stricter_model_wins', 'Model judgment is stricter than deterministic rules, so the role remains required.'));
    }
    if (downgraded) {
      const downgrade = {
        role,
        label: REVIEWER_ROLE_LABELS[role],
        rationale: downgradeRationale,
        visibility: 'operator',
      };
      downgradeRationales.push(downgrade);
      reasons.push(roleReason('pm_downgrade_rationale', 'operator_visible_downgrade', 'PM recorded an operator-visible downgrade rationale, so stricter model judgment is not applied.'));
    }

    const status = reviewerStatusFromInput(input, role, required);
    reviewers[role] = {
      role,
      label: REVIEWER_ROLE_LABELS[role],
      required,
      approvalRequired: required && role !== 'pm',
      status,
      approved: reviewerIsApproved(role, { status }),
      actorId: input.actorId || input.actor_id || input.approvedBy || input.approved_by || null,
      ruleRequired,
      modelRequired,
      downgraded,
      downgradeRationale: downgraded ? downgradeRationale : null,
      reasons,
    };
  }

  return {
    policy_version: REVIEWER_ROUTING_POLICY_VERSION,
    template_tier: templateTier,
    risk_flags: riskFlags,
    resolution_order: ['deterministic_rules', 'model_judgment', 'pm_downgrade_rationale'],
    required_reviewers: REVIEWER_ROLE_ORDER.filter((role) => reviewers[role].required),
    required_role_approvals: REVIEWER_ROLE_ORDER.filter((role) => reviewers[role].approvalRequired),
    downgrade_rationales: downgradeRationales,
    reviewers,
  };
}

function normalizeFeedbackState(value, fallback = 'open') {
  const normalized = normalizeSectionBody(value).toLowerCase();
  if (['resolved', 'closed', 'done'].includes(normalized)) return 'resolved';
  if (['answered'].includes(normalized)) return 'answered';
  if (['open', 'pending', 'unresolved'].includes(normalized)) return 'open';
  return fallback;
}

function normalizeFeedbackItem(entry, fallback = {}) {
  if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
    const body = normalizeSectionBody(entry.body ?? entry.prompt ?? entry.summary ?? entry.text ?? entry.value);
    if (!body) return null;
    return {
      id: normalizeSectionBody(entry.id) || fallback.id || `feedback-${crypto.randomUUID().slice(0, 8)}`,
      type: normalizeSectionBody(entry.type) || fallback.type || 'comment',
      body,
      blocking: entry.blocking == null ? Boolean(fallback.blocking) : normalizeBoolean(entry.blocking, Boolean(fallback.blocking)),
      state: normalizeFeedbackState(entry.state ?? entry.status, fallback.state || 'open'),
      source: normalizeSectionBody(entry.source) || fallback.source || 'contract_feedback',
      role: normalizeSectionBody(entry.role) || fallback.role || null,
    };
  }
  const body = normalizeSectionBody(entry);
  if (!body) return null;
  return {
    id: fallback.id || `feedback-${crypto.randomUUID().slice(0, 8)}`,
    type: fallback.type || 'comment',
    body,
    blocking: Boolean(fallback.blocking),
    state: fallback.state || 'open',
    source: fallback.source || 'contract_feedback',
    role: fallback.role || null,
  };
}

function normalizeFeedbackList(value, fallback = {}) {
  return normalizeStructuredList(value)
    .map((entry, index) => normalizeFeedbackItem(entry, { id: `${fallback.prefix || 'feedback'}-${index + 1}`, ...fallback }))
    .filter(Boolean);
}

function normalizeReviewFeedback(body = {}) {
  const source = body.reviewFeedback || body.review_feedback || body.feedback || {};
  const questions = normalizeFeedbackList(
    body.questions ?? body.blockingQuestions ?? body.blocking_questions ?? source.questions ?? source.blockingQuestions ?? source.blocking_questions,
    { prefix: 'question', type: 'question', blocking: true },
  );
  const comments = normalizeFeedbackList(
    body.comments ?? body.nonBlockingComments ?? body.non_blocking_comments ?? source.comments ?? source.nonBlockingComments ?? source.non_blocking_comments,
    { prefix: 'comment', type: 'comment', blocking: false },
  );
  return {
    policy_version: 'execution-contract-review-feedback.v1',
    questions,
    comments,
  };
}

function feedbackFromContract(contract = {}) {
  const feedback = contract.review_feedback || {};
  return [
    ...normalizeFeedbackList(feedback.questions || [], { prefix: 'question', type: 'question', blocking: true }),
    ...normalizeFeedbackList(feedback.comments || [], { prefix: 'comment', type: 'comment', blocking: false }),
  ];
}

function feedbackFromWorkflowThreads(workflowThreads = []) {
  return workflowThreads.map((thread) => normalizeFeedbackItem({
    id: thread.id,
    type: thread.commentType || 'comment',
    body: thread.title || thread.body || 'Workflow thread',
    blocking: thread.blocking,
    state: thread.state,
    source: 'workflow_thread',
  }, { source: 'workflow_thread' })).filter(Boolean);
}

function feedbackFromReviewQuestions(reviewQuestions = []) {
  return reviewQuestions.map((question) => normalizeFeedbackItem({
    id: question.id,
    type: 'question',
    body: question.prompt || question.answer || 'Review question',
    blocking: question.blocking,
    state: question.state,
    source: 'review_question',
  }, { source: 'review_question', type: 'question' })).filter(Boolean);
}

function evaluateExecutionContractApprovalReadiness(contract = {}, context = {}) {
  const reviewers = contract.reviewer_routing?.reviewers || contract.reviewers || {};
  const requiredReviewers = REVIEWER_ROLE_ORDER
    .map((role) => reviewers[role])
    .filter((reviewer) => reviewer?.required);
  const requiredRoleApprovals = requiredReviewers.filter((reviewer) => reviewer.approvalRequired || reviewer.role !== 'pm');
  const missingRequiredApprovals = requiredRoleApprovals
    .filter((reviewer) => !reviewerIsApproved(reviewer.role, reviewer))
    .map((reviewer) => ({
      role: reviewer.role,
      label: reviewer.label || REVIEWER_ROLE_LABELS[reviewer.role] || reviewer.role,
      status: reviewer.status || 'pending',
      reasons: reviewer.reasons || [],
    }));
  const feedback = [
    ...feedbackFromContract(contract),
    ...feedbackFromWorkflowThreads(context.workflowThreads || []),
    ...feedbackFromReviewQuestions(context.reviewQuestions || []),
  ];
  const unresolvedBlockingQuestions = feedback
    .filter((item) => item.blocking && item.state !== 'resolved')
    .map((item) => ({
      id: item.id,
      type: item.type,
      body: item.body,
      source: item.source,
      state: item.state,
    }));
  const nonBlockingComments = feedback
    .filter((item) => !item.blocking && item.state !== 'resolved')
    .map((item) => ({
      id: item.id,
      type: item.type,
      body: item.body,
      source: item.source,
      state: item.state,
    }));
  const blocked = missingRequiredApprovals.length > 0 || unresolvedBlockingQuestions.length > 0;
  return {
    policy_version: APPROVAL_GATES_POLICY_VERSION,
    status: blocked ? 'blocked' : 'ready',
    canApprove: !blocked,
    requiredReviewers: requiredReviewers.map((reviewer) => reviewer.role),
    requiredRoleApprovals: requiredRoleApprovals.map((reviewer) => reviewer.role),
    missingRequiredApprovals,
    unresolvedBlockingQuestions,
    nonBlockingComments,
    downgradeRationales: contract.reviewer_routing?.downgrade_rationales || [],
  };
}

function autoApprovalSectionBody(contract = {}, sectionId) {
  return normalizeSectionBody(contract.sections?.[sectionId]?.body);
}

function autoApprovalLineItems(body = '') {
  return normalizeSectionBody(body)
    .split(/\n+/)
    .map((line) => line.replace(/^[-*]\s+/, '').replace(/^\d+[.)]\s+/, '').trim())
    .filter(Boolean);
}

function autoApprovalAcceptanceCriteria(contract = {}) {
  const body = autoApprovalSectionBody(contract, '2');
  const items = autoApprovalLineItems(body);
  return {
    complete: sectionBodyIsComplete(body) && items.length > 0,
    count: items.length,
    items,
  };
}

function normalizeAutoApprovalSignals(value = {}, contract = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const explicitRollbackPath = normalizeSectionBody(source.rollbackPath ?? source.rollback_path ?? source.clearRollbackPath ?? source.clear_rollback_path);
  const rollbackPath = explicitRollbackPath || autoApprovalSectionBody(contract, '11');
  const unresolvedDependencies = normalizeStructuredList(source.unresolvedDependencies ?? source.unresolved_dependencies);
  const dependencySection = autoApprovalSectionBody(contract, '14');
  const dependencySectionSignals = dependencySection && !AUTO_APPROVAL_NEGATION_PATTERN.test(dependencySection)
    && /\b(unresolved|blocked|blocking|waiting|depends on|dependency)\b/i.test(dependencySection)
    ? [dependencySection]
    : [];
  const explicitSensitivePaths = normalizeStructuredList(
    source.productionSensitivePaths
      ?? source.production_sensitive_paths
      ?? source.productionAuthSecurityDataModelPaths
      ?? source.production_auth_security_data_model_paths,
  );
  return {
    rollback_path: rollbackPath || null,
    unresolved_dependencies: [...new Set([...unresolvedDependencies, ...dependencySectionSignals])],
    production_sensitive_paths: explicitSensitivePaths,
  };
}

function rollbackPathIsClear(value) {
  const text = normalizeSectionBody(value);
  return Boolean(text && /\b(rollback|roll back|revert|disable|kill switch|feature flag|restore)\b/i.test(text));
}

function inferSensitiveAutoApprovalPaths(contract = {}, signals = {}) {
  const explicit = signals.production_sensitive_paths || [];
  const sections = Object.entries(contract.sections || {})
    .map(([sectionId, section]) => ({ sectionId, body: normalizeSectionBody(section?.body) }))
    .filter((entry) => entry.body);
  const inferred = [];
  for (const { sectionId, body } of sections) {
    for (const sentence of body.split(/[.!?\n]+/).map((item) => item.trim()).filter(Boolean)) {
      if (AUTO_APPROVAL_NEGATION_PATTERN.test(sentence) && /\b(auth|security|data[-\s]?model|schema|database|migration|pii)\b/i.test(sentence)) {
        continue;
      }
      for (const [code, pattern] of AUTO_APPROVAL_SENSITIVE_PATTERNS) {
        if (pattern.test(sentence)) {
          inferred.push({
            code,
            sectionId,
            detail: sentence,
          });
        }
      }
    }
  }
  return [
    ...explicit.map((detail) => ({ code: 'explicit_sensitive_path', sectionId: null, detail })),
    ...inferred,
  ];
}

function autoApprovalReason(code, detail, signals = {}) {
  return {
    code,
    detail,
    signals,
  };
}

function evaluateExecutionContractAutoApprovalPolicy({
  contract = {},
  approvalSummary = null,
} = {}) {
  const templateTier = normalizeTemplateTier(contract.template_tier || contract.templateTier || contract.tier, 'Standard');
  const riskFlags = contractRiskFlagIds(contract);
  const acceptanceCriteria = autoApprovalAcceptanceCriteria(contract);
  const signals = normalizeAutoApprovalSignals(contract.auto_approval_signals || contract.autoApprovalSignals, contract);
  const sensitivePaths = inferSensitiveAutoApprovalPaths(contract, signals);
  const reviewerApprovalReady = approvalSummary ? approvalSummary.canApprove !== false : true;
  const blockingReasons = [];

  if (templateTier !== 'Simple') {
    blockingReasons.push(autoApprovalReason(
      'simple_tier_required',
      'Auto-approval is limited to Simple Execution Contracts.',
      { templateTier },
    ));
  }
  if (riskFlags.length > 0) {
    blockingReasons.push(autoApprovalReason(
      'risk_flags_require_operator_approval',
      'Risk flags require explicit Operator Approval instead of policy auto-approval.',
      { riskFlags },
    ));
  }
  if (!acceptanceCriteria.complete) {
    blockingReasons.push(autoApprovalReason(
      'acceptance_criteria_incomplete',
      'Auto-approval requires complete acceptance criteria.',
      { acceptanceCriteriaCount: acceptanceCriteria.count },
    ));
  }
  if (signals.unresolved_dependencies.length > 0) {
    blockingReasons.push(autoApprovalReason(
      'unresolved_dependencies_present',
      'Auto-approval requires no unresolved dependencies.',
      { unresolvedDependencies: signals.unresolved_dependencies },
    ));
  }
  if (sensitivePaths.length > 0) {
    blockingReasons.push(autoApprovalReason(
      'production_auth_security_data_model_path_present',
      'Production auth, security, or data-model paths require explicit Operator Approval.',
      { sensitivePaths },
    ));
  }
  if (!rollbackPathIsClear(signals.rollback_path)) {
    blockingReasons.push(autoApprovalReason(
      'clear_rollback_path_required',
      'Auto-approval requires a clear rollback path.',
      { rollbackPath: signals.rollback_path },
    ));
  }
  if (!reviewerApprovalReady) {
    blockingReasons.push(autoApprovalReason(
      'reviewer_gates_not_ready',
      'Auto-approval cannot bypass required reviewer approvals or unresolved blocking questions.',
      {
        missingRequiredApprovals: approvalSummary?.missingRequiredApprovals || [],
        unresolvedBlockingQuestions: approvalSummary?.unresolvedBlockingQuestions || [],
      },
    ));
  }

  const canAutoApprove = blockingReasons.length === 0;
  return {
    policy_version: AUTO_APPROVAL_POLICY_VERSION,
    status: canAutoApprove ? 'ready' : 'blocked',
    canAutoApprove,
    operatorApprovalRequired: !canAutoApprove,
    rationale: canAutoApprove
      ? 'Low-risk Simple Execution Contract meets all policy criteria: complete acceptance criteria, no risk flags, no unresolved dependencies, no production auth/security/data-model paths, and a clear rollback path.'
      : 'Explicit Operator Approval is required because one or more low-risk Simple auto-approval criteria are not satisfied.',
    criteria: {
      templateTier,
      riskFlags,
      acceptanceCriteriaComplete: acceptanceCriteria.complete,
      acceptanceCriteriaCount: acceptanceCriteria.count,
      unresolvedDependencies: signals.unresolved_dependencies,
      productionSensitivePaths: sensitivePaths,
      rollbackPathClear: rollbackPathIsClear(signals.rollback_path),
      rollbackPath: signals.rollback_path,
      reviewerApprovalReady,
    },
    blockingReasons,
    metricsPolicy: {
      measuredBy: ['feature_operator_trusted_autonomous_delivery_rate', 'feature_execution_contract_auto_approvals_total', 'feature_operator_trusted_autonomous_deliveries_total'],
      reason: 'Autonomous delivery is trusted only when low-risk policy approval later closes successfully.',
    },
  };
}

function buildExecutionContractAutoApprovalRecord({ policy, approvedAt, actorId, body = {} }) {
  if (!policy?.canAutoApprove) return null;
  const rationale = normalizeSectionBody(body.autoApprovalRationale ?? body.auto_approval_rationale ?? body.rationale)
    || policy.rationale;
  return {
    policy_version: AUTO_APPROVAL_POLICY_VERSION,
    approved_by_policy: true,
    approval_mode: 'policy',
    approved_at: approvedAt,
    recorded_by: actorId || null,
    rationale,
    criteria: policy.criteria,
    blocking_reasons: [],
    metrics_policy: policy.metricsPolicy,
  };
}

function normalizeRequirementEntry(entry, fallback = {}) {
  if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
    const text = normalizeSectionBody(entry.text ?? entry.body ?? entry.summary ?? entry.value);
    if (!text) return null;
    return {
      id: normalizeSectionBody(entry.id) || fallback.id || `req-${crypto.randomUUID().slice(0, 8)}`,
      text,
      source_section_id: normalizeSectionBody(entry.sourceSectionId ?? entry.source_section_id) || fallback.sourceSectionId || null,
      committed: entry.committed !== false,
      provenance_references: normalizeStructuredList(entry.provenanceReferences ?? entry.provenance_references),
    };
  }
  const text = normalizeSectionBody(entry);
  if (!text) return null;
  return {
    id: fallback.id || `req-${crypto.randomUUID().slice(0, 8)}`,
    text,
    source_section_id: fallback.sourceSectionId || null,
    committed: true,
    provenance_references: [],
  };
}

function splitRequirementLines(body) {
  return normalizeSectionBody(body)
    .split(/\n+/)
    .map((line) => line.replace(/^[-*]\s+/, '').replace(/^\d+[.)]\s+/, '').trim())
    .filter(Boolean);
}

function deriveCommittedRequirementsFromSections(sections = {}, requiredSections = []) {
  const sourceSectionIds = requiredSections.filter((sectionId) => sectionBodyIsComplete(sections[sectionId]?.body));
  return sourceSectionIds.flatMap((sectionId) => {
    const lines = splitRequirementLines(sections[sectionId]?.body);
    const candidates = lines.length > 1 ? lines : [normalizeSectionBody(sections[sectionId]?.body)];
    return candidates.map((text, index) => normalizeRequirementEntry(text, {
      id: `sec-${sectionId}-req-${index + 1}`,
      sourceSectionId: sectionId,
    })).filter(Boolean);
  });
}

function normalizeScopeItem(entry, fallback = {}) {
  if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
    const text = normalizeSectionBody(entry.text ?? entry.body ?? entry.summary ?? entry.value ?? entry.title);
    if (!text) return null;
    return {
      id: normalizeSectionBody(entry.id) || fallback.id || `scope-${crypto.randomUUID().slice(0, 8)}`,
      text,
      reason: normalizeSectionBody(entry.reason) || null,
      provenance_references: normalizeStructuredList(entry.provenanceReferences ?? entry.provenance_references),
    };
  }
  const text = normalizeSectionBody(entry);
  if (!text) return null;
  return {
    id: fallback.id || `scope-${crypto.randomUUID().slice(0, 8)}`,
    text,
    reason: null,
    provenance_references: [],
  };
}

function normalizeScopeItems(value, prefix) {
  return normalizeStructuredList(value)
    .map((entry, index) => normalizeScopeItem(entry, { id: `${prefix}-${index + 1}` }))
    .filter(Boolean);
}

function normalizeCommittedScope(body = {}, sections = {}, requiredSections = []) {
  const source = body.scopeBoundaries || body.scope_boundaries || body.scope || {};
  const explicitCommitted = body.committedRequirements
    ?? body.committed_requirements
    ?? source.committedRequirements
    ?? source.committed_requirements;
  const committedRequirements = explicitCommitted
    ? normalizeStructuredList(explicitCommitted)
      .map((entry, index) => normalizeRequirementEntry(entry, { id: `committed-${index + 1}` }))
      .filter(Boolean)
    : deriveCommittedRequirementsFromSections(sections, requiredSections);
  const outOfScope = normalizeScopeItems(
    body.outOfScope ?? body.out_of_scope ?? source.outOfScope ?? source.out_of_scope,
    'out-of-scope',
  );
  const deferredConsiderations = normalizeScopeItems(
    body.deferredConsiderations ?? body.deferred_considerations ?? source.deferredConsiderations ?? source.deferred_considerations,
    'deferred',
  );
  const followUpTasks = normalizeScopeItems(
    body.followUpTasks ?? body.follow_up_tasks ?? source.followUpTasks ?? source.follow_up_tasks,
    'follow-up',
  );
  return {
    commitment_status: 'pending_approval',
    committed_requirements: committedRequirements,
    out_of_scope: outOfScope,
    deferred_considerations: deferredConsiderations,
    follow_up_tasks: followUpTasks,
    exclusion_policy: 'Only committed_requirements become implementation scope after approval; out_of_scope, deferred_considerations, and follow_up_tasks are excluded unless promoted through a new approved contract version or a new Intake Draft.',
  };
}

function sectionBodyIsComplete(body) {
  const normalized = normalizeSectionBody(body);
  if (!normalized) return false;
  return !PLACEHOLDER_SECTION_BODIES.has(normalized.toLowerCase());
}

function contractRiskFlagIds(contract = {}) {
  return (contract.risk_flags || contract.riskFlags || [])
    .map((flag) => normalizeSectionBody(flag?.id ?? flag?.key ?? flag?.name ?? flag))
    .filter(Boolean);
}

function normalizeDispatchWorkCategory(value, fallback = 'feature') {
  const normalized = normalizeKey(value);
  if (['test', 'tests', 'testing', 'test_only', 'test-only'].includes(normalized)) return 'tests';
  if (['fixture', 'fixtures', 'test_fixture', 'test-fixture'].includes(normalized)) return 'fixtures';
  if (['doc', 'docs', 'documentation', 'runbook', 'report'].includes(normalized)) return 'docs';
  if (['refactor', 'clear_refactor', 'clear-refactor', 'mechanical_refactor', 'mechanical-refactor'].includes(normalized)) return 'clear_refactor';
  if (['feature', 'implementation', 'runtime', 'product'].includes(normalized)) return 'feature';
  return fallback;
}

function inferDispatchWorkCategory({ contract = {}, title = '' } = {}) {
  const text = [
    title,
    ...Object.values(contract.sections || {}).map((section) => section?.body || ''),
    ...committedRequirementTexts(contract),
  ].join('\n').toLowerCase();
  if (/\b(fixtures?|test fixtures?)\b/.test(text)) return 'fixtures';
  if (/\b(docs?|documentation|runbook|report)\b/.test(text)) return 'docs';
  if (/\b(refactor|rename|move|mechanical cleanup|mechanical change)\b/.test(text)) return 'clear_refactor';
  if (/\b(test|tests|testing|coverage|spec)\b/.test(text)) return 'tests';
  return 'feature';
}

function textLooksLikeClearTestPlan(value) {
  const text = normalizeSectionBody(value).toLowerCase();
  if (!text || PLACEHOLDER_SECTION_BODIES.has(text)) return false;
  return /\b(test|tests|testing|coverage|spec|suite|assert|unit|integration|e2e|browser|contract|security|smoke|failing|pending)\b/.test(text);
}

function normalizeDispatchSignals(value = {}, context = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const contract = context.contract || {};
  const sections = context.sections || contract.sections || {};
  const templateTier = normalizeTemplateTier(context.templateTier || contract.template_tier || contract.templateTier, 'Standard');
  const riskFlags = context.riskFlags || normalizeRiskFlags(contract.risk_flags || contract.riskFlags || []);
  const sectionFourBody = sections['4']?.body || '';
  const explicitWorkCategory = source.workCategory ?? source.work_category ?? source.category ?? source.scope;
  const workCategory = normalizeDispatchWorkCategory(
    explicitWorkCategory,
    inferDispatchWorkCategory({ contract: { ...contract, sections }, title: source.title || contract.title || contract.task_id }),
  );
  const clearTestPlan = source.clearTestPlan != null || source.clear_test_plan != null || source.failingOrPendingTestPlan != null || source.failing_or_pending_test_plan != null
    ? normalizeBoolean(source.clearTestPlan ?? source.clear_test_plan ?? source.failingOrPendingTestPlan ?? source.failing_or_pending_test_plan, false)
    : textLooksLikeClearTestPlan(sectionFourBody);
  const qaCoverageApplicable = source.qaCoverageApplicable != null || source.qa_coverage_applicable != null
    ? normalizeBoolean(source.qaCoverageApplicable ?? source.qa_coverage_applicable, true)
    : STANDARD_OR_ABOVE_TIERS.includes(templateTier);
  const proposedEngineerTier = normalizeEngineerTier(
    source.proposedEngineerTier
      ?? source.proposed_engineer_tier
      ?? source.engineerTier
      ?? source.engineer_tier,
    null,
  );
  const explicitPrincipalTriggers = normalizeStructuredList(
    source.principalTriggers
      ?? source.principal_triggers
      ?? source.escalationTriggers
      ?? source.escalation_triggers,
  ).map(normalizeKey).filter(Boolean);
  const riskFlagTriggers = riskFlags
    .map((flag) => flag.id || flag)
    .filter((id) => PRINCIPAL_TRIGGER_RISK_FLAGS.has(id));
  return {
    policy_version: DISPATCH_POLICY_VERSION,
    work_category: workCategory,
    clear_test_plan: clearTestPlan,
    test_plan_summary: normalizeSectionBody(source.testPlanSummary ?? source.test_plan_summary ?? sectionFourBody) || null,
    qa_coverage_applicable: qaCoverageApplicable,
    proposed_engineer_tier: proposedEngineerTier,
    principal_triggers: [...new Set([...riskFlagTriggers, ...explicitPrincipalTriggers])],
    signals_source: normalizeSectionBody(source.source) || 'execution_contract',
  };
}

function dispatchReason(source, code, detail, signals = {}) {
  return {
    source,
    code,
    detail,
    signals,
  };
}

function reviewerApprovalStatus(contract = {}, role) {
  const reviewer = contract.reviewer_routing?.reviewers?.[role] || contract.reviewers?.[role] || null;
  const required = reviewer?.required === true || reviewer?.approvalRequired === true;
  return {
    required,
    status: reviewer?.status || (required ? 'pending' : 'not_required'),
    approved: reviewer ? reviewerIsApproved(role, reviewer) : !required,
    actorId: reviewer?.actorId || null,
    reasons: reviewer?.reasons || [],
  };
}

function normalizeFailureContext(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const priorFailedQaCount = Number(source.priorFailedQaCount ?? source.prior_failed_qa_count ?? (source.latestFailedQa ? 1 : 0)) || 0;
  const triggers = [];
  if (priorFailedQaCount > 0 || normalizeBoolean(source.repeatedFailedAttempts ?? source.repeated_failed_attempts, false)) {
    triggers.push('repeated_failed_attempts');
  }
  if (normalizeBoolean(source.unclearRootCause ?? source.unclear_root_cause, false)) triggers.push('unclear_root_cause');
  if (normalizeBoolean(source.highRiskRegression ?? source.high_risk_regression, false)) triggers.push('high_risk_regression');
  if (normalizeBoolean(source.contractDefectSuspected ?? source.contract_defect_suspected, false)) triggers.push('contract_defect_suspected');
  if (normalizeBoolean(source.principalEscalationRequested ?? source.principal_escalation_requested, false)) triggers.push('principal_escalation_requested');
  return {
    prior_failed_qa_count: priorFailedQaCount,
    implementing_engineer_tier: normalizeEngineerTier(source.implementingEngineerTier ?? source.implementing_engineer_tier, null),
    implementing_engineer_assignee: normalizeSectionBody(source.implementingEngineerAssignee ?? source.implementing_engineer_assignee) || null,
    triggers: [...new Set(triggers)],
  };
}

function buildDispatchFailureLoop({ failureContext = {}, implementingAssignee = null, selectedEngineerTier = null }) {
  const principalEscalationRequired = failureContext.triggers.some((trigger) => (
    ['repeated_failed_attempts', 'unclear_root_cause', 'high_risk_regression', 'contract_defect_suspected', 'principal_escalation_requested'].includes(trigger)
  ));
  const escalationChain = principalEscalationRequired
    ? ['qa', 'engineer', 'principalEngineer', 'pm']
    : ['qa', 'engineer'];
  return {
    returnToImplementingEngineerFirst: true,
    recipientRole: 'engineer',
    recipientAgentId: implementingAssignee || null,
    requiredEngineerTier: failureContext.implementing_engineer_tier || selectedEngineerTier || null,
    principalEscalationRequired,
    principalEscalationAllowed: principalEscalationRequired,
    escalationTriggers: failureContext.triggers,
    escalationChain,
    policy: principalEscalationRequired
      ? 'Escalate to Principal only because an explicit failure-loop escalation trigger is present.'
      : 'Return failing implementation work to the implementing Engineer first with evidence attached.',
  };
}

function evaluateExecutionContractDispatchPolicy({
  contract = {},
  verificationReport = null,
  proposedEngineerTier = null,
  proposedAssignee = null,
  implementingEngineerTier = null,
  implementingAssignee = null,
  failureContext = {},
} = {}) {
  const templateTier = normalizeTemplateTier(contract.template_tier || contract.templateTier || contract.tier, 'Standard');
  const riskFlags = contractRiskFlagIds(contract);
  const dispatchSignals = normalizeDispatchSignals(contract.dispatch_signals || contract.dispatchSignals, {
    contract,
    templateTier,
    riskFlags: contract.risk_flags || [],
  });
  const principalTriggers = [...new Set([
    ...riskFlags.filter((id) => PRINCIPAL_TRIGGER_RISK_FLAGS.has(id)),
    ...dispatchSignals.principal_triggers,
  ])];
  const standardOrAbove = STANDARD_OR_ABOVE_TIERS.includes(templateTier);
  const juniorEligible = templateTier === 'Simple'
    && JR_ELIGIBLE_WORK_CATEGORIES.has(dispatchSignals.work_category)
    && dispatchSignals.clear_test_plan
    && principalTriggers.length === 0;
  const principalReview = reviewerApprovalStatus(contract, 'principalEngineer');
  const principalReviewRequired = principalTriggers.length > 0 || principalReview.required;
  const principalReviewSatisfied = !principalReviewRequired || principalReview.approved;
  const selectionReasons = [];

  let selectedEngineerTier = 'Sr';
  if (principalTriggers.length > 0) {
    selectedEngineerTier = 'Principal';
    selectionReasons.push(dispatchReason(
      'risk',
      'principal_trigger_present',
      'Principal Engineer involvement is required for high-risk engineering triggers.',
      { principalTriggers },
    ));
  } else if (standardOrAbove) {
    selectedEngineerTier = 'Sr';
    selectionReasons.push(dispatchReason(
      'tier',
      'sr_default_standard_plus',
      'Sr Engineer is the default implementation tier for Standard, Complex, and Epic work.',
      { templateTier },
    ));
  } else if (juniorEligible) {
    selectedEngineerTier = 'Jr';
    selectionReasons.push(dispatchReason(
      'contract_signals',
      'jr_constrained_simple_work',
      'Jr Engineer is allowed because the contract is Simple, constrained, and has a clear test plan.',
      {
        templateTier,
        workCategory: dispatchSignals.work_category,
        clearTestPlan: dispatchSignals.clear_test_plan,
      },
    ));
  } else {
    selectedEngineerTier = 'Sr';
    selectionReasons.push(dispatchReason(
      'contract_signals',
      'sr_default_simple_without_jr_constraints',
      'Sr Engineer is selected because the Simple work is not safely constrained for Jr routing.',
      {
        templateTier,
        workCategory: dispatchSignals.work_category,
        clearTestPlan: dispatchSignals.clear_test_plan,
      },
    ));
  }

  const proposedTier = normalizeEngineerTier(proposedEngineerTier, null)
    || engineerTierFromAssigneeId(proposedAssignee)
    || dispatchSignals.proposed_engineer_tier
    || null;
  const blockingReasons = [];
  if (principalReviewRequired && !principalReviewSatisfied) {
    blockingReasons.push(dispatchReason(
      'approval_gate',
      'principal_review_required',
      'Principal Engineer review must be approved before high-risk work can be approved or dispatched.',
      { principalTriggers, principalReviewStatus: principalReview.status },
    ));
  }
  if (proposedTier === 'Jr' && !dispatchSignals.clear_test_plan) {
    blockingReasons.push(dispatchReason(
      'contract_signals',
      'jr_requires_clear_test_plan',
      'Jr Engineer dispatch requires a clear failing or pending test plan.',
      { workCategory: dispatchSignals.work_category },
    ));
  }
  if (proposedTier === 'Jr' && !juniorEligible) {
    blockingReasons.push(dispatchReason(
      'contract_signals',
      'jr_requires_constrained_simple_scope',
      'Jr Engineer dispatch is limited to constrained Simple tests, fixtures, docs, or clear refactors.',
      {
        templateTier,
        workCategory: dispatchSignals.work_category,
        clearTestPlan: dispatchSignals.clear_test_plan,
      },
    ));
  }
  if (proposedTier && selectedEngineerTier === 'Principal' && proposedTier !== 'Principal') {
    blockingReasons.push(dispatchReason(
      'risk',
      'principal_tier_required',
      'Principal-triggered work cannot be dispatched to Jr or Sr implementation before Principal involvement.',
      { proposedTier, selectedEngineerTier, principalTriggers },
    ));
  }

  const qaParallelAllowed = standardOrAbove
    && dispatchSignals.qa_coverage_applicable
    && selectedEngineerTier === 'Sr'
    && blockingReasons.length === 0;
  const normalizedFailureContext = normalizeFailureContext({
    ...failureContext,
    implementingEngineerTier: implementingEngineerTier || failureContext.implementingEngineerTier,
    implementingEngineerAssignee: implementingAssignee || failureContext.implementingEngineerAssignee,
  });
  const failureLoop = buildDispatchFailureLoop({
    failureContext: normalizedFailureContext,
    implementingAssignee: implementingAssignee || normalizedFailureContext.implementing_engineer_assignee,
    selectedEngineerTier,
  });

  return {
    policy_version: DISPATCH_POLICY_VERSION,
    status: blockingReasons.length ? 'blocked' : 'ready',
    canDispatch: blockingReasons.length === 0,
    selectedEngineerTier,
    selectedAssignee: engineerAssigneeForTier(selectedEngineerTier),
    proposedEngineerTier: proposedTier,
    proposedAssignee: proposedAssignee || (proposedTier ? engineerAssigneeForTier(proposedTier) : null),
    rerouted: Boolean(proposedTier && proposedTier !== selectedEngineerTier),
    selectionReasons,
    blockingReasons,
    contractSignals: {
      templateTier,
      riskFlags,
      workCategory: dispatchSignals.work_category,
      clearTestPlan: dispatchSignals.clear_test_plan,
      qaCoverageApplicable: dispatchSignals.qa_coverage_applicable,
      verificationReportPresent: Boolean(verificationReport?.path || verificationReport?.report_id || verificationReport?.content),
      principalTriggers,
    },
    principalReview: {
      required: principalReviewRequired,
      satisfied: principalReviewSatisfied,
      status: principalReview.status,
      actorId: principalReview.actorId,
      triggers: principalTriggers,
    },
    qaDispatch: {
      parallelAllowed: qaParallelAllowed,
      role: 'qa',
      mode: qaParallelAllowed ? 'parallel_with_sr_implementation' : 'serial_or_not_applicable',
      reason: qaParallelAllowed
        ? 'Standard-or-higher work may dispatch QA coverage work in parallel with Sr implementation.'
        : 'Parallel QA dispatch is limited to Standard-or-higher Sr implementation when QA coverage applies.',
    },
    escalationPaths: {
      architect: {
        bounded: true,
        reason: 'Architect remains a bounded implementation escalation path for feasibility, scope, and technical-spec questions.',
      },
      principalEngineer: {
        bounded: true,
        triggers: principalTriggers,
        reason: 'Principal Engineer involvement is reserved for high-risk triggers or failure-loop escalation conditions.',
      },
    },
    failureLoop,
    metricsPolicy: {
      measuredBy: ['quality_outcomes', 'test_pass_rate', 'qa_rework_rate', 'principal_intervention_rate', 'escaped_defect_rate'],
      excludedMetrics: ['lines_of_code', 'raw_task_count'],
      reason: 'Engineer tier outcomes are measured by quality and intervention metrics, not code volume or raw assignment count.',
    },
  };
}

function validateExecutionContract(contract = {}) {
  const templateTier = normalizeTemplateTier(contract.template_tier || contract.templateTier);
  const missingFields = [];
  if (!templateTier) missingFields.push('template_tier');
  if (contract.owner !== EXECUTION_CONTRACT_OWNER) missingFields.push('owner');

  const requiredSections = templateTier ? REQUIRED_SECTIONS_BY_TIER[templateTier] : [];
  const missingSections = [];
  const sections = contract.sections || {};
  for (const sectionId of requiredSections) {
    if (!sectionBodyIsComplete(sections[sectionId]?.body)) {
      missingSections.push(sectionId);
    }
  }

  return {
    status: missingFields.length || missingSections.length ? 'invalid' : 'valid',
    templateTier: templateTier || null,
    requiredSections,
    missingFields,
    missingSections,
    completeSections: requiredSections.filter((sectionId) => !missingSections.includes(sectionId)),
  };
}

function normalizeBodyForMaterialComparison(value) {
  return normalizeSectionBody(value).replace(/\s+/g, ' ');
}

function stableMaterialValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableMaterialValue);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableMaterialValue(value[key])]));
  }
  return value ?? null;
}

function materialFingerprint(contract = {}) {
  const sections = contract.sections || {};
  const sectionFingerprint = Object.fromEntries(orderedSectionIds(Object.keys(sections)).map((sectionId) => [
    sectionId,
    {
      title: normalizeBodyForMaterialComparison(sections[sectionId]?.title),
      body: normalizeBodyForMaterialComparison(sections[sectionId]?.body),
      owner_role: normalizeRole(sections[sectionId]?.owner_role ?? sections[sectionId]?.owner),
      section_status: normalizeSectionStatus(sections[sectionId]?.section_status, sections[sectionId]?.body ? 'complete' : 'draft'),
      contributor: normalizeSectionBody(sections[sectionId]?.contributor) || null,
      contributors: normalizeStructuredList(sections[sectionId]?.contributors),
      approver: normalizeSectionBody(sections[sectionId]?.approver) || null,
      approvals: normalizeStructuredList(sections[sectionId]?.approvals),
      approval_status: normalizeApprovalStatus(sections[sectionId]?.approval_status, sections[sectionId]?.approvals),
      payload_schema_version: Number(sections[sectionId]?.payload_schema_version ?? 1) || 1,
      payload_json: stableMaterialValue(sections[sectionId]?.payload_json || {}),
      provenance_references: normalizeStructuredList(sections[sectionId]?.provenance_references),
      required: sections[sectionId]?.required === true,
    },
  ]));
  return JSON.stringify({
    template_tier: contract.template_tier,
    required_sections: contract.required_sections || [],
    risk_flags: contract.risk_flags || [],
    sections: sectionFingerprint,
    reviewer_routing: contract.reviewer_routing || {},
    reviewers: contract.reviewers || {},
    review_feedback: contract.review_feedback || {},
    context_provenance: contract.context_provenance || {},
    dispatch_signals: contract.dispatch_signals || {},
    auto_approval_signals: contract.auto_approval_signals || {},
    committed_scope: contract.committed_scope || {},
  });
}

function hashContract(contract = {}) {
  return crypto.createHash('sha256').update(materialFingerprint(contract)).digest('hex');
}

function isMaterialContractChange(previousContract, nextContract) {
  if (!previousContract) return true;
  return hashContract(previousContract) !== hashContract(nextContract);
}

function findCreatedEvent(history = []) {
  return history.find((event) => event?.event_type === 'task.created') || null;
}

function findRefinementRequestedEvent(history = []) {
  return history.find((event) => event?.event_type === 'task.refinement_requested') || null;
}

function isIntakeDraftSummary(summary = {}, history = []) {
  if (summary?.intake_draft) return true;
  return history.some((event) => (
    (event?.event_type === 'task.created' || event?.event_type === 'task.refinement_requested')
    && (event?.payload?.intake_draft === true || typeof event?.payload?.raw_requirements === 'string')
  ));
}

function createExecutionContractDraft({ taskId, summary = {}, history = [], body = {}, actorId, previousContract = null }) {
  const templateTier = normalizeTemplateTier(body.templateTier || body.template_tier || body.tier, 'Standard');
  const requiredSections = REQUIRED_SECTIONS_BY_TIER[templateTier];
  const riskFlags = normalizeRiskFlags(body.riskFlags ?? body.risk_flags ?? body.risks ?? body.risk);
  const reviewerRouting = normalizeReviewerRouting(body, templateTier, riskFlags);
  const createdEvent = findCreatedEvent(history);
  const refinementRequestedEvent = findRefinementRequestedEvent(history);
  const rawRequirements = summary.operator_intake_requirements
    || refinementRequestedEvent?.payload?.raw_requirements
    || createdEvent?.payload?.raw_requirements
    || '';
  const title = normalizeSectionBody(body.title) || summary.title || createdEvent?.payload?.title || taskId;
  const sections = buildDraftSections({
    taskId,
    title,
    rawRequirements,
    templateTier,
    sections: normalizeSectionInput(body),
  });
  const versionSeed = Number(previousContract?.version || 0);
  const materialChangeReason = normalizeSectionBody(body.materialChangeReason || body.material_change_reason || body.materialChangeSummary || body.material_change_summary)
    || (previousContract ? 'Execution Contract section update.' : 'Initial Execution Contract draft generated from Intake Draft.');
  const sourceIntakeRevision = {
    intake_task_id: taskId,
    intake_event_id: createdEvent?.event_id || null,
    intake_sequence_number: createdEvent?.sequence_number || null,
    refinement_event_id: refinementRequestedEvent?.event_id || null,
    refinement_sequence_number: refinementRequestedEvent?.sequence_number || null,
    raw_requirements_hash: rawRequirements
      ? crypto.createHash('sha256').update(rawRequirements).digest('hex')
      : null,
  };
  const contextProvenance = normalizeContextProvenance(
    body.contextProvenance ?? body.context_provenance,
    {
      source_intake: [
        createdEvent ? {
          label: 'Intake Draft creation event',
          reference: createdEvent.event_id,
          source_type: 'audit_event',
          source_event_id: createdEvent.event_id,
        } : null,
        refinementRequestedEvent ? {
          label: 'PM refinement routing event',
          reference: refinementRequestedEvent.event_id,
          source_type: 'audit_event',
          source_event_id: refinementRequestedEvent.event_id,
        } : null,
      ].filter(Boolean),
      repo_docs: [
        EXECUTION_CONTRACT_TEMPLATE_SOURCE,
        'CONTEXT.md',
      ],
      specialist_contributions: Object.values(sections)
        .flatMap((section) => section.contributors || (section.contributor ? [section.contributor] : []))
        .filter(Boolean)
        .map((contributor) => ({
          label: contributor,
          reference: contributor,
          source_type: 'contract_section_contributor',
        })),
    },
  );
  const candidate = {
    contract_id: null,
    task_id: taskId,
    version: Math.max(1, versionSeed),
    status: 'draft',
    template_tier: templateTier,
    tier: templateTier,
    template_source: EXECUTION_CONTRACT_TEMPLATE_SOURCE,
    owner: EXECUTION_CONTRACT_OWNER,
    authoritative: true,
    creator: actorId || null,
    created_by: actorId || null,
    approver: null,
    approval_timestamp: null,
    approved_by: null,
    approved_at: null,
    source_intake_revision: sourceIntakeRevision,
    generated_from: sourceIntakeRevision,
    context_provenance: contextProvenance,
    required_sections: [...requiredSections],
    sections,
    risk_flags: riskFlags,
    reviewer_routing: reviewerRouting,
    reviewers: reviewerRouting.reviewers,
    review_feedback: normalizeReviewFeedback(body),
    dispatch_signals: normalizeDispatchSignals(body.dispatchSignals ?? body.dispatch_signals ?? body.dispatch, {
      templateTier,
      riskFlags,
      sections,
    }),
    auto_approval_signals: normalizeAutoApprovalSignals(body.autoApprovalSignals ?? body.auto_approval_signals ?? body.autoApproval ?? body.auto_approval, {
      sections,
    }),
    committed_scope: normalizeCommittedScope(body, sections, requiredSections),
    material_change_reason: materialChangeReason,
    material_change_summary: materialChangeReason,
    policy_versions_used: {
      template_source: EXECUTION_CONTRACT_TEMPLATE_SOURCE,
      required_sections_policy: 'execution-contract-required-sections.v1',
      material_change_policy: 'execution-contract-material-change.v1',
      committed_scope_policy: 'execution-contract-committed-scope.v1',
      context_provenance_policy: contextProvenance.policy_version,
      reviewer_routing_policy: REVIEWER_ROUTING_POLICY_VERSION,
      approval_gates_policy: APPROVAL_GATES_POLICY_VERSION,
      auto_approval_policy: AUTO_APPROVAL_POLICY_VERSION,
    },
  };
  const materialChange = isMaterialContractChange(previousContract, candidate);
  candidate.version = previousContract && materialChange ? Number(previousContract.version || 0) + 1 : versionSeed || 1;
  candidate.contract_id = `EC-${taskId}-v${candidate.version}`;
  candidate.validation = validateExecutionContract(candidate);
  candidate.material_hash = hashContract(candidate);
  return {
    contract: candidate,
    materialChange,
    previousVersion: previousContract?.version || null,
  };
}

function extractContractFromVersionEvent(event) {
  if (!event) return null;
  return event.payload?.contract || null;
}

function normalizeArtifactEnvironment(value) {
  const normalized = normalizeKey(value || 'production');
  if (['prod', 'production'].includes(normalized)) return 'production';
  if (['stg', 'stage', 'staging'].includes(normalized)) return 'staging';
  if (['local', 'dev', 'development', 'test', 'testing'].includes(normalized)) return 'local';
  return 'production';
}

function productionDisplayIdIsValid(value) {
  return /^TSK-\d+$/.test(String(value || '').trim());
}

function nonProductionDisplayIdIsSafe(value) {
  return /^(STG|LOCAL)-[A-Z0-9][A-Z0-9-]*$/.test(String(value || '').trim());
}

function numericIdSuffix(value) {
  const match = String(value || '').trim().match(/-(\d+)$/);
  return match ? match[1] : null;
}

function safeAliasSuffix(value) {
  const normalized = normalizeKey(value).replace(/_/g, '-').toUpperCase();
  if (normalized) return normalized.slice(0, 48);
  return crypto.createHash('sha256').update(String(value || 'task')).digest('hex').slice(0, 10).toUpperCase();
}

function normalizeArtifactIdentity({ taskId, contract = {}, body = {} }) {
  const environment = normalizeArtifactEnvironment(body.artifactEnvironment ?? body.artifact_environment ?? body.environment ?? contract.artifact_environment);
  const requestedDisplayId = normalizeSectionBody(
    body.displayId
    ?? body.display_id
    ?? body.taskDisplayId
    ?? body.task_display_id
    ?? contract.display_id
    ?? contract.displayId
    ?? contract.task_display_id,
  );
  const sourceDisplayId = requestedDisplayId || normalizeSectionBody(taskId);

  if (environment === 'production') {
    const displayId = requestedDisplayId || (productionDisplayIdIsValid(taskId) ? normalizeSectionBody(taskId) : '');
    return {
      environment,
      display_id: displayId,
      source_task_id: taskId,
      requested_display_id: requestedDisplayId || null,
      valid_for_committed_repo: productionDisplayIdIsValid(displayId),
      collision_safe: productionDisplayIdIsValid(displayId),
      alias_applied: false,
      collision_policy: 'Production generated repo artifacts must use TSK-123-style display IDs.',
    };
  }

  const prefix = environment === 'staging' ? 'STG' : 'LOCAL';
  const requestedIsSafeAlias = nonProductionDisplayIdIsSafe(requestedDisplayId) && requestedDisplayId.startsWith(`${prefix}-`);
  const suffix = numericIdSuffix(sourceDisplayId) || safeAliasSuffix(sourceDisplayId);
  const displayId = requestedIsSafeAlias ? requestedDisplayId : `${prefix}-${suffix}`;
  return {
    environment,
    display_id: displayId,
    source_task_id: taskId,
    requested_display_id: requestedDisplayId || null,
    valid_for_committed_repo: nonProductionDisplayIdIsSafe(displayId),
    collision_safe: !String(displayId).startsWith('TSK-'),
    alias_applied: displayId !== sourceDisplayId,
    collision_policy: 'Non-production generated repo artifacts use environment-prefixed aliases so they cannot collide with production TSK IDs.',
  };
}

function slugifyArtifactTitle(value, fallback = 'execution-contract') {
  const ascii = String(value || '')
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '');
  const slug = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return slug || fallback;
}

function artifactTitle(contract = {}, body = {}) {
  const explicitTitle = normalizeSectionBody(body.title ?? body.artifactTitle ?? body.artifact_title);
  if (explicitTitle) return explicitTitle;
  const sectionOne = normalizeSectionBody(contract.sections?.['1']?.titleOverride || contract.sections?.['1']?.artifact_title);
  if (sectionOne) return sectionOne;
  const bodyLines = normalizeSectionBody(contract.sections?.['1']?.body).split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const wantLine = bodyLines.find((line) => /^I want\s+/i.test(line));
  if (wantLine) return wantLine.replace(/^I want\s+/i, '').replace(/[.,;:]+$/g, '');
  return normalizeSectionBody(contract.title) || `${contract.task_id || 'Task'} Execution Contract`;
}

function approvedContractVersions(history = []) {
  return history
    .filter((event) => event?.event_type === 'task.execution_contract_approved')
    .map((event) => Number(event.payload?.version))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
}

function previousApprovedContract(history = [], currentVersion) {
  const versionEvents = new Map(history
    .filter((event) => event?.event_type === 'task.execution_contract_version_recorded')
    .map((event) => {
      const contract = extractContractFromVersionEvent(event) || {};
      return [Number(contract.version || event.payload?.version), contract];
    }));
  const previousVersion = approvedContractVersions(history)
    .filter((version) => version < Number(currentVersion))
    .at(-1);
  return previousVersion ? versionEvents.get(previousVersion) || null : null;
}

function committedRequirementTexts(contract = {}) {
  return (contract.committed_scope?.committed_requirements || [])
    .map((item) => normalizeSectionBody(item?.text ?? item?.body ?? item))
    .filter(Boolean);
}

function committedRequirementsChanged(previousContract, nextContract) {
  if (!previousContract) return false;
  return JSON.stringify(committedRequirementTexts(previousContract)) !== JSON.stringify(committedRequirementTexts(nextContract));
}

function deriveSectionOwnerApprovalRoles(contract = {}) {
  const roles = new Set();
  for (const section of Object.values(contract.sections || {})) {
    if (!sectionBodyIsComplete(section?.body)) continue;
    const role = canonicalReviewerRole(section.owner_role || section.owner);
    if (role && role !== 'pm') roles.add(role);
  }
  return ARTIFACT_ROLE_ORDER.filter((role) => roles.has(role));
}

function artifactExceptionTriggers({ contract = {}, history = [], approvalSummary = {}, body = {} }) {
  const previousContract = previousApprovedContract(history, contract.version);
  const reasons = [];
  if (normalizeBoolean(body.scopeMismatch ?? body.scope_mismatch, false)) {
    reasons.push({
      code: 'scope_mismatch',
      detail: 'Generated artifact content reveals a scope mismatch against the approved Execution Contract.',
    });
  }
  if (normalizeBoolean(body.promotesDeferredConsideration ?? body.promotes_deferred_consideration, false)) {
    reasons.push({
      code: 'promotes_deferred_consideration',
      detail: 'Generated artifact content promotes a Deferred Consideration into current implementation scope.',
    });
  }
  if (
    normalizeBoolean(body.changesCommittedRequirement ?? body.changes_committed_requirement, false)
    || committedRequirementsChanged(previousContract, contract)
  ) {
    reasons.push({
      code: 'changes_committed_requirement',
      detail: 'Generated artifact content changes committed implementation requirements after approval.',
    });
  }
  if (
    normalizeBoolean(body.acceptsUnresolvedNonBlockingComments ?? body.accepts_unresolved_non_blocking_comments, false)
    || (approvalSummary.nonBlockingComments || []).length > 0
  ) {
    reasons.push({
      code: 'accepts_unresolved_non_blocking_comments',
      detail: 'Generated artifact approval accepts unresolved non-blocking comments.',
    });
  }
  if (normalizeBoolean(body.bundledWithOperatorApproval ?? body.bundled_with_operator_approval, false)) {
    reasons.push({
      code: 'bundled_with_operator_approval',
      detail: 'Generated artifact approval is bundled with Operator Approval.',
    });
  }
  if (normalizeBoolean(body.bundledWithOperatorCloseout ?? body.bundled_with_operator_closeout, false)) {
    reasons.push({
      code: 'bundled_with_operator_closeout',
      detail: 'Generated artifact approval is bundled with Operator Closeout.',
    });
  }
  return {
    operator_approval_required: reasons.length > 0,
    reasons,
  };
}

function canonicalArtifactApprovalRole(value) {
  const normalized = normalizeKey(value);
  if (normalized === 'operator' || normalized === 'stakeholder') return 'operator';
  return canonicalReviewerRole(value);
}

function normalizeArtifactApprovalInput(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const normalized = {};
  for (const [key, entry] of Object.entries(source)) {
    const role = canonicalArtifactApprovalRole(key);
    if (!role) continue;
    normalized[role] = entry && typeof entry === 'object' && !Array.isArray(entry)
      ? entry
      : { status: entry === true ? 'approved' : String(entry || '').trim() };
  }
  return normalized;
}

function normalizeArtifactApprovalEntry(role, entry = {}, required = false) {
  const status = entry.approved === true
    ? 'approved'
    : normalizeReviewerStatus(entry.status ?? entry.approvalStatus ?? entry.approval_status, required ? 'pending' : 'not_required');
  return {
    role,
    label: ARTIFACT_ROLE_LABELS[role] || role,
    required,
    status,
    approved: reviewerIsApproved(role, { status }),
    actorId: entry.actorId || entry.actor_id || entry.approvedBy || entry.approved_by || null,
    approvedAt: entry.approvedAt || entry.approved_at || null,
    note: normalizeSectionBody(entry.note ?? entry.summary ?? entry.rationale) || null,
  };
}

function normalizeArtifactApprovals(input = {}, requiredRoles = []) {
  const source = normalizeArtifactApprovalInput(input);
  return Object.fromEntries(ARTIFACT_ROLE_ORDER
    .filter((role) => requiredRoles.includes(role) || source[role])
    .map((role) => [
      role,
      normalizeArtifactApprovalEntry(role, source[role] || {}, requiredRoles.includes(role)),
    ]));
}

function evaluateArtifactBundleApprovalReadiness(requiredRoles = [], approvals = {}, operatorApproval = {}) {
  const requiredApprovals = requiredRoles.map((role) => approvals[role] || normalizeArtifactApprovalEntry(role, {}, true));
  const missingRequiredApprovals = requiredApprovals
    .filter((approval) => !reviewerIsApproved(approval.role, approval))
    .map((approval) => ({
      role: approval.role,
      label: approval.label || ARTIFACT_ROLE_LABELS[approval.role] || approval.role,
      status: approval.status || 'pending',
    }));
  const blocked = missingRequiredApprovals.length > 0;
  return {
    policy_version: ARTIFACT_BUNDLE_APPROVAL_POLICY_VERSION,
    status: blocked ? 'pending_approval' : 'approved_for_commit',
    canCommit: !blocked,
    requiredRoles,
    missingRequiredApprovals,
    operatorApprovalRequired: Boolean(operatorApproval.operator_approval_required),
    operatorApprovalReasons: operatorApproval.reasons || [],
  };
}

function renderArtifactUserStory({ contract = {}, displayId, title, amendment = null }) {
  const lines = [
    `# ${displayId} ${title}`,
    '',
    `Task Display ID: ${displayId}`,
    `Execution Contract Version: v${contract.version}`,
    `Template Tier: ${contract.template_tier}`,
    'Authoritative Source: structured Task execution_contract data',
    `Template Source: ${contract.template_source || EXECUTION_CONTRACT_TEMPLATE_SOURCE}`,
    '',
    'This generated user story is the committed human-readable view of the approved Execution Contract. Material changes require a new approved contract version or amendment.',
    '',
  ];
  if (amendment) {
    lines.push('## Amendment Notice');
    lines.push('');
    lines.push(`This artifact is generated for Execution Contract v${contract.version} after approved v${amendment.previousApprovedVersion}. The previous generated story remains immutable.`);
    lines.push('');
  }
  if (contract.auto_approval?.approved_by_policy) {
    lines.push('## Auto-Approval Policy');
    lines.push('');
    lines.push(`Policy: ${contract.auto_approval.policy_version || AUTO_APPROVAL_POLICY_VERSION}`);
    lines.push(`Rationale: ${contract.auto_approval.rationale}`);
    lines.push(`Approved At: ${contract.auto_approval.approved_at || 'unknown'}`);
    lines.push('');
  }
  const sections = contract.sections || {};
  for (const sectionId of orderedSectionIds(Object.keys(sections))) {
    const section = sections[sectionId];
    if (!sectionBodyIsComplete(section?.body)) continue;
    lines.push(`## ${sectionId}. ${section.title || sectionTitle(sectionId)}`);
    lines.push('');
    lines.push(section.body);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

function renderRefinementDecisionLog({
  contract = {},
  displayId,
  title,
  bundleId,
  approvalRouting = {},
  operatorApproval = {},
  amendment = null,
}) {
  const lines = [
    `# Refinement Decision Log: ${displayId} ${title}`,
    '',
    `Task Display ID: ${displayId}`,
    `Artifact Bundle: ${bundleId}`,
    `Execution Contract Version: v${contract.version}`,
    `Template Tier: ${contract.template_tier}`,
    'Status: Generated for artifact-bundle review',
    '',
    '## Accepted Decisions',
    '',
    `- Generated repo artifacts are derived from approved structured Execution Contract ${contract.contract_id || `v${contract.version}`}.`,
    '- The Markdown user story is a durable generated view; structured Task data remains authoritative.',
    '- GitHub issue creation remains optional and default-off for this bundle.',
  ];
  if (amendment) {
    lines.push(`- This bundle uses a versioned artifact path for v${contract.version}; the v${amendment.previousApprovedVersion} approved story remains immutable.`);
  }
  if (contract.auto_approval?.approved_by_policy) {
    lines.push(`- Operator Approval was recorded by ${contract.auto_approval.policy_version || AUTO_APPROVAL_POLICY_VERSION}: ${contract.auto_approval.rationale}`);
  }
  lines.push('');
  lines.push('## Approval Routing');
  lines.push('');
  for (const role of approvalRouting.required_roles || []) {
    lines.push(`- ${ARTIFACT_ROLE_LABELS[role] || role}: required before commit.`);
  }
  if (!(approvalRouting.required_roles || []).length) {
    lines.push('- No section-owner artifact approvals were required.');
  }
  lines.push('');
  lines.push('## Operator Approval Exceptions');
  lines.push('');
  if (operatorApproval.operator_approval_required) {
    for (const reason of operatorApproval.reasons || []) {
      lines.push(`- ${reason.code}: ${reason.detail}`);
    }
  } else {
    lines.push('- No exception-triggered operator approval required.');
  }
  lines.push('');
  lines.push('## Resulting Contract Version');
  lines.push('');
  lines.push(`- ${contract.contract_id || `Execution Contract v${contract.version}`}`);
  return lines.join('\n');
}

function verificationReportSkeletonRequired(contract = {}) {
  const tier = normalizeTemplateTier(contract.template_tier || contract.templateTier, 'Simple');
  return STANDARD_OR_ABOVE_TIERS.includes(tier) || contractRiskFlagIds(contract).length > 0;
}

function sectionEvidence(contract = {}, sectionId, fallback) {
  return normalizeSectionBody(contract.sections?.[sectionId]?.body) || fallback;
}

function buildVerificationReportEvidence(contract = {}) {
  return {
    acceptance_criteria: sectionEvidence(contract, '2', 'No acceptance criteria were captured in the approved Execution Contract.'),
    test: sectionEvidence(contract, '4', 'No automated test deliverables were captured in the approved Execution Contract.'),
    security: sectionEvidence(contract, '8', 'No dedicated security evidence was required by the approved Execution Contract.'),
    sre: [
      sectionEvidence(contract, '12', 'No monitoring or observability evidence was captured in the approved Execution Contract.'),
      sectionEvidence(contract, '16', 'No production validation strategy was captured in the approved Execution Contract.'),
    ].filter(Boolean).join('\n\n'),
    rollout: sectionEvidence(contract, '11', 'No rollout evidence was captured in the approved Execution Contract.'),
    operator_customer_review: sectionEvidence(contract, '17', 'No customer/operator handoff evidence was captured in the approved Execution Contract.'),
    definition_of_done: sectionEvidence(contract, '15', 'No Definition of Done was captured in the approved Execution Contract.'),
  };
}

function renderVerificationReportSkeleton({
  contract = {},
  displayId,
  title,
  reportId,
  path,
  evidence = buildVerificationReportEvidence(contract),
  generatedAt,
}) {
  const riskFlags = contractRiskFlagIds(contract);
  const lines = [
    `# ${displayId} Verification Report`,
    '',
    `Task Display ID: ${displayId}`,
    `Report ID: ${reportId}`,
    `Report Path: ${path}`,
    `Execution Contract Version: v${contract.version}`,
    `Template Tier: ${contract.template_tier}`,
    `Generated At: ${generatedAt}`,
    'Status: Skeleton generated before implementation',
    'Authoritative Source: approved structured Task execution_contract data',
    '',
    '## Approved Contract Summary',
    '',
    `- Title: ${title}`,
    `- Contract ID: ${contract.contract_id || `Execution Contract v${contract.version}`}`,
    `- Risk flags: ${riskFlags.length ? riskFlags.join(', ') : 'none'}`,
    '',
    '## Required Evidence From Approved Contract',
    '',
    '### Acceptance Criteria',
    '',
    evidence.acceptance_criteria,
    '',
    '### Test Evidence',
    '',
    evidence.test,
    '',
    '### Security Evidence',
    '',
    evidence.security,
    '',
    '### SRE Evidence',
    '',
    evidence.sre,
    '',
    '### Rollout Evidence',
    '',
    evidence.rollout,
    '',
    '### Operator/Customer Review',
    '',
    evidence.operator_customer_review,
    '',
    '### Definition Of Done',
    '',
    evidence.definition_of_done,
    '',
    '## Deviations',
    '',
    '- Implementation phase entry: record any approved deviations from the Execution Contract here.',
    '',
    '## Commands',
    '',
    '- Implementation phase entry: record exact verification commands and outcomes here.',
    '',
    '## Links',
    '',
    `- Execution Contract: ${contract.contract_id || `v${contract.version}`}`,
    `- Verification report path: ${path}`,
  ];
  return lines.join('\n');
}

function createExecutionContractVerificationReportSkeleton({
  taskId,
  contract = {},
  body = {},
  actorId = null,
  generatedAt = new Date().toISOString(),
}) {
  const identity = normalizeArtifactIdentity({ taskId, contract, body });
  const title = artifactTitle(contract, body);
  const slug = slugifyArtifactTitle(body.slug || body.reportSlug || body.report_slug || title);
  const path = `docs/reports/${identity.display_id}-${slug}-verification.md`;
  const reportId = `VR-${identity.display_id}-v${contract.version}`;
  const required = verificationReportSkeletonRequired(contract);
  const evidence = buildVerificationReportEvidence(contract);
  const dispatchReadiness = evaluateExecutionContractDispatchReadiness({
    contract,
    verificationReport: { path, report_id: reportId },
  });
  const content = renderVerificationReportSkeleton({
    contract,
    displayId: identity.display_id,
    title,
    reportId,
    path,
    evidence,
    generatedAt,
  });

  return {
    policy_version: VERIFICATION_REPORT_SKELETON_POLICY_VERSION,
    report_id: reportId,
    task_id: taskId,
    source_task_id: taskId,
    display_id: identity.display_id,
    identity,
    environment: identity.environment,
    slug,
    title,
    contract_id: contract.contract_id || null,
    contract_version: Number(contract.version) || null,
    required,
    required_reason: required
      ? STANDARD_OR_ABOVE_TIERS.includes(normalizeTemplateTier(contract.template_tier || contract.templateTier, 'Simple'))
        ? 'Standard, Complex, and Epic Execution Contracts require a verification report skeleton before implementation dispatch.'
        : 'Simple Execution Contracts with risk flags require a verification report skeleton before implementation dispatch.'
      : 'Simple Execution Contracts without risk flags may skip the verification report skeleton.',
    status: 'generated',
    generated_at: generatedAt,
    generated_by: actorId,
    path,
    content,
    required_evidence: evidence,
    links: [
      { rel: 'verification_report', label: 'Verification report skeleton', path },
    ],
    dispatch_gate: {
      skeleton_required: required,
      can_dispatch: dispatchReadiness.canDispatch,
      missing_required_artifacts: dispatchReadiness.missingRequiredArtifacts,
      risk_flags: contractRiskFlagIds(contract),
      selected_engineer_tier: dispatchReadiness.dispatchPolicy.selectedEngineerTier,
      selected_engineer_assignee: dispatchReadiness.dispatchPolicy.selectedAssignee,
      qa_parallel_allowed: dispatchReadiness.dispatchPolicy.qaDispatch.parallelAllowed,
      dispatch_policy: dispatchReadiness.dispatchPolicy,
      policy_version: VERIFICATION_REPORT_SKELETON_POLICY_VERSION,
    },
  };
}

function contractCoverageRequirementArea(requirement = {}, templateTier = 'Standard') {
  const sectionId = normalizeSectionBody(requirement.source_section_id ?? requirement.sourceSectionId);
  if (templateTier === 'Simple') return 'acceptance_criteria';
  if (sectionId === '2') return 'acceptance_criteria';
  if (sectionId === '4') return 'test_evidence';
  if (sectionId === '8') return 'security';
  if (sectionId === '10') return 'ux';
  if (sectionId === '11') return 'rollout';
  if (sectionId === '12') return 'observability';
  if (sectionId === '16') return 'sre';
  if (sectionId === '17') return 'docs_handoff';
  return STANDARD_OR_ABOVE_TIERS.includes(templateTier) ? 'contract_section' : 'committed_requirement';
}

function contractCoverageRequirements(contract = {}) {
  const templateTier = normalizeTemplateTier(contract.template_tier || contract.templateTier || contract.tier, 'Standard');
  const committedRequirements = contract.committed_scope?.committed_requirements || [];
  return committedRequirements
    .map((requirement, index) => normalizeRequirementEntry(requirement, { id: `committed-${index + 1}` }))
    .filter((requirement) => requirement?.committed !== false)
    .map((requirement) => ({
      id: requirement.id,
      text: requirement.text,
      source_section_id: requirement.source_section_id || null,
      coverage_area: contractCoverageRequirementArea(requirement, templateTier),
      provenance_references: requirement.provenance_references || [],
    }));
}

function normalizeCoverageEvidence(value = []) {
  return normalizeStructuredList(value)
    .map((entry, index) => {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const label = normalizeSectionBody(entry.label ?? entry.title ?? entry.summary ?? entry.text ?? entry.value ?? entry.path ?? entry.command);
        if (!label) return null;
        const rawKind = normalizeKey(entry.kind ?? entry.type ?? entry.source ?? 'artifact');
        const manual = normalizeBoolean(entry.manual ?? entry.manualOnly ?? entry.manual_only, false)
          || rawKind === 'manual'
          || MANUAL_EVIDENCE_PATTERN.test(label);
        return {
          id: normalizeSectionBody(entry.id) || `evidence-${index + 1}`,
          label,
          kind: rawKind || 'artifact',
          value: normalizeSectionBody(entry.value ?? entry.path ?? entry.command ?? label) || label,
          automated: entry.automated == null ? !manual : normalizeBoolean(entry.automated, !manual),
        };
      }
      const label = normalizeSectionBody(entry);
      if (!label) return null;
      return {
        id: `evidence-${index + 1}`,
        label,
        kind: MANUAL_EVIDENCE_PATTERN.test(label) ? 'manual' : 'artifact',
        value: label,
        automated: !MANUAL_EVIDENCE_PATTERN.test(label),
      };
    })
    .filter(Boolean);
}

function evidenceHasAutomatedItem(evidence = []) {
  return evidence.some((item) => item?.automated !== false);
}

function normalizeCoverageRowStatus(value, fallback = 'submitted') {
  const normalized = normalizeKey(value);
  return normalized || fallback;
}

function normalizeCoverageRow(entry = {}, requirement = {}, context = {}) {
  const source = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : {};
  const requirementId = normalizeSectionBody(
    source.requirementId
    ?? source.requirement_id
    ?? source.committedRequirementId
    ?? source.committed_requirement_id
    ?? requirement.id,
  );
  const status = normalizeCoverageRowStatus(source.status ?? source.coverageStatus ?? source.coverage_status);
  const exceptionType = normalizeKey(source.exceptionType ?? source.exception_type);
  const notApplicable = normalizeBoolean(source.notApplicable ?? source.not_applicable, false)
    || CONTRACT_COVERAGE_NOT_APPLICABLE_STATUSES.has(status);
  const nonCode = normalizeBoolean(source.nonCode ?? source.non_code, false);
  return {
    row_id: normalizeSectionBody(source.rowId ?? source.row_id)
      || `cov-${requirementId || crypto.randomUUID().slice(0, 8)}`,
    requirement_id: requirementId,
    requirement_text: normalizeSectionBody(source.requirementText ?? source.requirement_text ?? source.text)
      || requirement.text
      || 'Unknown committed requirement.',
    source_section_id: normalizeSectionBody(source.sourceSectionId ?? source.source_section_id)
      || requirement.source_section_id
      || null,
    coverage_area: normalizeKey(source.coverageArea ?? source.coverage_area)
      || requirement.coverage_area
      || 'committed_requirement',
    contract_version: Number(context.contractVersion) || null,
    implementation_attempt: Number(context.implementationAttempt) || 0,
    status,
    implementation_evidence: normalizeCoverageEvidence(source.implementationEvidence ?? source.implementation_evidence ?? source.implementation),
    verification_evidence: normalizeCoverageEvidence(source.verificationEvidence ?? source.verification_evidence ?? source.verification),
    non_code: nonCode,
    not_applicable: notApplicable,
    exception_type: exceptionType || null,
    exception_rationale: normalizeSectionBody(
      source.exceptionRationale
      ?? source.exception_rationale
      ?? source.notApplicableRationale
      ?? source.not_applicable_rationale
      ?? source.rationale,
    ) || null,
    exception_approved: normalizeBoolean(source.exceptionApproved ?? source.exception_approved ?? source.approvedException ?? source.approved_exception, false),
    dependent_requirement_ids: normalizeStructuredList(source.dependentRequirementIds ?? source.dependent_requirement_ids ?? source.dependsOn ?? source.depends_on),
    submitted_by: context.actorId || null,
    submitted_at: context.submittedAt || null,
  };
}

function normalizeCoverageRows(value = [], requirements = [], context = {}) {
  const entries = Array.isArray(value) ? value : [];
  const byRequirement = new Map();
  for (const entry of entries) {
    const normalized = normalizeCoverageRow(entry, {}, context);
    if (normalized.requirement_id) byRequirement.set(normalized.requirement_id, normalized);
  }
  const rows = requirements.map((requirement) => normalizeCoverageRow(
    byRequirement.get(requirement.id) || {},
    requirement,
    context,
  ));
  const knownIds = new Set(requirements.map((requirement) => requirement.id));
  const extras = [...byRequirement.values()].filter((row) => !knownIds.has(row.requirement_id));
  return [...rows, ...extras];
}

function evaluateCoverageRow(row = {}, knownRequirementIds = new Set()) {
  const reasons = [];
  const status = normalizeCoverageRowStatus(row.status);
  const hasImplementationEvidence = row.implementation_evidence?.length > 0;
  const hasVerificationEvidence = row.verification_evidence?.length > 0;
  const hasAutomatedImplementation = evidenceHasAutomatedItem(row.implementation_evidence || []);
  const hasAutomatedVerification = evidenceHasAutomatedItem(row.verification_evidence || []);
  const knownRequirement = knownRequirementIds.has(row.requirement_id);

  if (!knownRequirement) {
    reasons.push({
      code: 'unknown_committed_requirement',
      detail: 'Coverage rows must map to committed requirements from the approved Execution Contract.',
    });
  }

  if (row.not_applicable || CONTRACT_COVERAGE_NOT_APPLICABLE_STATUSES.has(status)) {
    if (!row.exception_rationale) {
      reasons.push({
        code: 'missing_not_applicable_rationale',
        detail: 'Not-applicable rows require explicit rationale.',
      });
    }
    return {
      row_id: row.row_id,
      requirement_id: row.requirement_id,
      outcome: reasons.length ? 'rejected' : 'not_applicable',
      covered: reasons.length === 0,
      neutral_exception: reasons.length === 0,
      reasons,
    };
  }

  if (row.exception_type) {
    if (row.exception_type === 'implementation_incomplete') {
      reasons.push({
        code: 'implementation_incomplete',
        detail: 'Committed requirement is not fully implemented and verified.',
      });
    } else {
      if (!row.exception_rationale) {
        reasons.push({
          code: 'missing_exception_rationale',
          detail: 'Coverage exceptions require explicit rationale.',
        });
      }
      if (!row.exception_approved) {
        reasons.push({
          code: 'exception_not_approved',
          detail: 'Coverage exceptions require QA-approved rationale before the gate can close.',
        });
      }
    }
    return {
      row_id: row.row_id,
      requirement_id: row.requirement_id,
      outcome: reasons.length ? 'rejected' : 'excepted',
      covered: reasons.length === 0,
      neutral_exception: reasons.length === 0 && row.exception_type !== 'implementation_incomplete',
      reasons,
    };
  }

  if (CONTRACT_COVERAGE_INCOMPLETE_STATUSES.has(status)) {
    reasons.push({
      code: 'implementation_incomplete',
      detail: 'Coverage row is explicitly marked incomplete, partial, or uncovered.',
    });
  }
  if (CONTRACT_COVERAGE_EXCEPTION_STATUSES.has(status)) {
    reasons.push({
      code: 'missing_exception_type',
      detail: 'Excepted rows must identify an approved exception type.',
    });
  }

  if (row.non_code) {
    if (!row.exception_rationale) {
      reasons.push({
        code: 'missing_non_code_rationale',
        detail: 'Non-code coverage rows require explicit rationale.',
      });
    }
    if (!hasAutomatedImplementation && !hasAutomatedVerification) {
      reasons.push({
        code: 'missing_non_code_evidence',
        detail: 'Non-code rows still require auditable implementation or verification evidence.',
      });
    }
  } else {
    if (!hasImplementationEvidence) {
      reasons.push({
        code: 'missing_implementation_evidence',
        detail: 'Covered rows require implementation evidence.',
      });
    } else if (!hasAutomatedImplementation) {
      reasons.push({
        code: 'manual_only_implementation_evidence',
        detail: 'Manual-only implementation evidence is not sufficient coverage.',
      });
    }
    if (!hasVerificationEvidence) {
      reasons.push({
        code: 'missing_verification_evidence',
        detail: 'Covered rows require verification evidence.',
      });
    } else if (!hasAutomatedVerification) {
      reasons.push({
        code: 'manual_only_verification_evidence',
        detail: 'Manual-only verification evidence is not sufficient coverage.',
      });
    }
  }

  if (!CONTRACT_COVERAGE_COVERED_STATUSES.has(status) && status !== 'submitted') {
    reasons.push({
      code: 'coverage_status_not_covered',
      detail: 'QA can close only covered, not-applicable, or approved-exception rows.',
    });
  }

  return {
    row_id: row.row_id,
    requirement_id: row.requirement_id,
    outcome: reasons.length ? 'rejected' : 'covered',
    covered: reasons.length === 0,
    neutral_exception: false,
    reasons,
  };
}

function coverageBlockingException(row = {}, reason = {}) {
  return {
    exception_type: 'implementation_incomplete',
    requirement_id: row.requirement_id,
    row_id: row.row_id,
    source_section_id: row.source_section_id || null,
    coverage_area: row.coverage_area || null,
    reason_code: reason.code || 'implementation_incomplete',
    detail: reason.detail || 'Committed requirement lacks sufficient implementation and verification coverage.',
    blocks: ['qa_verification', 'operator_closeout'],
  };
}

function evaluateContractCoverageAudit({
  contract = {},
  audit = {},
  implementationAttempt = audit.implementation_attempt,
  priorValidations = [],
} = {}) {
  const requirements = contractCoverageRequirements(contract);
  const knownRequirementIds = new Set(requirements.map((requirement) => requirement.id));
  const rows = Array.isArray(audit.rows) ? audit.rows : [];
  const rowResults = rows.map((row) => ({
    ...evaluateCoverageRow(row, knownRequirementIds),
    requirementText: row.requirement_text,
    sourceSectionId: row.source_section_id || null,
    coverageArea: row.coverage_area || null,
  }));
  const missingRequirementIds = requirements
    .filter((requirement) => !rows.some((row) => row.requirement_id === requirement.id))
    .map((requirement) => requirement.id);
  const missingRequirementExceptions = missingRequirementIds.map((requirementId) => coverageBlockingException(
    {
      row_id: `missing-${requirementId}`,
      requirement_id: requirementId,
      source_section_id: requirements.find((requirement) => requirement.id === requirementId)?.source_section_id || null,
      coverage_area: requirements.find((requirement) => requirement.id === requirementId)?.coverage_area || null,
    },
    {
      code: 'missing_coverage_row',
      detail: 'Every committed requirement must have a Contract Coverage Audit row.',
    },
  ));
  const blockingExceptions = [
    ...rowResults.flatMap((result) => result.covered ? [] : (
      (result.reasons.length ? result.reasons : [{ code: 'implementation_incomplete' }])
        .map((reason) => coverageBlockingException(rows.find((row) => row.row_id === result.row_id) || result, reason))
    )),
    ...missingRequirementExceptions,
  ];
  const neutralExceptionCount = rowResults.filter((result) => result.neutral_exception).length;
  const coveredCount = rowResults.filter((result) => result.outcome === 'covered').length;
  const canClose = blockingExceptions.length === 0;
  const firstPass = priorValidations.length === 0;
  const fullCoverageWithoutExceptions = canClose && neutralExceptionCount === 0 && coveredCount === requirements.length;
  const autonomyOutcome = blockingExceptions.length
    ? 'negative'
    : fullCoverageWithoutExceptions && firstPass
      ? 'positive'
      : neutralExceptionCount > 0
        ? 'neutral'
        : 'positive';

  return {
    policy_version: CONTRACT_COVERAGE_AUDIT_POLICY_VERSION,
    status: canClose ? 'closed' : 'implementation_incomplete',
    gate_closed: canClose,
    can_start_qa_verification: canClose,
    blocks_operator_closeout: !canClose,
    contract_version: Number(contract.version) || null,
    implementation_attempt: Number(implementationAttempt) || 0,
    required_row_count: requirements.length,
    covered_row_count: coveredCount,
    neutral_exception_count: neutralExceptionCount,
    rejected_row_count: rowResults.filter((result) => !result.covered).length + missingRequirementIds.length,
    row_results: rowResults,
    blocking_exceptions: blockingExceptions,
    autonomy_confidence_signal: {
      outcome: autonomyOutcome,
      first_pass_full_coverage: Boolean(fullCoverageWithoutExceptions && firstPass),
      neutral_exceptions: neutralExceptionCount,
      implementation_incomplete_count: blockingExceptions.length,
      reason: blockingExceptions.length
        ? 'Committed-requirement implementation_incomplete coverage is a negative autonomy-confidence signal.'
        : neutralExceptionCount > 0
          ? 'Approved not-applicable or scope exceptions are neutral autonomy-confidence signals.'
          : 'First-pass full committed-requirement coverage is a positive autonomy-confidence signal.',
    },
    summary: canClose
      ? 'All committed requirements are covered or explicitly excepted with approved rationale.'
      : 'One or more committed requirements are uncovered, partially covered, manually evidenced only, or missing required evidence.',
  };
}

function latestVerificationReportPath(history = []) {
  const event = history.find((candidate) => candidate?.event_type === 'task.execution_contract_verification_report_generated') || null;
  return event?.payload?.verification_report?.path || null;
}

function renderContractCoverageMarkdown({ audit = {}, validation = {}, contract = {}, reportPath = null }) {
  const lines = [
    '## Contract Coverage Audit',
    '',
    `Policy: ${CONTRACT_COVERAGE_AUDIT_POLICY_VERSION}`,
    `Execution Contract Version: v${contract.version || audit.contract_version || '?'}`,
    `Implementation Attempt: ${audit.implementation_attempt || validation.implementation_attempt || 0}`,
    `Gate Status: ${validation.status || 'submitted'}`,
    reportPath ? `Verification Report Path: ${reportPath}` : null,
    '',
    '| Requirement | Coverage Area | Status | Implementation Evidence | Verification Evidence | Rationale |',
    '| --- | --- | --- | --- | --- | --- |',
  ].filter(Boolean);
  for (const row of audit.rows || []) {
    const result = validation.row_results?.find((item) => item.row_id === row.row_id);
    const implementationEvidence = (row.implementation_evidence || []).map((item) => item.label).join('<br>') || 'None';
    const verificationEvidence = (row.verification_evidence || []).map((item) => item.label).join('<br>') || 'None';
    lines.push([
      `${row.requirement_id}: ${row.requirement_text}`,
      row.coverage_area,
      result?.outcome || row.status,
      implementationEvidence,
      verificationEvidence,
      row.exception_rationale || '',
    ].map((value) => String(value || '').replace(/\|/g, '\\|')).join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }
  if (validation.blocking_exceptions?.length) {
    lines.push('');
    lines.push('### Blocking Exceptions');
    lines.push('');
    for (const exception of validation.blocking_exceptions) {
      lines.push(`- ${exception.exception_type}: ${exception.requirement_id} - ${exception.detail}`);
    }
  }
  return lines.join('\n');
}

function createContractCoverageAudit({
  taskId,
  contract = {},
  implementationAttempt = 0,
  previousAudit = null,
  body = {},
  actorId = null,
  submittedAt = new Date().toISOString(),
} = {}) {
  const requirements = contractCoverageRequirements(contract);
  const auditVersion = Number(previousAudit?.latest?.audit_version || previousAudit?.audit_version || 0) + 1;
  const rows = normalizeCoverageRows(body.rows ?? body.coverageRows ?? body.coverage_rows, requirements, {
    contractVersion: contract.version,
    implementationAttempt,
    actorId,
    submittedAt,
  });
  const audit = {
    policy_version: CONTRACT_COVERAGE_AUDIT_POLICY_VERSION,
    audit_id: `CCA-${taskId}-v${contract.version}-i${implementationAttempt}-a${auditVersion}`,
    task_id: taskId,
    contract_id: contract.contract_id || null,
    contract_version: Number(contract.version) || null,
    implementation_attempt: Number(implementationAttempt) || 0,
    audit_version: auditVersion,
    status: 'submitted',
    submitted_at: submittedAt,
    submitted_by: actorId,
    tier_scaling: {
      template_tier: normalizeTemplateTier(contract.template_tier || contract.templateTier || contract.tier, 'Standard'),
      row_generation: normalizeTemplateTier(contract.template_tier || contract.templateTier || contract.tier, 'Standard') === 'Simple'
        ? 'Simple checklist against committed acceptance criteria.'
        : STANDARD_OR_ABOVE_TIERS.includes(normalizeTemplateTier(contract.template_tier || contract.templateTier || contract.tier, 'Standard'))
          ? 'Full committed-requirement matrix with section coverage for the approved contract tier.'
          : 'Committed-requirement matrix.',
      deferred_considerations_excluded: true,
    },
    required_requirements: requirements,
    rows,
  };
  return {
    audit,
    readiness: evaluateContractCoverageAudit({ contract, audit, implementationAttempt }),
  };
}

function validateContractCoverageAudit({
  audit = {},
  contract = {},
  history = [],
  body = {},
  actorId = null,
  validatedAt = new Date().toISOString(),
} = {}) {
  const requirements = contractCoverageRequirements(contract);
  const rows = body.rows || body.coverageRows || body.coverage_rows
    ? normalizeCoverageRows(body.rows ?? body.coverageRows ?? body.coverage_rows, requirements, {
      contractVersion: contract.version,
      implementationAttempt: audit.implementation_attempt,
      actorId: audit.submitted_by,
      submittedAt: audit.submitted_at,
    })
    : audit.rows || [];
  const validationEvents = history.filter((event) => event?.event_type === 'task.contract_coverage_audit_validated');
  const validation = evaluateContractCoverageAudit({
    contract,
    audit: { ...audit, rows },
    implementationAttempt: audit.implementation_attempt,
    priorValidations: validationEvents,
  });
  const reportPath = latestVerificationReportPath(history)
    || `docs/reports/${taskIdSafe(contract.task_id || audit.task_id)}-contract-coverage-audit-verification.md`;
  const markdown = {
    path: reportPath,
    anchor: 'contract-coverage-audit',
    content: renderContractCoverageMarkdown({
      audit: { ...audit, rows },
      validation,
      contract,
      reportPath,
    }),
  };
  return {
    audit: {
      ...audit,
      rows,
      status: validation.status,
      validated_at: validatedAt,
      validated_by: actorId,
    },
    validation: {
      ...validation,
      validated_at: validatedAt,
      validated_by: actorId,
      markdown,
    },
  };
}

function taskIdSafe(value) {
  return slugifyArtifactTitle(value, 'task');
}

function deriveContractCoverageAuditProjection(history = [], contract = null) {
  const contractProjection = contract ? null : deriveExecutionContractProjection(history);
  const latestContract = contract || contractProjection?.latest || null;
  const submissions = history
    .filter((event) => event?.event_type === 'task.contract_coverage_audit_submitted')
    .sort((a, b) => Number(b.sequence_number || 0) - Number(a.sequence_number || 0));
  const validations = history
    .filter((event) => event?.event_type === 'task.contract_coverage_audit_validated')
    .sort((a, b) => Number(b.sequence_number || 0) - Number(a.sequence_number || 0));
  const latestSubmission = submissions[0] || null;
  const latestAudit = latestSubmission?.payload?.coverage_audit || null;
  if (!latestAudit) {
    return {
      active: false,
      latest: null,
      validation: null,
      audits: [],
      readiness: latestContract ? evaluateContractCoverageAudit({
        contract: latestContract,
        audit: { rows: [], implementation_attempt: 0 },
      }) : null,
    };
  }
  const latestValidationEvent = validations.find((event) => event?.payload?.audit_id === latestAudit.audit_id) || null;
  const latestValidation = latestValidationEvent?.payload?.validation || null;
  return {
    active: true,
    latest: {
      ...latestAudit,
      status: latestValidation?.status || latestAudit.status,
      submittedAt: latestSubmission.occurred_at || latestAudit.submitted_at || null,
      submittedBy: latestSubmission.actor_id || latestAudit.submitted_by || null,
      validatedAt: latestValidationEvent?.occurred_at || latestValidation?.validated_at || null,
      validatedBy: latestValidationEvent?.actor_id || latestValidation?.validated_by || null,
    },
    validation: latestValidation,
    audits: submissions.map((event) => {
      const audit = event.payload?.coverage_audit || {};
      const validationEvent = validations.find((candidate) => candidate?.payload?.audit_id === audit.audit_id) || null;
      return {
        auditId: audit.audit_id || null,
        auditVersion: audit.audit_version || null,
        contractVersion: audit.contract_version || null,
        implementationAttempt: audit.implementation_attempt || 0,
        status: validationEvent?.payload?.validation?.status || audit.status || null,
        submittedAt: event.occurred_at || audit.submitted_at || null,
        validatedAt: validationEvent?.occurred_at || null,
      };
    }),
    readiness: latestValidation || (latestContract ? evaluateContractCoverageAudit({
      contract: latestContract,
      audit: latestAudit,
      implementationAttempt: latestAudit.implementation_attempt,
    }) : null),
  };
}

function evaluateExecutionContractDispatchReadiness({
  contract = null,
  verificationReport = null,
  proposedEngineerTier = null,
  proposedAssignee = null,
  failureContext = {},
} = {}) {
  if (!contract) {
    return {
      policy_version: VERIFICATION_REPORT_SKELETON_POLICY_VERSION,
      skeletonRequired: false,
      canDispatch: true,
      missingRequiredArtifacts: [],
      riskFlags: [],
      blockedReasons: [],
      dispatchPolicy: evaluateExecutionContractDispatchPolicy(),
      reason: 'No Execution Contract is present.',
    };
  }
  const skeletonRequired = verificationReportSkeletonRequired(contract);
  const hasSkeleton = Boolean(verificationReport?.path || verificationReport?.content || verificationReport?.report_id);
  const dispatchPolicy = evaluateExecutionContractDispatchPolicy({
    contract,
    verificationReport,
    proposedEngineerTier,
    proposedAssignee,
    failureContext,
  });
  const missingRequiredArtifacts = skeletonRequired && !hasSkeleton ? ['verification_report_skeleton'] : [];
  const blockedReasons = [
    ...missingRequiredArtifacts.map((artifact) => ({
      source: 'artifact_gate',
      code: artifact,
      detail: 'Implementation dispatch is blocked until the verification report skeleton exists for the approved Execution Contract.',
    })),
    ...dispatchPolicy.blockingReasons,
  ];
  return {
    policy_version: VERIFICATION_REPORT_SKELETON_POLICY_VERSION,
    skeletonRequired,
    canDispatch: (!skeletonRequired || hasSkeleton) && dispatchPolicy.canDispatch,
    missingRequiredArtifacts,
    riskFlags: contractRiskFlagIds(contract),
    blockedReasons,
    dispatchPolicy,
    reason: skeletonRequired
      ? 'Standard-or-risk-bearing Execution Contracts require a verification report skeleton before implementation dispatch.'
      : 'Simple Execution Contracts without risk flags may skip the verification report skeleton.',
  };
}

function createExecutionContractArtifactBundle({
  taskId,
  contract = {},
  history = [],
  body = {},
  actorId = null,
  approvalSummary = {},
  generatedAt = new Date().toISOString(),
}) {
  const identity = normalizeArtifactIdentity({ taskId, contract, body });
  const title = artifactTitle(contract, body);
  const slug = slugifyArtifactTitle(body.slug || body.artifactSlug || body.artifact_slug || title);
  const priorApprovedVersion = approvedContractVersions(history).filter((version) => version < Number(contract.version)).at(-1) || null;
  const amendment = priorApprovedVersion
    ? {
      strategy: 'versioned_story_path',
      previousApprovedVersion: priorApprovedVersion,
      reason: 'Approved generated stories are immutable for material changes.',
    }
    : null;
  const versionSuffix = amendment ? `-v${contract.version}` : '';
  const baseName = `${identity.display_id}-${slug}${versionSuffix}`;
  const storyPath = `docs/user-stories/${baseName}.md`;
  const decisionLogPath = `docs/refinement/${baseName}.md`;
  const sectionOwnerRoles = deriveSectionOwnerApprovalRoles(contract);
  const operatorApproval = artifactExceptionTriggers({ contract, history, approvalSummary, body });
  const requiredRoles = [...new Set([
    'pm',
    ...sectionOwnerRoles,
    ...(operatorApproval.operator_approval_required ? ['operator'] : []),
  ])];
  const approvals = normalizeArtifactApprovals(body.artifactApprovals || body.artifact_approvals || body.approvals, requiredRoles);
  const bundleApprovalSummary = evaluateArtifactBundleApprovalReadiness(requiredRoles, approvals, operatorApproval);
  const githubIssueRequested = normalizeBoolean(body.createGithubIssue ?? body.create_github_issue ?? body.githubIssueRequested ?? body.github_issue_requested, false);
  const bundleId = `ART-${identity.display_id}-v${contract.version}`;
  const approvalRouting = {
    policy_version: ARTIFACT_BUNDLE_APPROVAL_POLICY_VERSION,
    required_roles: requiredRoles,
    section_owner_roles: sectionOwnerRoles,
    pm_approval_required: true,
    operator_approval_required: operatorApproval.operator_approval_required,
    operator_approval_reasons: operatorApproval.reasons,
  };
  const userStory = renderArtifactUserStory({ contract, displayId: identity.display_id, title, amendment });
  const decisionLog = renderRefinementDecisionLog({
    contract,
    displayId: identity.display_id,
    title,
    bundleId,
    approvalRouting,
    operatorApproval,
    amendment,
  });

  return {
    policy_version: ARTIFACT_BUNDLE_POLICY_VERSION,
    bundle_id: bundleId,
    task_id: taskId,
    source_task_id: taskId,
    display_id: identity.display_id,
    identity,
    environment: identity.environment,
    slug,
    title,
    contract_id: contract.contract_id || null,
    contract_version: Number(contract.version) || null,
    status: bundleApprovalSummary.canCommit ? 'approved_for_commit' : 'pending_approval',
    generated_at: generatedAt,
    generated_by: actorId,
    amendment,
    generated_artifacts: {
      user_story: {
        type: 'generated_markdown_user_story',
        path: storyPath,
        content: userStory,
        immutable_after_approval: true,
      },
      refinement_decision_log: {
        type: 'refinement_decision_log',
        path: decisionLogPath,
        content: decisionLog,
        immutable_after_approval: true,
      },
    },
    links: [
      { rel: 'generated_user_story', label: 'Generated user story', path: storyPath },
      { rel: 'refinement_decision_log', label: 'Refinement Decision Log', path: decisionLogPath },
    ],
    pr_guidance: {
      title: `[${identity.display_id}] ${title}`,
      required_links: [
        { label: 'Task', target: identity.display_id },
        { label: 'Generated user story', target: storyPath },
        { label: 'Refinement Decision Log', target: decisionLogPath },
        { label: 'Evidence report', target: `docs/reports/${identity.display_id}-${slug}-verification.md` },
      ],
      body_template: [
        `Task: ${identity.display_id}`,
        `Generated user story: ${storyPath}`,
        `Refinement Decision Log: ${decisionLogPath}`,
        `Evidence report: docs/reports/${identity.display_id}-${slug}-verification.md`,
      ].join('\n'),
    },
    approval_routing: approvalRouting,
    approvals,
    approval_summary: bundleApprovalSummary,
    commit_policy: {
      requires_reviewable_bundle_before_commit: true,
      requires_pm_approval_before_commit: true,
      commit_allowed: bundleApprovalSummary.canCommit && identity.valid_for_committed_repo,
      blocked_reasons: [
        ...bundleApprovalSummary.missingRequiredApprovals.map((approval) => `missing_${approval.role}_approval`),
        ...(identity.valid_for_committed_repo ? [] : ['invalid_artifact_display_id']),
      ],
      github_issue_creation: {
        default_off: true,
        requested: githubIssueRequested,
        will_create_issue: githubIssueRequested,
        note: githubIssueRequested
          ? 'GitHub-native tracking was explicitly requested for this artifact bundle.'
          : 'GitHub issues are optional and are not created by default.',
      },
    },
  };
}

function approveExecutionContractArtifactBundle({ bundle = {}, body = {}, actorId = null, approvedAt = new Date().toISOString() }) {
  const requiredRoles = bundle.approval_routing?.required_roles || bundle.approval_summary?.requiredRoles || ['pm'];
  const incomingApprovals = normalizeArtifactApprovals(body.artifactApprovals || body.artifact_approvals || body.approvals, []);
  const approvals = {
    ...(bundle.approvals || {}),
    ...incomingApprovals,
  };
  const operatorApproval = {
    operator_approval_required: bundle.approval_routing?.operator_approval_required || false,
    reasons: bundle.approval_routing?.operator_approval_reasons || [],
  };
  const approvalSummary = evaluateArtifactBundleApprovalReadiness(requiredRoles, approvals, operatorApproval);
  return {
    ...bundle,
    status: approvalSummary.canCommit ? 'approved_for_commit' : 'pending_approval',
    approved_at: approvalSummary.canCommit ? approvedAt : null,
    approved_by: approvalSummary.canCommit ? actorId : null,
    approvals,
    approval_summary: approvalSummary,
    commit_policy: {
      ...(bundle.commit_policy || {}),
      commit_allowed: approvalSummary.canCommit && bundle.identity?.valid_for_committed_repo !== false,
      approved_at: approvalSummary.canCommit ? approvedAt : null,
      approved_by: approvalSummary.canCommit ? actorId : null,
      blocked_reasons: [
        ...approvalSummary.missingRequiredApprovals.map((approval) => `missing_${approval.role}_approval`),
        ...(bundle.identity?.valid_for_committed_repo === false ? ['invalid_artifact_display_id'] : []),
      ],
    },
  };
}

function deriveExecutionContractProjection(history = []) {
  const versionEvents = history
    .filter((event) => event?.event_type === 'task.execution_contract_version_recorded')
    .sort((a, b) => Number(b.sequence_number || 0) - Number(a.sequence_number || 0));
  const latestEvent = versionEvents[0] || null;
  const latestContract = extractContractFromVersionEvent(latestEvent);
  if (!latestContract) {
    return {
      active: false,
      latest: null,
      latestVersion: null,
      versions: [],
      validation: null,
      approval: null,
      markdown: null,
      artifacts: null,
      verificationReport: null,
      contractCoverageAudit: null,
      dispatchReadiness: evaluateExecutionContractDispatchReadiness(),
    };
  }
  const validationEvent = history.find((event) => (
    event?.event_type === 'task.execution_contract_validated'
    && Number(event?.payload?.version) === Number(latestContract.version)
  )) || null;
  const markdownEvent = history.find((event) => (
    event?.event_type === 'task.execution_contract_markdown_generated'
    && Number(event?.payload?.version) === Number(latestContract.version)
  )) || null;
  const approvalEvent = history.find((event) => (
    event?.event_type === 'task.execution_contract_approved'
    && Number(event?.payload?.version) === Number(latestContract.version)
  )) || null;
  const artifactBundleEvent = history.find((event) => (
    event?.event_type === 'task.execution_contract_artifact_bundle_generated'
    && Number(event?.payload?.version) === Number(latestContract.version)
  )) || null;
  const verificationReportEvent = history.find((event) => (
    event?.event_type === 'task.execution_contract_verification_report_generated'
    && Number(event?.payload?.version) === Number(latestContract.version)
  )) || null;
  const artifactBundle = artifactBundleEvent?.payload?.artifact_bundle || null;
  const artifactApprovalEvent = artifactBundle ? history.find((event) => (
    event?.event_type === 'task.execution_contract_artifact_bundle_approved'
    && event?.payload?.bundle_id === artifactBundle.bundle_id
  )) || null : null;
  const approvedArtifactBundle = artifactApprovalEvent?.payload?.artifact_bundle || null;
  const artifacts = artifactBundle ? {
    ...(approvedArtifactBundle || artifactBundle),
    generatedAt: artifactBundleEvent?.occurred_at || artifactBundle.generated_at || null,
    generatedBy: artifactBundleEvent?.actor_id || artifactBundle.generated_by || null,
    approvedAt: artifactApprovalEvent?.occurred_at || approvedArtifactBundle?.approved_at || null,
    approvedBy: artifactApprovalEvent?.actor_id || approvedArtifactBundle?.approved_by || null,
    status: approvedArtifactBundle?.status || artifactBundle.status || 'pending_approval',
  } : null;
  const verificationReport = verificationReportEvent?.payload?.verification_report || null;
  const validation = validationEvent?.payload?.validation || latestContract.validation || validateExecutionContract(latestContract);
  const approvedScope = approvalEvent?.payload?.committed_scope || null;
  const autoApproval = approvalEvent?.payload?.auto_approval || null;
  const approvalMode = approvalEvent?.payload?.approval_mode || (autoApproval?.approved_by_policy ? 'policy' : approvalEvent ? 'explicit' : null);
  const latest = {
    ...latestContract,
    status: approvalEvent ? 'approved' : latestContract.status,
    validation,
    approver: approvalEvent?.actor_id || latestContract.approver || null,
    approval_timestamp: approvalEvent?.occurred_at || latestContract.approval_timestamp || null,
    approved_by: approvalEvent?.actor_id || latestContract.approved_by || null,
    approved_at: approvalEvent?.occurred_at || latestContract.approved_at || null,
    committed_scope: approvedScope || latestContract.committed_scope,
    approval_summary: approvalEvent?.payload?.approval_summary || null,
    approval_mode: approvalMode,
    auto_approval: autoApproval,
    markdown_generated_at: markdownEvent?.occurred_at || null,
    artifact_bundle: artifacts,
    verification_report: verificationReport,
  };
  const contractCoverageAudit = deriveContractCoverageAuditProjection(history, latest);
  return {
    active: true,
    latest,
    latestVersion: latestContract.version,
    versions: versionEvents.map((event) => {
      const contract = extractContractFromVersionEvent(event) || {};
      const matchingApproval = history.find((candidate) => (
        candidate?.event_type === 'task.execution_contract_approved'
        && Number(candidate?.payload?.version) === Number(contract.version || event.payload?.version)
      )) || null;
      return {
        version: contract.version || event.payload?.version || null,
        templateTier: contract.template_tier || null,
        status: matchingApproval ? 'approved' : contract.status || null,
        materialHash: contract.material_hash || event.payload?.material_hash || null,
        materialChange: event.payload?.material_change !== false,
        recordedAt: event.occurred_at || null,
        recordedBy: event.actor_id || null,
        approvedAt: matchingApproval?.occurred_at || null,
        approvedBy: matchingApproval?.actor_id || null,
        summary: contract.material_change_summary || event.payload?.material_change_summary || null,
      };
    }),
    validation,
    approval: approvalEvent ? {
      version: approvalEvent.payload?.version || latestContract.version,
      approvedAt: approvalEvent.occurred_at || null,
      approvedBy: approvalEvent.actor_id || null,
      approvalMode,
      autoApproval,
      committedScope: approvedScope || latestContract.committed_scope || null,
      approvalSummary: approvalEvent.payload?.approval_summary || null,
    } : null,
    markdown: markdownEvent ? {
      version: markdownEvent.payload?.version || latestContract.version,
      generatedAt: markdownEvent.occurred_at || null,
      generatedBy: markdownEvent.actor_id || null,
      markdown: markdownEvent.payload?.markdown || '',
      authoritative: false,
    } : null,
    artifacts,
    verificationReport,
    contractCoverageAudit,
    dispatchReadiness: evaluateExecutionContractDispatchReadiness({
      contract: latest,
      verificationReport,
    }),
  };
}

function contractMarkdown(contract = {}) {
  const title = contract.sections?.['1']?.body
    ? `${contract.task_id} Execution Contract`
    : `${contract.task_id || 'Task'} Execution Contract`;
  const lines = [
    `# ${title}`,
    '',
    `Task: ${contract.task_id}`,
    `Execution Contract Version: v${contract.version}`,
    `Template Tier: ${contract.template_tier}`,
    `Authoritative Source: structured Task execution_contract data`,
    `Template Source: ${contract.template_source || EXECUTION_CONTRACT_TEMPLATE_SOURCE}`,
    '',
    '> This Markdown story is generated from structured contract data for review and repo artifacts. It is not the authoritative source.',
    '',
  ];
  const sections = contract.sections || {};
  for (const sectionId of orderedSectionIds(Object.keys(sections))) {
    const section = sections[sectionId];
    if (!sectionBodyIsComplete(section?.body)) continue;
    lines.push(`## ${sectionId}. ${section.title || sectionTitle(sectionId)}`);
    lines.push('');
    lines.push(section.body);
    lines.push('');
  }
  lines.push('---');
  lines.push('');
  lines.push('Generated from structured Execution Contract data.');
  return lines.join('\n');
}

module.exports = {
  EXECUTION_CONTRACT_APPROVED_ACTION,
  EXECUTION_CONTRACT_NEXT_ACTION,
  EXECUTION_CONTRACT_OWNER,
  EXECUTION_CONTRACT_REVIEW_ACTION,
  EXECUTION_CONTRACT_TEMPLATE_SOURCE,
  EXECUTION_CONTRACT_WAITING_STATE,
  ARTIFACT_BUNDLE_APPROVED_ACTION,
  ARTIFACT_BUNDLE_APPROVAL_POLICY_VERSION,
  ARTIFACT_BUNDLE_POLICY_VERSION,
  ARTIFACT_BUNDLE_REVIEW_ACTION,
  AUTO_APPROVAL_POLICY_VERSION,
  CONTRACT_COVERAGE_AUDIT_ACTION,
  CONTRACT_COVERAGE_AUDIT_CLOSED_ACTION,
  CONTRACT_COVERAGE_AUDIT_POLICY_VERSION,
  DISPATCH_POLICY_VERSION,
  VERIFICATION_REPORT_GENERATED_ACTION,
  VERIFICATION_REPORT_SKELETON_POLICY_VERSION,
  ENGINEER_TIERS,
  REQUIRED_SECTIONS_BY_TIER,
  TEMPLATE_TIERS,
  approveExecutionContractArtifactBundle,
  buildExecutionContractAutoApprovalRecord,
  contractMarkdown,
  contractCoverageRequirements,
  createContractCoverageAudit,
  createExecutionContractDraft,
  createExecutionContractArtifactBundle,
  createExecutionContractVerificationReportSkeleton,
  deriveContractCoverageAuditProjection,
  deriveExecutionContractProjection,
  engineerAssigneeForTier,
  engineerTierFromAssigneeId,
  evaluateExecutionContractDispatchReadiness,
  evaluateExecutionContractDispatchPolicy,
  evaluateExecutionContractAutoApprovalPolicy,
  evaluateExecutionContractApprovalReadiness,
  evaluateContractCoverageAudit,
  normalizeArtifactIdentity,
  normalizeAutoApprovalSignals,
  normalizeDispatchSignals,
  normalizeEngineerTier,
  renderContractCoverageMarkdown,
  validateContractCoverageAudit,
  isIntakeDraftSummary,
  normalizeReviewerRouting,
  normalizeRiskFlags,
  normalizeTemplateTier,
  validateExecutionContract,
};
