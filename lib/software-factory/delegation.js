const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createAuditLogger, ensureDir } = require('../audit/logger');
const { isSpecialistDelegationEnabled } = require('../audit/feature-flags');
const { createRuntimeDelegateWork } = require('./runtime-delegation');

const SPECIALIST_ROUTING_RULES = Object.freeze([
  { specialist: 'architect', match: /\b(architect|architecture|system design|design review|adr|trade-?off|scalability|boundary|integration design)\b/i },
  { specialist: 'engineer', match: /\b(engineer|engineering|implement|implementation|code|bug|refactor|fix|build|develop)\b/i },
  { specialist: 'qa', match: /\b(qa|quality|test|testing|regression|acceptance criteria|verify|verification)\b/i },
  { specialist: 'sre', match: /\b(sre|reliability|incident|monitoring|observability|latency|alert|runbook|ops|deployment)\b/i },
]);

const FALLBACK_REASONS = Object.freeze({
  FEATURE_DISABLED: 'feature_disabled',
  NOT_CONFIGURED: 'not_configured',
  UNSUPPORTED_TASK_TYPE: 'unsupported_task_type',
  RUNTIME_EXEC_FAILED: 'runtime_exec_failed',
  INVALID_JSON: 'invalid_json',
  MISSING_EVIDENCE: 'missing_evidence',
  ATTRIBUTION_MISMATCH: 'attribution_mismatch',
  NO_SPECIALIST_MATCH: 'no_specialist_match',
  AMBIGUOUS_REQUEST: 'ambiguous_request',
  UNKNOWN: 'unknown',
});

const FALLBACK_REASON_CATEGORIES = Object.freeze({
  RUNTIME_NOT_AVAILABLE: 'runtime_not_available',
  RUNTIME_EXECUTION_FAILED: 'runtime_execution_failed',
  DELEGATION_UNVERIFIED: 'delegation_unverified',
  UNSUPPORTED_RUNTIME_SPECIALIST: 'unsupported_runtime_specialist',
  DELEGATION_DISABLED: 'delegation_disabled',
  NO_CLEAR_SPECIALIST_OWNER: 'no_clear_specialist_owner',
});

function classifyDelegationFailure(error) {
  switch (error?.code) {
    case 'SPECIALIST_RUNTIME_NOT_CONFIGURED':
      return FALLBACK_REASONS.NOT_CONFIGURED;
    case 'SPECIALIST_RUNTIME_EXEC_FAILED':
    case 'SPECIALIST_RUNTIME_TIMEOUT':
      return FALLBACK_REASONS.RUNTIME_EXEC_FAILED;
    case 'SPECIALIST_RUNTIME_INVALID_JSON':
      return FALLBACK_REASONS.INVALID_JSON;
    case 'SPECIALIST_RUNTIME_MISSING_EVIDENCE':
      return FALLBACK_REASONS.MISSING_EVIDENCE;
    case 'SPECIALIST_ATTRIBUTION_MISMATCH':
      return FALLBACK_REASONS.ATTRIBUTION_MISMATCH;
    default:
      return FALLBACK_REASONS.UNKNOWN;
  }
}

