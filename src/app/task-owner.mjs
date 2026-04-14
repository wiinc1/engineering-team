import { buildBoardStageOrder, matchesTaskSearch } from './work-lifecycle.mjs';

export const UNASSIGNED_FILTER_VALUE = '__unassigned__';
export const STAGE_ORDER = ['BACKLOG', 'TODO', 'IMPLEMENT', 'IN_PROGRESS', 'REVIEW', 'VERIFY', 'DONE', 'REOPEN'];
export const ROLE_INBOXES = ['pm', 'architect', 'engineer', 'qa', 'sre', 'human'];
export const PM_OVERVIEW_BUCKET_ORDER = ['needs-routing-attention', 'unassigned', 'architect', 'engineer', 'qa', 'sre'];

const PRIORITY_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 };
const ACTIVE_STAGES = new Set(['IMPLEMENT', 'IN_PROGRESS']);

const ROLE_LABELS = {
  pm: 'PM',
  architect: 'Architect',
  engineer: 'Engineer',
  qa: 'QA',
  sre: 'SRE',
  human: 'Human Stakeholder',
};

const PM_BUCKET_LABELS = {
  'needs-routing-attention': 'Needs routing attention',
  unassigned: 'Unassigned',
  architect: 'Architect',
  engineer: 'Engineer',
  qa: 'QA',
  sre: 'SRE',
};

const PM_OVERVIEW_ROLE_BUCKETS = new Set(['architect', 'engineer', 'qa', 'sre']);

export function mapAgentOptions(items = []) {
  return items.map((agent) => ({
    id: agent.id,
    label: `${agent.display_name}${agent.role ? ` · ${agent.role}` : ''}`,
    role: normalizeRoleKey(agent.role),
  }));
}

export function normalizeRoleKey(role) {
  if (typeof role !== 'string') return null;
  const normalized = role.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'architecture') return 'architect';
  if (normalized === 'engineering') return 'engineer';
  if (normalized === 'quality assurance') return 'qa';
  if (normalized === 'product' || normalized === 'product manager') return 'pm';
  if (normalized === 'human stakeholder' || normalized === 'stakeholder') return 'human';
  return ROLE_INBOXES.includes(normalized) ? normalized : null;
}

export function getRoleInboxLabel(roleKey) {
  return ROLE_LABELS[normalizeRoleKey(roleKey)] || 'Role';
}

function isOwnerExplicitlyHidden(owner) {
  if (!owner || typeof owner !== 'object') return false;
  return owner.redacted === true || owner.visibility === 'hidden' || owner.policy_state === 'hidden';
}

export function resolveOwnerPresentation(item, agentLookup) {
  if (!item.current_owner) {
    return { label: 'Unassigned', detail: 'No owner assigned', tone: 'unassigned', filterValue: UNASSIGNED_FILTER_VALUE };
  }

  const agent = agentLookup.get(item.current_owner);
  if (agent) {
    return { label: agent.label, detail: `Owner: ${agent.label}`, tone: 'assigned', filterValue: item.current_owner };
  }

  if (isOwnerExplicitlyHidden(item.owner)) {
    return { label: 'Owner hidden', detail: 'Owner identity is intentionally redacted on this surface', tone: 'fallback', filterValue: item.current_owner };
  }

  return { label: 'Unknown owner', detail: `Owner record unavailable for ${item.current_owner}`, tone: 'fallback', filterValue: item.current_owner };
}

export function resolveRoleInboxMembership(item, agentLookup) {
  const waitingState = String(item?.waiting_state || '').trim().toLowerCase();
  const nextRequiredAction = String(item?.next_required_action || '').trim().toLowerCase();

  if (waitingState.includes('pm') || nextRequiredAction.includes('pm')) {
    return {
      inboxRole: 'pm',
      reason: 'waiting-pm',
      routingLabel: 'Routed to PM because the task is explicitly waiting on PM action.',
      isFallback: false,
    };
  }

  if (waitingState.includes('human') || waitingState.includes('stakeholder') || nextRequiredAction.includes('human') || nextRequiredAction.includes('stakeholder') || nextRequiredAction.includes('approval')) {
    return {
      inboxRole: 'human',
      reason: 'waiting-human',
      routingLabel: 'Routed to Human Stakeholder because the task is explicitly waiting on human approval or escalation handling.',
      isFallback: false,
    };
  }

  if (!item?.current_owner) {
    return {
      inboxRole: null,
      reason: 'unassigned',
      routingLabel: 'Not routed to a role inbox until an owner is assigned.',
      isFallback: false,
    };
  }

  const agent = agentLookup.get(item.current_owner);
  if (agent?.role) {
    return {
      inboxRole: agent.role,
      reason: 'matched',
      routingLabel: `Routed to ${getRoleInboxLabel(agent.role)} because the assigned owner maps to that canonical role.`,
      isFallback: false,
    };
  }

  if (isOwnerExplicitlyHidden(item.owner)) {
    return {
      inboxRole: null,
      reason: 'hidden',
      routingLabel: 'Owner metadata is intentionally hidden, so role routing cannot be confirmed on this surface.',
      isFallback: true,
    };
  }

  return {
    inboxRole: null,
    reason: 'unknown-owner',
    routingLabel: `Assigned owner ${item.current_owner} does not resolve to a canonical role mapping.`,
    isFallback: true,
  };
}

