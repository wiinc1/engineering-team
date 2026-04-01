const ROLE_PERMISSIONS = Object.freeze({
  reader: ['history:read', 'state:read', 'relationships:read', 'observability:read'],
  contributor: ['history:read', 'state:read', 'relationships:read', 'observability:read', 'events:write'],
  admin: ['history:read', 'state:read', 'relationships:read', 'observability:read', 'events:write', 'projections:rebuild', 'metrics:read'],
  sre: ['history:read', 'state:read', 'relationships:read', 'observability:read', 'metrics:read'],
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
  authorize,
};
