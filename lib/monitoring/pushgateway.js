const http = require('http');
const https = require('https');
const { URL } = require('url');

function pushMetrics({ endpoint, job = 'audit-workers', instance = 'local', metrics = {} }) {
  if (!endpoint) return Promise.resolve({ skipped: true });

  const url = new URL(`/metrics/job/${encodeURIComponent(job)}/instance/${encodeURIComponent(instance)}`, endpoint);
  const body = Object.entries(metrics)
    .filter(([, value]) => typeof value === 'number')
    .map(([key, value]) => `# TYPE ${key} gauge\n${key} ${value}`)
    .join('\n') + '\n';

  const transport = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(url, {
      method: 'PUT',
      headers: { 'content-type': 'text/plain; version=0.0.4', 'content-length': Buffer.byteLength(body) },
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = { pushMetrics };
