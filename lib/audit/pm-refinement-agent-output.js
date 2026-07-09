const {
  REQUIRED_SECTIONS_BY_TIER,
  TEMPLATE_TIERS,
  validateExecutionContract,
} = require('./execution-contracts');
const {
  buildExecutionContractSectionsFromIntake,
  parseOperatorIntakeForPmRefinement,
} = require('./pm-refinement-intake-parser');
const {
  defaultOperatorVerificationPathForIntake,
  intakeTextSuggestsUiUx,
} = require('./product-delivery-integrity');

const EXECUTION_CONTRACT_SECTION_TITLES = Object.freeze({
  1: 'User Story',
  2: 'Acceptance Criteria',
  3: 'Workflow & User Journey',
  4: 'Automated Test Deliverables',
  5: 'Data Model & Schema',
  6: 'Architecture & Integration',
  7: 'API Design',
  8: 'Security & Compliance',
  9: 'Dependencies & Integrations',
  10: 'UI/UX Requirements',
  11: 'Deployment & Release Strategy',
  12: 'Monitoring & Observability',
  13: 'Program Coordination',
  14: 'Cross-Team Alignment',
  15: 'Definition of Done',
  16: 'Production Validation Strategy',
  17: 'Compliance & Handoff',
});

const PLACEHOLDER_SECTION_VALUES = new Set(['tbd', 'todo', 'n/a', 'na', 'pending', '']);

function normalizeTemplateTier(value, fallback = 'Standard') {
  const tier = String(value || '').trim();
  return TEMPLATE_TIERS.includes(tier) ? tier : fallback;
}

function normalizeSectionBody(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean).join('\n');
  }
  if (value && typeof value === 'object') {
    if (typeof value.body === 'string') return value.body.trim();
    if (typeof value.text === 'string') return value.text.trim();
  }
  return String(value || '').trim();
}

function isUsableSectionBody(body) {
  const normalized = normalizeSectionBody(body);
  if (!normalized) return false;
  if (PLACEHOLDER_SECTION_VALUES.has(normalized.toLowerCase())) return false;
  return normalized.length >= 20;
}

