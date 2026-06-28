#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { submitFactoryRequirements } = require('../lib/task-platform/factory-delivery');

function readArg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 || index === process.argv.length - 1 ? fallback : process.argv[index + 1];
}

function loadRequirements(inputPath) {
  const resolved = path.resolve(process.cwd(), inputPath);
  const payload = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.requirements)) return payload.requirements;
  if (payload.title || payload.requirements || payload.description) return [payload];
  throw new Error('Requirements file must be an array or { requirements: [...] }');
}

async function main() {
  const inputPath = readArg('--file', readArg('--in', ''));
  const title = readArg('--title', '');
  const requirements = readArg('--requirements', readArg('--body', ''));
  let entries = [];

  if (inputPath) {
    entries = loadRequirements(inputPath);
  } else if (title && requirements) {
    entries = [{ title, requirements, templateTier: readArg('--tier', 'Simple') }];
  } else {
    throw new Error('Provide --file <json> or --title and --requirements');
  }

  const result = submitFactoryRequirements(entries, {
    baseUrl: readArg('--base-url', process.env.FACTORY_BASE_URL || 'http://127.0.0.1:13000'),
    queuePath: readArg('--queue', process.env.FACTORY_QUEUE_PATH || 'observability/factory-delivery-queue.json'),
  });

  process.stdout.write(`${JSON.stringify({
    ok: true,
    queuePath: result.queuePath,
    submitted: result.created.length,
    items: result.created.map((item) => ({
      id: item.id,
      title: item.title,
      stage: item.stage,
      evidencePath: item.evidencePath,
    })),
    next: 'npm run factory:orchestrator -- --once',
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
  process.exitCode = 1;
});