#!/usr/bin/env node
'use strict';

const { createLangGraphRuntime } = require('../lib/software-factory/langgraph');

async function main() {
  const runtime = createLangGraphRuntime({
    config: { enabled: false },
    nodes: [{ name: 'dormant_runtime', execute: () => ({}) }],
  });
  try {
    const setup = await runtime.setup();
    const health = await runtime.health({ deep: true });
    process.stdout.write(`${JSON.stringify({ setup, health })}\n`);
  } finally {
    await runtime.close();
  }
}

if (require.main === module) main().catch((error) => {
  process.stderr.write(`${error.code || 'langgraph_checkpoint_unavailable'}: ${error.message}\n`);
  process.exit(1);
});

module.exports = { main };