function describeDelegationFallback({ specialist, fallbackReason }) {
  switch (fallbackReason) {
    case FALLBACK_REASONS.NOT_CONFIGURED:
      return {
        category: FALLBACK_REASON_CATEGORIES.RUNTIME_NOT_AVAILABLE,
        message: `Coordinator handling this request because runtime delegation for specialist \`${specialist}\` is not configured or not available.`,
      };
    case FALLBACK_REASONS.RUNTIME_EXEC_FAILED:
      return {
        category: FALLBACK_REASON_CATEGORIES.RUNTIME_EXECUTION_FAILED,
        message: `Coordinator handling this request because runtime delegation for specialist \`${specialist}\` failed during execution.`,
      };
    case FALLBACK_REASONS.INVALID_JSON:
    case FALLBACK_REASONS.MISSING_EVIDENCE:
    case FALLBACK_REASONS.ATTRIBUTION_MISMATCH:
    case FALLBACK_REASONS.UNKNOWN:
      return {
        category: FALLBACK_REASON_CATEGORIES.DELEGATION_UNVERIFIED,
        message: `Coordinator handling this request because runtime delegation for specialist \`${specialist}\` could not be verified.`,
      };
    case FALLBACK_REASONS.UNSUPPORTED_TASK_TYPE:
      return {
        category: FALLBACK_REASON_CATEGORIES.UNSUPPORTED_RUNTIME_SPECIALIST,
        message: 'Coordinator handling directly because this task type is unsupported for runtime delegation.',
      };
    case FALLBACK_REASONS.FEATURE_DISABLED:
      return {
        category: FALLBACK_REASON_CATEGORIES.DELEGATION_DISABLED,
        message: 'Coordinator handling directly. Specialist delegation is disabled by ff_real_specialist_delegation.',
      };
    case FALLBACK_REASONS.AMBIGUOUS_REQUEST:
    case FALLBACK_REASONS.NO_SPECIALIST_MATCH:
      return {
        category: FALLBACK_REASON_CATEGORIES.NO_CLEAR_SPECIALIST_OWNER,
        message: 'Coordinator handling directly because no single specialist clearly owns this request.',
      };
    default:
      return {
        category: FALLBACK_REASON_CATEGORIES.DELEGATION_UNVERIFIED,
        message: `Coordinator handling this request because runtime delegation for specialist \`${specialist}\` could not be verified.`,
      };
  }
}

function buildDelegationFallbackMessage({ specialist, fallbackReason }) {
  return describeDelegationFallback({ specialist, fallbackReason }).message;
}

function classifySpecialistRequest(input = '') {
  const content = String(input || '').trim();
  if (!content) return { specialist: null, confidence: 'none', rule: null };

  const matches = SPECIALIST_ROUTING_RULES.filter((rule) => rule.match.test(content));
  if (matches.length !== 1) {
    return {
      specialist: null,
      confidence: matches.length === 0 ? 'none' : 'ambiguous',
      rule: matches.map((match) => match.specialist),
    };
  }

  return {
    specialist: matches[0].specialist,
    confidence: 'clear',
    rule: matches[0].specialist,
  };
}

function createDelegationMetrics() {
  const counters = {
    runtimeBridgeInvocationCount: 0,
    liveDelegationSuccessCount: 0,
    delegationAttemptsByAgent: {},
    delegationSuccessByAgent: {},
    delegationFailureByAgent: {},
    delegationFailureByReason: {},
    delegationFailureByCategory: {},
    fallbackToCoordinatorCount: 0,
    attributionMismatchCount: 0,
  };
  const delegationLatencyMs = [];

  return {
    counters,
    delegationLatencyMs,
    recordAttempt(agent) {
      counters.runtimeBridgeInvocationCount += 1;
      counters.delegationAttemptsByAgent[agent] = (counters.delegationAttemptsByAgent[agent] || 0) + 1;
    },
    recordSuccess(agent, latencyMs) {
      counters.liveDelegationSuccessCount += 1;
      counters.delegationSuccessByAgent[agent] = (counters.delegationSuccessByAgent[agent] || 0) + 1;
      if (typeof latencyMs === 'number') delegationLatencyMs.push(latencyMs);
    },
    recordFailure(agent, latencyMs, reason = FALLBACK_REASONS.UNKNOWN, category = FALLBACK_REASON_CATEGORIES.DELEGATION_UNVERIFIED) {
      counters.delegationFailureByAgent[agent] = (counters.delegationFailureByAgent[agent] || 0) + 1;
      counters.delegationFailureByReason[reason] = (counters.delegationFailureByReason[reason] || 0) + 1;
      counters.delegationFailureByCategory[category] = (counters.delegationFailureByCategory[category] || 0) + 1;
      counters.fallbackToCoordinatorCount += 1;
      if (typeof latencyMs === 'number') delegationLatencyMs.push(latencyMs);
    },
    recordAttributionMismatch() {
      counters.attributionMismatchCount += 1;
    },
    snapshot() {
      const sorted = [...delegationLatencyMs].sort((a, b) => a - b);
      const percentile = (p) => {
        if (!sorted.length) return 0;
        const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
        return sorted[index];
      };
      return {
        ...counters,
        delegationLatencyHistogram: {
          count: sorted.length,
          min_ms: sorted[0] || 0,
          p50_ms: percentile(0.5),
          p95_ms: percentile(0.95),
          max_ms: sorted[sorted.length - 1] || 0,
        },
      };
    },
  };
}

