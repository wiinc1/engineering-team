const { createSpecialistCoordinator, FALLBACK_REASONS } = require('./delegation');

const TASK_TYPE_TO_SPECIALIST = Object.freeze({
  dev: 'engineer',
  engineer: 'engineer',
  qa: 'qa',
  sre: 'sre',
  architect: 'architect',
  research: 'architect',
  design: 'architect',
});

function normalizeTaskType(taskType) {
  return String(taskType || '').trim().toLowerCase();
}

function resolveTaskSpecialist(taskType) {
  return TASK_TYPE_TO_SPECIALIST[normalizeTaskType(taskType)] || null;
}

async function dispatchTaskToSpecialist(task, options = {}) {
  const specialist = resolveTaskSpecialist(task.type);
  if (!specialist) {
    const fallbackReason = FALLBACK_REASONS.UNSUPPORTED_TASK_TYPE;
    return {
      mode: 'fallback',
      agentId: options.coordinatorAgent || 'main',
      specialist: null,
      message: `Coordinator handling directly because task type \`${task.type || 'unknown'}\` does not map to a supported runtime specialist.`,
      attribution: { handledBy: options.coordinatorAgent || 'main', delegated: false },
      metadata: { reason: 'unsupported_task_type', fallbackReason, artifactLogged: false },
    };
  }

  const coordinator = options.coordinator || createSpecialistCoordinator(options);
  const request = task.prompt || [task.title, task.description].filter(Boolean).join('\n\n');
  return coordinator.handleRequest(request, {
    coordinatorAgent: options.coordinatorAgent || 'main',
    targetSpecialist: specialist,
    taskId: task.id,
    taskType: task.type,
  });
}

module.exports = {
  TASK_TYPE_TO_SPECIALIST,
  resolveTaskSpecialist,
  dispatchTaskToSpecialist,
};
