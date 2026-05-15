const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  buildExecutionContractSectionReviewDraftBody,
  resolveExecutionContractReviewerRole,
  reviewRoleAllowedForActor,
} = require('../../lib/audit/execution-contract-refinement');
const {
  REQUIRED_SECTIONS_BY_TIER,
  createExecutionContractDraft,
} = require('../../lib/audit/execution-contracts');

function sectionBodiesFor(tier) {
  return Object.fromEntries(
    REQUIRED_SECTIONS_BY_TIER[tier].map((sectionId) => [
      sectionId,
      `Completed refinement section ${sectionId}.`,
    ])
  );
}

function standardContract() {
  return createExecutionContractDraft({
    taskId: 'TSK-152',
    summary: {
      task_id: 'TSK-152',
      title: 'Execution Contract refinement workflow',
      intake_draft: true,
      operator_intake_requirements: 'Route reviewer section contributions.',
    },
    history: [
      {
        event_type: 'task.created',
        event_id: 'evt-created',
        payload: { intake_draft: true, raw_requirements: 'Route reviewer section contributions.' },
      },
    ],
    actorId: 'pm-152',
    body: {
      templateTier: 'Standard',
      sections: sectionBodiesFor('Standard'),
      reviewers: {
        architect: { status: 'pending' },
        ux: { status: 'pending' },
        qa: { status: 'pending' },
      },
      scopeBoundaries: {
        committedRequirements: ['Review status must survive a reload.'],
        outOfScope: ['Implementation dispatch before approval.'],
      },
    },
  }).contract;
}

test('builds a section-review draft body that preserves contract scope and records approval', () => {
  const contract = standardContract();
  const { draftBody, review } = buildExecutionContractSectionReviewDraftBody({
    contract,
    sectionId: '6',
    actorId: 'architect-152',
    actorRoles: ['architect'],
    body: {
      status: 'accepted',
      comment: 'Architecture section is sufficient for implementation planning.',
      sectionPatch: {
        payloadJson: { integration_contract: 'audit-event backed reviewer state' },
        payloadSchemaVersion: 2,
      },
    },
  });

  assert.equal(review.role, 'architect');
  assert.equal(review.sectionId, '6');
  assert.equal(review.status, 'accepted');
  assert.equal(draftBody.reviewers.architect.status, 'approved');
  assert.equal(draftBody.reviewers.architect.actorId, 'architect-152');
  assert.equal(draftBody.sections['6'].approver, 'architect-152');
  assert.equal(draftBody.sections['6'].approvalStatus, 'approved');
  assert.deepEqual(draftBody.sections['6'].payloadJson, {
    integration_contract: 'audit-event backed reviewer state',
  });
  assert.deepEqual(draftBody.committedRequirements, ['Review status must survive a reload.']);
  assert.deepEqual(draftBody.outOfScope, ['Implementation dispatch before approval.']);
  assert.equal(draftBody.reviewFeedback.comments[0].source, 'execution_contract_section_review');
});

test('resolves reviewer role from actor roles and blocks reviewer spoofing', () => {
  assert.equal(resolveExecutionContractReviewerRole({ actorRoles: ['qa'] }), 'qa');
  assert.equal(
    resolveExecutionContractReviewerRole({ body: { reviewerRole: 'principal' }, actorRoles: ['pm'] }),
    'principalEngineer'
  );
  assert.equal(reviewRoleAllowedForActor(['qa'], 'qa'), true);
  assert.equal(reviewRoleAllowedForActor(['qa'], 'architect'), false);
  assert.equal(reviewRoleAllowedForActor(['pm'], 'architect'), true);
});

test('issue 152 required artifacts are present and wired to refinement evidence', () => {
  const requiredArtifacts = [
    'docs/api/execution-contract-refinement-openapi.yml',
    'docs/diagrams/workflow-execution-contract-refinement.mmd',
    'docs/diagrams/schema-execution-contract-refinement.mmd',
    'docs/diagrams/architecture-execution-contract-refinement.mmd',
    'docs/runbooks/execution-contract-refinement.md',
    'monitoring/dashboards/execution-contract-refinement.json',
    'monitoring/alerts/execution-contract-refinement.yml',
    'docs/reports/ISSUE-152_STANDARDS_COMPLIANCE_CHECKLIST.md',
  ];

  for (const artifactPath of requiredArtifacts) {
    const content = fs.readFileSync(path.join(__dirname, '../..', artifactPath), 'utf8');
    assert.match(content, /Execution Contract|execution-contract|execution_contract/i, artifactPath);
  }

  const dashboard = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, '../../monitoring/dashboards/execution-contract-refinement.json'),
      'utf8'
    )
  );
  assert.ok(
    dashboard.panels.some((panel) => panel.name === 'feature_execution_contract_section_reviews_total')
  );
});
