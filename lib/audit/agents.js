const fs = require('fs');
const path = require('path');

const DEFAULT_AI_AGENT_REGISTRY = Object.freeze([
  { id: 'pm', display_name: 'Product Manager', role: 'PM', active: true },
  { id: 'architect', display_name: 'Architect', role: 'Architecture', active: true },
  { id: 'engineer', display_name: 'Engineer', role: 'Engineering', active: true },
  { id: 'qa', display_name: 'QA Engineer', role: 'QA', active: true },
  { id: 'sre', display_name: 'Site Reliability Engineer', role: 'SRE', active: true },
]);

function normalizeAgent(input = {}) {
  return {
    id: String(input.id || '').trim(),
    display_name: String(input.display_name || input.displayName || input.id || '').trim(),
    role: String(input.role || '').trim() || null,
    active: input.active !== false,
  };
}

function normalizeRegistry(entries = []) {
  return entries
    .map(normalizeAgent)
    .filter(agent => agent.id)
    .filter((agent, index, all) => all.findIndex(entry => entry.id === agent.id) === index);
}

function resolveAgentRegistry(options = {}) {
  if (Array.isArray(options.agentRegistry)) {
    return normalizeRegistry(options.agentRegistry);
  }

  const registryPath = options.agentRegistryPath || process.env.AUDIT_AGENT_REGISTRY_PATH;
  if (registryPath) {
    const absolutePath = path.isAbsolute(registryPath)
      ? registryPath
      : path.join(options.baseDir || process.cwd(), registryPath);
    const parsed = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
    return normalizeRegistry(Array.isArray(parsed) ? parsed : parsed.agents || []);
  }

  return normalizeRegistry(DEFAULT_AI_AGENT_REGISTRY);
}

function findAgentById(registry = [], agentId) {
  const normalized = String(agentId || '').trim();
  return registry.find(agent => agent.id === normalized) || null;
}

module.exports = {
  DEFAULT_AI_AGENT_REGISTRY,
  resolveAgentRegistry,
  findAgentById,
};
