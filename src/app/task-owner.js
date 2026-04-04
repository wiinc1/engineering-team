export const UNASSIGNED_FILTER_VALUE = '__unassigned__';
export const STAGE_ORDER = ['BACKLOG', 'TODO', 'IMPLEMENT', 'IN_PROGRESS', 'REVIEW', 'VERIFY', 'DONE', 'REOPEN'];
export const ROLE_INBOXES = ['architect', 'engineer', 'qa', 'sre'];
export const PM_OVERVIEW_BUCKET_ORDER = ['needs-routing-attention', 'unassigned', ...ROLE_INBOXES];

const ROLE_LABELS = {
  architect: 'Architect',
  engineer: 'Engineer',
  qa: 'QA',
  sre: 'SRE',
};

const PM_BUCKET_LABELS = {
  'needs-routing-attention': 'Needs routing attention',
  unassigned: 'Unassigned',
  architect: 'Architect',
  engineer: 'Engineer',
  qa: 'QA',
  sre: 'SRE',
};

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
  const routing = resolveRoleInboxMembership(item, agentLookup);
  const ownerPresentation = resolveOwnerPresentation(item, agentLookup);

  if (routing.reason === 'matched') {
    return {
      key: routing.inboxRole,
      label: getPmOverviewBucketLabel(routing.inboxRole),
      routingCue: `${getRoleInboxLabel(routing.inboxRole)} route`,
      routingReason: routing.routingLabel,
      ownerPresentation,
    };
  }

  if (routing.reason === 'unassigned') {
    return {
      key: 'unassigned',
      label: 'Unassigned',
      routingCue: 'Unassigned',
      routingReason: 'No owner is assigned, so this task is visible in the Unassigned bucket.',
      ownerPresentation,
    };
  }

  if (routing.reason === 'hidden') {
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

export function filterTaskList(items, ownerFilter) {
  if (!ownerFilter) return items;
  if (ownerFilter === UNASSIGNED_FILTER_VALUE) return items.filter((item) => !item.current_owner);
  return items.filter((item) => item.current_owner === ownerFilter);
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
  const stages = Array.from(new Set(allItems.map((item) => item.current_stage || 'Unspecified'))).sort(compareStageName);
  return stages.map((stage) => ({
    stage,
    items: allItems
      .filter((item) => (item.current_stage || 'Unspecified') === stage && visibleById.has(item.task_id))
      .map((item) => ({ ...item, ownerPresentation: resolveOwnerPresentation(item, agentLookup) })),
  }));
}

export function buildRoleInboxItems(items, roleKey, agentLookup) {
  return filterTasksForRoleInbox(items, roleKey, agentLookup).map((item) => ({
    ...item,
    ownerPresentation: resolveOwnerPresentation(item, agentLookup),
    routing: resolveRoleInboxMembership(item, agentLookup),
  }));
}
