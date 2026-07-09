import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { App } from './App';
import { clearBrowserSessionConfig } from './session';

const originalEnv = {
  mode: import.meta.env.MODE,
  prod: import.meta.env.PROD,
  productionAuthStrategy: import.meta.env.VITE_AUTH_PRODUCTION_AUTH_STRATEGY,
  internalBootstrapEnabled: import.meta.env.VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED,
  deployEnv: import.meta.env.VITE_FACTORY_DEPLOY_ENV,
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
  (import.meta.env as Record<string, string | boolean | undefined>).PROD = originalEnv.prod;
  setViteEnv('VITE_AUTH_PRODUCTION_AUTH_STRATEGY', originalEnv.productionAuthStrategy);
  setViteEnv('VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED', originalEnv.internalBootstrapEnabled);
  setViteEnv('VITE_FACTORY_DEPLOY_ENV', originalEnv.deployEnv);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  restoreViteEnv();
  clearBrowserSessionConfig();
  delete globalThis.__ENGINEERING_TEAM_RUNTIME_CONFIG__;
  window.history.replaceState({}, '', '/sign-in');
});

it('renders the production registration form from Vite env without runtime injection', async () => {
  clearBrowserSessionConfig();
  delete globalThis.__ENGINEERING_TEAM_RUNTIME_CONFIG__;
  window.history.replaceState({}, '', '/sign-in');
  setViteEnv('MODE', 'production');
  setViteEnv('VITE_AUTH_PRODUCTION_AUTH_STRATEGY', 'registration');
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

  await screen.findByRole('heading', { name: 'Sign in to Engineering Team' });
  expect(screen.getByText('Engineering Team')).toBeInTheDocument();
  expect(screen.getByText('Access your task workspace and inboxes.')).toBeInTheDocument();
  expect(screen.getByLabelText('Email address')).toBeInTheDocument();
  expect(screen.getByLabelText('Password')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Create an account' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Forgot password?' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Continue with enterprise sign-in' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Trusted auth code')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('API base URL')).not.toBeInTheDocument();
});

it('defaults factory preview deploy profile to registration even when the internal fallback flag is present', async () => {
  clearBrowserSessionConfig();
  delete globalThis.__ENGINEERING_TEAM_RUNTIME_CONFIG__;
  window.history.replaceState({}, '', '/sign-in');
  setViteEnv('MODE', 'production');
  (import.meta.env as Record<string, string | boolean | undefined>).PROD = true;
  setViteEnv('VITE_FACTORY_DEPLOY_ENV', 'preview');
  setViteEnv('VITE_AUTH_PRODUCTION_AUTH_STRATEGY', undefined);
  setViteEnv('VITE_AUTH_INTERNAL_BOOTSTRAP_ENABLED', 'true');
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

  await screen.findByRole('heading', { name: 'Sign in to Engineering Team' });
  expect(screen.getByLabelText('Email address')).toBeInTheDocument();
  expect(screen.getByLabelText('Password')).toBeInTheDocument();
  expect(screen.queryByLabelText('Trusted auth code')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('API base URL')).not.toBeInTheDocument();
});
