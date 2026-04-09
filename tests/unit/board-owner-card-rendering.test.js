import { describe, expect, it } from 'vitest';
import { buildBoardColumns, mapAgentOptions, resolveOwnerPresentation, UNASSIGNED_FILTER_VALUE } from '../../src/app/task-owner.mjs';
import fixture from '../fixtures/board-owner/board-owner-states.json' with { type: 'json' };

const agentLookup = new Map(mapAgentOptions(fixture.agents).map((agent) => [agent.id, agent]));

describe('board owner card rendering', () => {
  it('renders assigned, unassigned, unknown, and explicitly hidden owner states with stable labels', () => {
    const owned = resolveOwnerPresentation({ current_owner: 'qa', owner: { actor_id: 'qa', display_name: 'qa' } }, agentLookup);
    const unassigned = resolveOwnerPresentation({ current_owner: null, owner: null }, agentLookup);
    const unknown = resolveOwnerPresentation({ current_owner: 'ghost', owner: { actor_id: 'ghost', display_name: '' } }, agentLookup);
    const hidden = resolveOwnerPresentation({ current_owner: 'masked', owner: { actor_id: 'masked', display_name: '', redacted: true } }, agentLookup);

    expect(owned.label).toBe('QA Engineer · QA');
    expect(unassigned).toMatchObject({ label: 'Unassigned', tone: 'unassigned', filterValue: UNASSIGNED_FILTER_VALUE });
    expect(unknown.label).toBe('Unknown owner');
    expect(hidden.label).toBe('Owner hidden');
    expect(hidden.detail).toContain('intentionally redacted');
  });

  it('builds board columns with owner presentation attached to every visible card', () => {
    const visibleItems = fixture.tasks.map((task) => ({
      task_id: task.task_id,
      title: task.title,
      current_stage: task.initial_stage,
      priority: task.priority,
      current_owner: task.assigned_owner,
      owner: task.owner ?? (task.assigned_owner ? { actor_id: task.assigned_owner, display_name: task.assigned_owner } : null),
    }));

    const columns = buildBoardColumns(visibleItems, visibleItems, agentLookup);
    const cards = columns.flatMap((column) => column.items);

    expect(columns.map((column) => column.stage)).toEqual(['BACKLOG', 'TODO', 'IMPLEMENT', 'REVIEW']);
    expect(cards).toHaveLength(5);
    expect(cards.every((card) => card.ownerPresentation && typeof card.ownerPresentation.label === 'string')).toBe(true);
    expect(cards.find((card) => card.task_id === 'TSK-BOARD-5').ownerPresentation.label).toBe('Owner hidden');
  });
});
