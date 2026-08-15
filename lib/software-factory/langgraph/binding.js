'use strict';

const { AsyncLocalStorage } = require('async_hooks');
const { LangGraphRuntimeError } = require('./errors');

const storage = new AsyncLocalStorage();

function withTenantBinding(binding, action) {
  return storage.run(Object.freeze({ ...binding }), action);
}

function requireTenantBinding(threadId) {
  const binding = storage.getStore();
  if (!binding || binding.threadId !== threadId || !binding.tenantId) {
    throw new LangGraphRuntimeError('langgraph_tenant_mismatch', { safeDetails: { reason: 'missing_server_binding' } });
  }
  return binding;
}

function currentTenantBinding() {
  return storage.getStore() || null;
}

function createLeaseGuard(owner) {
  let failure = null;
  return Object.freeze({
    owner,
    fail(error) { failure ||= error; },
    assertActive() {
      if (failure) throw failure;
    },
  });
}

module.exports = { createLeaseGuard, currentTenantBinding, requireTenantBinding, withTenantBinding };
