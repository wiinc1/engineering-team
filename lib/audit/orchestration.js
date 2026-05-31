const crypto = require('crypto');
const { dispatchTaskToSpecialist } = require('../software-factory/task-dispatch');
const {
  BLOCKER_TYPES,
  DEPENDENCY_STATES,
  buildDependencyPlanner,
  normalizeChildDependencies,
} = require('./orchestration-planner');

const ORCHESTRATION_ITEM_STATES = Object.freeze({
  READY: 'ready',
  RUNNING: 'running',
  BLOCKED: 'blocked',
  FAILED: 'failed',
  COMPLETED: 'completed',
});

const DEFAULT_CONCURRENCY_LIMIT = 2;

function makeRunId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function summarizeOrchestrationItems(items = []) {
  const summary = { readyCount: 0, runningCount: 0, blockedCount: 0, failedCount: 0, completedCount: 0 };
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
  if (existing?.state === ORCHESTRATION_ITEM_STATES.RUNNING) return ORCHESTRATION_ITEM_STATES.RUNNING;
  if (plannerItem.dependencyState === DEPENDENCY_STATES.IN_PROGRESS) return ORCHESTRATION_ITEM_STATES.RUNNING;
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

function buildVisibleRunItem(plannerItem, existing, runState) {
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
}

function deriveRunState(items, runId) {
  if (!items.length) return 'empty';
  if (!runId) return 'not_started';
  const summary = summarizeOrchestrationItems(items);
  if (summary.runningCount) return 'active';
  if (summary.readyCount) return 'idle';
  if (summary.failedCount && summary.completedCount === 0) return 'failed';
  return 'complete';
}

function buildOrchestrationView({ relationships = {}, childTaskSummaries = [] } = {}) {
  const planner = buildDependencyPlanner({ relationships, childTaskSummaries });
  const runState = relationships.orchestration_state || null;
  const existingById = new Map((runState?.items || []).map(item => [item.id, item]));
  const items = planner.items.map(item => buildVisibleRunItem(item, existingById.get(item.id), runState));
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
    run: buildRunView(runState, items),
  };
}

function buildRunView(runState, items) {
  return {
    runId: runState?.runId || null,
    state: deriveRunState(items, runState?.runId),
    startedAt: runState?.startedAt || null,
    updatedAt: runState?.updatedAt || null,
    coordinatorAgent: runState?.coordinatorAgent || null,
    summary: summarizeOrchestrationItems(items),
    items,
  };
}

function runItemFromDispatch({ plannerItem, existing, result, now }) {
  const delegated = result?.mode === 'delegated';
  return {
    ...baseRunItem(plannerItem, existing, now),
    specialist: result?.specialist || null,
    actualAgent: result?.agentId || null,
    sessionId: delegated ? result?.metadata?.sessionId || null : null,
    delegationArtifactPath: result?.metadata?.artifactPath || null,
    runtimeAttribution: result?.attribution || null,
    state: delegated ? ORCHESTRATION_ITEM_STATES.RUNNING : ORCHESTRATION_ITEM_STATES.FAILED,
    dispatchAttempts: (existing?.dispatchAttempts || 0) + 1,
    delegated,
    fallbackReason: result?.metadata?.fallbackReason || null,
    userFacingReasonCategory: result?.metadata?.userFacingReasonCategory || null,
    lastMessage: result?.message || null,
    lastDispatchAt: now,
  };
}

function baseRunItem(plannerItem, existing, now) {
  return {
    id: plannerItem.id,
    title: plannerItem.title,
    taskType: plannerItem.taskType,
    dependencyState: plannerItem.dependencyState,
    dependsOn: plannerItem.dependsOn,
    blockers: plannerItem.blockers,
    dispatchAttempts: existing?.dispatchAttempts || 0,
    lastUpdatedAt: now,
    delegated: existing?.delegated === true,
  };
}

function doneRunItem(plannerItem, existing, now) {
  return {
    ...existing,
    ...baseRunItem(plannerItem, existing, now),
    specialist: existing?.specialist || null,
    actualAgent: existing?.actualAgent || null,
    ...runtimeEvidenceFromItem(existing),
    state: ORCHESTRATION_ITEM_STATES.COMPLETED,
  };
}

