#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const inventory = require('../config/runtime-legacy-entrypoints.json');

function verify(scope, rootDir = process.cwd()) {
  if (!['jobs', 'factory'].includes(scope)) throw new Error('Scope must be jobs or factory.');
  const present = inventory[scope].filter((relative) => fs.existsSync(path.join(rootDir, relative)));
  return Object.freeze({
    ok: present.length === 0, scope, checked: inventory[scope].length,
    code: present.length ? 'legacy_runtime_reference_present' : null,
    present: Object.freeze(present),
  });
}

function main() {
  const index = process.argv.indexOf('--scope');
  const result = verify(index >= 0 ? process.argv[index + 1] : '');
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) {
  try { main(); } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: 'legacy_runtime_guard_invalid', message: error.message })}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main, verify };
