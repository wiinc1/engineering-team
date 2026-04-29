const test = require('node:test');
const assert = require('node:assert/strict');
const {
  REQUIRED_SECTIONS_BY_TIER,
  contractMarkdown,
  createExecutionContractDraft,
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
      sections: sectionBodiesFor('Complex', ' material update'),
    },
  });
  assert.equal(updated.materialChange, true);
  assert.equal(updated.previousVersion, 1);
  assert.equal(updated.contract.version, 2);
  assert.equal(updated.contract.validation.status, 'valid');
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
