import { resolveOwnerPresentation, sortInboxItems } from './task-owner.mjs';

export const COMMAND_CENTER_QUEUE_SECTIONS = [
  { key: 'needs-attention', label: 'Needs attention', tone: 'danger' },
  { key: 'blocked', label: 'Blocked', tone: 'warning' },
  { key: 'ready-to-move', label: 'Ready to move', tone: 'success' },
  { key: 'monitoring', label: 'Monitoring', tone: 'info' },
];

function isIntakeDraft(task = {}) {
  return !!(task.intake_draft || task.intakeDraft || String(task.current_stage || '').trim().toUpperCase() === 'DRAFT');
}

export function classifyCommandCenterQueueBucket(task = {}) {
  const stage = String(task.current_stage || '').trim().toUpperCase();
  const waiting = String(task.waiting_state || '').trim().toLowerCase();
  const nextAction = String(task.next_required_action || '').trim().toLowerCase();
  const closeGov = task.close_governance || {};

  if (stage === 'SRE_MONITORING' || stage === 'VERIFY') {
    return 'monitoring';
  }
  if (
    stage === 'REOPEN'
    || waiting.includes('blocked')
    || nextAction.includes('blocked')
    || closeGov?.cancellation?.awaitingHumanDecision === true
    || closeGov?.humanDecision?.required === true
  ) {
    return 'blocked';
  }
  if (
    isIntakeDraft(task)
    || stage === 'BACKLOG'
    || stage === 'PM_CLOSE_REVIEW'
    || waiting.includes('pm')
    || waiting.includes('architect')
    || waiting.includes('human')
    || nextAction.includes('refinement')
    || nextAction.includes('approval')
  ) {
    return 'needs-attention';
  }
  return 'ready-to-move';
}

export function buildCommandCenterQueueSections(tasks = [], ownerLookup = new Map()) {
  const buckets = Object.fromEntries(
    COMMAND_CENTER_QUEUE_SECTIONS.map((section) => [section.key, []]),
  );

  for (const task of tasks) {
    const bucket = classifyCommandCenterQueueBucket(task);
    buckets[bucket].push({
      ...task,
      ownerPresentation: resolveOwnerPresentation(task, ownerLookup),
      queueSection: bucket,
    });
  }

  return COMMAND_CENTER_QUEUE_SECTIONS.map((section) => ({
    ...section,
    items: sortInboxItems(buckets[section.key]),
  }));
}

export function countActiveCommandCenterFilters(filters = {}) {
  return ['owner', 'project', 'priority', 'status', 'searchTerm']
    .filter((key) => String(filters[key] || '').trim()).length;
}

export function formatTaskFreshnessLabel(task = {}) {
  const stamp = task?.freshness?.last_updated_at || task?.queue_entered_at || null;
  if (!stamp) return 'Freshness unknown';
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(stamp));
  } catch {
    return stamp;
  }
}