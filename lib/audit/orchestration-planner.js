const DEPENDENCY_STATES = Object.freeze({
  READY: 'ready',
  BLOCKED: 'blocked',
  IN_PROGRESS: 'in_progress',
  DONE: 'done',
});

const BLOCKER_TYPES = Object.freeze({
  CHILD_DEPENDENCY: 'child_dependency',
  MISSING_DEPENDENCY: 'missing_dependency',
  CIRCULAR_DEPENDENCY: 'circular_dependency',
  TASK_BLOCKED: 'task_blocked',
  WAITING_STATE: 'waiting_state',
});

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
  if (Array.isArray(input)) return normalizeDependencyRows(input, allowed);
  if (!input || typeof input !== 'object') return {};
  return Object.entries(input).reduce((normalized, [childId, dependsOn]) => {
    if (childId && (!allowed.size || allowed.has(childId))) {
      normalized[childId] = dedupeStrings(Array.isArray(dependsOn) ? dependsOn : []);
    }
    return normalized;
  }, {});
}

function normalizeDependencyRows(rows, allowed) {
  const normalized = {};
  for (const row of rows) {
    const childId = String(row?.child_task_id || '').trim();
    if (!childId || (allowed.size && !allowed.has(childId))) continue;
    normalized[childId] = dedupeStrings(row?.depends_on || row?.dependsOnChildTaskIds || []);
  }
  return normalized;
}

function detectCircularDependencies(dependencies = {}) {
  const visited = new Set();
  const visiting = new Set();
  const circular = new Set();
  const visit = (childId) => visitDependency(childId, { dependencies, visited, visiting, circular });
  Object.keys(dependencies).forEach(visit);
  return circular;
}

