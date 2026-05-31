const ROLE_PERMISSIONS = Object.freeze({
  stakeholder: ['state:read'],
  reader: ['history:read', 'state:read', 'relationships:read', 'observability:read', 'agents:read'],
  contributor: ['history:read', 'state:read', 'relationships:read', 'observability:read', 'agents:read', 'events:write', 'tasks:create'],
  pm: ['history:read', 'state:read', 'relationships:read', 'observability:read', 'agents:read', 'agents:write', 'agent-role-requests:write', 'assignment:write', 'metrics:read', 'tasks:create', 'projects:write'],
  product_owner: ['history:read', 'state:read', 'relationships:read', 'observability:read', 'agents:read', 'metrics:read'],
  'product-owner': ['history:read', 'state:read', 'relationships:read', 'observability:read', 'agents:read', 'metrics:read'],
  admin: ['history:read', 'state:read', 'relationships:read', 'observability:read', 'agents:read', 'agents:write', 'agent-delegation:write', 'agent-role-requests:write', 'events:write', 'assignment:write', 'projections:rebuild', 'metrics:read', 'tasks:create', 'projects:write'],
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
