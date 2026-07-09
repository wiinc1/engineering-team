const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildPmRefinementContractDraft,
  buildPmRefinementPrompt,
  parsePmRefinementAgentOutput,
} = require('../../lib/audit/pm-refinement-agent-output');

test('buildPmRefinementPrompt requests structured JSON for all required sections', () => {
  const prompt = buildPmRefinementPrompt({
    taskId: 'TSK-011',
    summary: { title: 'UI Update', operator_intake_requirements: '## Summary\nUpdate desktop UI.' },
    templateTier: 'Standard',
  });
  assert.match(prompt, /Return ONLY valid JSON/);
  assert.match(prompt, /"3" \(Workflow & User Journey\)/);
  assert.match(prompt, /Do not use TBD/);
});

test('parsePmRefinementAgentOutput extracts JSON embedded in agent text', () => {
  const parsed = parsePmRefinementAgentOutput({
    message: 'PM draft ready.\n{"templateTier":"Standard","sections":{"2":"Given desktop loads When operator opens task Then overview is populated."}}',
  });
  assert.equal(parsed.templateTier, 'Standard');
  assert.match(parsed.sections['2'], /Given desktop loads/);
});

test('buildPmRefinementContractDraft prefers agent sections and fills remaining required sections', () => {
  const draft = buildPmRefinementContractDraft({
    taskId: 'TSK-011',
    title: 'UI Update',
    rawRequirements: [
      '## Summary',
      'Redesign the desktop control plane.',
      '',
      '## Acceptance Criteria',
      '- Queue-first layout is visible on desktop.',
      '',
      '## Suggested Verification',
      '- Run browser smoke for task detail.',
    ].join('\n'),
    delegation: {
      message: JSON.stringify({
        templateTier: 'Standard',
        sections: {
          1: 'As a Software Factory operator, I want UI Update, so that operators can review refined PM context. Business Context & Success Metrics: Redesign the desktop control plane.',
          2: 'Given desktop loads When operator opens TSK-011 Then queue-first layout and PM overview are visible.',
          3: 'User journey: operator opens task detail, reviews PM contract, and routes to architect review.',
          4: 'Add unit tests for parser merge logic and browser smoke for task detail overview.',
          6: 'Extend existing ET audit API and task-detail UI without new external integrations.',
          7: 'Reuse existing execution-contract and refinement routes; no new public API surface required.',
          10: 'Desktop queue-first hierarchy with visible PM overview and contract status.',
          11: 'Deploy through golden-path stack and verify PM refinement on intake tasks.',
          12: 'Monitor refinement events and specialist delegation artifacts for product-manager sessions.',
          15: 'Done when contract validation passes and reviewers can start section reviews.',
          16: 'Validate via golden-path browser smoke and contract validation status in task detail.',
          17: 'Operator reviews PM draft, confirms reviewer routing, then approves when gates pass.',
        },
        riskFlags: ['human_workflow'],
      }),
    },
  });

  assert.equal(draft.agentParsed, true);
  assert.equal(draft.validation.status, 'valid');
  assert.equal(Object.keys(draft.sections).length, 12);
  assert.match(draft.sections['1'], /UI Update/);
  assert.deepEqual(draft.riskFlags, ['human_workflow']);
  assert.equal(draft.parsed.businessContext, 'Redesign the desktop control plane.');
});

test('buildPmRefinementContractDraft falls back to intake-derived sections when agent output is missing', () => {
  const draft = buildPmRefinementContractDraft({
    taskId: 'TSK-012',
    title: 'OpenClaw PM smoke',
    rawRequirements: '## Summary\nValidate OpenClaw PM refinement.\n\n## Acceptance Criteria\n- PM refinement delegates to OpenClaw.',
    delegation: { message: 'Non-JSON PM notes only.' },
  });

  assert.equal(draft.agentParsed, false);
  assert.match(draft.sections['1'], /OpenClaw PM smoke/);
  assert.match(draft.sections['2'], /PM refinement delegates to OpenClaw/);
  assert.ok(Object.keys(draft.sections).length >= 3);
});