'use strict';

const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

it('uses the lockfile rather than tracked node_modules as the dependency source', () => {
  const tracked = execFileSync('git', ['ls-files', 'node_modules'], { encoding: 'utf8' }).trim();
  assert.equal(tracked, '');
  assert.equal(fs.existsSync('package-lock.json'), true);
  const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
  assert.equal(lock.packages[''].name, manifest.name);
  assert.equal(lock.packages[''].version, manifest.version);
});
