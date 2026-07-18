'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { assertProductionLifecycleServices } = require('./production-ports');
const { assertHandlers } = require('../../task-platform/langgraph-lifecycle-services');

function enabled(value) {
  return value === true || ['true', '1', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function resolveServiceModule(modulePath, baseDir) {
  if (!modulePath) throw new Error('LANGGRAPH_LIFECYCLE_SERVICES_MODULE is required when LangGraph is enabled.');
  const root = fs.realpathSync(baseDir || process.cwd());
  const requested = path.resolve(root, modulePath);
  const requestedRelative = path.relative(root, requested);
  if (requestedRelative.startsWith('..') || path.isAbsolute(requestedRelative)) {
    throw new Error('LANGGRAPH_LIFECYCLE_SERVICES_MODULE must resolve inside the application directory.');
  }
  const candidate = fs.realpathSync(requested);
  const relative = path.relative(root, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('LANGGRAPH_LIFECYCLE_SERVICES_MODULE must resolve inside the application directory.');
  }
  return candidate;
}

function loadModule(options = {}) {
  const env = options.env || process.env;
  const resolved = resolveServiceModule(
    options.modulePath || env.LANGGRAPH_LIFECYCLE_SERVICES_MODULE,
    options.baseDir || process.cwd(),
  );
  // The module is an operator-selected, revision-controlled composition root.
  // eslint-disable-next-line global-require, import/no-dynamic-require
  return require(resolved);
}

function materialize(loaded, names, options) {
  const factory = names.map((name) => loaded[name]).find((value) => typeof value === 'function');
  const value = typeof factory === 'function'
    ? factory({ baseDir: options.baseDir || process.cwd(), ...(options.context || {}) })
    : null;
  if (value && typeof value.then === 'function') {
    throw new Error('Lifecycle composition module factories must be synchronous.');
  }
  return value;
}

function loadProductionLifecycleHandlerFactory(options = {}) {
  const env = options.env || process.env;
  if (!enabled(options.enabled ?? env.FF_LANGGRAPH_RUNTIME)) return null;
  const loaded = loadModule(options);
  const names = ['createProductionLifecycleHandlers', 'createLifecycleHandlers'];
  const moduleFactory = names.map((name) => loaded[name]).find((value) => typeof value === 'function');
  if (!moduleFactory && !loaded.handlers) {
    throw new Error('Lifecycle composition module must export createLifecycleHandlers or handlers.');
  }
  return (context = {}) => {
    const handlers = moduleFactory
      ? moduleFactory(Object.freeze({
        baseDir: options.baseDir || process.cwd(),
        env,
        ...context,
      }))
      : loaded.handlers;
    if (handlers && typeof handlers.then === 'function') {
      throw new Error('Lifecycle composition module factories must be synchronous.');
    }
    return assertHandlers(handlers);
  };
}

function loadProductionLifecycleServices(options = {}) {
  const env = options.env || process.env;
  if (!enabled(options.enabled ?? env.FF_LANGGRAPH_RUNTIME)) return null;
  const loaded = loadModule(options);
  const factory = loaded.createProductionLifecycleServices || loaded.createLifecycleServices;
  const services = typeof factory === 'function'
    ? factory({ baseDir: options.baseDir || process.cwd() })
    : (loaded.services || loaded);
  if (services && typeof services.then === 'function') {
    throw new Error('Lifecycle service module factories must be synchronous composition roots.');
  }
  return assertProductionLifecycleServices(services);
}

function loadProductionLifecycleHandlers(options = {}) {
  const factory = loadProductionLifecycleHandlerFactory(options);
  return factory ? factory(options.context || {}) : null;
}

module.exports = {
  enabled,
  loadProductionLifecycleHandlerFactory,
  loadProductionLifecycleHandlers,
  loadProductionLifecycleServices,
  resolveServiceModule,
};