function parsePmRefinementAgentOutput(delegation = {}) {
  const raw = String(delegation.message || delegation.output || '').trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function normalizeAgentSections(parsed = {}) {
  const source = parsed.sections && typeof parsed.sections === 'object' ? parsed.sections : parsed;
  const sections = {};

  for (const [key, value] of Object.entries(source)) {
    const sectionId = String(key).trim();
    if (!/^\d+$/.test(sectionId)) continue;
    const body = normalizeSectionBody(value);
    if (isUsableSectionBody(body)) sections[sectionId] = body;
  }

  if (Array.isArray(parsed.acceptanceCriteria || parsed.acceptance_criteria) && !sections['2']) {
    const body = normalizeSectionBody(parsed.acceptanceCriteria || parsed.acceptance_criteria);
    if (isUsableSectionBody(body)) sections['2'] = body;
  }
  if (Array.isArray(parsed.definitionOfDone || parsed.definition_of_done) && !sections['15']) {
    const body = normalizeSectionBody(parsed.definitionOfDone || parsed.definition_of_done);
    if (isUsableSectionBody(body)) sections['15'] = body;
  }
  if ((parsed.businessContext || parsed.business_context) && !sections['1']) {
    const businessContext = String(parsed.businessContext || parsed.business_context || '').trim();
    if (businessContext) {
      sections['1'] = [
        'As a Software Factory operator,',
        'I want this intake refined into an execution-ready contract,',
        'so that downstream reviewers can start section reviews without manual PM rewrite.',
        '',
        'Business Context & Success Metrics:',
        businessContext,
      ].join('\n');
    }
  }

  return sections;
}

function buildIntakeSectionFallback(sectionId, {
  taskId = '',
  title = '',
  parsed = {},
  intakeSections = {},
} = {}) {
  const displayTitle = String(title || taskId).trim() || taskId;
  const scope = intakeSections.scope?.body || '';
  const design = intakeSections.design?.body || '';
  const verification = intakeSections.verification?.body || '';

  switch (String(sectionId)) {
    case '3':
      return [
        '**User Journey**',
        `1. Operator opens task ${taskId} (${displayTitle}) from intake.`,
        '2. PM-refined contract sections are visible for reviewer routing.',
        '3. Reviewers record section contributions before operator approval.',
        '',
        '**System Flow**',
        'Intake Draft -> PM refinement -> Execution Contract draft -> reviewer section reviews -> operator approval.',
        '',
        '**Error & Edge Cases**',
        '- Missing PM agent JSON falls back to intake-derived section content.',
        '- Incomplete contracts remain blocked from reviewer routing.',
      ].join('\n');
    case '4':
      return [
        'Required automated evidence for this intake:',
        verification ? `- ${verification}` : '- Browser and API smoke for task detail and contract validation.',
        '- Unit coverage for PM refinement parser and contract merge logic.',
        '- Contract test for refinement/start response shape.',
      ].join('\n');
    case '6':
      return [
        `This change extends the existing Software Factory control plane for ${displayTitle}.`,
        design ? `Design direction: ${design}` : '',
        scope ? `Scope notes: ${scope}` : '',
        'No new external service boundary is introduced; work stays inside ET audit API, UI, and OpenClaw delegation.',
      ].filter(Boolean).join('\n');
    case '7':
      return [
        'API impact is limited to existing PM refinement and execution-contract routes.',
        'No new public HTTP contract is required beyond structured execution-contract persistence.',
        'Backwards compatibility: intake-only parser fallback remains available when agent JSON is absent.',
      ].join('\n');
    case '10':
      return design
        ? `UI/UX requirements from intake design direction:\n${design}`
        : `Preserve task-detail hierarchy and make PM-refined overview/context visible for ${displayTitle}.`;
    case '11':
      return [
        'Roll out behind existing OpenClaw PM refinement configuration in golden-path dev stack.',
        'Restart audit API after prompt/parser changes; rerun PM refinement on affected intake tasks.',
        'Rollback by reverting PM refinement agent-output wiring and re-running local intake parser path.',
      ].join('\n');
    case '12':
      return [
        'Monitor workflow audit events for task.refinement_started/completed/failed.',
        'Track specialist-delegation.jsonl for product-manager session evidence.',
        'Alert on refinement_failed or contracts stuck in invalid validation after PM refinement completes.',
      ].join('\n');
    case '16':
      return verification
        ? `Production validation plan:\n${verification}`
        : 'Validate on golden-path stack: PM refinement completes, contract validation passes, reviewers can start section reviews.';
    case '17':
      return [
        `Operator handoff for ${displayTitle}: review PM-authored contract draft, confirm reviewer routing, then approve when gates pass.`,
        `Task reference: ${taskId}.`,
        'Deferred product scope stays out of committed requirements until promoted through a new approved contract version.',
      ].join('\n');
    default:
      return '';
  }
}

function deriveOverviewFromSections(sections = {}, parsed = {}) {
  const section1 = sections['1'] || sections[1] || '';
  const section2 = sections['2'] || sections[2] || '';
  const section15 = sections['15'] || sections[15] || '';
  const businessContext = parsed.businessContext
    || parsed.business_context
    || (section1 ? String(section1).split('Business Context & Success Metrics:').pop().trim() : null)
    || section1
    || null;

  const acceptanceCriteria = parsed.acceptanceCriteria?.length
    ? parsed.acceptanceCriteria
    : (parsed.acceptance_criteria?.length ? parsed.acceptance_criteria : (
      section2
        ? section2.split(/\r?\n/).map((line) => line.replace(/^\s*[-*•]\s+/, '').trim()).filter(Boolean)
        : []
    ));

  const definitionOfDone = parsed.definitionOfDone?.length
    ? parsed.definitionOfDone
    : (parsed.definition_of_done?.length ? parsed.definition_of_done : (
      section15
        ? section15.split(/\r?\n/).map((line) => line.replace(/^\s*[-*•]\s+/, '').trim()).filter(Boolean)
        : []
    ));

  return {
    businessContext: businessContext || null,
    acceptanceCriteria,
    definitionOfDone,
  };
}

function buildPmRefinementPrompt({
  taskId,
  summary = {},
  templateTier = 'Standard',
} = {}) {
  const tier = normalizeTemplateTier(templateTier);
  const requiredSections = REQUIRED_SECTIONS_BY_TIER[tier] || REQUIRED_SECTIONS_BY_TIER.Standard;
  const sectionGuidance = requiredSections.map((sectionId) => {
    const title = EXECUTION_CONTRACT_SECTION_TITLES[sectionId] || `Section ${sectionId}`;
    return `- "${sectionId}" (${title})`;
  }).join('\n');

  return [
    `You are the Product Manager agent for ${taskId}.`,
    'Refine the operator Intake Draft into a first draft Execution Contract.',
    'Return ONLY valid JSON (no markdown fences, no prose outside JSON).',
    'Populate every required section with substantive PM draft content derived from the intake.',
    'Do not use TBD, TODO, or empty placeholders.',
    '',
    `Template tier: ${tier}`,
    'Required sections:',
    sectionGuidance,
    '',
    'JSON shape:',
    '{',
    `  "templateTier": "${tier}",`,
    '  "sections": {',
    '    "1": "User story with Business Context & Success Metrics",',
    '    "2": "Given-When-Then acceptance criteria",',
    '    "...": "one string body per required section id"',
    '  },',
    '  "businessContext": "optional summary string",',
    '  "acceptanceCriteria": ["optional array"],',
    '  "definitionOfDone": ["optional array"],',
    '  "riskFlags": ["optional risk flag ids such as human_workflow, deployment"]',
    '}',
    '',
    `Title: ${summary.title || taskId}`,
    'Operator intake requirements:',
    summary.operator_intake_requirements || 'No raw operator intake was available.',
    ...(intakeTextSuggestsUiUx(summary.operator_intake_requirements || '') ? [
      '',
      'Operator verification path (required for ui_ux work):',
      JSON.stringify(defaultOperatorVerificationPathForIntake(), null, 2),
      'Include dispatchSignals.workCategory = "ui_ux" and operatorVerificationPath when the intake affects visible UI.',
    ] : []),
  ].join('\n');
}

function buildPmRefinementContractDraft({
  taskId = '',
  title = '',
  rawRequirements = '',
  templateTier = 'Standard',
  delegation = {},
} = {}) {
  const agentParsed = parsePmRefinementAgentOutput(delegation);
  const tier = normalizeTemplateTier(
    agentParsed?.templateTier || agentParsed?.template_tier || templateTier,
    'Standard',
  );
  const requiredSections = REQUIRED_SECTIONS_BY_TIER[tier] || REQUIRED_SECTIONS_BY_TIER.Standard;
  const intakeDraft = buildExecutionContractSectionsFromIntake({
    taskId,
    title,
    rawRequirements,
    templateTier: tier,
  });
  const intakeParsed = parseOperatorIntakeForPmRefinement(rawRequirements);
  const intakeSections = Object.fromEntries(
    (intakeParsed.sections || []).map((section) => [section.heading, section]),
  );
  const agentSections = agentParsed ? normalizeAgentSections(agentParsed) : {};
  const sections = {};

  for (const sectionId of requiredSections) {
    const agentBody = agentSections[sectionId];
    const intakeBody = intakeDraft.sections[sectionId] || intakeDraft.sections[Number(sectionId)];
    const fallbackBody = buildIntakeSectionFallback(sectionId, {
      taskId,
      title,
      parsed: intakeParsed,
      intakeSections,
    });
    const body = agentBody || intakeBody || fallbackBody;
    if (isUsableSectionBody(body)) sections[sectionId] = body;
  }

  const overview = deriveOverviewFromSections(sections, {
    ...agentParsed,
    businessContext: agentParsed?.businessContext || agentParsed?.business_context || intakeParsed.businessContext,
    acceptanceCriteria: agentParsed?.acceptanceCriteria || agentParsed?.acceptance_criteria || intakeParsed.acceptanceCriteria,
    definitionOfDone: agentParsed?.definitionOfDone || agentParsed?.definition_of_done || intakeParsed.definitionOfDone,
  });

  const riskFlags = Array.isArray(agentParsed?.riskFlags || agentParsed?.risk_flags)
    ? (agentParsed.riskFlags || agentParsed.risk_flags).map((flag) => String(flag || '').trim()).filter(Boolean)
    : [];

  const validation = validateExecutionContract({
    template_tier: tier,
    owner: 'pm',
    required_sections: requiredSections,
    sections: Object.fromEntries(
      Object.entries(sections).map(([id, body]) => [id, { id, body }]),
    ),
  });

  return {
    templateTier: tier,
    sections,
    parsed: overview,
    riskFlags,
    agentParsed: !!agentParsed,
    agentSectionCount: Object.keys(agentSections).length,
    validation,
  };
}

module.exports = {
  EXECUTION_CONTRACT_SECTION_TITLES,
  buildPmRefinementContractDraft,
  buildPmRefinementPrompt,
  normalizeAgentSections,
  parsePmRefinementAgentOutput,
};