function normalizeHeading(line = '') {
  return String(line || '')
    .replace(/^#+\s*/, '')
    .replace(/\*\*/g, '')
    .trim()
    .toLowerCase();
}

function splitMarkdownSections(rawRequirements = '') {
  const text = String(rawRequirements || '').trim();
  if (!text) return [];

  const lines = text.split(/\r?\n/);
  const sections = [];
  let current = null;

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,3}\s+(.+)$/);
    if (headingMatch) {
      if (current) sections.push(current);
      current = {
        heading: normalizeHeading(headingMatch[1]),
        lines: [],
      };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) sections.push(current);

  return sections.map((section) => ({
    heading: section.heading,
    body: section.lines.join('\n').trim(),
  })).filter((section) => section.body);
}

function findSection(sections, matchers = []) {
  const normalizedMatchers = matchers.map((value) => String(value).trim().toLowerCase());
  return sections.find((section) => normalizedMatchers.some((matcher) => (
    section.heading === matcher
    || section.heading.includes(matcher)
    || matcher.includes(section.heading)
  ))) || null;
}

function linesToList(body = '') {
  return String(body || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*•]\s+/, '').replace(/^\s*\d+\.\s+/, '').trim())
    .filter(Boolean);
}

function parseOperatorIntakeForPmRefinement(rawRequirements = '') {
  const sections = splitMarkdownSections(rawRequirements);
  const summary = findSection(sections, ['summary', 'business context', 'problem statement']);
  const scope = findSection(sections, ['scope', 'in scope']);
  const design = findSection(sections, ['design direction', 'target ui', 'design']);
  const acceptance = findSection(sections, ['acceptance criteria', 'acceptance criterion']);
  const definition = findSection(sections, ['definition of done', 'done criteria', 'completion criteria']);
  const verification = findSection(sections, ['suggested verification', 'verification', 'test plan']);

  const businessParts = [summary, design, scope]
    .filter(Boolean)
    .map((section) => section.body);
  const businessContext = businessParts.join('\n\n').trim()
    || String(rawRequirements || '').trim()
    || null;

  const acceptanceCriteria = acceptance
    ? linesToList(acceptance.body)
    : [];
  const definitionOfDone = definition
    ? linesToList(definition.body)
    : (verification ? linesToList(verification.body) : []);

  return {
    businessContext,
    acceptanceCriteria,
    definitionOfDone,
    sections,
  };
}

function buildExecutionContractSectionsFromIntake({
  taskId = '',
  title = '',
  rawRequirements = '',
  templateTier = 'Standard',
} = {}) {
  const parsed = parseOperatorIntakeForPmRefinement(rawRequirements);
  const displayTitle = String(title || taskId).trim() || taskId;
  const section1Body = [
    'As a Software Factory operator,',
    `I want ${displayTitle} refined from the Intake Draft,`,
    'so that implementation waits until the execution contract is complete and approved.',
    '',
    'Business Context & Success Metrics:',
    parsed.businessContext || 'Raw operator intake was not available.',
  ].join('\n');

  return {
    parsed,
    sections: {
      1: section1Body,
      ...(parsed.acceptanceCriteria.length ? { 2: parsed.acceptanceCriteria.join('\n') } : {}),
      ...(parsed.definitionOfDone.length ? { 15: parsed.definitionOfDone.join('\n') } : {}),
    },
  };
}

function deriveIntakeOverviewFields({
  refinementCompleted = null,
  contract = null,
  rawRequirements = null,
} = {}) {
  const completedPayload = refinementCompleted?.payload || {};
  if (completedPayload.business_context) {
    return {
      business_context: completedPayload.business_context,
      acceptance_criteria: completedPayload.acceptance_criteria || null,
      definition_of_done: completedPayload.definition_of_done || null,
    };
  }

  const contractSections = contract?.sections || {};
  const section1 = contractSections['1']?.body || contractSections[1]?.body || null;
  const section2 = contractSections['2']?.body || contractSections[2]?.body || null;
  const section15 = contractSections['15']?.body || contractSections[15]?.body || null;

  if (section1 || section2 || section15) {
    const businessContext = section1
      ? String(section1).split('Business Context & Success Metrics:').pop().trim()
      : null;
    return {
      business_context: businessContext || section1 || null,
      acceptance_criteria: section2 ? linesToList(section2) : null,
      definition_of_done: section15 ? linesToList(section15) : null,
    };
  }

  if (rawRequirements) {
    const parsed = parseOperatorIntakeForPmRefinement(rawRequirements);
    return {
      business_context: parsed.businessContext,
      acceptance_criteria: parsed.acceptanceCriteria.length ? parsed.acceptanceCriteria : null,
      definition_of_done: parsed.definitionOfDone.length ? parsed.definitionOfDone : null,
    };
  }

  return {
    business_context: null,
    acceptance_criteria: null,
    definition_of_done: null,
  };
}

module.exports = {
  splitMarkdownSections,
  parseOperatorIntakeForPmRefinement,
  buildExecutionContractSectionsFromIntake,
  deriveIntakeOverviewFields,
};