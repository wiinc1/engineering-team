export const LIFECYCLE_STAGE_ORDER = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'VERIFY', 'REOPEN', 'DONE'];

export const BOARD_STAGE_ORDER = [
  'DRAFT',
  'BACKLOG',
  'TODO',
  'IMPLEMENT',
  'IMPLEMENTATION',
  'IN_PROGRESS',
  'CONTRACT_COVERAGE_AUDIT',
  'REVIEW',
  'QA_TESTING',
  'VERIFY',
  'SRE_MONITORING',
  'PM_CLOSE_REVIEW',
  'REOPEN',
  'DONE',
];

const BOARD_STAGE_PRESENTATION = {
  DRAFT: {
    label: 'Intake Draft',
    description: 'Raw request awaiting PM refinement.',
    group: 'Intake Draft',
  },
  BACKLOG: {
    label: 'Task Refinement',
    description: 'PM and architect shaping before approval.',
    group: 'Task Refinement',
  },
  TODO: {
    label: 'Operator Approval',
    description: 'Ready for approval, routing, or dispatch.',
    group: 'Operator Approval',
  },
  IMPLEMENT: {
    label: 'Implementation',
    description: 'Engineer-owned delivery work.',
    group: 'Implementation',
  },
  IMPLEMENTATION: {
    label: 'Implementation',
    description: 'Engineer-owned delivery work.',
    group: 'Implementation',
  },
  IN_PROGRESS: {
    label: 'Implementation',
    description: 'Active engineer-owned work.',
    group: 'Implementation',
  },
  CONTRACT_COVERAGE_AUDIT: {
    label: 'Implementation Evidence',
    description: 'Coverage evidence before QA verification.',
    group: 'Implementation',
  },
  REVIEW: {
    label: 'QA Verification',
    description: 'QA review and validation work.',
    group: 'QA Verification',
  },
  QA_TESTING: {
    label: 'QA Verification',
    description: 'QA testing and validation work.',
    group: 'QA Verification',
  },
  VERIFY: {
    label: 'SRE Verification',
    description: 'Release verification and monitoring readiness.',
    group: 'SRE Verification',
  },
  SRE_MONITORING: {
    label: 'SRE Verification',
    description: 'Production monitoring validation.',
    group: 'SRE Verification',
  },
  PM_CLOSE_REVIEW: {
    label: 'Operator Closeout',
    description: 'PM, operator, or stakeholder close review.',
    group: 'Operator Closeout',
  },
  REOPEN: {
    label: 'Reopened Work',
    description: 'Returned work awaiting reroute.',
    group: 'Implementation',
  },
  DONE: {
    label: 'Closed',
    description: 'Operator closeout complete.',
    group: 'Operator Closeout',
  },
};

export const LIFECYCLE_TRANSITIONS = {
  BACKLOG: { TODO: 'any' },
  TODO: { BACKLOG: 'any', IN_PROGRESS: 'any' },
  IN_PROGRESS: { TODO: 'assignee', VERIFY: 'assignee' },
  VERIFY: { DONE: 'sre', REOPEN: 'sre' },
  REOPEN: { TODO: 'assignee_or_sre', IN_PROGRESS: 'assignee_or_sre' },
  DONE: {},
};

function actorRoles(tokenClaims) {
  return Array.isArray(tokenClaims?.roles) ? tokenClaims.roles.map((role) => String(role || '').trim().toLowerCase()).filter(Boolean) : [];
}

function normalizeLifecycleRoleKey(role) {
  if (typeof role !== 'string') return null;
  const normalized = role.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'architecture') return 'architect';
  if (normalized === 'engineering') return 'engineer';
  if (normalized === 'quality assurance') return 'qa';
  if (normalized === 'product' || normalized === 'product manager') return 'pm';
  if (normalized === 'human stakeholder' || normalized === 'stakeholder') return 'human';
  return ['pm', 'architect', 'engineer', 'qa', 'sre', 'human'].includes(normalized) ? normalized : null;
}

