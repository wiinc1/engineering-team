#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { pushMetrics } = require('../lib/monitoring/pushgateway');

function resolveMetricsPath(baseDir = process.cwd()) {
  return path.join(baseDir, 'observability', 'specialist-delegation-metrics.json');
}

async function main() {
  const baseDir = process.cwd();
  const metricsPath = resolveMetricsPath(baseDir);
  if (!fs.existsSync(metricsPath)) {
    throw Object.assign(new Error(`Delegation metrics snapshot not found at ${metricsPath}`), {
      code: 'SPECIALIST_DELEGATION_METRICS_MISSING',
    });
  }

  const payload = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
  const endpoint = process.env.PUSHGATEWAY_URL;
  const result = await pushMetrics({
    endpoint,
    job: process.env.PUSHGATEWAY_JOB || 'real-specialist-delegation',
    instance: process.env.PUSHGATEWAY_INSTANCE || process.pid,
    metrics: payload.prometheus || {},
  });

  process.stdout.write(`${JSON.stringify({ metricsPath, pushed: !result?.skipped, result }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  resolveMetricsPath,
};
