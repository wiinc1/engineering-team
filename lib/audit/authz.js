const ROLE_PERMISSIONS = Object.freeze({
  stakeholder: ['state:read'],
  reader: ['history:read', 'state:read', 'relationships:read', 'observability:read', 'agents:read'],
  contributor: ['history:read', 'state:read', 'relationships:read', 'observability:read', 'agents:read', 'events:write', 'tasks:create'],
  pm: ['history:read', 'state:read', 'relationships:read', 'observability:read', 'agents:read', 'assignment:write', 'tasks:create'],
  admin: ['history:read', 'state:read', 'relationships:read', 'observability:read', 'agents:read', 'events:write', 'assignment:write', 'projections:rebuild', 'metrics:read', 'tasks:create'],
  sre: ['history:read', 'state:read', 'relationships:read', 'observability:read', 'agents:read', 'metrics:read'],
});

function expandPermissions(roles = []) {
  const permissions = new Set();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role] || []) {
      permissions.add(permission);
    }
  }
  return permissions;
}

function authorize(context, permission) {
  const permissions = expandPermissions(context.roles);
  return permissions.has(permission);
}

module.exports = {
  ROLE_PERMISSIONS,
  expandPermissions,
  authorize,
};
