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
    delegationAttemptsByAgent: {},
    delegationSuccessByAgent: {},
    delegationFailureByAgent: {},
    fallbackToCoordinatorCount: 0,
    attributionMismatchCount: 0,
  };
  const delegationLatencyMs = [];

  return {
    counters,
    delegationLatencyMs,
    recordAttempt(agent) {
      counters.delegationAttemptsByAgent[agent] = (counters.delegationAttemptsByAgent[agent] || 0) + 1;
    },
    recordSuccess(agent, latencyMs) {
      counters.delegationSuccessByAgent[agent] = (counters.delegationSuccessByAgent[agent] || 0) + 1;
      if (typeof latencyMs === 'number') delegationLatencyMs.push(latencyMs);
    },
    recordFailure(agent, latencyMs) {
      counters.delegationFailureByAgent[agent] = (counters.delegationFailureByAgent[agent] || 0) + 1;
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

function createSpecialistCoordinator(options = {}) {
  const baseDir = options.baseDir || process.cwd();
  const logger = options.logger || createAuditLogger(baseDir);
  const metrics = options.metrics || createDelegationMetrics();
  const delegateWork = options.delegateWork || createRuntimeDelegateWork(options);

  async function handleRequest(request, context = {}) {
    const content = String(request || '').trim();
    const classification = context.targetSpecialist
      ? { specialist: context.targetSpecialist, confidence: 'clear', rule: context.targetSpecialist }
      : classifySpecialistRequest(content);
    const delegationId = crypto.randomUUID();
    const startedAt = Date.now();

    if (!isSpecialistDelegationEnabled(options)) {
      const message = `Coordinator handling directly. Specialist delegation is disabled by ff_specialist_delegation.`;
      logger.info({
        event: 'specialist.delegation.skipped',
        delegation_id: delegationId,
        reason: 'feature_disabled',
        coordinator_agent: context.coordinatorAgent || 'main',
      });
      return {
        mode: 'coordinator',
        agentId: context.coordinatorAgent || 'main',
        specialist: null,
        message,
        attribution: { handledBy: context.coordinatorAgent || 'main', delegated: false },
        metadata: { delegationId, routeConfidence: classification.confidence, artifactLogged: false },
      };
    }

    if (classification.confidence !== 'clear') {
      logger.info({
        event: 'specialist.delegation.skipped',
        delegation_id: delegationId,
        reason: classification.confidence === 'ambiguous' ? 'ambiguous_request' : 'no_specialist_match',
        coordinator_agent: context.coordinatorAgent || 'main',
        matched_specialists: classification.rule,
      });
      return {
        mode: 'coordinator',
        agentId: context.coordinatorAgent || 'main',
        specialist: null,
        message: `Coordinator handling directly because no single specialist clearly owns this request.`,
        attribution: { handledBy: context.coordinatorAgent || 'main', delegated: false },
        metadata: { delegationId, routeConfidence: classification.confidence, artifactLogged: false },
      };
    }

    const specialist = classification.specialist;
    metrics.recordAttempt(specialist);
    logger.info({
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
      const artifact = {
        timestamp: new Date().toISOString(),
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

      if (actualAgent !== specialist) {
        metrics.recordAttributionMismatch();
        logger.error({
          event: 'specialist.attribution.mismatch',
          error_code: 'SPECIALIST_ATTRIBUTION_MISMATCH',
          delegation_id: delegationId,
          target_specialist: specialist,
          actual_agent: actualAgent,
        });
        throw Object.assign(new Error(`Delegated work returned ${actualAgent || 'unknown'} instead of ${specialist}`), {
          code: 'SPECIALIST_ATTRIBUTION_MISMATCH',
        });
      }

      metrics.recordSuccess(specialist, latencyMs);
      logger.info({
        event: 'specialist.delegation.succeeded',
        delegation_id: delegationId,
        target_specialist: specialist,
        actual_agent: actualAgent,
        session_id: result?.sessionId || null,
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
          latencyMs,
        },
      };
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      metrics.recordFailure(specialist, latencyMs);
      logger.error({
        event: 'specialist.delegation.failed',
        error_code: error.code || 'SPECIALIST_DELEGATION_FAILED',
        delegation_id: delegationId,
        target_specialist: specialist,
        latency_ms: latencyMs,
        message: error.message,
      });
      const artifactPath = appendDelegationArtifact(baseDir, {
        timestamp: new Date().toISOString(),
        event: 'specialist.delegation.failed',
        delegation_id: delegationId,
        coordinator_agent: context.coordinatorAgent || 'main',
        target_specialist: specialist,
        actual_agent: null,
        session_id: null,
        latency_ms: latencyMs,
        error_code: error.code || 'SPECIALIST_DELEGATION_FAILED',
      });

      return {
        mode: 'fallback',
        agentId: context.coordinatorAgent || 'main',
        specialist,
        message: `Coordinator handling this request because specialist \`${specialist}\` could not be reached.`,
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
          latencyMs,
          errorCode: error.code || 'SPECIALIST_DELEGATION_FAILED',
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
  createDelegationMetrics,
  createSpecialistCoordinator,
};
