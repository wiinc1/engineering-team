const {
  hasFactoryItemRealDeliveryIntent,
  normalizeRequirement,
} = require('./factory-delivery-shared');
const {
  assertFactoryItemRealEvidencePreflightForStage,
} = require('./factory-real-delivery-preflight');

function factoryRealDeliveryPreflightFailureLines(error) {
  const message = error?.message || String(error);
  const match = message.match(/preflight failed: (.*)$/s);
  return (match ? match[1] : message).split(/;\s+/).filter(Boolean);
}

function factoryRealDeliveryPreflightSummary(item = {}, config = {}, stage = 'queued') {
  if (!hasFactoryItemRealDeliveryIntent(item)) return null;
  try {
    const result = assertFactoryItemRealEvidencePreflightForStage(config, item, stage);
    return { required: result.required === true, ok: true, failures: [] };
  } catch (error) {
    return { required: true, ok: false, failures: factoryRealDeliveryPreflightFailureLines(error) };
  }
}

function prepareFactorySubmitRequirements(requirements = [], config = {}) {
  const normalized = requirements.map((entry, index) => normalizeRequirement(entry, index));
  normalized
    .filter((entry) => hasFactoryItemRealDeliveryIntent(entry))
    .forEach((entry) => {
      assertFactoryItemRealEvidencePreflightForStage(config, entry, 'queued');
    });
  return normalized;
}

module.exports = {
  factoryRealDeliveryPreflightFailureLines,
  factoryRealDeliveryPreflightSummary,
  prepareFactorySubmitRequirements,
};
