import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/app/**/*.{js,jsx,mjs,ts,tsx}'],
      exclude: ['src/app/main.jsx', 'src/app/session.js', 'src/app/session-oidc.js'],
    },
  },
});
