import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/app/App';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (globalThis as any).__ENGINEERING_TEAM_RUNTIME_CONFIG__;
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/sign-in');
});

function renderSignIn(config: Record<string, unknown>) {
  (globalThis as any).__ENGINEERING_TEAM_RUNTIME_CONFIG__ = config;
  window.history.replaceState({}, '', '/sign-in');
  return render(<App />);
}

describe('auth sign-in visual states', () => {
  it('matches the configured enterprise OIDC state', async () => {
    const { container } = renderSignIn({
      oidcDiscoveryUrl: 'https://idp.example/.well-known/openid-configuration',
      oidcClientId: 'browser-client',
      oidcRedirectUri: 'https://app.example/auth/callback',
      internalAuthBootstrapEnabled: false,
    });

    await screen.findByRole('heading', { name: 'Sign in to the workflow app' });
    expect(screen.getByRole('button', { name: 'Continue with enterprise sign-in' })).toBeEnabled();
    expect(container.querySelector('.auth-card')).toMatchSnapshot();
  });

  it('matches the magic-link state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: { code: 'missing_auth_context', message: 'A browser session is required.' } }),
    })));
    const { container } = renderSignIn({
      productionAuthStrategy: 'magic-link',
      internalAuthBootstrapEnabled: true,
      oidcDiscoveryUrl: 'https://idp.example/.well-known/openid-configuration',
      oidcClientId: 'browser-client',
    });

    await screen.findByRole('heading', { name: 'Sign in to the workflow app' });
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue with enterprise sign-in' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Trusted auth code')).not.toBeInTheDocument();
    expect(container.querySelector('.auth-card')).toMatchSnapshot();
  });

  it('matches the no-login-path configuration error state', async () => {
    const { container } = renderSignIn({
      internalAuthBootstrapEnabled: false,
    });

    await screen.findByRole('heading', { name: 'Sign in to the workflow app' });
    expect(screen.getByRole('button', { name: 'Continue with enterprise sign-in' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('This deployment is missing enterprise auth configuration.');
    expect(container.querySelector('.auth-card')).toMatchSnapshot();
  });

  it('matches the local internal fallback state', async () => {
    const { container } = renderSignIn({
      internalAuthBootstrapEnabled: true,
    });

    await screen.findByRole('heading', { name: 'Sign in to the workflow app' });
    expect(screen.getByLabelText('Trusted auth code')).toBeInTheDocument();
    expect(container.querySelector('.auth-card')).toMatchSnapshot();
  });
});
