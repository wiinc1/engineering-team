const http = require('node:http');
const { once } = require('node:events');

function createJsonResponse(response, statusCode, payload) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

async function startMockServer(name, port, handler) {
  const server = http.createServer(async (request, response) => {
    try {
      await handler(request, response);
    } catch (error) {
      createJsonResponse(response, 500, { error: error.message });
    }
  });
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  return {
    name,
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

async function startOpenClawMock(port) {
  return startMockServer('openclaw-mock', port, async (request, response) => {
    const url = request.url || '';
    if (request.method === 'GET' && url === '/health') {
      createJsonResponse(response, 200, { status: 'ok', service: 'openclaw-mock' });
      return;
    }
    if (request.method === 'POST' && url === '/sessions') {
      let body = '';
      for await (const chunk of request) body += chunk;
      const payload = JSON.parse(body || '{}');
      createJsonResponse(response, 200, {
        sessionId: `sess_${payload.packet?.taskId || 'local'}_${payload.owner || 'main'}`,
      });
      return;
    }
    if (request.method === 'POST' && /^\/sessions\/[^/]+\/children$/.test(url)) {
      createJsonResponse(response, 200, { sessionId: 'child_local_specialist_1' });
      return;
    }
    if (request.method === 'POST' && /^\/sessions\/[^/]+\/notifications$/.test(url)) {
      createJsonResponse(response, 200, { accepted: true });
      return;
    }
    createJsonResponse(response, 404, { error: 'not_found' });
  });
}

async function startHermesMock(port) {
  return startMockServer('hermes-mock', port, async (request, response) => {
    const url = request.url || '';
    if (request.method === 'GET' && url === '/health') {
      createJsonResponse(response, 200, { status: 'ok', service: 'hermes-mock' });
      return;
    }
    if (request.method === 'POST' && /^\/tasks\/[^/]+\/memory$/.test(url)) {
      let body = '';
      for await (const chunk of request) body += chunk;
      const payload = JSON.parse(body || '{}');
      createJsonResponse(response, 200, {
        summary: payload.summary,
        phase: payload.phase,
        createdAt: payload.createdAt || new Date().toISOString(),
      });
      return;
    }
    if (request.method === 'GET' && /^\/tasks\/[^/]+\/memory\/latest$/.test(url)) {
      createJsonResponse(response, 404, { error: 'not_found' });
      return;
    }
    createJsonResponse(response, 404, { error: 'not_found' });
  });
}

module.exports = {
  startOpenClawMock,
  startHermesMock,
};