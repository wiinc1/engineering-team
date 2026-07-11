'use strict';

/**
 * Factory-path human PM/Architect acceptance (Q6).
 * Agents propose; humans accept before contract authority.
 */

function parseTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function shouldRequireFactoryHumanPmArchitect(options = {}, env = process.env) {
  if (options.requireHumanPmArchitectReview === false) return false;
  if (options.requireHumanPmArchitectReview === true) return true;
  if (parseTruthy(env.FF_REQUIRE_HUMAN_PM_ARCHITECT_REVIEW)) return true;
  // Agent-driven factory phase1 always records agent proposals → human gate applies.
  return options.agentDrivenPhase1 === true
    || options.agentDrivenPhases === true
    || parseTruthy(env.FF_FACTORY_AGENT_DRIVEN_PHASE1)
    || parseTruthy(env.FF_FACTORY_AGENT_DRIVEN_PHASES);
}

function buildFactoryHumanReviews({
  actorId = 'factory-operator',
  pmActorId,
  architectActorId,
  reason = 'Supervised human acceptance of agent-authored PM/Architect proposals (Q6).',
  at = new Date().toISOString(),
} = {}) {
  const pmId = pmActorId || process.env.FACTORY_HUMAN_PM_ACTOR_ID || actorId || 'human-pm-operator';
  const archId = architectActorId || process.env.FACTORY_HUMAN_ARCHITECT_ACTOR_ID || actorId || 'human-architect-operator';
  return {
    pm: {
      status: 'approved',
      actorId: pmId,
      actorType: 'human',
      approved: true,
      reviewedAt: at,
      reason,
    },
    architect: {
      status: 'approved',
      actorId: archId,
      actorType: 'human',
      approved: true,
      reviewedAt: at,
      reason,
    },
  };
}

/**
 * Attach agent proposal markers + supervised human acceptance for factory contracts.
 * Does not invent authority when human reviews are explicitly disabled.
 */
function applyFactoryHumanPmArchitectContractFields(contractBody = {}, options = {}) {
  if (!shouldRequireFactoryHumanPmArchitect(options)) {
    return {
      contract: contractBody,
      humanGate: { required: false, applied: false },
    };
  }

  const humanReviews = options.humanReviews
    || buildFactoryHumanReviews({
      actorId: options.actorId,
      pmActorId: options.pmActorId,
      architectActorId: options.architectActorId,
      reason: options.humanReviewReason,
    });

  const contract = {
    ...contractBody,
    require_human_pm_architect_review: true,
    agent_proposals: {
      pm: options.pmAgentProposed !== false,
      architect: options.architectAgentProposed !== false,
      ...(contractBody.agent_proposals || contractBody.agentProposals || {}),
    },
    reviewers: {
      ...(contractBody.reviewers || {}),
      pm: {
        status: 'approved',
        actorId: options.pmAgentId || 'pm-agent',
        actorType: 'agent',
        ...(contractBody.reviewers?.pm || {}),
      },
      architect: {
        status: 'approved',
        actorId: options.architectAgentId || 'architect-agent',
        actorType: 'agent',
        ...(contractBody.reviewers?.architect || {}),
      },
    },
    human_reviews: {
      ...(contractBody.human_reviews || contractBody.humanReviews || {}),
      ...humanReviews,
    },
  };

  return {
    contract,
    humanGate: {
      required: true,
      applied: true,
      policy: 'pm-architect-human-review-gate.v1',
      humanReviews: {
        pm: Boolean(humanReviews.pm),
        architect: Boolean(humanReviews.architect),
      },
    },
  };
}

module.exports = {
  shouldRequireFactoryHumanPmArchitect,
  buildFactoryHumanReviews,
  applyFactoryHumanPmArchitectContractFields,
};
