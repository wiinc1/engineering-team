export const UNASSIGNED_FILTER_VALUE = '__unassigned__';
export const STAGE_ORDER = ['BACKLOG', 'TODO', 'IMPLEMENT', 'IN_PROGRESS', 'REVIEW', 'VERIFY', 'DONE', 'REOPEN'];

export function mapAgentOptions(items = []) {
  return items.map((agent) => ({
    id: agent.id,
    label: `${agent.display_name}${agent.role ? ` · ${agent.role}` : ''}`,
  }));
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
