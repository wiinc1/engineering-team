import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/role-inbox/role-inbox-states.json' with { type: 'json' };
import {
  buildRoleInboxItems,
  getRoleInboxLabel,
  mapAgentOptions,
  normalizeRoleKey,
  resolveRoleInboxMembership,
  summarizeRoleInboxResults,
} from '../../src/app/task-owner.js';

const agentLookup = new Map(mapAgentOptions(fixture.agents).map((agent) => [agent.id, agent]));

describe('role inbox routing', () => {
  it('normalizes canonical role keys from roster roles', () => {
    expect(normalizeRoleKey('Architect')).toBe('architect');
    expect(normalizeRoleKey('Engineering')).toBe('engineer');
    expect(normalizeRoleKey('QA')).toBe('qa');
    expect(normalizeRoleKey('SRE')).toBe('sre');
    expect(normalizeRoleKey('PM')).toBe(null);
  });

  it('routes assigned tasks into exactly one canonical inbox and excludes unassigned/stale entries', () => {
    const architectTask = { current_owner: 'architect', owner: { actor_id: 'architect' } };
    const engineerTask = { current_owner: 'engineer', owner: { actor_id: 'engineer' } };
    const unassignedTask = { current_owner: null, owner: null };
    const staleTask = { current_owner: 'ghost', owner: { actor_id: 'ghost' } };

    expect(resolveRoleInboxMembership(architectTask, agentLookup)).toMatchObject({ inboxRole: 'architect', reason: 'matched' });
    expect(resolveRoleInboxMembership(engineerTask, agentLookup)).toMatchObject({ inboxRole: 'engineer', reason: 'matched' });
    expect(resolveRoleInboxMembership(unassignedTask, agentLookup)).toMatchObject({ inboxRole: null, reason: 'unassigned' });
    expect(resolveRoleInboxMembership(staleTask, agentLookup)).toMatchObject({ inboxRole: null, reason: 'unknown-owner', isFallback: true });
  });

  it('builds read-only role inbox rows with routing cues and summaries', () => {
    const items = fixture.tasks.map((task) => ({
      task_id: task.task_id,
      title: task.title,
      current_stage: task.initial_stage,
      current_owner: task.assigned_owner,
      owner: task.assigned_owner ? { actor_id: task.assigned_owner, display_name: task.assigned_owner } : null,
    }));

    const qaItems = buildRoleInboxItems(items, 'qa', agentLookup);
    const engineerItems = buildRoleInboxItems(items, 'engineer', agentLookup);

    expect(qaItems).toEqual([]);
    expect(engineerItems).toHaveLength(1);
    expect(engineerItems[0].routing.routingLabel).toContain('Engineer');
    expect(getRoleInboxLabel('qa')).toBe('QA');
    expect(summarizeRoleInboxResults(2, 'qa')).toBe('2 tasks routed to QA.');
  });
});
