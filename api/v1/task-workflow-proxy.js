const { handleRequest } = require('../_server');

const workflowPathPattern =
  /^tasks\/[^/?#]+\/(?:execution-contract|contract-coverage-audit|sre-monitoring)\/[^/?#]+$/;

function rejectInvalidWorkflowPath(res) {
  res.statusCode = 400;
  if (typeof res.setHeader === 'function') {
    res.setHeader('content-type', 'application/json');
  }
  res.end(JSON.stringify({
    error: {
      code: 'invalid_workflow_proxy_path',
      message: 'Invalid task workflow proxy path.',
    },
  }));
}

module.exports = (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const workflowPath = url.searchParams.get('__workflow_path');
  if (workflowPath) {
    const normalizedWorkflowPath = workflowPath.replace(/^\/+/, '');
    if (!workflowPathPattern.test(normalizedWorkflowPath)) {
      return rejectInvalidWorkflowPath(res);
    }
    const params = new URLSearchParams(url.searchParams);
    params.delete('__workflow_path');
    const query = params.toString();
    req.url = `/api/v1/${normalizedWorkflowPath}${query ? `?${query}` : ''}`;
  }
  return handleRequest(req, res);
};
