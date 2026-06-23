const { defineConfig, loadEnv } = require('vite');
const react = require('@vitejs/plugin-react');

function shouldBypassAuthProxy(req) {
  if (req.method !== 'GET') return false;
  const path = (req.url || '').split('?')[0].replace(/\/+$/, '') || '/';
  return path === '/auth/callback'
    || path === '/auth/email/verify'
    || path === '/auth/password-reset';
}

function shouldBypassTasksProxy(req) {
  // Browser navigations request HTML; API fetches request JSON. Without this bypass,
  // /tasks/:taskId page loads are proxied to the audit API and render raw JSON.
  const accept = String(req.headers?.accept || '');
  return req.method === 'GET' && accept.includes('text/html') ? req.url : undefined;
}

module.exports = defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxyTarget = env.VITE_TASK_API_PROXY_TARGET;

  return {
    plugins: [react()],
    server: proxyTarget
      ? {
          proxy: {
            '/tasks': {
              target: proxyTarget,
              bypass: (req) => shouldBypassTasksProxy(req),
            },
            '/auth': {
              target: proxyTarget,
              bypass: (req) => (shouldBypassAuthProxy(req) ? req.url : undefined),
            },
            '/backend': {
              target: proxyTarget,
              rewrite: (path) => path.replace(/^\/backend/, '') || '/',
            },
          },
        }
      : undefined,
  };
});
