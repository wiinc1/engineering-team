const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveAgentRegistry, findAgentById } = require('../../lib/audit');

test('provides a default canonical AI-agent registry', () => {
  const registry = resolveAgentRegistry();
  assert.equal(registry.length >= 5, true);
  assert.deepEqual(findAgentById(registry, 'qa'), {
    id: 'qa',
    display_name: 'QA Engineer',
    role: 'QA',
    active: true,
  });
});

test('loads AI-agent registry from config file when provided', () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-agents-'));
  fs.writeFileSync(path.join(baseDir, 'agents.json'), JSON.stringify({ agents: [
    { id: 'agent-one', displayName: 'Agent One', role: 'Engineering', active: true },
    { id: 'agent-two', display_name: 'Agent Two', role: 'QA', active: false },
  ] }, null, 2));

  const registry = resolveAgentRegistry({ baseDir, agentRegistryPath: 'agents.json' });
  assert.equal(registry.length, 2);
  assert.equal(findAgentById(registry, 'agent-one').display_name, 'Agent One');
  assert.equal(findAgentById(registry, 'agent-two').active, false);
});