function appendDelegationArtifact(baseDir, artifact) {
  const logDir = path.join(baseDir, 'observability');
  const logPath = path.join(logDir, 'specialist-delegation.jsonl');
  ensureDir(logDir);
  fs.appendFileSync(logPath, `${JSON.stringify(artifact)}\n`);
  return logPath;
}

function delegationMetricsPath(baseDir) {
  return path.join(baseDir, 'observability', 'specialist-delegation-metrics.json');
}

function flattenDelegationMetrics(snapshot = {}) {
  const flattened = {
    real_specialist_delegation_runtime_bridge_invocation_total: Number(snapshot.runtimeBridgeInvocationCount || 0),
    real_specialist_delegation_live_success_total: Number(snapshot.liveDelegationSuccessCount || 0),
    real_specialist_delegation_fallback_total: Number(snapshot.fallbackToCoordinatorCount || 0),
    real_specialist_delegation_attribution_mismatch_total: Number(snapshot.attributionMismatchCount || 0),
    real_specialist_delegation_latency_count: Number(snapshot.delegationLatencyHistogram?.count || 0),
    real_specialist_delegation_latency_p50_ms: Number(snapshot.delegationLatencyHistogram?.p50_ms || 0),
    real_specialist_delegation_latency_p95_ms: Number(snapshot.delegationLatencyHistogram?.p95_ms || 0),
    real_specialist_delegation_latency_max_ms: Number(snapshot.delegationLatencyHistogram?.max_ms || 0),
  };

  for (const [agent, count] of Object.entries(snapshot.delegationAttemptsByAgent || {})) {
    flattened[`real_specialist_delegation_attempts_${agent}_total`] = Number(count || 0);
  }
  for (const [agent, count] of Object.entries(snapshot.delegationSuccessByAgent || {})) {
    flattened[`real_specialist_delegation_success_${agent}_total`] = Number(count || 0);
  }
  for (const [agent, count] of Object.entries(snapshot.delegationFailureByAgent || {})) {
    flattened[`real_specialist_delegation_failures_${agent}_total`] = Number(count || 0);
  }
  for (const [reason, count] of Object.entries(snapshot.delegationFailureByReason || {})) {
    flattened[`real_specialist_delegation_failure_reason_${reason}_total`] = Number(count || 0);
  }
  for (const [category, count] of Object.entries(snapshot.delegationFailureByCategory || {})) {
    flattened[`real_specialist_delegation_failure_category_${category}_total`] = Number(count || 0);
  }

  return flattened;
}

