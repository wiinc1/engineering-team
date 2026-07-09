function goldenPathPrTitle(realEvidence = false) {
  return realEvidence
    ? 'Golden path real code-change delivery'
    : 'Golden path pilot — README marker + evidence';
}

function goldenPathCloseSummary(realEvidence = false) {
  return realEvidence
    ? 'Golden path real code-change delivery ready for close.'
    : 'Golden path pilot ready for close.';
}

function goldenPathHumanCloseSummary(realEvidence = false) {
  return realEvidence
    ? 'Golden path real code-change closeout approved.'
    : 'Golden path pilot human closeout approved.';
}

function goldenPathPmCloseRationale(realEvidence = false) {
  return realEvidence
    ? 'PM approves real code-change close after tests, Merge readiness, release evidence, and monitoring gates passed.'
    : 'PM approves docs-only pilot close after QA retest pass and forge lifecycle complete.';
}

function goldenPathArchitectCloseRationale(realEvidence = false) {
  return realEvidence
    ? 'Architect confirms implementation scope, rollback evidence, and production-safe deploy validation are complete.'
    : 'Simple docs-only marker delivered; no production risk remains.';
}

function goldenPathHumanCloseRationale(realEvidence = false) {
  return realEvidence
    ? 'GP-001–GP-026 evidence recorded for real code-change delivery with tests, Merge readiness, release evidence, and monitoring.'
    : 'GP-001–GP-026 evidence recorded for supervised docs-only pilot issue #271.';
}

function goldenPathTaskCloseReason(realEvidence = false) {
  return realEvidence
    ? 'Golden path real code-change GP-027 closeout complete.'
    : 'Golden path pilot GP-027 closeout complete.';
}

function realCodeChangeSreApproval(operatorUrl, mergeCommitSha) {
  return {
    reason: 'Real code-change golden path: deployment validation, rollback evidence, and monitoring evidence reviewed.',
    evidence: [
      'Hosted release evidence validation passed.',
      `Operator URL ${operatorUrl}.`,
      `Deployment version ${mergeCommitSha}.`,
    ],
    agent: null,
  };
}

module.exports = {
  goldenPathArchitectCloseRationale,
  goldenPathCloseSummary,
  goldenPathHumanCloseRationale,
  goldenPathHumanCloseSummary,
  goldenPathPmCloseRationale,
  goldenPathPrTitle,
  goldenPathTaskCloseReason,
  realCodeChangeSreApproval,
};