export function getPmOverviewBucketLabel(bucketKey) {
  return PM_BUCKET_LABELS[bucketKey] || 'Unknown bucket';
}

export function resolvePmOverviewBucket(item, agentLookup) {
  const ownerPresentation = resolveOwnerPresentation(item, agentLookup);
  const ownerId = item?.current_owner;

  if (!ownerId) {
    return {
      key: 'unassigned',
      label: 'Unassigned',
      routingCue: 'Unassigned',
      routingReason: 'No owner is assigned, so this task is visible in the Unassigned bucket.',
      ownerPresentation,
    };
  }

  const agent = agentLookup.get(ownerId);

  if (agent?.role && PM_OVERVIEW_ROLE_BUCKETS.has(agent.role)) {
    return {
      key: agent.role,
      label: getPmOverviewBucketLabel(agent.role),
      routingCue: `${getRoleInboxLabel(agent.role)} route`,
      routingReason: `Routed to ${getRoleInboxLabel(agent.role)} because the assigned owner maps to that canonical role.`,
      ownerPresentation,
    };
  }

  if (agent?.role) {
    return {
      key: 'needs-routing-attention',
      label: 'Needs routing attention',
      routingCue: 'Needs routing attention',
      routingReason: `Role mapping unavailable because canonical role ${getRoleInboxLabel(agent.role)} is outside the PM overview buckets for this slice.`,
      ownerPresentation: { ...ownerPresentation, detail: `${ownerPresentation.detail}. Role mapping unavailable.` },
      degradedLabel: 'Role mapping unavailable',
    };
  }

  if (isOwnerExplicitlyHidden(item.owner)) {
    return {
      key: 'needs-routing-attention',
      label: 'Needs routing attention',
      routingCue: 'Needs routing attention',
      routingReason: 'Role mapping unavailable because owner metadata is intentionally hidden on this surface.',
      ownerPresentation: { ...ownerPresentation, detail: `${ownerPresentation.detail}. Role mapping unavailable.` },
      degradedLabel: 'Role mapping unavailable',
    };
  }

  return {
    key: 'needs-routing-attention',
    label: 'Needs routing attention',
    routingCue: 'Needs routing attention',
    routingReason: 'Role mapping unavailable because the assigned owner does not resolve to a canonical role mapping.',
    ownerPresentation,
    degradedLabel: 'Role mapping unavailable',
  };
}

export function buildPmOverviewSections(items, agentLookup) {
  const grouped = new Map(PM_OVERVIEW_BUCKET_ORDER.map((bucket) => [bucket, []]));

  items.forEach((item) => {
    const bucket = resolvePmOverviewBucket(item, agentLookup);
    grouped.get(bucket.key).push({
      ...item,
      ownerPresentation: bucket.ownerPresentation,
      pmBucket: bucket,
    });
  });

  return PM_OVERVIEW_BUCKET_ORDER.map((bucketKey) => ({
    key: bucketKey,
    label: getPmOverviewBucketLabel(bucketKey),
    items: grouped.get(bucketKey),
  }));
}

export function summarizePmOverviewResults(sections, activeBucket) {
  const visibleCount = sections.reduce((sum, section) => sum + section.items.length, 0);
  if (activeBucket) return `${visibleCount} task${visibleCount === 1 ? '' : 's'} shown in ${getPmOverviewBucketLabel(activeBucket)}.`;
  return `${visibleCount} task${visibleCount === 1 ? '' : 's'} shown across ${sections.filter((section) => section.items.length).length} buckets.`;
}

export function filterTasksForRoleInbox(items, roleKey, agentLookup) {
  const normalizedRole = normalizeRoleKey(roleKey);
  return items.filter((item) => resolveRoleInboxMembership(item, agentLookup).inboxRole === normalizedRole);
}

export function summarizeRoleInboxResults(count, roleKey) {
  const label = getRoleInboxLabel(roleKey);
  return `${count} task${count === 1 ? '' : 's'} routed to ${label}.`;
}

