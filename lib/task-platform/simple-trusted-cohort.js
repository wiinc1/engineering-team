'use strict';

/**
 * Simple operator-trusted cohort evaluation (GitLab #276 / Q1 bar).
 * Pure functions over closeout + factory-evidence artifacts — no network I/O.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { aggregateAutonomousDeliveryMetrics } = require('../audit/autonomous-delivery-metrics-aggregate');
const { assertTrustedSimpleCloseEvidence } = require('./trusted-simple-close-evidence');

const LEGACY_COHORT_POLICY_VERSION = 'simple-trusted-cohort.v1';
const COHORT_POLICY_VERSION = 'simple-trusted-cohort.v2';
const COHORT_V2_EFFECTIVE_AT = '2026-08-19T00:00:00.000Z';
const DEFAULT_BAR = Object.freeze({
  minTrustedCloses: 10,
  minAutonomousRate: 0.8,
  taskClass: 'Simple',
});

const LIVE_SESSION_RE = /specialist-delegation-[0-9a-f]{8}-[0-9a-f-]{20,}/gi;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function walkFind(obj, key) {
  if (!obj || typeof obj !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(obj, key) && obj[key] != null && obj[key] !== '') {
    return obj[key];
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = walkFind(item, key);
      if (found != null) return found;
    }
    return null;
  }
  for (const value of Object.values(obj)) {
    const found = walkFind(value, key);
    if (found != null) return found;
  }
  return null;
}

function extractLiveSessions(textOrObj) {
  const text = typeof textOrObj === 'string' ? textOrObj : JSON.stringify(textOrObj);
  const matches = text.match(LIVE_SESSION_RE) || [];
  return [...new Set(matches.map((s) => s.toLowerCase()))];
}

function listJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.json')) out.push(full);
    }
  };
  walk(dir);
  return out;
}

function evidenceReference(doc) {
  return doc.trustedSimpleCloseEvidence || doc.trustedCloseEvidence || null;
}

function loadTrustedEvidenceReference(doc, { root, taskId }) {
  const reference = evidenceReference(doc);
  if (!reference) return { provided: false, valid: false, reasons: ['missing_trusted_close_evidence_reference'] };
  const relativePath = reference.path || reference.filePath;
  const expectedSha256 = String(reference.sha256 || reference.digest || '').toLowerCase();
  const reasons = [];
  if (!relativePath) reasons.push('missing_trusted_close_evidence_path');
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) reasons.push('invalid_trusted_close_evidence_sha256');
  if (reasons.length) return { provided: true, valid: false, path: relativePath || null, reasons };

  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    return { provided: true, valid: false, path: relativePath, reasons: ['trusted_close_evidence_outside_repository'] };
  }
  if (!fs.existsSync(resolvedPath)) {
    return { provided: true, valid: false, path: relativePath, reasons: ['trusted_close_evidence_missing'] };
  }

  const body = fs.readFileSync(resolvedPath);
  const actualSha256 = crypto.createHash('sha256').update(body).digest('hex');
  if (actualSha256 !== expectedSha256) reasons.push('trusted_close_evidence_digest_mismatch');
  let evidence = null;
  try {
    evidence = JSON.parse(body.toString('utf8'));
    assertTrustedSimpleCloseEvidence(evidence);
  } catch {
    reasons.push('trusted_close_evidence_invalid');
  }
  if (evidence && evidence.taskId !== taskId) reasons.push('trusted_close_evidence_task_mismatch');
  return {
    provided: true,
    valid: reasons.length === 0,
    path: relativePath,
    sha256: actualSha256,
    prUrl: evidence?.prUrl || evidence?.github?.prUrl || null,
    mergeCommitSha: evidence?.mergeCommitSha || evidence?.github?.mergeCommitSha || null,
    reasons: [...new Set(reasons)],
  };
}

function loadCloseouts(closeoutDir, { root = process.cwd() } = {}) {
  return listJsonFiles(closeoutDir)
    .filter((p) => /TSK-\d+\.json$/i.test(path.basename(p)))
    .map((filePath) => {
      const doc = readJson(filePath);
      const taskId = doc.taskId || doc.task_id || path.basename(filePath, '.json');
      return {
        filePath,
        taskId,
        deliveryStatus: doc.deliveryStatus || doc.status || null,
        generatedAt: doc.generatedAt || null,
        manualInterventions: Array.isArray(doc.manualInterventions) ? doc.manualInterventions : [],
        stepClassification: doc.stepClassification || null,
        stepsCompleted: Number(doc.stepsCompleted) || (Array.isArray(doc.steps) ? doc.steps.length : 0),
        liveSessions: extractLiveSessions(doc),
        cohortPolicyVersion: doc.cohortPolicyVersion || doc.cohort_policy_version || null,
        trustedEvidence: loadTrustedEvidenceReference(doc, { root, taskId }),
        humanReviewProvenance: doc.humanReviewProvenance || null,
        approvalProvenance: doc.approvalProvenance || null,
        interventionAudit: doc.interventionAudit || null,
      };
    });
}

function loadFactoryEvidence(observabilityDir) {
  return listJsonFiles(observabilityDir)
    .filter((p) => /factory-milestone-c-/.test(path.basename(p)) && !/real-delivery-candidate/.test(p))
    .map((filePath) => {
      const doc = readJson(filePath);
      const sessions = extractLiveSessions(doc);
      return {
        filePath,
        taskId: walkFind(doc, 'taskId') || walkFind(doc, 'task_id') || null,
        status: doc.status || walkFind(doc, 'status') || null,
        factoryQueueId: doc.factoryQueueId || path.basename(filePath, '.json'),
        liveSessions: sessions,
        liveSessionCount: sessions.length,
        completedAt: doc.completedAt || doc.generatedAt || null,
      };
    })
    .filter((row) => row.taskId);
}

function isPhase6Complete(status) {
  return String(status || '').toLowerCase() === 'phase6_complete';
}

function indexEvidenceByTask(factoryEvidence) {
  const evidenceByTask = new Map();
  for (const row of factoryEvidence) {
    const rows = evidenceByTask.get(row.taskId) || [];
    rows.push(row);
    evidenceByTask.set(row.taskId, rows);
  }
  return evidenceByTask;
}

function selectEvidence(evidenceRows) {
  const liveEvidence = evidenceRows
    .filter((evidence) => evidence.liveSessionCount > 0)
    .sort((left, right) => right.liveSessionCount - left.liveSessionCount)[0] || null;
  const phase6Evidence = evidenceRows.find(
    (evidence) => isPhase6Complete(evidence.status) && evidence.liveSessionCount > 0,
  ) || null;
  return { liveEvidence, phase6Evidence };
}

function policyVersionFor(closeout) {
  const generatedAt = Date.parse(closeout.generatedAt || '');
  const effectiveAt = Date.parse(COHORT_V2_EFFECTIVE_AT);
  if (closeout.cohortPolicyVersion === COHORT_POLICY_VERSION
    || (Number.isFinite(generatedAt) && generatedAt >= effectiveAt)) return COHORT_POLICY_VERSION;
  return LEGACY_COHORT_POLICY_VERSION;
}

function validTimestamp(value) {
  return Number.isFinite(Date.parse(value || ''));
}

function evaluateProspectiveProvenance(closeout) {
  const reasons = [];
  const review = closeout.humanReviewProvenance;
  const approval = closeout.approvalProvenance;
  if (!review?.eventId || review?.eventType !== 'task.pm_architect_human_review_recorded') {
    reasons.push('missing_human_review_event_provenance');
  }
  const approvalValid = Boolean(
    approval?.eventId
    && approval?.eventType === 'task.execution_contract_approved'
    && validTimestamp(approval.approvedAt),
  );
  if (!approvalValid) reasons.push('missing_contract_approval_event_provenance');
  for (const role of ['pm', 'architect']) {
    const record = review?.roles?.[role];
    const actorType = String(record?.actorType || '').toLowerCase();
    if (!record?.actorId || !['human', 'user', 'operator', 'person'].includes(actorType)
      || !record?.eventId || !validTimestamp(record.reviewedAt)) {
      reasons.push(`missing_human_${role}_review_provenance`);
    } else if (approvalValid && Date.parse(record.reviewedAt) > Date.parse(approval.approvedAt)) {
      reasons.push(`human_${role}_review_after_approval`);
    }
  }
  const interventions = closeout.manualInterventions || [];
  const ambiguous = interventions.filter((entry) => !validTimestamp(entry.recordedAt));
  const postApproval = approvalValid
    ? interventions.filter((entry) => validTimestamp(entry.recordedAt)
      && Date.parse(entry.recordedAt) >= Date.parse(approval.approvedAt))
    : [];
  if (ambiguous.length) reasons.push('ambiguous_intervention_timestamp');
  if (postApproval.length) reasons.push('has_post_approval_interventions');
  return {
    valid: reasons.length === 0,
    reasons: [...new Set(reasons)],
    postApprovalInterventionCount: postApproval.length,
    interventionClassificationComplete: ambiguous.length === 0 && approvalValid,
  };
}

function trustedEvidenceFields(closeout) {
  return {
    trustedEvidencePath: closeout.trustedEvidence?.path || null,
    trustedEvidenceSha256: closeout.trustedEvidence?.sha256 || null,
    prUrl: closeout.trustedEvidence?.prUrl || null,
    mergeCommitSha: closeout.trustedEvidence?.mergeCommitSha || null,
  };
}

function buildCloseoutRow(closeout, evidenceRows, bar) {
  const { liveEvidence, phase6Evidence } = selectEvidence(evidenceRows);
  const closed = isPhase6Complete(closeout.deliveryStatus);
  const totalInterventionCount = closeout.manualInterventions.length;
  const liveSessions = phase6Evidence?.liveSessions || liveEvidence?.liveSessions || closeout.liveSessions || [];
  const liveSessionCount = liveSessions.length;
  const policyVersion = policyVersionFor(closeout);
  const prEvidenceRequired = policyVersion === COHORT_POLICY_VERSION;
  const prEvidenceValid = closeout.trustedEvidence?.valid === true;
  const provenance = evaluateProspectiveProvenance(closeout);
  const interventionCount = prEvidenceRequired
    ? provenance.postApprovalInterventionCount : totalInterventionCount;
  const trusted = closed && interventionCount === 0 && liveSessionCount > 0
    && (phase6Evidence != null || (liveEvidence != null && isPhase6Complete(closeout.deliveryStatus)))
    && (!prEvidenceRequired || (prEvidenceValid && provenance.valid));
  return {
    taskId: closeout.taskId,
    task_class: bar.taskClass,
    template_tier: 'Simple',
    closed,
    deliveryStatus: closeout.deliveryStatus,
    interventionCount,
    totalInterventionCount,
    humanReviewProvenanceValid: provenance.valid,
    interventionClassificationComplete: provenance.interventionClassificationComplete,
    liveSessionCount,
    liveSessions: liveSessions.slice(0, 8),
    trusted,
    policyVersion,
    prEvidenceRequired,
    prEvidenceValid,
    ...trustedEvidenceFields(closeout),
    trustedReason: trusted
      ? 'phase6 closeout + zero recorded post-closeout interventions + live OpenClaw session evidence'
      : [
        !closed ? 'not_phase6_complete' : null,
        interventionCount > 0 ? 'has_manual_interventions' : null,
        liveSessionCount === 0 ? 'missing_live_session_evidence' : null,
        ...(prEvidenceRequired && !prEvidenceValid
          ? (closeout.trustedEvidence?.reasons || ['missing_trusted_close_evidence_reference'])
          : []),
        ...(prEvidenceRequired && !provenance.valid ? provenance.reasons : []),
      ].filter(Boolean),
    closeoutPath: closeout.filePath,
    factoryEvidencePath: (phase6Evidence || liveEvidence)?.filePath || null,
    generatedAt: closeout.generatedAt,
  };
}

function appendEvidenceOnlyRows(rows, evidenceByTask, bar) {
  const closeoutTaskIds = new Set(rows.map((row) => row.taskId));
  for (const [taskId, evidenceRows] of evidenceByTask.entries()) {
    if (closeoutTaskIds.has(taskId)) continue;
    const evidence = evidenceRows.find((row) => isPhase6Complete(row.status) && row.liveSessionCount > 0);
    if (!evidence) continue;
    const policyVersion = policyVersionFor({ generatedAt: evidence.completedAt });
    const prospective = policyVersion === COHORT_POLICY_VERSION;
    rows.push({
      taskId, task_class: bar.taskClass, template_tier: 'Simple', closed: true,
      deliveryStatus: evidence.status, interventionCount: 0, liveSessionCount: evidence.liveSessionCount,
      liveSessions: evidence.liveSessions.slice(0, 8), trusted: !prospective,
      policyVersion, prEvidenceRequired: prospective, prEvidenceValid: false,
      trustedReason: prospective
        ? ['missing_closeout', 'missing_trusted_close_evidence_reference']
        : 'phase6 factory evidence with live sessions (legacy policy; no separate closeout file)',
      closeoutPath: null, factoryEvidencePath: evidence.filePath, generatedAt: evidence.completedAt,
    });
  }
}

function metricsSignal(row) {
  return {
    tenant_id: 'engineering-team', task_id: row.taskId, task_class: 'Simple', template_tier: 'Simple',
    implementation_agent: 'openclaw-live', generated_at: row.generatedAt || new Date().toISOString(),
    excluded_from_thresholds: false, approval_mode: 'explicit',
    operator_interventions: { count: row.interventionCount },
    qa_sre_rework: { rework_count: 0 }, rollback: { recorded: false }, escaped_defects: { count: 0 },
    final_outcome: { closed: true, closed_at: row.generatedAt || null }, live_session_count: row.liveSessionCount,
  };
}

function summarizeCohort(rows, closeouts, factoryEvidence, bar) {
  const trusted = rows.filter((row) => row.trusted);
  const closed = rows.filter((row) => row.closed);
  const rate = closed.length > 0 ? Number((trusted.length / closed.length).toFixed(4)) : 0;
  return {
    trusted,
    summary: {
      closeouts: closeouts.length,
      factoryEvidenceFiles: factoryEvidence.length,
      closedTasks: closed.length,
      trustedCloses: trusted.length,
      autonomous_delivery_rate: rate,
      barMet: trusted.length >= bar.minTrustedCloses && rate >= bar.minAutonomousRate,
      minTrustedCloses: bar.minTrustedCloses,
      minAutonomousRate: bar.minAutonomousRate,
    },
  };
}

/**
 * Build per-task cohort rows by joining closeouts with live factory evidence.
 */
