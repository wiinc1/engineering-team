const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseOperatorIntakeForPmRefinement,
  buildExecutionContractSectionsFromIntake,
  deriveIntakeOverviewFields,
} = require('../../lib/audit/pm-refinement-intake-parser');

test('parseOperatorIntakeForPmRefinement extracts summary, acceptance criteria, and verification fallback', () => {
  const raw = [
    '## **Summary**',
    'Redesign the desktop control plane.',
    '',
    '## **Acceptance Criteria**',
    '- Queue-first layout is visible on desktop.',
    '- Operator can act from the primary workspace.',
    '',
    '## **Suggested Verification**',
    '- Run browser smoke for task detail.',
  ].join('\n');

  const parsed = parseOperatorIntakeForPmRefinement(raw);
  assert.match(parsed.businessContext, /Redesign the desktop control plane/);
  assert.deepEqual(parsed.acceptanceCriteria, [
    'Queue-first layout is visible on desktop.',
    'Operator can act from the primary workspace.',
  ]);
  assert.deepEqual(parsed.definitionOfDone, [
    'Run browser smoke for task detail.',
  ]);
});

test('buildExecutionContractSectionsFromIntake maps parsed intake into contract sections', () => {
  const built = buildExecutionContractSectionsFromIntake({
    taskId: 'TSK-011',
    title: 'UI Update',
    rawRequirements: '## Summary\nUpdate overview.\n\n## Acceptance Criteria\n- AC one.',
  });
  assert.match(built.sections[1], /UI Update/);
  assert.match(built.sections[1], /Update overview/);
  assert.equal(built.sections[2], 'AC one.');
});

test('deriveIntakeOverviewFields prefers refinement_completed payload', () => {
  const overview = deriveIntakeOverviewFields({
    refinementCompleted: {
      payload: {
        business_context: 'Finalized business context.',
        acceptance_criteria: ['AC one'],
        definition_of_done: ['DoD one'],
      },
    },
  });
  assert.equal(overview.business_context, 'Finalized business context.');
  assert.deepEqual(overview.acceptance_criteria, ['AC one']);
  assert.deepEqual(overview.definition_of_done, ['DoD one']);
});