import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { App } from './App';
import { clearBrowserSessionConfig } from './session';

const originalEnv = {
  mode: import.meta.env.MODE,
  productionAuthStrategy: import.meta.env.VITE_AUTH_PRODUCTION_AUTH_STRATEGY,
  internalBootstrapEnabled: import.meta.env.VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED,
};

function setViteEnv(name: string, value: string | undefined) {
  const env = import.meta.env as Record<string, string | boolean | undefined>;
  if (value === undefined) {
    delete env[name];
    return;
  }
  env[name] = value;
}

function restoreViteEnv() {
  setViteEnv('MODE', originalEnv.mode);
  setViteEnv('VITE_AUTH_PRODUCTION_AUTH_STRATEGY', originalEnv.productionAuthStrategy);
  setViteEnv('VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED', originalEnv.internalBootstrapEnabled);
}

describe('browser auth runtime environment', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    restoreViteEnv();
    clearBrowserSessionConfig();
    delete globalThis.__ENGINEERING_TEAM_RUNTIME_CONFIG__;
    window.history.replaceState({}, '', '/sign-in');
  });

  it('renders the production magic-link email form from Vite env without runtime injection', async () => {
    clearBrowserSessionConfig();
    delete globalThis.__ENGINEERING_TEAM_RUNTIME_CONFIG__;
    window.history.replaceState({}, '', '/sign-in');
    setViteEnv('MODE', 'production');
    setViteEnv('VITE_AUTH_PRODUCTION_AUTH_STRATEGY', 'magic-link');
    setViteEnv('VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED', 'false');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 401,
        json: async () => ({
          error: {
            code: 'missing_auth_context',
            message: 'A browser session is required.',
          },
        }),
      }))
    );

    render(<App />);

    await screen.findByRole('heading', { name: 'Sign in to the workflow app' });
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send sign-in link' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue with enterprise sign-in' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Trusted auth code')).not.toBeInTheDocument();
  });
});