export function filterTaskList(items, filtersOrOwner) {
  const filters = typeof filtersOrOwner === 'string'
    ? { owner: filtersOrOwner }
    : { owner: '', priority: '', status: '', searchTerm: '', ...(filtersOrOwner || {}) };

  return items.filter((item) => {
    if (filters.owner) {
      if (filters.owner === UNASSIGNED_FILTER_VALUE && item.current_owner) return false;
      if (filters.owner !== UNASSIGNED_FILTER_VALUE && item.current_owner !== filters.owner) return false;
    }
    if (filters.priority && String(item.priority || '') !== filters.priority) return false;
    if (filters.status && String(item.current_stage || '') !== filters.status) return false;
    if (filters.searchTerm && !matchesTaskSearch(item, filters.searchTerm)) return false;
    return true;
  });
}

export function summarizeListResults(count, ownerFilter, agentLookup, view = 'list') {
  const noun = view === 'board' ? 'cards' : 'tasks';
  if (!ownerFilter) return `${count} ${noun} shown.`;
  if (ownerFilter === UNASSIGNED_FILTER_VALUE) return `${count} unassigned ${noun} shown.`;
  return `${count} ${noun} shown for ${agentLookup.get(ownerFilter)?.label || ownerFilter}.`;
}

export function compareStageName(a, b) {
  const left = STAGE_ORDER.indexOf(a);
  const right = STAGE_ORDER.indexOf(b);
  if (left === -1 && right === -1) return a.localeCompare(b);
  if (left === -1) return 1;
  if (right === -1) return -1;
  return left - right;
}

export function buildBoardColumns(allItems, visibleItems, agentLookup) {
  const visibleById = new Set(visibleItems.map((item) => item.task_id));
  const stages = buildBoardStageOrder(allItems.length ? allItems : visibleItems);
  return stages.map((stage) => ({
    stage,
    items: allItems
      .filter((item) => (item.current_stage || 'Unspecified') === stage && visibleById.has(item.task_id))
      .map((item) => ({ ...item, ownerPresentation: resolveOwnerPresentation(item, agentLookup) })),
  }));
}

function comparePriority(left, right) {
  const leftRank = PRIORITY_ORDER[left?.priority] ?? Number.MAX_SAFE_INTEGER;
  const rightRank = PRIORITY_ORDER[right?.priority] ?? Number.MAX_SAFE_INTEGER;
  if (leftRank !== rightRank) return leftRank - rightRank;
  return 0;
}

function compareFreshnessTimestamp(left, right) {
  const leftTs = Date.parse(left?.freshness?.last_updated_at || '') || 0;
  const rightTs = Date.parse(right?.freshness?.last_updated_at || '') || 0;
  if (leftTs !== rightTs) return leftTs - rightTs;
  return 0;
}

function compareStableTaskId(left, right) {
  return String(left?.task_id || '').localeCompare(String(right?.task_id || ''));
}

export function sortInboxItems(items = []) {
  return [...items].sort((left, right) => comparePriority(left, right) || compareFreshnessTimestamp(left, right) || compareStableTaskId(left, right));
}

export function resolveQueueReason(item, roleKey) {
  const normalizedRole = normalizeRoleKey(roleKey);
  const priority = item?.priority || 'Unprioritized';
  const active = ACTIVE_STAGES.has(item?.current_stage || '');
  const actionNeeded = item?.next_required_action || null;
  const queueEnteredAt = item?.queue_entered_at || item?.freshness?.last_updated_at || null;

  if (actionNeeded) {
    return {
      label: actionNeeded,
      detail: `Action needed from ${getRoleInboxLabel(normalizedRole)}. Ordered by priority first, then queue age (${queueEnteredAt || 'unknown'}), then task ID for stable tie-breaking.`,
    };
  }

  if (active) {
    return {
      label: 'Active work retained',
      detail: `${priority} task already in progress. Higher-priority queued work should not automatically preempt active work.`,
    };
  }

  return {
    label: `${priority} waiting work`,
    detail: `Waiting for ${getRoleInboxLabel(normalizedRole)} action. Ordered by priority first, then queue age (${queueEnteredAt || 'unknown'}), then task ID for stable tie-breaking.`,
  };
}

export function buildRoleInboxItems(items, roleKey, agentLookup) {
  return sortInboxItems(filterTasksForRoleInbox(items, roleKey, agentLookup)).map((item) => ({
    ...item,
    ownerPresentation: resolveOwnerPresentation(item, agentLookup),
    routing: resolveRoleInboxMembership(item, agentLookup),
    queueReason: resolveQueueReason(item, roleKey),
  }));
}
