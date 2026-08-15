'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const {
  REQUIRED_BRANCHES,
  verifyLifecycleEquivalence,
} = require('../../lib/software-factory/langgraph/equivalence');

function read(relative) {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, '../..', relative), 'utf8'));
}

function inputs() {
  return {
    contract: read('config/langgraph-lifecycle-equivalence.v1.json'),
    manualInventory: read('observability/golden-path-manual-steps.json'),
    legacyEvidence: read('observability/golden-path-postgres-pilot.json'),
  };
}

test('lifecycle equivalence contract preserves every legacy step, persona, governance gate, release artifact, and branch', () => {
  const report = verifyLifecycleEquivalence(inputs());
  assert.deepEqual(report, {
    ok: true,
    failures: [],
    graphVersion: 'factory-v1',
    nodeCount: 14,
    goldenPathStepCount: 27,
    personaCount: 9,
    governanceGateCount: 10,
    releaseEvidenceCount: 11,
    branchCount: 7,
  });
});

test('lifecycle equivalence fails closed for lost, duplicated, unknown, or incomplete evidence', () => {
  const base = inputs();
  const contract = structuredClone(base.contract);
  contract.nodes.intake.pop();
  contract.nodes.qa.push('GP-015');
  contract.personas.qa = [];
  contract.governance.qa_approval = ['unknown_node'];
  delete contract.releaseEvidence.rollback_proof;
  contract.branches = REQUIRED_BRANCHES.filter((entry) => entry !== 'worker_restart');
  const legacyEvidence = { ...base.legacyEvidence, status: 'phase5_complete', stepsCompleted: ['GP-001'] };
  const report = verifyLifecycleEquivalence({ ...base, contract, legacyEvidence });
  assert.equal(report.ok, false);
  assert.deepEqual(report.failures, [
    'branch_inventory',
    'golden_path_duplicate_mapping',
    'golden_path_inventory',
    'legacy_golden_path_evidence',
    'legacy_lifecycle_incomplete',
    'persona_inventory',
    'release_evidence_inventory',
    'unknown_node_reference',
  ]);
});

test('lifecycle equivalence rejects version, node, and malformed inventory drift', () => {
  const base = inputs();
  const contract = structuredClone(base.contract);
  contract.schemaVersion = 'future';
  contract.graphVersion = 'factory-v2';
  delete contract.nodes.terminal;
  contract.personas.pm = 'pm_refinement';
  const report = verifyLifecycleEquivalence({
    contract,
    manualInventory: { steps: [{ id: null }] },
    legacyEvidence: base.legacyEvidence,
  });
  assert.equal(report.ok, false);
  for (const failure of [
    'contract_schema_version', 'graph_version', 'node_inventory', 'golden_path_inventory',
    'legacy_golden_path_evidence', 'persona_inventory', 'unknown_node_reference',
  ]) assert.ok(report.failures.includes(failure));
});
