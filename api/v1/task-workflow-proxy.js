const { handleRequest } = require('../_server');

module.exports = (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const workflowPath = url.searchParams.get('__workflow_path');
  if (workflowPath) {
    const params = new URLSearchParams(url.searchParams);
    params.delete('__workflow_path');
    const query = params.toString();
    req.url = `/api/v1/${workflowPath.replace(/^\/+/, '')}${query ? `?${query}` : ''}`;
  }
  return handleRequest(req, res);
};
