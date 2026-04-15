import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/role-inbox/role-inbox-states.json' with { type: 'json' };
import {
  buildGovernanceReviewItems,
  buildRoleInboxItems,
  getRoleInboxLabel,
  mapAgentOptions,
  normalizeRoleKey,
  resolveQueueReason,
  resolveRoleInboxMembership,
  sortInboxItems,
  summarizeRoleInboxResults,
} from '../../src/app/task-owner.mjs';

const agentLookup = new Map(mapAgentOptions(fixture.agents).map((agent) => [agent.id, agent]));

describe('role inbox routing', () => {
  it('normalizes canonical role keys from roster roles', () => {
    expect(normalizeRoleKey('Architect')).toBe('architect');
    expect(normalizeRoleKey('Engineering')).toBe('engineer');
    expect(normalizeRoleKey('QA')).toBe('qa');
    expect(normalizeRoleKey('SRE')).toBe('sre');
    expect(normalizeRoleKey('PM')).toBe('pm');
    expect(normalizeRoleKey('Human Stakeholder')).toBe('human');
  });

  it('routes assigned and explicitly waiting tasks into the correct canonical inbox', () => {
    const architectTask = { current_owner: 'architect', owner: { actor_id: 'architect' } };
    const engineerTask = { current_owner: 'engineer', owner: { actor_id: 'engineer' } };
    const seniorEngineerTask = { current_owner: 'engineer-sr', owner: { actor_id: 'engineer-sr' } };
    const pmTask = { current_owner: null, owner: null, waiting_state: 'awaiting_pm_decision' };
    const architectWaitTask = { current_owner: 'engineer', owner: { actor_id: 'engineer' }, waiting_state: 'awaiting_architect_decision' };
    const sreMonitoringTask = { current_owner: 'engineer', owner: { actor_id: 'engineer' }, current_stage: 'SRE_MONITORING' };
    const humanTask = { current_owner: null, owner: null, next_required_action: 'Human approval required' };
    const escalatedSreTask = { current_owner: 'engineer', owner: { actor_id: 'engineer' }, current_stage: 'SRE_MONITORING', waiting_state: 'awaiting_human_stakeholder_escalation' };
    const unassignedTask = { current_owner: null, owner: null };
    const staleTask = { current_owner: 'ghost', owner: { actor_id: 'ghost' } };
    const governanceTask = { current_owner: 'architect', owner: { actor_id: 'architect' }, task_type: 'governance_review' };

    expect(resolveRoleInboxMembership(architectTask, agentLookup)).toMatchObject({ inboxRole: 'architect', reason: 'matched' });
    expect(resolveRoleInboxMembership(engineerTask, agentLookup)).toMatchObject({ inboxRole: 'engineer', reason: 'matched' });
    expect(resolveRoleInboxMembership(seniorEngineerTask, agentLookup)).toMatchObject({ inboxRole: 'engineer', reason: 'matched-pattern' });
    expect(resolveRoleInboxMembership(pmTask, agentLookup)).toMatchObject({ inboxRole: 'pm', reason: 'waiting-pm' });
    expect(resolveRoleInboxMembership(architectWaitTask, agentLookup)).toMatchObject({ inboxRole: 'architect', reason: 'waiting-architect' });
    expect(resolveRoleInboxMembership(sreMonitoringTask, agentLookup)).toMatchObject({ inboxRole: 'sre', reason: 'stage-sre-monitoring' });
    expect(resolveRoleInboxMembership(humanTask, agentLookup)).toMatchObject({ inboxRole: 'human', reason: 'waiting-human' });
    expect(resolveRoleInboxMembership(escalatedSreTask, agentLookup)).toMatchObject({ inboxRole: 'human', reason: 'waiting-human' });
    expect(resolveRoleInboxMembership(unassignedTask, agentLookup)).toMatchObject({ inboxRole: null, reason: 'unassigned' });
    expect(resolveRoleInboxMembership(staleTask, agentLookup)).toMatchObject({ inboxRole: null, reason: 'unknown-owner', isFallback: true });
    expect(resolveRoleInboxMembership(governanceTask, agentLookup)).toMatchObject({ inboxRole: null, reason: 'governance-review' });
  });

  it('builds read-only role inbox rows with routing cues, queue reasons, and summaries', () => {
    const items = fixture.tasks.map((task) => ({
      task_id: task.task_id,
      title: task.title,
      current_stage: task.initial_stage,
      current_owner: task.assigned_owner,
      priority: task.priority,
      freshness: { last_updated_at: `2026-04-01T00:00:0${task.task_id.endsWith('1') ? '1' : task.task_id.endsWith('2') ? '2' : '3'}.000Z` },
      owner: task.assigned_owner ? { actor_id: task.assigned_owner, display_name: task.assigned_owner } : null,
    }));

    const qaItems = buildRoleInboxItems(items, 'qa', agentLookup);
    const engineerItems = buildRoleInboxItems(items, 'engineer', agentLookup);

    expect(qaItems).toEqual([]);
    expect(engineerItems).toHaveLength(1);
    expect(engineerItems[0].routing.routingLabel).toContain('Engineer');
    expect(engineerItems[0].queueReason.label).toBe('Active work retained');
    expect(engineerItems[0].queueReason.detail).toContain('P1');
    expect(getRoleInboxLabel('qa')).toBe('QA');
    expect(summarizeRoleInboxResults(2, 'qa')).toBe('2 tasks routed to QA.');
  });

  it('builds human inbox rows from close-governance decision previews', () => {
    const items = [
      {
        task_id: 'TSK-HUMAN-1',
        title: 'Resolve governed close review',
        current_stage: 'PM_CLOSE_REVIEW',
        current_owner: null,
        priority: 'P1',
        waiting_state: 'awaiting_human_stakeholder_escalation',
        next_required_action: 'Human stakeholder escalation required for exceptional dispute.',
        freshness: { last_updated_at: '2026-04-01T00:00:01.000Z' },
        close_governance: {
          cancellation: { awaitingHumanDecision: true },
          escalation: {
            source: 'exceptional_dispute',
            summary: 'A human stakeholder must resolve the exceptional dispute before close review can finish.',
            recommendation: 'Decide whether to cancel the release or reopen implementation.',
          },
          humanDecision: {
            required: true,
            summary: 'Human stakeholder decision required before the task can close.',
          },
        },
      },
    ];

    const humanItems = buildRoleInboxItems(items, 'human', agentLookup);
    expect(humanItems).toHaveLength(1);
    expect(humanItems[0].queueReason.label).toBe('Human stakeholder decision required before the task can close.');
    expect(humanItems[0].queueReason.detail).toContain('Decision-ready close governance item.');
  });

  it('sorts inbox rows by priority, then queue age, then stable task id', () => {
    const ordered = sortInboxItems([
      { task_id: 'TSK-3', priority: 'P1', freshness: { last_updated_at: '2026-04-01T00:00:03.000Z' } },
      { task_id: 'TSK-1', priority: 'P0', freshness: { last_updated_at: '2026-04-01T00:00:02.000Z' } },
      { task_id: 'TSK-2', priority: 'P0', freshness: { last_updated_at: '2026-04-01T00:00:02.000Z' } },
      { task_id: 'TSK-4', priority: 'P1', freshness: { last_updated_at: '2026-04-01T00:00:01.000Z' } },
    ]);

    expect(ordered.map((item) => item.task_id)).toEqual(['TSK-1', 'TSK-2', 'TSK-4', 'TSK-3']);
  });

  it('sorts SRE inbox rows by remaining monitoring time after priority', () => {
    const ordered = sortInboxItems([
      { task_id: 'TSK-3', priority: 'P1', monitoring: { timeRemainingMs: 6_000 }, freshness: { last_updated_at: '2026-04-01T00:00:03.000Z' } },
      { task_id: 'TSK-1', priority: 'P1', monitoring: { timeRemainingMs: 1_000 }, freshness: { last_updated_at: '2026-04-01T00:00:01.000Z' } },
      { task_id: 'TSK-2', priority: 'P1', monitoring: { timeRemainingMs: 3_000 }, freshness: { last_updated_at: '2026-04-01T00:00:02.000Z' } },
    ], 'sre');

    expect(ordered.map((item) => item.task_id)).toEqual(['TSK-1', 'TSK-2', 'TSK-3']);
  });

  it('marks active work as non-preemptive in the queue reason', () => {
    const reason = resolveQueueReason({ priority: 'P2', current_stage: 'IN_PROGRESS' }, 'engineer');
    expect(reason.label).toBe('Active work retained');
    expect(reason.detail).toMatch(/not automatically preempt/i);
  });

  it('excludes governance review tasks from role inbox item lists', () => {
    const items = [
      { task_id: 'TSK-1', current_owner: 'architect', current_stage: 'BACKLOG', priority: 'P1', freshness: { last_updated_at: '2026-04-01T00:00:01.000Z' }, owner: { actor_id: 'architect' } },
      { task_id: 'TSK-2', current_owner: 'architect', current_stage: 'BACKLOG', priority: 'P1', task_type: 'governance_review', freshness: { last_updated_at: '2026-04-01T00:00:02.000Z' }, owner: { actor_id: 'architect' } },
    ];

    const architectItems = buildRoleInboxItems(items, 'architect', agentLookup);
    expect(architectItems.map((item) => item.task_id)).toEqual(['TSK-1']);
  });

  it('builds a dedicated governance review list and preserves synthetic engineer owner labels', () => {
    const items = [
      { task_id: 'GHOST-1', title: 'Inactivity review for TSK-42', current_owner: 'architect', current_stage: 'BACKLOG', priority: 'P1', task_type: 'governance_review', freshness: { last_updated_at: '2026-04-01T00:00:01.000Z' }, owner: { actor_id: 'architect' } },
      { task_id: 'TSK-2', title: 'Delivery work', current_owner: 'engineer-sr', current_stage: 'IMPLEMENT', priority: 'P1', freshness: { last_updated_at: '2026-04-01T00:00:02.000Z' }, owner: { actor_id: 'engineer-sr' } },
    ];

    const governanceItems = buildGovernanceReviewItems(items, agentLookup);
    expect(governanceItems.map((item) => item.task_id)).toEqual(['GHOST-1']);

    const engineerItems = buildRoleInboxItems(items, 'engineer', agentLookup);
    expect(engineerItems).toHaveLength(1);
    expect(engineerItems[0].ownerPresentation.label).toBe('Senior Engineer');
  });
});
