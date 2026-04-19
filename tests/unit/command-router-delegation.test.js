const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const runtimeRunnerPath = path.join(__dirname, '..', 'fixtures', 'specialist-runtime-runner.js');
const repoRoot = path.join(__dirname, '..', '..');
const tasksDir = path.join(repoRoot, 'tasks');
const taskPath = path.join(tasksDir, 'TSK-998-runtime-test.md');
const artifactPath = path.join(repoRoot, 'observability', 'specialist-delegation.jsonl');
const { taskMove } = require('../../scripts/command-router');

function writeTask(type = 'dev') {
  fs.writeFileSync(taskPath, `# Runtime delegation task\n\n**Status:** TODO\n**Type:** ${type}\n**Created:** 2026-04-06 18:00 CDT\n**Updated:** 2026-04-06 18:00 CDT\n\n## 📝 Description\n\nValidate runtime delegation.\n\n## 🔄 Status History\n\n| Date | From | To | Actor | Note |\n|------|------|----|----|------|\n`);
}

test.afterEach(() => {
  try { fs.unlinkSync(taskPath); } catch {}
  try { fs.unlinkSync(artifactPath); } catch {}
});

test('taskMove wires runtime-backed specialist delegation into IN_PROGRESS flow', async () => {
  writeTask('dev');
  const reply = await taskMove('TSK-998 IN_PROGRESS --note start work', { id: 'msg-1', author: { username: 'alice' } }, {
    delegationRunnerCommand: `node ${runtimeRunnerPath}`,
    baseDir: repoRoot,
  });

  assert.match(reply, /Runtime delegation confirmed/);
  assert.match(reply, /session `runtime-session-/);

  const artifactLines = fs.readFileSync(artifactPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  const artifact = artifactLines.at(-1);
  assert.equal(artifact.target_specialist, 'engineer');
  assert.equal(artifact.actual_agent, 'engineer');
  assert.equal(artifact.ownership.runtime, 'fixture-openclaw');
});

test('taskMove falls back truthfully when runtime delegation is not configured', async () => {
  writeTask('dev');
  const reply = await taskMove('TSK-998 IN_PROGRESS', { id: 'msg-2', author: { username: 'bob' } }, {
    baseDir: repoRoot,
    delegationRunnerCommand: '',
  });

  assert.match(reply, /Runtime delegation not confirmed/);
  assert.match(reply, /not configured or not available/i);
  assert.doesNotMatch(reply, /owns this run/);
});

test('taskMove does not claim runtime ownership for unsupported task types', async () => {
  writeTask('unknown');
  const reply = await taskMove('TSK-998 IN_PROGRESS', { id: 'msg-3', author: { username: 'carol' } }, {
    delegationRunnerCommand: `node ${runtimeRunnerPath}`,
    baseDir: repoRoot,
  });

  assert.match(reply, /Runtime delegation not confirmed/);
  assert.match(reply, /unsupported for runtime delegation/i);
});

test('taskMove reports unverifiable runtime output without leaking raw runtime details', async () => {
  writeTask('dev');
  const reply = await taskMove('TSK-998 IN_PROGRESS', { id: 'msg-4', author: { username: 'dora' } }, {
    delegationRunnerCommand: `node ${runtimeRunnerPath}`,
    baseDir: repoRoot,
    runnerEnv: {
      FIXTURE_RUNTIME_MODE: 'missing-evidence',
    },
  });

  assert.match(reply, /Runtime delegation not confirmed/);
  assert.match(reply, /could not be verified/i);
  assert.doesNotMatch(reply, /agentId/i);
  assert.doesNotMatch(reply, /sessionId/i);
});
