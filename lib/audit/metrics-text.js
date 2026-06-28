function parsePrometheusMetric(text, metricName) {
  const pattern = new RegExp(`^${metricName}\\s+(\\d+(?:\\.\\d+)?)`, 'm');
  const match = String(text || '').match(pattern);
  return match ? Number(match[1]) : null;
}

async function readAuditMetrics(baseUrl, authHeaders = {}, fetchImpl = fetch) {
  const response = await fetchImpl(`${String(baseUrl).replace(/\/+$/, '')}/metrics`, { headers: authHeaders });
  if (!response.ok) {
    throw new Error(`metrics fetch failed: ${response.status}`);
  }
  const text = await response.text();
  return {
    text,
    workflow_projection_lag_seconds: parsePrometheusMetric(text, 'workflow_projection_lag_seconds'),
    workflow_projection_events_processed_total: parsePrometheusMetric(text, 'workflow_projection_events_processed_total'),
    workflow_outbox_events_published_total: parsePrometheusMetric(text, 'workflow_outbox_events_published_total'),
    workflow_projection_failures_total: parsePrometheusMetric(text, 'workflow_projection_failures_total'),
    workflow_outbox_publish_failures_total: parsePrometheusMetric(text, 'workflow_outbox_publish_failures_total'),
  };
}

module.exports = {
  parsePrometheusMetric,
  readAuditMetrics,
};