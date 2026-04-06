function matchTaskCreationRoute(pathname = '') {
  const normalizedPath = pathname.replace(/\/+$/, '') || '/';
  const match = normalizedPath.match(/^\/tasks\/create$/);

  if (!match) {
    return null;
  }

  return {
    pathname: '/tasks/create',
  };
}

function createTaskCreationPageModule({ client }) {
  return {
    match(pathname) {
      return matchTaskCreationRoute(pathname);
    },
    
    async load({ pathname, search = '' }) {
      const route = matchTaskCreationRoute(pathname);

      if (!route) {
        const error = new Error(`No task creation route matched: ${pathname}`);
        error.code = 'route_not_found';
        throw error;
      }

      // Return an empty model for now
      return {
        route,
        task: null,
      };
    },
    
    async create(taskData) {
      return client.createTask(taskData);
    },
    
    async saveDraft(taskData) {
      return client.saveDraft(taskData);
    },
  };
}

module.exports = {
  matchTaskCreationRoute,
  createTaskCreationPageModule,
};