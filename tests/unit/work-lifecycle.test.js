import { describe, expect, it } from 'vitest';
import {
  buildBoardStageOrder,
  canTransitionLifecycleTask,
  isTaskAssignedToCurrentActor,
  matchesTaskSearch,
} from '../../src/app/work-lifecycle.mjs';

const agentLookup = new Map([
  ['engineer', { id: 'engineer', role: 'Engineering' }],
  ['qa', { id: 'qa', role: 'QA' }],
]);

describe('work lifecycle helpers', () => {
  it('orders lifecycle stages ahead of non-lifecycle columns', () => {
    const order = buildBoardStageOrder([
      { current_stage: 'REVIEW' },
      { current_stage: 'VERIFY' },
      { current_stage: 'BACKLOG' },
      { current_stage: 'TODO' },
    ]);

    expect(order).toEqual(['BACKLOG', 'TODO', 'VERIFY', 'REVIEW']);
  });

  it('matches task search against task id and title', () => {
    expect(matchesTaskSearch({ task_id: 'TSK-47', title: 'Design routing architecture' }, 'routing')).toBe(true);
    expect(matchesTaskSearch({ task_id: 'TSK-47', title: 'Design routing architecture' }, 'tsk-47')).toBe(true);
    expect(matchesTaskSearch({ task_id: 'TSK-47', title: 'Design routing architecture' }, 'missing')).toBe(false);
  });

  it('recognizes assignee ownership from either subject or canonical role', () => {
    expect(isTaskAssignedToCurrentActor({ current_owner: 'engineer' }, { sub: 'engineer', roles: ['reader'] }, agentLookup)).toBe(true);
    expect(isTaskAssignedToCurrentActor({ current_owner: 'qa' }, { sub: 'user-1', roles: ['qa'] }, agentLookup)).toBe(true);
    expect(isTaskAssignedToCurrentActor({ current_owner: 'qa' }, { sub: 'user-1', roles: ['pm'] }, agentLookup)).toBe(false);
  });

  it('enforces assignee and sre-only lifecycle transitions', () => {
    expect(
      canTransitionLifecycleTask(
        { current_stage: 'IN_PROGRESS', current_owner: 'engineer' },
        'VERIFY',
        { sub: 'user-1', roles: ['reader'] },
        agentLookup,
      ),
    ).toMatchObject({ allowed: false });

    expect(
      canTransitionLifecycleTask(
        { current_stage: 'IN_PROGRESS', current_owner: 'engineer' },
        'VERIFY',
        { sub: 'user-1', roles: ['engineer'] },
        agentLookup,
      ),
    ).toMatchObject({ allowed: true });

    expect(
      canTransitionLifecycleTask(
        { current_stage: 'VERIFY', current_owner: 'qa' },
        'DONE',
        { sub: 'user-1', roles: ['qa'] },
        agentLookup,
      ),
    ).toMatchObject({ allowed: false });

    expect(
      canTransitionLifecycleTask(
        { current_stage: 'VERIFY', current_owner: 'qa' },
        'DONE',
        { sub: 'user-1', roles: ['sre'] },
        agentLookup,
      ),
    ).toMatchObject({ allowed: true });
  });
});