export function isLifecycleStage(stage) {
  return LIFECYCLE_STAGE_ORDER.includes(String(stage || '').trim().toUpperCase());
}

export function compareLifecycleStage(a, b) {
  const left = LIFECYCLE_STAGE_ORDER.indexOf(a);
  const right = LIFECYCLE_STAGE_ORDER.indexOf(b);
  if (left === -1 && right === -1) return String(a || '').localeCompare(String(b || ''));
  if (left === -1) return 1;
  if (right === -1) return -1;
  return left - right;
}

export function getBoardStagePresentation(stage) {
  const key = String(stage || '').trim().toUpperCase();
  return BOARD_STAGE_PRESENTATION[key] || {
    label: key || 'Unspecified',
    description: key ? 'Unmapped lifecycle state from the task read model.' : 'Task has no projected lifecycle state.',
    group: 'Unmapped',
  };
}

function isBoardStage(stage) {
  return BOARD_STAGE_ORDER.includes(String(stage || '').trim().toUpperCase());
}

export function buildBoardStageOrder(items = []) {
  const extras = Array.from(
    new Set(
      items
        .map((item) => String(item?.current_stage || '').trim())
        .filter((stage) => stage && !isBoardStage(stage)),
    ),
  ).sort((left, right) => String(left).localeCompare(String(right)));

  const presentLifecycle = BOARD_STAGE_ORDER.filter((stage) => items.some((item) => (item?.current_stage || '') === stage));
  return [...presentLifecycle, ...extras];
}

export function matchesTaskSearch(item, searchTerm = '') {
  const normalized = String(searchTerm || '').trim().toLowerCase();
  if (!normalized) return false;
  return [item?.task_id, item?.title].some((value) => String(value || '').toLowerCase().includes(normalized));
}

export function isTaskAssignedToCurrentActor(item, tokenClaims, agentLookup = new Map()) {
  const ownerId = String(item?.current_owner || '').trim();
  if (!ownerId) return false;
  const roles = actorRoles(tokenClaims);
  const subject = String(tokenClaims?.sub || '').trim().toLowerCase();
  if (subject && subject === ownerId.toLowerCase()) return true;

  const mappedRole = normalizeLifecycleRoleKey(agentLookup.get(ownerId)?.role || ownerId);
  return Boolean(mappedRole && roles.includes(mappedRole));
}

export function canTransitionLifecycleTask(item, toStage, tokenClaims, agentLookup = new Map()) {
  const fromStage = String(item?.current_stage || '').trim().toUpperCase();
  const nextStage = String(toStage || '').trim().toUpperCase();
  const permitted = LIFECYCLE_TRANSITIONS[fromStage]?.[nextStage] || null;
  const roles = actorRoles(tokenClaims);
  const assignedToActor = isTaskAssignedToCurrentActor(item, tokenClaims, agentLookup);
  const isSre = roles.includes('sre') || roles.includes('admin');

  if (!permitted) {
    return {
      allowed: false,
      reason: `Invalid transition: ${fromStage || 'UNKNOWN'} → ${nextStage || 'UNKNOWN'} is not allowed`,
    };
  }

  if (permitted === 'any') return { allowed: true, reason: '' };
  if (permitted === 'assignee' && assignedToActor) return { allowed: true, reason: '' };
  if (permitted === 'sre' && isSre) return { allowed: true, reason: '' };
  if (permitted === 'assignee_or_sre' && (assignedToActor || isSre)) return { allowed: true, reason: '' };

  if (permitted === 'sre') {
    return {
      allowed: false,
      reason: `Invalid transition: ${fromStage} → ${nextStage} requires SRE approval`,
    };
  }

  if (permitted === 'assignee_or_sre') {
    return {
      allowed: false,
      reason: `Invalid transition: ${fromStage} → ${nextStage} requires the assignee or SRE`,
    };
  }

  return {
    allowed: false,
    reason: `Invalid transition: ${fromStage} → ${nextStage} requires the assigned agent`,
  };
}
