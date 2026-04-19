const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BLOCKER_TYPES,
  DEPENDENCY_STATES,
  ORCHESTRATION_ITEM_STATES,
  buildDependencyPlanner,
  buildOrchestrationView,
  evaluateOrchestrationStart,
} = require('../../lib/audit/orchestration');

test('buildDependencyPlanner marks child work as ready, blocked, in progress, and done from dependency state', () => {
  const planner = buildDependencyPlanner({
    relationships: {
      child_task_ids: ['TSK-1', 'TSK-2', 'TSK-3', 'TSK-4'],
      child_dependencies: {
        'TSK-2': ['TSK-1'],
      },
    },
    childTaskSummaries: [
      { task_id: 'TSK-1', title: 'Ship foundation', current_stage: 'DONE', closed: true, blocked: false, waiting_state: null },
      { task_id: 'TSK-2', title: 'Parallel implementation', current_stage: 'TODO', closed: false, blocked: false, waiting_state: null },
      { task_id: 'TSK-3', title: 'Blocked review', current_stage: 'TODO', closed: false, blocked: true, waiting_state: null },
      { task_id: 'TSK-4', title: 'Existing implementation', current_stage: 'IMPLEMENTATION', closed: false, blocked: false, waiting_state: null },
    ],
  });

  assert.equal(planner.summary.doneCount, 1);
  assert.equal(planner.summary.readyCount, 1);
  assert.equal(planner.summary.blockedCount, 1);
  assert.equal(planner.summary.inProgressCount, 1);
  assert.equal(planner.items.find((item) => item.id === 'TSK-2').dependencyState, DEPENDENCY_STATES.READY);
  assert.equal(planner.items.find((item) => item.id === 'TSK-3').dependencyState, DEPENDENCY_STATES.BLOCKED);
  assert.equal(planner.items.find((item) => item.id === 'TSK-4').dependencyState, DEPENDENCY_STATES.IN_PROGRESS);
});

test('buildDependencyPlanner reports circular and missing dependencies as normalized blockers', () => {
  const planner = buildDependencyPlanner({
    relationships: {
      child_task_ids: ['TSK-A', 'TSK-B'],
      child_dependencies: {
        'TSK-A': ['TSK-B'],
        'TSK-B': ['TSK-A', 'TSK-MISSING'],
      },
    },
    childTaskSummaries: [
      { task_id: 'TSK-A', title: 'A', current_stage: 'TODO', closed: false, blocked: false, waiting_state: null },
      { task_id: 'TSK-B', title: 'B', current_stage: 'TODO', closed: false, blocked: false, waiting_state: null },
    ],
  });

  const taskA = planner.items.find((item) => item.id === 'TSK-A');
  const taskB = planner.items.find((item) => item.id === 'TSK-B');

  assert.equal(taskA.dependencyState, DEPENDENCY_STATES.BLOCKED);
  assert.equal(taskB.dependencyState, DEPENDENCY_STATES.BLOCKED);
  assert.ok(taskA.blockers.some((blocker) => blocker.type === BLOCKER_TYPES.CIRCULAR_DEPENDENCY));
  assert.ok(taskB.blockers.some((blocker) => blocker.type === BLOCKER_TYPES.MISSING_DEPENDENCY));
});

test('evaluateOrchestrationStart dispatches only ready work and preserves fallback details', async () => {
  const run = await evaluateOrchestrationStart({
    taskId: 'TSK-PARENT',
    relationships: {
      child_task_ids: ['TSK-1', 'TSK-2', 'TSK-3'],
      child_dependencies: {
        'TSK-2': ['TSK-1'],
      },
    },
    childTaskSummaries: [
      { task_id: 'TSK-1', title: 'Ready implementation', task_type: 'engineer', current_stage: 'TODO', closed: false, blocked: false, waiting_state: null },
      { task_id: 'TSK-2', title: 'Blocked by child', task_type: 'qa', current_stage: 'TODO', closed: false, blocked: false, waiting_state: null },
      { task_id: 'TSK-3', title: 'Fallback task', task_type: 'qa', current_stage: 'TODO', closed: false, blocked: false, waiting_state: null },
    ],
    dispatchWork: async (task) => {
      if (task.id === 'TSK-1') {
        return {
          mode: 'delegated',
          agentId: 'engineer',
          specialist: 'engineer',
          message: 'Delegated to engineer.',
          metadata: {},
        };
      }

      return {
        mode: 'fallback',
        agentId: 'main',
        specialist: null,
        message: 'Coordinator handling this request because runtime delegation for specialist `qa` is not configured or not available.',
        metadata: {
          fallbackReason: 'not_configured',
          userFacingReasonCategory: 'runtime_not_available',
        },
      };
    },
  });

  const delegated = run.items.find((item) => item.id === 'TSK-1');
  const blocked = run.items.find((item) => item.id === 'TSK-2');
  const fallback = run.items.find((item) => item.id === 'TSK-3');

  assert.equal(delegated.state, ORCHESTRATION_ITEM_STATES.RUNNING);
  assert.equal(blocked.state, ORCHESTRATION_ITEM_STATES.BLOCKED);
  assert.equal(fallback.state, ORCHESTRATION_ITEM_STATES.FAILED);
  assert.equal(fallback.fallbackReason, 'not_configured');
  assert.equal(fallback.userFacingReasonCategory, 'runtime_not_available');
});

test('buildOrchestrationView surfaces persisted fallback outcomes alongside planner counts', () => {
  const view = buildOrchestrationView({
    relationships: {
      child_task_ids: ['TSK-1'],
      child_dependencies: {},
      orchestration_state: {
        runId: 'run-1',
        startedAt: '2026-04-19T10:00:00.000Z',
        updatedAt: '2026-04-19T10:01:00.000Z',
        items: [
          {
            id: 'TSK-1',
            state: 'failed',
            fallbackReason: 'runtime_exec_failed',
            userFacingReasonCategory: 'runtime_execution_failed',
            lastMessage: 'Coordinator handling this request because runtime delegation failed during execution.',
          },
        ],
      },
    },
    childTaskSummaries: [
      { task_id: 'TSK-1', title: 'Ready item', task_type: 'engineer', current_stage: 'TODO', closed: false, blocked: false, waiting_state: null },
    ],
  });

  assert.equal(view.run.summary.failedCount, 1);
  assert.equal(view.run.items[0].state, ORCHESTRATION_ITEM_STATES.FAILED);
  assert.equal(view.run.items[0].userFacingReasonCategory, 'runtime_execution_failed');
});

test('buildOrchestrationView marks previously running work as completed once the child task is done', () => {
  const view = buildOrchestrationView({
    relationships: {
      child_task_ids: ['TSK-1'],
      child_dependencies: {},
      orchestration_state: {
        runId: 'run-2',
        startedAt: '2026-04-19T10:00:00.000Z',
        updatedAt: '2026-04-19T10:02:00.000Z',
        items: [
          {
            id: 'TSK-1',
            state: 'running',
            delegated: true,
            specialist: 'engineer',
            actualAgent: 'engineer',
          },
        ],
      },
    },
    childTaskSummaries: [
      { task_id: 'TSK-1', title: 'Completed child', task_type: 'engineer', current_stage: 'DONE', closed: true, blocked: false, waiting_state: null },
    ],
  });

  assert.equal(view.run.summary.completedCount, 1);
  assert.equal(view.run.items[0].state, ORCHESTRATION_ITEM_STATES.COMPLETED);
});
