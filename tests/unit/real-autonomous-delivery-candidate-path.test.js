const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  candidateProofPathFromEvidence,
  verifyRealAutonomousDeliveryEvidence,
} = require('../../lib/task-platform/real-autonomous-delivery-evidence');

test('real autonomous delivery verifier resolves candidate proof path from final evidence', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'real-delivery-candidate-path-'));
  const candidateProofPath = path.join(tmp, 'candidate-proof.json');
  fs.writeFileSync(candidateProofPath, '{}\n');
  const evidence = {
    status: 'phase6_complete',
    releaseEvidence: {
      environment: 'staging',
      artifacts: {},
    },
    realDelivery: {
      candidateProofPath,
    },
  };
  const result = verifyRealAutonomousDeliveryEvidence({
    repoRoot: tmp,
    evidence,
  });

  assert.equal(candidateProofPathFromEvidence(evidence), candidateProofPath);
  assert.equal(result.candidateProofPath, candidateProofPath);
  assert.match(result.failures.join('\n'), /real-delivery candidate proof schemaVersion/);
  assert.doesNotMatch(result.failures.join('\n'), /real-delivery candidate proof is required/);
});
