const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('../fixtures/pm-overview/pm-overview-states.json');

async function loadRouting() {
  return import('../../src/app/task-owner.js');
}

function toProjectedItems(tasks, reassignedOwner = null) {
  return tasks.map((task) => ({
    task_id: task.task_id,
    title: task.title,
    current_stage: task.initial_stage,
    current_owner: task.task_id === 'TSK-PM-2' && reassignedOwner ? reassignedOwner : task.assigned_owner,
    waiting_state: task.waiting_state || null,
    next_required_action: task.next_required_action || null,
    owner: task.owner_hidden
      ? { actor_id: task.assigned_owner, redacted: true }
      : task.assigned_owner
        ? { actor_id: task.assigned_owner, display_name: task.assigned_owner }
        : null,
  }));
}

test('integration: PM overview grouping reflects reassignment after refresh', async () => {
  const { buildPmOverviewSections, mapAgentOptions } = await loadRouting();
  const agentLookup = new Map(mapAgentOptions(fixture.agents).map((agent) => [agent.id, agent]));
  const initialSections = buildPmOverviewSections(toProjectedItems(fixture.tasks), agentLookup);
  assert.equal(initialSections.find((section) => section.key === 'engineer').items.length, 1);
  assert.equal(initialSections.find((section) => section.key === 'qa').items.length, 0);
  assert.equal(initialSections.find((section) => section.key === 'needs-routing-attention').items.length, 2);

  const refreshedSections = buildPmOverviewSections(toProjectedItems(fixture.tasks, fixture.tasks[1].reassigned_owner), agentLookup);
  assert.equal(refreshedSections.find((section) => section.key === 'engineer').items.length, 0);
  assert.equal(refreshedSections.find((section) => section.key === 'qa').items.length, 1);
});

test('integration: PM overview keeps no-owner work unassigned and preserves assigned-owner buckets despite waiting-state metadata', async () => {
  const { buildPmOverviewSections, mapAgentOptions } = await loadRouting();
  const agentLookup = new Map(mapAgentOptions(fixture.agents).map((agent) => [agent.id, agent]));
  const sections = buildPmOverviewSections(toProjectedItems([
    {
      task_id: 'TSK-PM-WAITING',
      title: 'Await PM triage',
      initial_stage: 'TODO',
      assigned_owner: null,
      waiting_state: 'awaiting_pm_decision',
      next_required_action: 'PM triage required',
    },
    {
      task_id: 'TSK-PM-ENGINEER',
      title: 'Engineer follow-up',
      initial_stage: 'IMPLEMENT',
      assigned_owner: 'engineer',
      waiting_state: 'awaiting_pm_decision',
      next_required_action: 'PM answer pending',
    },
  ]), agentLookup);

  assert.equal(sections.find((section) => section.key === 'unassigned').items.length, 1);
  assert.equal(sections.find((section) => section.key === 'engineer').items.length, 1);
  assert.equal(sections.find((section) => section.key === 'needs-routing-attention').items.length, 0);
});
