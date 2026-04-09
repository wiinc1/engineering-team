import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/pm-overview/pm-overview-states.json' with { type: 'json' };
import { buildPmOverviewSections, mapAgentOptions, resolvePmOverviewBucket, summarizePmOverviewResults } from '../../src/app/task-owner.mjs';

const agentLookup = new Map(mapAgentOptions(fixture.agents).map((agent) => [agent.id, agent]));

const items = [
  { task_id: 'TSK-PM-1', title: 'Architecture review', current_stage: 'BACKLOG', current_owner: 'architect', owner: { actor_id: 'architect' } },
  { task_id: 'TSK-PM-2', title: 'Queue triage', current_stage: 'TODO', current_owner: null, owner: null, waiting_state: 'awaiting_pm_decision' },
  { task_id: 'TSK-PM-3', title: 'Unknown mapping', current_stage: 'REVIEW', current_owner: 'ghost', owner: { actor_id: 'ghost' } },
  { task_id: 'TSK-PM-4', title: 'Restricted owner', current_stage: 'VERIFY', current_owner: 'masked', owner: { actor_id: 'masked', redacted: true }, next_required_action: 'Human approval required' },
  { task_id: 'TSK-PM-5', title: 'PM-routed owner', current_stage: 'BACKLOG', current_owner: 'pm-1', owner: { actor_id: 'pm-1' } },
  { task_id: 'TSK-PM-6', title: 'Engineer waiting on PM', current_stage: 'IMPLEMENT', current_owner: 'engineer', owner: { actor_id: 'engineer' }, waiting_state: 'awaiting_pm_decision' },
];

describe('pm overview routing', () => {
  it('assigns every task to exactly one PM bucket with explicit fallback labels', () => {
    expect(resolvePmOverviewBucket(items[0], agentLookup)).toMatchObject({ key: 'architect', routingCue: 'Architect route' });
    expect(resolvePmOverviewBucket(items[1], agentLookup)).toMatchObject({ key: 'unassigned', label: 'Unassigned' });
    expect(resolvePmOverviewBucket(items[2], agentLookup)).toMatchObject({ key: 'needs-routing-attention', degradedLabel: 'Role mapping unavailable' });
    expect(resolvePmOverviewBucket(items[3], agentLookup)).toMatchObject({ key: 'needs-routing-attention', degradedLabel: 'Role mapping unavailable' });
    expect(resolvePmOverviewBucket(items[4], agentLookup)).toMatchObject({
      key: 'needs-routing-attention',
      degradedLabel: 'Role mapping unavailable',
      routingReason: 'Role mapping unavailable because canonical role PM is outside the PM overview buckets for this slice.',
    });
    expect(resolvePmOverviewBucket(items[5], agentLookup)).toMatchObject({
      key: 'engineer',
      routingCue: 'Engineer route',
      routingReason: 'Routed to Engineer because the assigned owner maps to that canonical role.',
    });
  });

  it('builds sections in the required display order and summarizes filtered results', () => {
    const sections = buildPmOverviewSections(items, agentLookup);
    expect(sections.map((section) => section.key)).toEqual(['needs-routing-attention', 'unassigned', 'architect', 'engineer', 'qa', 'sre']);
    expect(sections[0].items).toHaveLength(3);
    expect(sections[1].items).toHaveLength(1);
    expect(sections[2].items).toHaveLength(1);
    expect(sections[3].items).toHaveLength(1);
    expect(summarizePmOverviewResults(sections.filter((section) => section.items.length), '')).toBe('6 tasks shown across 4 buckets.');
    expect(summarizePmOverviewResults(sections.filter((section) => section.key === 'engineer'), 'engineer')).toBe('1 task shown in Engineer.');
  });
});