function blockedRunItem(plannerItem, existing, now) {
  return {
    ...existing,
    ...baseRunItem(plannerItem, existing, now),
    state: ORCHESTRATION_ITEM_STATES.BLOCKED,
  };
}

function existingRunningRunItem(plannerItem, existing, now) {
  return {
    ...existing,
    ...baseRunItem(plannerItem, existing, now),
  };
}

function inProgressRunItem(plannerItem, existing, now) {
  return {
    ...existing,
    ...baseRunItem(plannerItem, existing, now),
    state: ORCHESTRATION_ITEM_STATES.RUNNING,
  };
}

function readyRunItem(plannerItem, existing, now) {
  return {
    ...existing,
    ...baseRunItem(plannerItem, existing, now),
    state: ORCHESTRATION_ITEM_STATES.READY,
  };
}

function initialRunState(relationships, concurrencyLimit) {
  const previousRun = relationships.orchestration_state || {};
  const runningCount = (previousRun.items || []).filter(item => item.state === ORCHESTRATION_ITEM_STATES.RUNNING).length;
  const limit = Number.isFinite(concurrencyLimit) && concurrencyLimit > 0 ? concurrencyLimit : DEFAULT_CONCURRENCY_LIMIT;
  return {
    previousRun,
    runId: previousRun.runId || makeRunId(),
    startedAt: previousRun.startedAt || new Date().toISOString(),
    now: new Date().toISOString(),
    remainingCapacity: limit - runningCount,
  };
}

function defaultDispatch(dispatchWork, dispatchOptions) {
  return typeof dispatchWork === 'function'
    ? dispatchWork
    : async task => dispatchTaskToSpecialist(task, dispatchOptions);
}

async function evaluateRunItem({ plannerItem, existing, state, dispatch }) {
  if (plannerItem.dependencyState === DEPENDENCY_STATES.DONE) return doneRunItem(plannerItem, existing, state.now);
  if (plannerItem.dependencyState === DEPENDENCY_STATES.BLOCKED) return blockedRunItem(plannerItem, existing, state.now);
  if (existing?.state === ORCHESTRATION_ITEM_STATES.RUNNING) return existingRunningRunItem(plannerItem, existing, state.now);
  if (plannerItem.dependencyState === DEPENDENCY_STATES.IN_PROGRESS) return inProgressRunItem(plannerItem, existing, state.now);
  if (plannerItem.dependencyState !== DEPENDENCY_STATES.READY || state.remainingCapacity <= 0) {
    return readyRunItem(plannerItem, existing, state.now);
  }
  state.remainingCapacity -= 1;
  const result = await dispatch({
    id: plannerItem.id,
    title: plannerItem.title,
    type: plannerItem.taskType,
    prompt: plannerItem.title,
  });
  return runItemFromDispatch({ plannerItem, existing, result, now: state.now });
}

async function evaluateOrchestrationStart({
  relationships = {},
  childTaskSummaries = [],
  coordinatorAgent = 'main',
  concurrencyLimit = DEFAULT_CONCURRENCY_LIMIT,
  dispatchWork = null,
  dispatchOptions = {},
} = {}) {
  const planner = buildDependencyPlanner({ relationships, childTaskSummaries });
  const state = initialRunState(relationships, concurrencyLimit);
  const existingById = new Map((state.previousRun.items || []).map(item => [item.id, item]));
  const dispatch = defaultDispatch(dispatchWork, dispatchOptions);
  const items = [];
  for (const plannerItem of planner.items) {
    items.push(await evaluateRunItem({
      plannerItem,
      existing: existingById.get(plannerItem.id) || null,
      state,
      dispatch,
    }));
  }
  return buildRunState({ state, coordinatorAgent, concurrencyLimit, items });
}

function buildRunState({ state, coordinatorAgent, concurrencyLimit, items }) {
  return {
    runId: state.runId,
    startedAt: state.startedAt,
    updatedAt: state.now,
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
