'use strict';

const crypto = require('crypto');
const { deriveThreadId } = require('../../../lib/software-factory/langgraph/identity');

function state(overrides = {}) {
  const tenantId = overrides.tenantId || 'tenant_alpha';
  const factoryRunId = overrides.factoryRunId || 'factory:RUN-280';
  return {
    schemaVersion: 1,
    graphVersion: 'factory-v1',
    tenantId,
    factoryRunId,
    threadId: deriveThreadId({ tenantId, factoryRunId }),
    lifecycleNode: null,
    completedNodes: [],
    artifacts: [],
    decisions: [],
    attempt: 0,
    updatedAt: '2026-07-15T12:00:00.000Z',
    ...overrides,
  };
}

function artifact(kind = 'test_report') {
  return { kind, reference: `artifact://${kind}`, checksum: `sha256:${crypto.createHash('sha256').update(kind).digest('hex')}` };
}

module.exports = { artifact, state };
