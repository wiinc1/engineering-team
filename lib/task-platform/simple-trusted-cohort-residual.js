'use strict';

function requiredForRate(trustedCloses, closedTasks, targetRate) {
  if (targetRate <= 0) return 0;
  if (targetRate >= 1) return trustedCloses === closedTasks ? 0 : null;
  const raw = ((targetRate * closedTasks) - trustedCloses) / (1 - targetRate);
  return Math.max(0, Math.ceil(raw - 1e-12));
}

function projectedRate(trustedCloses, closedTasks, additions) {
  if (additions == null) return null;
  const projectedClosed = closedTasks + additions;
  if (projectedClosed === 0) return 0;
  return Number(((trustedCloses + additions) / projectedClosed).toFixed(4));
}

function calculateCohortResidual({ trustedCloses, closedTasks, bar }) {
  const targetCount = Number(bar.minTrustedCloses) || 0;
  const targetRate = Number(bar.minAutonomousRate) || 0;
  const countRequired = Math.max(0, targetCount - trustedCloses);
  const rateRequired = requiredForRate(trustedCloses, closedTasks, targetRate);
  const additions = rateRequired == null ? null : Math.max(countRequired, rateRequired);
  const currentRate = closedTasks > 0 ? trustedCloses / closedTasks : 0;
  return {
    trustedCloseShortfall: countRequired,
    rateShortfall: Number(Math.max(0, targetRate - currentRate).toFixed(4)),
    additionalTrustedClosesForRate: rateRequired,
    additionalTrustedClosesRequired: additions,
    achievableWithAdditionalTrustedCloses: additions != null,
    projectedTrustedCloses: additions == null ? null : trustedCloses + additions,
    projectedClosedTasks: additions == null ? null : closedTasks + additions,
    projectedAutonomousDeliveryRate: projectedRate(trustedCloses, closedTasks, additions),
    assumption: 'every additional closed Simple task is trusted',
  };
}

module.exports = { calculateCohortResidual, requiredForRate };
