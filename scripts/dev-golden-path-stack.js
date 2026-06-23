#!/usr/bin/env node
const { main } = require('./dev-golden-path/stack');

main(process.argv).catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
  process.exitCode = 1;
});