function visitDependency(childId, context) {
  const { dependencies, visited, visiting, circular } = context;
  if (visiting.has(childId)) {
    circular.add(childId);
    return;
  }
  if (visited.has(childId)) return;
  visited.add(childId);
  visiting.add(childId);
  for (const dependencyId of dependencies[childId] || []) {
    if (!dependencies[dependencyId]) continue;
    visitDependency(dependencyId, context);
    if (circular.has(dependencyId)) circular.add(childId);
  }
  visiting.delete(childId);
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

function createPlannerContext(relationships, childTaskSummaries) {
  const childIds = childTaskSummaries.map(task => task.task_id);
  const childById = new Map(childTaskSummaries.map(task => [task.task_id, task]));
  const dependencyMap = normalizeChildDependencies(relationships.child_dependencies, childIds);
  return {
    childById,
    dependencyMap,
    circular: detectCircularDependencies(dependencyMap),
    resultById: new Map(),
  };
}

function dependencyLinks(dependencyIds, childById) {
  return dependencyIds.map(dependencyId => ({
    id: dependencyId,
    title: childById.get(dependencyId)?.title || dependencyId,
  }));
}

function collectBlockers(task, dependencyIds, context) {
  return [
    ...circularBlockers(task.task_id, context.circular),
    ...missingDependencyBlockers(dependencyIds, context.childById),
    ...unfinishedDependencyBlockers(dependencyIds, context),
    ...taskStateBlockers(task),
  ];
}

function circularBlockers(childId, circular) {
  if (!circular.has(childId)) return [];
  return [{
    type: BLOCKER_TYPES.CIRCULAR_DEPENDENCY,
    reason: 'Dependency graph contains a circular child-task reference.',
    childTaskId: childId,
  }];
}

function missingDependencyBlockers(dependencyIds, childById) {
  return dependencyIds.filter(id => !childById.has(id)).map(dependencyId => ({
    type: BLOCKER_TYPES.MISSING_DEPENDENCY,
    reason: `Referenced dependency ${dependencyId} is not linked as a child task.`,
    childTaskId: dependencyId,
  }));
}

function unfinishedDependencyBlockers(dependencyIds, context) {
  return dependencyIds
    .map(dependencyId => ({
      dependencyId,
      dependency: context.childById.get(dependencyId),
      result: context.resultById.get(dependencyId),
    }))
    .filter(({ dependencyId, result }) => context.childById.has(dependencyId)
      && result?.dependencyState !== DEPENDENCY_STATES.DONE)
    .map(({ dependencyId, dependency, result }) => ({
      type: BLOCKER_TYPES.CHILD_DEPENDENCY,
      reason: `Blocked by child task ${dependencyId}.`,
      childTaskId: dependencyId,
      dependencyState: result?.dependencyState || DEPENDENCY_STATES.BLOCKED,
      title: dependency?.title || dependencyId,
    }));
}

function taskStateBlockers(task) {
  if (task.blocked) {
    return [{
      type: BLOCKER_TYPES.TASK_BLOCKED,
      reason: task.next_required_action || 'Child task is currently blocked.',
      childTaskId: task.task_id,
    }];
  }
  if (!task.waiting_state) return [];
  return [{
    type: BLOCKER_TYPES.WAITING_STATE,
    reason: `Waiting on ${task.waiting_state}.`,
    childTaskId: task.task_id,
  }];
}

function dependencyStateForTask(task, blockers) {
  const status = inferTaskStatus(task);
  if (status === 'done') return DEPENDENCY_STATES.DONE;
  if (blockers.length > 0) return DEPENDENCY_STATES.BLOCKED;
  if (isTaskAlreadyRunning(task)) return DEPENDENCY_STATES.IN_PROGRESS;
  return DEPENDENCY_STATES.READY;
}

function buildPlannerItem(task, context) {
  const dependencyIds = context.dependencyMap[task.task_id] || [];
  const blockers = collectBlockers(task, dependencyIds, context);
  return {
    id: task.task_id,
    title: task.title || task.task_id,
    taskType: task.task_type || null,
    stage: task.current_stage || null,
    status: inferTaskStatus(task),
    owner: task.current_owner ? { id: task.current_owner, label: task.current_owner } : null,
    dependencyState: dependencyStateForTask(task, blockers),
    dependsOn: dependencyLinks(dependencyIds, context.childById),
    blockers,
  };
}

function summarizeDependencyItems(items) {
  const ready = items.filter(item => item.dependencyState === DEPENDENCY_STATES.READY);
  const blocked = items.filter(item => item.dependencyState === DEPENDENCY_STATES.BLOCKED);
  const inProgress = items.filter(item => item.dependencyState === DEPENDENCY_STATES.IN_PROGRESS);
  const done = items.filter(item => item.dependencyState === DEPENDENCY_STATES.DONE);
  return {
    ready,
    summary: {
      total: items.length,
      readyCount: ready.length,
      blockedCount: blocked.length,
      inProgressCount: inProgress.length,
      doneCount: done.length,
      invalidCount: invalidBlockerCount(blocked),
    },
  };
}

function invalidBlockerCount(blocked) {
  return blocked.filter(item => item.blockers.some(blocker => (
    blocker.type === BLOCKER_TYPES.CIRCULAR_DEPENDENCY
    || blocker.type === BLOCKER_TYPES.MISSING_DEPENDENCY
  ))).length;
}

function buildDependencyPlanner({ relationships = {}, childTaskSummaries = [] } = {}) {
  const context = createPlannerContext(relationships, childTaskSummaries);
  const items = [];
  for (const task of childTaskSummaries) {
    const item = buildPlannerItem(task, context);
    context.resultById.set(task.task_id, item);
    items.push(item);
  }
  const { ready, summary } = summarizeDependencyItems(items);
  return {
    dependencyMap: context.dependencyMap,
    items,
    readyWork: ready,
    summary,
  };
}

module.exports = {
  BLOCKER_TYPES,
  DEPENDENCY_STATES,
  buildDependencyPlanner,
  normalizeChildDependencies,
};
