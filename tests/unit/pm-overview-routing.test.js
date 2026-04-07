import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/pm-overview/pm-overview-states.json' with { type: 'json' };
import { buildPmOverviewSections, mapAgentOptions, resolvePmOverviewBucket, summarizePmOverviewResults } from '../../src/app/task-owner.js';

const agentLookup = new Map(mapAgentOptions(fixture.agents).map((agent) => [agent.id, agent]));

const items = [
  { task_id: 'TSK-PM-1', title: 'Architecture review', current_stage: 'BACKLOG', current_owner: 'architect', owner: { actor_id: 'architect' } },
  { task_id: 'TSK-PM-2', title: 'Queue triage', current_stage: 'TODO', current_owner: null, owner: null },
  { task_id: 'TSK-PM-3', title: 'Unknown mapping', current_stage: 'REVIEW', current_owner: 'ghost', owner: { actor_id: 'ghost' } },
  { task_id: 'TSK-PM-4', title: 'Restricted owner', current_stage: 'VERIFY', current_owner: 'masked', owner: { actor_id: 'masked', redacted: true } },
];

describe('pm overview routing', () => {
  it('assigns every task to exactly one PM bucket with explicit fallback labels', () => {
    expect(resolvePmOverviewBucket(items[0], agentLookup)).toMatchObject({ key: 'architect', routingCue: 'Architect route' });
    expect(resolvePmOverviewBucket(items[1], agentLookup)).toMatchObject({ key: 'unassigned', label: 'Unassigned' });
    expect(resolvePmOverviewBucket(items[2], agentLookup)).toMatchObject({ key: 'needs-routing-attention', degradedLabel: 'Role mapping unavailable' });
    expect(resolvePmOverviewBucket(items[3], agentLookup)).toMatchObject({ key: 'needs-routing-attention', degradedLabel: 'Role mapping unavailable' });
  });

  it('builds sections in the required display order and summarizes filtered results', () => {
    const sections = buildPmOverviewSections(items, agentLookup);
    expect(sections.map((section) => section.key)).toEqual(['needs-routing-attention', 'unassigned', 'pm', 'architect', 'engineer', 'qa', 'sre', 'human']);
    expect(sections[0].items).toHaveLength(2);
    expect(sections[1].items).toHaveLength(1);
    expect(sections[2].items).toHaveLength(0);
    expect(sections[3].items).toHaveLength(1);
    expect(summarizePmOverviewResults(sections.filter((section) => section.items.length), '')).toBe('4 tasks shown across 3 buckets.');
    expect(summarizePmOverviewResults(sections.filter((section) => section.key === 'engineer'), 'engineer')).toBe('0 tasks shown in Engineer.');
  });
});