function writeDelegationMetricsSnapshot(baseDir, metrics) {
  const outputDir = path.join(baseDir, 'observability');
  const outputPath = delegationMetricsPath(baseDir);
  ensureDir(outputDir);
  const snapshot = typeof metrics?.snapshot === 'function' ? metrics.snapshot() : metrics;
  const payload = {
    updatedAt: new Date().toISOString(),
    snapshot,
    prometheus: flattenDelegationMetrics(snapshot),
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
  return outputPath;
}

function normalizeSpecialistAlias(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function createSpecialistCoordinator(options = {}) {
  const baseDir = options.baseDir || process.cwd();
  const logger = options.logger || createAuditLogger(baseDir);
  const metrics = options.metrics || createDelegationMetrics();
  const delegateWork = options.delegateWork || createRuntimeDelegateWork(options);

  function flushMetrics() {
    return writeDelegationMetricsSnapshot(baseDir, metrics);
  }

  async function handleRequest(request, context = {}) {
    const content = String(request || '').trim();
    const classification = context.targetSpecialist
      ? { specialist: context.targetSpecialist, confidence: 'clear', rule: context.targetSpecialist }
      : classifySpecialistRequest(content);
    const delegationId = crypto.randomUUID();
    const startedAt = Date.now();

    if (!isSpecialistDelegationEnabled(options)) {
      const fallbackReason = FALLBACK_REASONS.FEATURE_DISABLED;
      const fallback = describeDelegationFallback({ fallbackReason });
      logger.info({
        feature: 'real-specialist-delegation',
        event: 'specialist.delegation.skipped',
        delegation_id: delegationId,
        reason: 'feature_disabled',
        fallback_reason: fallbackReason,
        coordinator_agent: context.coordinatorAgent || 'main',
      });
      flushMetrics();
      return {
        mode: 'coordinator',
        agentId: context.coordinatorAgent || 'main',
        specialist: null,
        message: fallback.message,
        attribution: { handledBy: context.coordinatorAgent || 'main', delegated: false },
        metadata: {
          delegationId,
          routeConfidence: classification.confidence,
          artifactLogged: false,
          fallbackReason,
          userFacingReasonCategory: fallback.category,
        },
      };
    }

    if (classification.confidence !== 'clear') {
      const fallbackReason = classification.confidence === 'ambiguous'
        ? FALLBACK_REASONS.AMBIGUOUS_REQUEST
        : FALLBACK_REASONS.NO_SPECIALIST_MATCH;
      const fallback = describeDelegationFallback({ fallbackReason });
      logger.info({
        feature: 'real-specialist-delegation',
        event: 'specialist.delegation.skipped',
        delegation_id: delegationId,
        reason: classification.confidence === 'ambiguous' ? 'ambiguous_request' : 'no_specialist_match',
        fallback_reason: fallbackReason,
        coordinator_agent: context.coordinatorAgent || 'main',
        matched_specialists: classification.rule,
      });
      flushMetrics();
      return {
        mode: 'coordinator',
        agentId: context.coordinatorAgent || 'main',
        specialist: null,
        message: fallback.message,
        attribution: { handledBy: context.coordinatorAgent || 'main', delegated: false },
        metadata: {
          delegationId,
          routeConfidence: classification.confidence,
          artifactLogged: false,
          fallbackReason,
          userFacingReasonCategory: fallback.category,
        },
      };
    }

    const specialist = classification.specialist;
    metrics.recordAttempt(specialist);
    flushMetrics();
    logger.info({
      feature: 'real-specialist-delegation',
      event: 'specialist.delegation.attempted',
      delegation_id: delegationId,
      coordinator_agent: context.coordinatorAgent || 'main',
      target_specialist: specialist,
      route_policy: classification.rule,
    });

    try {
      const result = await delegateWork({ specialist, request: content, delegationId, context });
      const latencyMs = Date.now() - startedAt;
      const actualAgent = result?.agentId || null;
      const ownershipSpecialist = normalizeSpecialistAlias(result?.ownership?.specialistId);
      const artifact = {
        timestamp: new Date().toISOString(),
        feature: 'real-specialist-delegation',
        event: 'specialist.delegation.completed',
        delegation_id: delegationId,
        coordinator_agent: context.coordinatorAgent || 'main',
        target_specialist: specialist,
        actual_agent: actualAgent,
        session_id: result?.sessionId || null,
        ownership: result?.ownership || null,
        latency_ms: latencyMs,
      };
      const artifactPath = appendDelegationArtifact(baseDir, artifact);

      if ((ownershipSpecialist || actualAgent) !== specialist) {
        metrics.recordAttributionMismatch();
        logger.error({
          feature: 'real-specialist-delegation',
          event: 'specialist.attribution.mismatch',
          error_code: 'SPECIALIST_ATTRIBUTION_MISMATCH',
          delegation_id: delegationId,
          target_specialist: specialist,
          actual_agent: actualAgent,
          ownership_specialist: ownershipSpecialist || null,
        });
        throw Object.assign(new Error(`Delegated work returned ${actualAgent || 'unknown'} instead of ${specialist}`), {
          code: 'SPECIALIST_ATTRIBUTION_MISMATCH',
        });
      }

      metrics.recordSuccess(specialist, latencyMs);
      const metricsPath = flushMetrics();
      logger.info({
        feature: 'real-specialist-delegation',
        event: 'specialist.delegation.succeeded',
        outcome: 'delegated',
        delegation_id: delegationId,
        target_specialist: specialist,
        actual_agent: actualAgent,
        session_id: result?.sessionId || null,
        user_facing_outcome_category: 'delegated',
        latency_ms: latencyMs,
      });

      return {
        mode: 'delegated',
        agentId: actualAgent,
        specialist,
        message: result.output,
        attribution: {
          handledBy: actualAgent,
          delegated: true,
          coordinator: context.coordinatorAgent || 'main',
        },
        metadata: {
          delegationId,
          routeConfidence: classification.confidence,
          sessionId: result?.sessionId || null,
          ownership: result?.ownership || null,
          artifactLogged: true,
          artifactPath,
          metricsPath,
          latencyMs,
        },
      };
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const fallbackReason = classifyDelegationFailure(error);
      const fallback = describeDelegationFallback({ specialist, fallbackReason });
      metrics.recordFailure(specialist, latencyMs, fallbackReason, fallback.category);
      const metricsPath = flushMetrics();
      logger.error({
        feature: 'real-specialist-delegation',
        event: 'specialist.delegation.failed',
        outcome: 'fallback',
        error_code: error.code || 'SPECIALIST_DELEGATION_FAILED',
        fallback_reason: fallbackReason,
        user_facing_reason_category: fallback.category,
        user_facing_outcome_category: fallback.category,
        user_facing_message: fallback.message,
        delegation_id: delegationId,
        target_specialist: specialist,
        latency_ms: latencyMs,
        message: error.message,
      });
      const artifactPath = appendDelegationArtifact(baseDir, {
        timestamp: new Date().toISOString(),
        feature: 'real-specialist-delegation',
        event: 'specialist.delegation.failed',
        delegation_id: delegationId,
        coordinator_agent: context.coordinatorAgent || 'main',
        target_specialist: specialist,
        actual_agent: null,
        session_id: null,
        latency_ms: latencyMs,
        error_code: error.code || 'SPECIALIST_DELEGATION_FAILED',
        fallback_reason: fallbackReason,
        user_facing_reason_category: fallback.category,
      });

      return {
        mode: 'fallback',
        agentId: context.coordinatorAgent || 'main',
        specialist,
        message: fallback.message,
        attribution: {
          handledBy: context.coordinatorAgent || 'main',
          delegated: false,
          fallbackFor: specialist,
        },
        metadata: {
          delegationId,
          routeConfidence: classification.confidence,
          artifactLogged: true,
          artifactPath,
          metricsPath,
          latencyMs,
          errorCode: error.code || 'SPECIALIST_DELEGATION_FAILED',
          fallbackReason,
          userFacingReasonCategory: fallback.category,
        },
      };
    }
  }

  return {
    handleRequest,
    metrics,
    logger,
  };
}

module.exports = {
  SPECIALIST_ROUTING_RULES,
  isSpecialistDelegationEnabled,
  classifySpecialistRequest,
  classifyDelegationFailure,
  buildDelegationFallbackMessage,
  describeDelegationFallback,
  FALLBACK_REASONS,
  FALLBACK_REASON_CATEGORIES,
  createDelegationMetrics,
  createSpecialistCoordinator,
  delegationMetricsPath,
  flattenDelegationMetrics,
  writeDelegationMetricsSnapshot,
};