function buildSimpleTrustedCohort({
  closeouts = [],
  factoryEvidence = [],
  bar = DEFAULT_BAR,
} = {}) {
  const evidenceByTask = indexEvidenceByTask(factoryEvidence);
  const rows = closeouts.map((closeout) => buildCloseoutRow(closeout, evidenceByTask.get(closeout.taskId) || [], bar));
  appendEvidenceOnlyRows(rows, evidenceByTask, bar);
  rows.sort((a, b) => String(a.taskId).localeCompare(String(b.taskId)));
  const { trusted, summary } = summarizeCohort(rows, closeouts, factoryEvidence, bar);
  return {
    policy_version: COHORT_POLICY_VERSION,
    bar,
    generatedAt: new Date().toISOString(),
    summary,
    rows,
    trustedTaskIds: trusted.map((row) => row.taskId),
    metrics: aggregateAutonomousDeliveryMetrics(trusted.map(metricsSignal), { taskClass: 'Simple' }),
  };
}

function buildSimpleTrustedCohortFromRepo(root = process.cwd(), options = {}) {
  const closeoutDir = options.closeoutDir || path.join(root, 'observability', 'factory-closeout');
  const observabilityDir = options.observabilityDir || path.join(root, 'observability');
  const closeouts = loadCloseouts(closeoutDir, { root });
  const factoryEvidence = loadFactoryEvidence(observabilityDir);
  return buildSimpleTrustedCohort({ closeouts, factoryEvidence, bar: options.bar || DEFAULT_BAR });
}

module.exports = {
  COHORT_POLICY_VERSION,
  LEGACY_COHORT_POLICY_VERSION,
  COHORT_V2_EFFECTIVE_AT,
  DEFAULT_BAR,
  extractLiveSessions,
  loadCloseouts,
  loadTrustedEvidenceReference,
  evaluateProspectiveProvenance,
  loadFactoryEvidence,
  buildSimpleTrustedCohort,
  buildSimpleTrustedCohortFromRepo,
};
