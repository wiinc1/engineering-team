'use strict';

const { GRAPH_VERSION } = require('./constants');
const { LIFECYCLE_NODE_NAMES } = require('./lifecycle');

const REQUIRED_PERSONAS = Object.freeze([
  'pm', 'architect', 'engineer', 'engineer-jr', 'engineer-sr', 'engineer-principal', 'qa', 'sre', 'ux',
]);
const REQUIRED_GOVERNANCE = Object.freeze([
  'tenant_authorization', 'execution_contract_approval', 'architect_handoff', 'qa_approval',
  'pm_architect_close_review', 'merge_readiness', 'deployment_health', 'sre_approval',
  'human_closeout', 'release_evidence',
]);
const REQUIRED_RELEASE_EVIDENCE = Object.freeze([
  'issue_intake', 'execution_contract', 'implementation_commit', 'pull_request', 'qa_evidence',
  'merge_commit', 'ci_validation', 'deployment_proof', 'rollback_proof', 'monitoring_approval', 'closeout_report',
]);
const REQUIRED_BRANCHES = Object.freeze([
  'success', 'qa_fix_pass', 'qa_exhausted', 'retry_exhausted', 'policy_failure', 'cancelled', 'worker_restart',
]);

function strings(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.length > 0);
}

function missingKeys(record, required) {
  return required.filter((key) => !strings(record?.[key]) || record[key].length === 0);
}

function verifyLifecycleEquivalence({ contract, manualInventory, legacyEvidence }) {
  const failures = [];
  if (contract?.schemaVersion !== 'langgraph-lifecycle-equivalence.v1') failures.push('contract_schema_version');
  if (contract?.graphVersion !== GRAPH_VERSION) failures.push('graph_version');

  const expectedNodes = [...LIFECYCLE_NODE_NAMES].sort();
  const contractNodes = Object.keys(contract?.nodes || {}).sort();
  if (JSON.stringify(contractNodes) !== JSON.stringify(expectedNodes)) failures.push('node_inventory');

  const inventorySteps = (manualInventory?.steps || []).map((step) => step.id).sort();
  const mappedSteps = Object.values(contract?.nodes || {}).flat();
  const uniqueMappedSteps = [...new Set(mappedSteps)].sort();
  if (!strings(inventorySteps) || JSON.stringify(uniqueMappedSteps) !== JSON.stringify(inventorySteps)) {
    failures.push('golden_path_inventory');
  }
  if (mappedSteps.length !== uniqueMappedSteps.length) failures.push('golden_path_duplicate_mapping');

  const legacySteps = [...new Set(legacyEvidence?.stepsCompleted || [])].sort();
  if (legacyEvidence?.status !== 'phase6_complete') failures.push('legacy_lifecycle_incomplete');
  if (JSON.stringify(legacySteps) !== JSON.stringify(inventorySteps)) failures.push('legacy_golden_path_evidence');

  if (missingKeys(contract?.personas, REQUIRED_PERSONAS).length) failures.push('persona_inventory');
  if (missingKeys(contract?.governance, REQUIRED_GOVERNANCE).length) failures.push('governance_inventory');
  if (missingKeys(contract?.releaseEvidence, REQUIRED_RELEASE_EVIDENCE).length) failures.push('release_evidence_inventory');
  const branches = [...new Set(contract?.branches || [])].sort();
  if (REQUIRED_BRANCHES.some((branch) => !branches.includes(branch))) failures.push('branch_inventory');

  const knownNodes = new Set(expectedNodes);
  for (const record of [contract?.personas, contract?.governance, contract?.releaseEvidence]) {
    for (const nodes of Object.values(record || {})) {
      if (!strings(nodes) || nodes.some((node) => !knownNodes.has(node))) failures.push('unknown_node_reference');
    }
  }

  return Object.freeze({
    ok: failures.length === 0,
    failures: Object.freeze([...new Set(failures)].sort()),
    graphVersion: contract?.graphVersion || null,
    nodeCount: contractNodes.length,
    goldenPathStepCount: uniqueMappedSteps.length,
    personaCount: Object.keys(contract?.personas || {}).length,
    governanceGateCount: Object.keys(contract?.governance || {}).length,
    releaseEvidenceCount: Object.keys(contract?.releaseEvidence || {}).length,
    branchCount: branches.length,
  });
}

module.exports = {
  REQUIRED_BRANCHES,
  REQUIRED_GOVERNANCE,
  REQUIRED_PERSONAS,
  REQUIRED_RELEASE_EVIDENCE,
  verifyLifecycleEquivalence,
};
