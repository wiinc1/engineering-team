const { handleRequest } = require('../_server');

const workflowPathPattern =
  /^tasks\/[^/?#]+\/(?:execution-contract|contract-coverage-audit|sre-monitoring)\/[^/?#]+$/;
const auditReadPathPattern =
  /^tasks\/[^/?#]+(?:\/(?:detail|history|observability-summary|state))?$/;

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

function rejectInvalidAuditPath(res) {
  res.statusCode = 400;
  if (typeof res.setHeader === 'function') {
    res.setHeader('content-type', 'application/json');
  }
  res.end(JSON.stringify({
    error: {
      code: 'invalid_audit_proxy_path',
      message: 'Invalid audit proxy path.',
    },
  }));
}

module.exports = (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const workflowPath = url.searchParams.get('__workflow_path');
  const auditPath = url.searchParams.get('__audit_path');
  if (auditPath) {
    const normalizedAuditPath = auditPath.replace(/^\/+/, '');
    if (!auditReadPathPattern.test(normalizedAuditPath)) {
      return rejectInvalidAuditPath(res);
    }
    const params = new URLSearchParams(url.searchParams);
    params.delete('__audit_path');
    const query = params.toString();
    req.url = `/api/${normalizedAuditPath}${query ? `?${query}` : ''}`;
  }
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
