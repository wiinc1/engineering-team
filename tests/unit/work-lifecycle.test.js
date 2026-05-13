import { describe, expect, it } from 'vitest';

import {
  BOARD_STAGE_ORDER,
  buildBoardStageOrder,
  canTransitionLifecycleTask,
  getBoardStagePresentation,
  isTaskAssignedToCurrentActor,
  matchesTaskSearch,
} from '../../src/app/work-lifecycle.mjs';

const agentLookup = new Map([
  ['engineer', { id: 'engineer', role: 'Engineering' }],
  ['qa', { id: 'qa', role: 'QA' }],
]);

describe('work lifecycle helpers', () => {
  it('keeps canonical board lanes visible ahead of non-lifecycle columns', () => {
    const stages = buildBoardStageOrder([
      { current_stage: 'REVIEW' },
      { current_stage: 'VERIFY' },
      { current_stage: 'BACKLOG' },
      { current_stage: 'TODO' },
      { current_stage: 'DRAFT' },
      { current_stage: 'CUSTOM_BLOCKED' },
    ]);

    expect(stages).toEqual([...BOARD_STAGE_ORDER, 'CUSTOM_BLOCKED']);
  });

  it('presents technical stages with canonical lifecycle labels', () => {
    expect(getBoardStagePresentation('DRAFT')).toMatchObject({ label: 'Intake Draft', group: 'Intake Draft' });
    expect(getBoardStagePresentation('TODO')).toMatchObject({ label: 'Operator Approval', group: 'Operator Approval' });
    expect(getBoardStagePresentation('IMPLEMENT')).toMatchObject({ label: 'Ready for Implementation', group: 'Implementation' });
    expect(getBoardStagePresentation('IN_PROGRESS')).toMatchObject({ label: 'In Progress', group: 'Implementation' });
    expect(getBoardStagePresentation('REVIEW')).toMatchObject({ label: 'QA Verification', group: 'QA Verification' });
    expect(getBoardStagePresentation('QA_TESTING')).toMatchObject({ label: 'QA Testing', group: 'QA Verification' });
    expect(getBoardStagePresentation('VERIFY')).toMatchObject({ label: 'SRE Verification', group: 'SRE Verification' });
    expect(getBoardStagePresentation('SRE_MONITORING')).toMatchObject({ label: 'SRE Monitoring', group: 'SRE Verification' });
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
    expect(canTransitionLifecycleTask({ current_stage: 'IN_PROGRESS', current_owner: 'engineer' }, 'VERIFY', { sub: 'user-1', roles: ['reader'] }, agentLookup)).toMatchObject({ allowed: false });
    expect(canTransitionLifecycleTask({ current_stage: 'IN_PROGRESS', current_owner: 'engineer' }, 'VERIFY', { sub: 'user-1', roles: ['engineer'] }, agentLookup)).toMatchObject({ allowed: true });
    expect(canTransitionLifecycleTask({ current_stage: 'VERIFY', current_owner: 'qa' }, 'DONE', { sub: 'user-1', roles: ['qa'] }, agentLookup)).toMatchObject({ allowed: false });
    expect(canTransitionLifecycleTask({ current_stage: 'VERIFY', current_owner: 'qa' }, 'DONE', { sub: 'user-1', roles: ['sre'] }, agentLookup)).toMatchObject({ allowed: true });
  });
});
