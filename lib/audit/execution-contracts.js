const crypto = require('crypto');

const EXECUTION_CONTRACT_TEMPLATE_SOURCE = 'docs/templates/USER_STORY_TEMPLATE.md';
const EXECUTION_CONTRACT_OWNER = 'pm';
const EXECUTION_CONTRACT_WAITING_STATE = 'execution_contract_refinement';
const EXECUTION_CONTRACT_NEXT_ACTION = 'Complete Execution Contract required sections before operator review.';
const EXECUTION_CONTRACT_REVIEW_ACTION = 'Execution Contract is ready for operator review.';

const TEMPLATE_TIERS = Object.freeze(['Simple', 'Standard', 'Complex', 'Epic']);

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

function normalizeTemplateTier(value, fallback = null) {
  const normalized = String(value || '').trim().toLowerCase();
  return TEMPLATE_TIERS.find((tier) => tier.toLowerCase() === normalized) || fallback;
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

function normalizeSectionEntry(sectionId, value, requiredSections = []) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return {
      id: sectionId,
      title: normalizeSectionBody(value.title) || sectionTitle(sectionId),
      body: normalizeSectionBody(value.body ?? value.content ?? value.value),
      owner: normalizeSectionBody(value.owner) || EXECUTION_CONTRACT_OWNER,
      contributors: Array.isArray(value.contributors) ? value.contributors.map(String).filter(Boolean) : [],
      approvals: Array.isArray(value.approvals) ? value.approvals.map(String).filter(Boolean) : [],
      required: requiredSections.includes(sectionId),
    };
  }
  return {
    id: sectionId,
    title: sectionTitle(sectionId),
    body: normalizeSectionBody(value),
    owner: EXECUTION_CONTRACT_OWNER,
    contributors: [],
    approvals: [],
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

function normalizeReviewerRouting(body = {}, templateTier) {
  const reviewerInput = body.reviewers && typeof body.reviewers === 'object' && !Array.isArray(body.reviewers)
    ? body.reviewers
    : {};
  const standardOrAbove = ['Standard', 'Complex', 'Epic'].includes(templateTier);
  const complexOrAbove = ['Complex', 'Epic'].includes(templateTier);
  return {
    pm: {
      required: true,
      status: reviewerInput.pm?.status || 'owner',
      actorId: reviewerInput.pm?.actorId || null,
    },
    architect: {
      required: reviewerInput.architect?.required ?? standardOrAbove,
      status: reviewerInput.architect?.status || 'pending',
      actorId: reviewerInput.architect?.actorId || null,
    },
    ux: {
      required: reviewerInput.ux?.required ?? standardOrAbove,
      status: reviewerInput.ux?.status || 'pending',
      actorId: reviewerInput.ux?.actorId || null,
    },
    qa: {
      required: reviewerInput.qa?.required ?? standardOrAbove,
      status: reviewerInput.qa?.status || 'pending',
      actorId: reviewerInput.qa?.actorId || null,
    },
    sre: {
      required: reviewerInput.sre?.required ?? complexOrAbove,
      status: reviewerInput.sre?.status || 'pending',
      actorId: reviewerInput.sre?.actorId || null,
    },
    principalEngineer: {
      required: reviewerInput.principalEngineer?.required ?? false,
      status: reviewerInput.principalEngineer?.status || 'not_required',
      actorId: reviewerInput.principalEngineer?.actorId || null,
    },
  };
}

function sectionBodyIsComplete(body) {
  const normalized = normalizeSectionBody(body);
  if (!normalized) return false;
  return !PLACEHOLDER_SECTION_BODIES.has(normalized.toLowerCase());
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

function materialFingerprint(contract = {}) {
  const sections = contract.sections || {};
  const sectionFingerprint = Object.fromEntries(orderedSectionIds(Object.keys(sections)).map((sectionId) => [
    sectionId,
    {
      title: normalizeBodyForMaterialComparison(sections[sectionId]?.title),
      body: normalizeBodyForMaterialComparison(sections[sectionId]?.body),
    },
  ]));
  return JSON.stringify({
    template_tier: contract.template_tier,
    required_sections: contract.required_sections || [],
    sections: sectionFingerprint,
    reviewers: contract.reviewers || {},
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
  const candidate = {
    task_id: taskId,
    version: Math.max(1, versionSeed),
    status: 'draft',
    template_tier: templateTier,
    template_source: EXECUTION_CONTRACT_TEMPLATE_SOURCE,
    owner: EXECUTION_CONTRACT_OWNER,
    authoritative: true,
    generated_from: {
      intake_task_id: taskId,
      intake_event_id: createdEvent?.event_id || null,
      refinement_event_id: refinementRequestedEvent?.event_id || null,
      raw_requirements_hash: rawRequirements
        ? crypto.createHash('sha256').update(rawRequirements).digest('hex')
        : null,
    },
    required_sections: [...requiredSections],
    sections,
    reviewers: normalizeReviewerRouting(body, templateTier),
    material_change_summary: normalizeSectionBody(body.materialChangeSummary || body.material_change_summary)
      || (previousContract ? 'Execution Contract section update.' : 'Initial Execution Contract draft generated from Intake Draft.'),
    created_by: actorId || null,
  };
  const materialChange = isMaterialContractChange(previousContract, candidate);
  candidate.version = previousContract && materialChange ? Number(previousContract.version || 0) + 1 : versionSeed || 1;
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
      markdown: null,
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
  const validation = validationEvent?.payload?.validation || latestContract.validation || validateExecutionContract(latestContract);
  return {
    active: true,
    latest: {
      ...latestContract,
      validation,
      markdown_generated_at: markdownEvent?.occurred_at || null,
    },
    latestVersion: latestContract.version,
    versions: versionEvents.map((event) => {
      const contract = extractContractFromVersionEvent(event) || {};
      return {
        version: contract.version || event.payload?.version || null,
        templateTier: contract.template_tier || null,
        status: contract.status || null,
        materialHash: contract.material_hash || event.payload?.material_hash || null,
        materialChange: event.payload?.material_change !== false,
        recordedAt: event.occurred_at || null,
        recordedBy: event.actor_id || null,
        summary: contract.material_change_summary || event.payload?.material_change_summary || null,
      };
    }),
    validation,
    markdown: markdownEvent ? {
      version: markdownEvent.payload?.version || latestContract.version,
      generatedAt: markdownEvent.occurred_at || null,
      generatedBy: markdownEvent.actor_id || null,
      markdown: markdownEvent.payload?.markdown || '',
      authoritative: false,
    } : null,
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
  EXECUTION_CONTRACT_NEXT_ACTION,
  EXECUTION_CONTRACT_OWNER,
  EXECUTION_CONTRACT_REVIEW_ACTION,
  EXECUTION_CONTRACT_TEMPLATE_SOURCE,
  EXECUTION_CONTRACT_WAITING_STATE,
  REQUIRED_SECTIONS_BY_TIER,
  TEMPLATE_TIERS,
  contractMarkdown,
  createExecutionContractDraft,
  deriveExecutionContractProjection,
  isIntakeDraftSummary,
  normalizeTemplateTier,
  validateExecutionContract,
};
