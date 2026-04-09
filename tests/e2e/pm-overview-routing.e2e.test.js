const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('../fixtures/pm-overview/pm-overview-states.json');

async function loadRouting() {
  return import('../../src/app/task-owner.mjs');
}

function buildItems(tasks) {
  return tasks.map((task) => ({
    task_id: task.task_id,
    title: task.title,
    current_stage: task.initial_stage,
    current_owner: task.assigned_owner,
    owner: task.owner_hidden
      ? { actor_id: task.assigned_owner, redacted: true }
      : task.assigned_owner
        ? { actor_id: task.assigned_owner, display_name: task.assigned_owner }
        : null,
  }));
}

test('e2e: PM overview exposes routed, unassigned, and routing-attention buckets', async () => {
  const { buildPmOverviewSections, mapAgentOptions } = await loadRouting();
  const agentLookup = new Map(mapAgentOptions(fixture.agents).map((agent) => [agent.id, agent]));
  const sections = buildPmOverviewSections(buildItems(fixture.tasks), agentLookup);
  const visible = sections.filter((section) => section.items.length);

  assert.deepEqual(visible.map((section) => section.key), ['needs-routing-attention', 'unassigned', 'architect', 'engineer']);
  assert.equal(visible[0].items[0].pmBucket.routingCue, 'Needs routing attention');
  assert.equal(visible[1].items[0].ownerPresentation.label, 'Unassigned');
  assert.equal(visible[2].items[0].pmBucket.routingCue, 'Architect route');
  assert.equal(visible[3].items[0].pmBucket.routingCue, 'Engineer route');
});
