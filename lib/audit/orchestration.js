const crypto = require('crypto');
const { dispatchTaskToSpecialist } = require('../software-factory/task-dispatch');

const DEPENDENCY_STATES = Object.freeze({
  READY: 'ready',
  BLOCKED: 'blocked',
  IN_PROGRESS: 'in_progress',
  DONE: 'done',
});

const ORCHESTRATION_ITEM_STATES = Object.freeze({
  READY: 'ready',
  RUNNING: 'running',
  BLOCKED: 'blocked',
  FAILED: 'failed',
  COMPLETED: 'completed',
});

const BLOCKER_TYPES = Object.freeze({
  CHILD_DEPENDENCY: 'child_dependency',
  MISSING_DEPENDENCY: 'missing_dependency',
  CIRCULAR_DEPENDENCY: 'circular_dependency',
  TASK_BLOCKED: 'task_blocked',
  WAITING_STATE: 'waiting_state',
});

const DEFAULT_CONCURRENCY_LIMIT = 2;

function makeRunId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function inferTaskStatus(summary = {}) {
  if (summary?.closed || summary?.current_stage === 'DONE') return 'done';
  if (summary?.blocked) return 'blocked';
  if (summary?.waiting_state) return 'waiting';
  return 'active';
}

function dedupeStrings(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function normalizeChildDependencies(rawDependencies = {}, childTaskIds = []) {
  const knownIds = new Set(childTaskIds);
  if (Array.isArray(rawDependencies)) {
    const next = {};
    for (const entry of rawDependencies) {
      const childTaskId = String(entry?.child_task_id || '').trim();
      if (!childTaskId || (knownIds.size && !knownIds.has(childTaskId))) continue;
      next[childTaskId] = dedupeStrings(entry?.depends_on || entry?.dependsOnChildTaskIds || []);
    }
    return next;
  }

  if (!rawDependencies || typeof rawDependencies !== 'object') return {};

  return Object.entries(rawDependencies).reduce((accumulator, [childTaskId, dependsOn]) => {
    if (!childTaskId || (knownIds.size && !knownIds.has(childTaskId))) return accumulator;
    accumulator[childTaskId] = dedupeStrings(Array.isArray(dependsOn) ? dependsOn : []);
    return accumulator;
  }, {});
}

function detectCircularDependencies(dependencyMap = {}) {
  const visited = new Set();
  const active = new Set();
  const circular = new Set();

  function visit(nodeId) {
    if (active.has(nodeId)) {
      circular.add(nodeId);
      return;
    }
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    active.add(nodeId);
    for (const dependencyId of dependencyMap[nodeId] || []) {
      if (!dependencyMap[dependencyId]) continue;
      visit(dependencyId);
      if (circular.has(dependencyId)) circular.add(nodeId);
    }
    active.delete(nodeId);
  }

  Object.keys(dependencyMap).forEach(visit);
  return circular;
}

function isTaskAlreadyRunning(summary = {}) {
  if (summary?.closed || summary?.current_stage === 'DONE') return false;
  if (summary?.blocked || summary?.waiting_state) return false;
  return Boolean(summary?.wip_owner)
    || ['IN_PROGRESS', 'IMPLEMENTATION', 'QA_TESTING', 'SRE_MONITORING', 'VERIFY', 'PM_CLOSE_REVIEW'].includes(summary?.current_stage);
}

function buildDependencyPlanner({ relationships = {}, childTaskSummaries = [] } = {}) {
  const childTaskIds = childTaskSummaries.map((child) => child.task_id);
  const childById = new Map(childTaskSummaries.map((child) => [child.task_id, child]));
  const dependencyMap = normalizeChildDependencies(relationships.child_dependencies, childTaskIds);
  const circularIds = detectCircularDependencies(dependencyMap);
  const results = new Map();
  const items = [];

  for (const child of childTaskSummaries) {
    const childTaskId = child.task_id;
    const dependencyIds = dependencyMap[childTaskId] || [];
    const dependsOn = dependencyIds.map((dependencyId) => {
      const dependency = childById.get(dependencyId);
      return {
        id: dependencyId,
        title: dependency?.title || dependencyId,
      };
    });

    const blockers = [];
    const taskStatus = inferTaskStatus(child);

    if (circularIds.has(childTaskId)) {
      blockers.push({
        type: BLOCKER_TYPES.CIRCULAR_DEPENDENCY,
        reason: 'Dependency graph contains a circular child-task reference.',
        childTaskId,
      });
    }

    const missingDependencies = dependencyIds.filter((dependencyId) => !childById.has(dependencyId));
    for (const dependencyId of missingDependencies) {
      blockers.push({
        type: BLOCKER_TYPES.MISSING_DEPENDENCY,
        reason: `Referenced dependency ${dependencyId} is not linked as a child task.`,
        childTaskId: dependencyId,
      });
    }

    const unresolvedDependencies = dependencyIds
      .map((dependencyId) => ({ dependencyId, dependency: childById.get(dependencyId), result: results.get(dependencyId) }))
      .filter(({ dependencyId, result }) => childById.has(dependencyId) && result?.dependencyState !== DEPENDENCY_STATES.DONE);

    for (const { dependencyId, dependency, result } of unresolvedDependencies) {
      blockers.push({
        type: BLOCKER_TYPES.CHILD_DEPENDENCY,
        reason: `Blocked by child task ${dependencyId}.`,
        childTaskId: dependencyId,
        dependencyState: result?.dependencyState || DEPENDENCY_STATES.BLOCKED,
        title: dependency?.title || dependencyId,
      });
    }

    if (child.blocked) {
      blockers.push({
        type: BLOCKER_TYPES.TASK_BLOCKED,
        reason: child.next_required_action || 'Child task is currently blocked.',
        childTaskId,
      });
    } else if (child.waiting_state) {
      blockers.push({
        type: BLOCKER_TYPES.WAITING_STATE,
        reason: `Waiting on ${child.waiting_state}.`,
        childTaskId,
      });
    }

    let dependencyState = DEPENDENCY_STATES.READY;
    if (taskStatus === 'done') {
      dependencyState = DEPENDENCY_STATES.DONE;
    } else if (blockers.length > 0) {
      dependencyState = DEPENDENCY_STATES.BLOCKED;
    } else if (isTaskAlreadyRunning(child)) {
      dependencyState = DEPENDENCY_STATES.IN_PROGRESS;
    }

    const item = {
      id: childTaskId,
      title: child.title || childTaskId,
      taskType: child.task_type || null,
      stage: child.current_stage || null,
      status: taskStatus,
      owner: child.current_owner
        ? { id: child.current_owner, label: child.current_owner }
        : null,
      dependencyState,
      dependsOn,
      blockers,
    };

    results.set(childTaskId, item);
    items.push(item);
  }

  const readyWork = items.filter((item) => item.dependencyState === DEPENDENCY_STATES.READY);
  const blockedWork = items.filter((item) => item.dependencyState === DEPENDENCY_STATES.BLOCKED);
  const inProgressWork = items.filter((item) => item.dependencyState === DEPENDENCY_STATES.IN_PROGRESS);
  const doneWork = items.filter((item) => item.dependencyState === DEPENDENCY_STATES.DONE);
  const invalidCount = blockedWork.filter((item) => item.blockers.some((blocker) => blocker.type === BLOCKER_TYPES.CIRCULAR_DEPENDENCY || blocker.type === BLOCKER_TYPES.MISSING_DEPENDENCY)).length;

  return {
    dependencyMap,
    items,
    readyWork,
    summary: {
      total: items.length,
      readyCount: readyWork.length,
      blockedCount: blockedWork.length,
      inProgressCount: inProgressWork.length,
      doneCount: doneWork.length,
      invalidCount,
    },
  };
}

function summarizeOrchestrationItems(items = []) {
  const summary = {
    readyCount: 0,
    runningCount: 0,
    blockedCount: 0,
    failedCount: 0,
    completedCount: 0,
  };

  for (const item of items) {
    if (item.state === ORCHESTRATION_ITEM_STATES.READY) summary.readyCount += 1;
    if (item.state === ORCHESTRATION_ITEM_STATES.RUNNING) summary.runningCount += 1;
    if (item.state === ORCHESTRATION_ITEM_STATES.BLOCKED) summary.blockedCount += 1;
    if (item.state === ORCHESTRATION_ITEM_STATES.FAILED) summary.failedCount += 1;
    if (item.state === ORCHESTRATION_ITEM_STATES.COMPLETED) summary.completedCount += 1;
  }

  return {
    ...summary,
    total: items.length,
  };
}

function toDisplayOrchestrationState(item, plannerItem) {
  if (!plannerItem) return item?.state || ORCHESTRATION_ITEM_STATES.BLOCKED;
  if (plannerItem.dependencyState === DEPENDENCY_STATES.DONE) return ORCHESTRATION_ITEM_STATES.COMPLETED;
  if (item?.state === ORCHESTRATION_ITEM_STATES.FAILED) return ORCHESTRATION_ITEM_STATES.FAILED;
  if (item?.state === ORCHESTRATION_ITEM_STATES.RUNNING) return ORCHESTRATION_ITEM_STATES.RUNNING;
  if (plannerItem.dependencyState === DEPENDENCY_STATES.IN_PROGRESS) return ORCHESTRATION_ITEM_STATES.RUNNING;
  if (plannerItem.dependencyState === DEPENDENCY_STATES.BLOCKED) return ORCHESTRATION_ITEM_STATES.BLOCKED;
  return ORCHESTRATION_ITEM_STATES.READY;
}

function buildOrchestrationView({ relationships = {}, childTaskSummaries = [] } = {}) {
  const planner = buildDependencyPlanner({ relationships, childTaskSummaries });
  const run = relationships.orchestration_state || null;
  const runItemsById = new Map((run?.items || []).map((item) => [item.id, item]));
  const items = planner.items.map((plannerItem) => {
    const existing = runItemsById.get(plannerItem.id) || null;
    return {
      id: plannerItem.id,
      title: plannerItem.title,
      taskType: plannerItem.taskType,
      stage: plannerItem.stage,
      owner: plannerItem.owner,
      state: toDisplayOrchestrationState(existing, plannerItem),
      dependencyState: plannerItem.dependencyState,
      dependsOn: plannerItem.dependsOn,
      blockers: plannerItem.blockers,
      specialist: existing?.specialist || null,
      actualAgent: existing?.actualAgent || null,
      fallbackReason: existing?.fallbackReason || null,
      userFacingReasonCategory: existing?.userFacingReasonCategory || null,
      lastMessage: existing?.lastMessage || null,
      lastUpdatedAt: existing?.lastUpdatedAt || run?.updatedAt || null,
      lastDispatchAt: existing?.lastDispatchAt || null,
      dispatchAttempts: existing?.dispatchAttempts || 0,
      delegated: existing?.delegated === true,
    };
  });

  const summary = summarizeOrchestrationItems(items);
  const runState = !items.length
    ? 'empty'
    : run?.runId
      ? summary.runningCount
        ? 'active'
        : summary.readyCount
          ? 'idle'
          : summary.failedCount && summary.completedCount === 0
            ? 'failed'
            : 'complete'
      : 'not_started';

  return {
    planner: {
      summary: planner.summary,
      readyWork: planner.readyWork.map((item) => ({
        id: item.id,
        title: item.title,
        taskType: item.taskType,
        dependsOn: item.dependsOn,
      })),
      items: planner.items,
    },
    run: {
      runId: run?.runId || null,
      state: runState,
      startedAt: run?.startedAt || null,
      updatedAt: run?.updatedAt || null,
      coordinatorAgent: run?.coordinatorAgent || null,
      summary,
      items,
    },
  };
}

async function evaluateOrchestrationStart({
  taskId,
  relationships = {},
  childTaskSummaries = [],
  coordinatorAgent = 'main',
  concurrencyLimit = DEFAULT_CONCURRENCY_LIMIT,
  dispatchWork = null,
  dispatchOptions = {},
} = {}) {
  const planner = buildDependencyPlanner({ relationships, childTaskSummaries });
  const existingRun = relationships.orchestration_state || {};
  const existingItems = new Map((existingRun.items || []).map((item) => [item.id, item]));
  const runId = existingRun.runId || makeRunId();
  const startedAt = existingRun.startedAt || new Date().toISOString();
  const now = new Date().toISOString();
  let availableSlots = Number.isFinite(concurrencyLimit) && concurrencyLimit > 0 ? concurrencyLimit : DEFAULT_CONCURRENCY_LIMIT;
  availableSlots -= (existingRun.items || []).filter((item) => item.state === ORCHESTRATION_ITEM_STATES.RUNNING).length;

  const nextItems = [];
  const dispatcher = typeof dispatchWork === 'function'
    ? dispatchWork
    : async (childTask) => dispatchTaskToSpecialist(childTask, dispatchOptions);

  for (const plannerItem of planner.items) {
    const previous = existingItems.get(plannerItem.id) || null;
    if (plannerItem.dependencyState === DEPENDENCY_STATES.DONE) {
      nextItems.push({
        ...previous,
        id: plannerItem.id,
        title: plannerItem.title,
        taskType: plannerItem.taskType,
        specialist: previous?.specialist || null,
        actualAgent: previous?.actualAgent || null,
        state: ORCHESTRATION_ITEM_STATES.COMPLETED,
        dependencyState: plannerItem.dependencyState,
        dependsOn: plannerItem.dependsOn,
        blockers: plannerItem.blockers,
        dispatchAttempts: previous?.dispatchAttempts || 0,
        lastUpdatedAt: now,
        delegated: previous?.delegated === true,
      });
      continue;
    }

    if (plannerItem.dependencyState === DEPENDENCY_STATES.BLOCKED) {
      nextItems.push({
        ...previous,
        id: plannerItem.id,
        title: plannerItem.title,
        taskType: plannerItem.taskType,
        state: ORCHESTRATION_ITEM_STATES.BLOCKED,
        dependencyState: plannerItem.dependencyState,
        dependsOn: plannerItem.dependsOn,
        blockers: plannerItem.blockers,
        dispatchAttempts: previous?.dispatchAttempts || 0,
        lastUpdatedAt: now,
        delegated: previous?.delegated === true,
      });
      continue;
    }

    if (previous?.state === ORCHESTRATION_ITEM_STATES.RUNNING) {
      nextItems.push({
        ...previous,
        id: plannerItem.id,
        title: plannerItem.title,
        taskType: plannerItem.taskType,
        dependencyState: plannerItem.dependencyState,
        dependsOn: plannerItem.dependsOn,
        blockers: plannerItem.blockers,
        lastUpdatedAt: now,
      });
      continue;
    }

    if (plannerItem.dependencyState === DEPENDENCY_STATES.IN_PROGRESS) {
      nextItems.push({
        ...previous,
        id: plannerItem.id,
        title: plannerItem.title,
        taskType: plannerItem.taskType,
        state: ORCHESTRATION_ITEM_STATES.RUNNING,
        dependencyState: plannerItem.dependencyState,
        dependsOn: plannerItem.dependsOn,
        blockers: plannerItem.blockers,
        dispatchAttempts: previous?.dispatchAttempts || 0,
        lastUpdatedAt: now,
        delegated: previous?.delegated === true,
      });
      continue;
    }

    if (plannerItem.dependencyState !== DEPENDENCY_STATES.READY || availableSlots <= 0) {
      nextItems.push({
        ...previous,
        id: plannerItem.id,
        title: plannerItem.title,
        taskType: plannerItem.taskType,
        state: ORCHESTRATION_ITEM_STATES.READY,
        dependencyState: plannerItem.dependencyState,
        dependsOn: plannerItem.dependsOn,
        blockers: plannerItem.blockers,
        dispatchAttempts: previous?.dispatchAttempts || 0,
        lastUpdatedAt: now,
        delegated: previous?.delegated === true,
      });
      continue;
    }

    availableSlots -= 1;
    const dispatchResult = await dispatcher({
      id: plannerItem.id,
      title: plannerItem.title,
      type: plannerItem.taskType,
      prompt: plannerItem.title,
    });

    const delegated = dispatchResult?.mode === 'delegated';
    nextItems.push({
      id: plannerItem.id,
      title: plannerItem.title,
      taskType: plannerItem.taskType,
      specialist: dispatchResult?.specialist || null,
      actualAgent: dispatchResult?.agentId || null,
      state: delegated ? ORCHESTRATION_ITEM_STATES.RUNNING : ORCHESTRATION_ITEM_STATES.FAILED,
      dependencyState: plannerItem.dependencyState,
      dependsOn: plannerItem.dependsOn,
      blockers: plannerItem.blockers,
      dispatchAttempts: (previous?.dispatchAttempts || 0) + 1,
      delegated,
      fallbackReason: dispatchResult?.metadata?.fallbackReason || null,
      userFacingReasonCategory: dispatchResult?.metadata?.userFacingReasonCategory || null,
      lastMessage: dispatchResult?.message || null,
      lastDispatchAt: now,
      lastUpdatedAt: now,
    });
  }

  return {
    runId,
    startedAt,
    updatedAt: now,
    coordinatorAgent,
    concurrencyLimit,
    items: nextItems,
    summary: summarizeOrchestrationItems(nextItems),
  };
}

module.exports = {
  BLOCKER_TYPES,
  DEFAULT_CONCURRENCY_LIMIT,
  DEPENDENCY_STATES,
  ORCHESTRATION_ITEM_STATES,
  buildDependencyPlanner,
  buildOrchestrationView,
  evaluateOrchestrationStart,
  normalizeChildDependencies,
};
