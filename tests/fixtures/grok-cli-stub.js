#!/usr/bin/env node

'use strict';

const sessionFlag = process.argv.indexOf('--session-id');
const sessionId = sessionFlag !== -1
  ? process.argv[sessionFlag + 1]
  : '44444444-4444-4444-8444-444444444444';

process.stdout.write(`${JSON.stringify({
  sessionId,
  output: 'OK',
  message: 'OK',
})}\n`);
