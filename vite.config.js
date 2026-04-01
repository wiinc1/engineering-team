const { defineConfig, loadEnv } = require('vite');
const react = require('@vitejs/plugin-react');

module.exports = defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxyTarget = env.VITE_TASK_API_PROXY_TARGET;

  return {
    plugins: [react()],
    server: proxyTarget
      ? {
          proxy: {
            '/tasks': proxyTarget,
          },
        }
      : undefined,
  };
});
