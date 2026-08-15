'use strict';

const {
  createLifecycleHandlers,
  createLifecycleServices,
} = require('./production-lifecycle-services');

module.exports = {
  handlers: createLifecycleHandlers(),
  services: createLifecycleServices(),
};
