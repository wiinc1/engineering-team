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

function inferTaskStatus(task = {}) {
  if (task?.closed || task?.current_stage === 'DONE') return 'done';
  if (task?.blocked) return 'blocked';
  if (task?.waiting_state) return 'waiting';
  return 'active';
}

function dedupeStrings(values = []) {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

function normalizeChildDependencies(input = {}, allowedChildIds = []) {
  const allowed = new Set(allowedChildIds);
  if (Array.isArray(input)) {
    const normalized = {};
    for (const row of input) {
      const childId = String(row?.child_task_id || '').trim();
      if (!childId || (allowed.size && !allowed.has(childId))) continue;
      normalized[childId] = dedupeStrings(row?.depends_on || row?.dependsOnChildTaskIds || []);
    }
    return normalized;
  }
  if (!input || typeof input !== 'object') return {};
  return Object.entries(input).reduce((normalized, [childId, dependsOn]) => {
    if (childId && (!allowed.size || allowed.has(childId))) {
      normalized[childId] = dedupeStrings(Array.isArray(dependsOn) ? dependsOn : []);
    }
    return normalized;
  }, {});
}

function detectCircularDependencies(dependencies = {}) {
  const visited = new Set();
  const visiting = new Set();
  const circular = new Set();

  function visit(childId) {
    if (visiting.has(childId)) {
      circular.add(childId);
      return;
    }
    if (visited.has(childId)) return;
    visited.add(childId);
    visiting.add(childId);
    for (const dependencyId of dependencies[childId] || []) {
      if (dependencies[dependencyId]) {
        visit(dependencyId);
        if (circular.has(dependencyId)) circular.add(childId);
      }
    }
    visiting.delete(childId);
  }

  Object.keys(dependencies).forEach(visit);
  return circular;
}

function isTaskAlreadyRunning(task = {}) {
  if (task?.closed || task?.current_stage === 'DONE' || task?.blocked || task?.waiting_state) return false;
  return !!task?.wip_owner || [
    'IN_PROGRESS',
    'IMPLEMENTATION',
    'QA_TESTING',
    'SRE_MONITORING',
    'VERIFY',
    'PM_CLOSE_REVIEW',
  ].includes(task?.current_stage);
}

function buildDependencyPlanner({ relationships = {}, childTaskSummaries = [] } = {}) {
  const childIds = childTaskSummaries.map(task => task.task_id);
  const childById = new Map(childTaskSummaries.map(task => [task.task_id, task]));
  const dependencyMap = normalizeChildDependencies(relationships.child_dependencies, childIds);
  const circular = detectCircularDependencies(dependencyMap);
  const resultById = new Map();
  const items = [];

  for (const task of childTaskSummaries) {
    const childId = task.task_id;
    const dependencyIds = dependencyMap[childId] || [];
    const dependsOn = dependencyIds.map(dependencyId => ({
      id: dependencyId,
      title: childById.get(dependencyId)?.title || dependencyId,
    }));
    const blockers = [];
    const status = inferTaskStatus(task);

    if (circular.has(childId)) {
      blockers.push({
        type: BLOCKER_TYPES.CIRCULAR_DEPENDENCY,
        reason: 'Dependency graph contains a circular child-task reference.',
        childTaskId: childId,
      });
    }

    for (const dependencyId of dependencyIds.filter(id => !childById.has(id))) {
      blockers.push({
        type: BLOCKER_TYPES.MISSING_DEPENDENCY,
        reason: `Referenced dependency ${dependencyId} is not linked as a child task.`,
        childTaskId: dependencyId,
      });
    }

    const unfinishedDependencies = dependencyIds
      .map(dependencyId => ({
        dependencyId,
        dependency: childById.get(dependencyId),
        result: resultById.get(dependencyId),
      }))
      .filter(({ dependencyId, result }) => childById.has(dependencyId) && result?.dependencyState !== DEPENDENCY_STATES.DONE);

    for (const { dependencyId, dependency, result } of unfinishedDependencies) {
      blockers.push({
        type: BLOCKER_TYPES.CHILD_DEPENDENCY,
        reason: `Blocked by child task ${dependencyId}.`,
        childTaskId: dependencyId,
        dependencyState: result?.dependencyState || DEPENDENCY_STATES.BLOCKED,
        title: dependency?.title || dependencyId,
      });
    }

    if (task.blocked) {
      blockers.push({
        type: BLOCKER_TYPES.TASK_BLOCKED,
        reason: task.next_required_action || 'Child task is currently blocked.',
        childTaskId: childId,
      });
    } else if (task.waiting_state) {
      blockers.push({
        type: BLOCKER_TYPES.WAITING_STATE,
        reason: `Waiting on ${task.waiting_state}.`,
        childTaskId: childId,
      });
    }

    let dependencyState = DEPENDENCY_STATES.READY;
    if (status === 'done') dependencyState = DEPENDENCY_STATES.DONE;
    else if (blockers.length > 0) dependencyState = DEPENDENCY_STATES.BLOCKED;
    else if (isTaskAlreadyRunning(task)) dependencyState = DEPENDENCY_STATES.IN_PROGRESS;

    const item = {
      id: childId,
      title: task.title || childId,
      taskType: task.task_type || null,
      stage: task.current_stage || null,
      status,
      owner: task.current_owner ? { id: task.current_owner, label: task.current_owner } : null,
      dependencyState,
      dependsOn,
      blockers,
    };
    resultById.set(childId, item);
    items.push(item);
  }

  const ready = items.filter(item => item.dependencyState === DEPENDENCY_STATES.READY);
  const blocked = items.filter(item => item.dependencyState === DEPENDENCY_STATES.BLOCKED);
  const inProgress = items.filter(item => item.dependencyState === DEPENDENCY_STATES.IN_PROGRESS);
  const done = items.filter(item => item.dependencyState === DEPENDENCY_STATES.DONE);
  const invalidCount = blocked.filter(item => item.blockers.some(blocker => (
    blocker.type === BLOCKER_TYPES.CIRCULAR_DEPENDENCY
    || blocker.type === BLOCKER_TYPES.MISSING_DEPENDENCY
  ))).length;

  return {
    dependencyMap,
    items,
    readyWork: ready,
    summary: {
      total: items.length,
      readyCount: ready.length,
      blockedCount: blocked.length,
      inProgressCount: inProgress.length,
      doneCount: done.length,
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
  return { ...summary, total: items.length };
}

function toDisplayOrchestrationState(existing, plannerItem) {
  if (!plannerItem) return existing?.state || ORCHESTRATION_ITEM_STATES.BLOCKED;
  if (plannerItem.dependencyState === DEPENDENCY_STATES.DONE) return ORCHESTRATION_ITEM_STATES.COMPLETED;
  if (existing?.state === ORCHESTRATION_ITEM_STATES.FAILED) return ORCHESTRATION_ITEM_STATES.FAILED;
  if (existing?.state === ORCHESTRATION_ITEM_STATES.RUNNING || plannerItem.dependencyState === DEPENDENCY_STATES.IN_PROGRESS) return ORCHESTRATION_ITEM_STATES.RUNNING;
  if (plannerItem.dependencyState === DEPENDENCY_STATES.BLOCKED) return ORCHESTRATION_ITEM_STATES.BLOCKED;
  return ORCHESTRATION_ITEM_STATES.READY;
}

function runtimeEvidenceFromItem(item = {}) {
  return {
    sessionId: item?.sessionId || null,
    delegationArtifactPath: item?.delegationArtifactPath || null,
    runtimeAttribution: item?.runtimeAttribution || null,
  };
}

function buildOrchestrationView({ relationships = {}, childTaskSummaries = [] } = {}) {
  const planner = buildDependencyPlanner({ relationships, childTaskSummaries });
  const runState = relationships.orchestration_state || null;
  const existingById = new Map((runState?.items || []).map(item => [item.id, item]));
  const items = planner.items.map((plannerItem) => {
    const existing = existingById.get(plannerItem.id) || null;
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
      ...runtimeEvidenceFromItem(existing),
      fallbackReason: existing?.fallbackReason || null,
      userFacingReasonCategory: existing?.userFacingReasonCategory || null,
      lastMessage: existing?.lastMessage || null,
      lastUpdatedAt: existing?.lastUpdatedAt || runState?.updatedAt || null,
      lastDispatchAt: existing?.lastDispatchAt || null,
      dispatchAttempts: existing?.dispatchAttempts || 0,
      delegated: existing?.delegated === true,
    };
  });
  const summary = summarizeOrchestrationItems(items);
  const state = items.length
    ? runState?.runId
      ? summary.runningCount
        ? 'active'
        : summary.readyCount
          ? 'idle'
          : summary.failedCount && summary.completedCount === 0
            ? 'failed'
            : 'complete'
      : 'not_started'
    : 'empty';

  return {
    planner: {
      summary: planner.summary,
      readyWork: planner.readyWork.map(item => ({
        id: item.id,
        title: item.title,
        taskType: item.taskType,
        dependsOn: item.dependsOn,
      })),
      items: planner.items,
    },
    run: {
      runId: runState?.runId || null,
      state,
      startedAt: runState?.startedAt || null,
      updatedAt: runState?.updatedAt || null,
      coordinatorAgent: runState?.coordinatorAgent || null,
      summary,
      items,
    },
  };
}

function runItemFromDispatch({ plannerItem, existing, result, now }) {
  const delegated = result?.mode === 'delegated';
  return {
    id: plannerItem.id,
    title: plannerItem.title,
    taskType: plannerItem.taskType,
    specialist: result?.specialist || null,
    actualAgent: result?.agentId || null,
    sessionId: delegated ? result?.metadata?.sessionId || null : null,
    delegationArtifactPath: result?.metadata?.artifactPath || null,
    runtimeAttribution: result?.attribution || null,
    state: delegated ? ORCHESTRATION_ITEM_STATES.RUNNING : ORCHESTRATION_ITEM_STATES.FAILED,
    dependencyState: plannerItem.dependencyState,
    dependsOn: plannerItem.dependsOn,
    blockers: plannerItem.blockers,
    dispatchAttempts: (existing?.dispatchAttempts || 0) + 1,
    delegated,
    fallbackReason: result?.metadata?.fallbackReason || null,
    userFacingReasonCategory: result?.metadata?.userFacingReasonCategory || null,
    lastMessage: result?.message || null,
    lastDispatchAt: now,
    lastUpdatedAt: now,
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
  const previousRun = relationships.orchestration_state || {};
  const existingById = new Map((previousRun.items || []).map(item => [item.id, item]));
  const runId = previousRun.runId || makeRunId();
  const startedAt = previousRun.startedAt || new Date().toISOString();
  const now = new Date().toISOString();
  let remainingCapacity = Number.isFinite(concurrencyLimit) && concurrencyLimit > 0 ? concurrencyLimit : DEFAULT_CONCURRENCY_LIMIT;
  remainingCapacity -= (previousRun.items || []).filter(item => item.state === ORCHESTRATION_ITEM_STATES.RUNNING).length;
  const items = [];
  const dispatch = typeof dispatchWork === 'function'
    ? dispatchWork
    : async task => dispatchTaskToSpecialist(task, dispatchOptions);

  for (const plannerItem of planner.items) {
    const existing = existingById.get(plannerItem.id) || null;
    if (plannerItem.dependencyState === DEPENDENCY_STATES.DONE) {
      items.push({
        ...existing,
        id: plannerItem.id,
        title: plannerItem.title,
        taskType: plannerItem.taskType,
        specialist: existing?.specialist || null,
        actualAgent: existing?.actualAgent || null,
        ...runtimeEvidenceFromItem(existing),
        state: ORCHESTRATION_ITEM_STATES.COMPLETED,
        dependencyState: plannerItem.dependencyState,
        dependsOn: plannerItem.dependsOn,
        blockers: plannerItem.blockers,
        dispatchAttempts: existing?.dispatchAttempts || 0,
        lastUpdatedAt: now,
        delegated: existing?.delegated === true,
      });
      continue;
    }

    if (plannerItem.dependencyState === DEPENDENCY_STATES.BLOCKED) {
      items.push({
        ...existing,
        id: plannerItem.id,
        title: plannerItem.title,
        taskType: plannerItem.taskType,
        state: ORCHESTRATION_ITEM_STATES.BLOCKED,
        dependencyState: plannerItem.dependencyState,
        dependsOn: plannerItem.dependsOn,
        blockers: plannerItem.blockers,
        dispatchAttempts: existing?.dispatchAttempts || 0,
        lastUpdatedAt: now,
        delegated: existing?.delegated === true,
      });
      continue;
    }

    if (existing?.state === ORCHESTRATION_ITEM_STATES.RUNNING) {
      items.push({
        ...existing,
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
      items.push({
        ...existing,
        id: plannerItem.id,
        title: plannerItem.title,
        taskType: plannerItem.taskType,
        state: ORCHESTRATION_ITEM_STATES.RUNNING,
        dependencyState: plannerItem.dependencyState,
        dependsOn: plannerItem.dependsOn,
        blockers: plannerItem.blockers,
        dispatchAttempts: existing?.dispatchAttempts || 0,
        lastUpdatedAt: now,
        delegated: existing?.delegated === true,
      });
      continue;
    }

    if (plannerItem.dependencyState !== DEPENDENCY_STATES.READY || remainingCapacity <= 0) {
      items.push({
        ...existing,
        id: plannerItem.id,
        title: plannerItem.title,
        taskType: plannerItem.taskType,
        state: ORCHESTRATION_ITEM_STATES.READY,
        dependencyState: plannerItem.dependencyState,
        dependsOn: plannerItem.dependsOn,
        blockers: plannerItem.blockers,
        dispatchAttempts: existing?.dispatchAttempts || 0,
        lastUpdatedAt: now,
        delegated: existing?.delegated === true,
      });
      continue;
    }

    remainingCapacity -= 1;
    const result = await dispatch({
      id: plannerItem.id,
      title: plannerItem.title,
      type: plannerItem.taskType,
      prompt: plannerItem.title,
    });
    items.push(runItemFromDispatch({ plannerItem, existing, result, now }));
  }

  return {
    runId,
    startedAt,
    updatedAt: now,
    coordinatorAgent,
    concurrencyLimit,
    items,
    summary: summarizeOrchestrationItems(items),
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
