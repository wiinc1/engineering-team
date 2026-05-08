import { jsx } from 'react/jsx-runtime';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { App } from '../../src/app/App';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete globalThis.__ENGINEERING_TEAM_RUNTIME_CONFIG__;
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/sign-in');
});

function renderAuth(config, search = '') {
  globalThis.__ENGINEERING_TEAM_RUNTIME_CONFIG__ = config;
  window.history.replaceState({}, '', `/sign-in${search}`);
  return render(jsx(App, {}));
}

  it('matches the configured enterprise OIDC state', async () => {
    const { container } = renderAuth({
      oidcDiscoveryUrl: 'https://idp.example/.well-known/openid-configuration',
      oidcClientId: 'browser-client',
      oidcRedirectUri: 'https://app.example/auth/callback',
      internalAuthBootstrapEnabled: false,
    });

    await screen.findByRole('heading', { name: 'Sign in to Engineering Team' });
    expect(screen.getByRole('button', { name: 'Continue with enterprise sign-in' })).toBeEnabled();
    expect(container.querySelector('.auth-card')).toMatchSnapshot();
  });

  it('matches the registration sign-in state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 401,
        json: async () => ({
          error: { code: 'missing_auth_context', message: 'A browser session is required.' },
        }),
      }))
    );

    const { container } = renderAuth({
      productionAuthStrategy: 'registration',
      internalAuthBootstrapEnabled: true,
      oidcDiscoveryUrl: 'https://idp.example/.well-known/openid-configuration',
      oidcClientId: 'browser-client',
    });

    await screen.findByRole('heading', { name: 'Sign in to Engineering Team' });
    expect(screen.getByText('Access your task workspace and inboxes.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show password' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Forgot password?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create an account' })).toBeInTheDocument();
    expect(screen.queryByLabelText('API base URL')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Invite code')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue with enterprise sign-in' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Trusted auth code')).not.toBeInTheDocument();
    expect(container.querySelector('.auth-card')).toMatchSnapshot();
  });

  it('matches the registration create-account state', async () => {
    const { container } = renderAuth(
      {
        productionAuthStrategy: 'registration',
        internalAuthBootstrapEnabled: false,
      },
      '?mode=register'
    );

    await screen.findByRole('heading', { name: 'Create your account' });
    expect(
      screen.getByText('Create an account. An admin will approve access before you can use Engineering Team.')
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByText('At least 12 characters with one letter and one number.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Invite code')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Forgot password?' })).not.toBeInTheDocument();
    expect(container.querySelector('.auth-card')).toMatchSnapshot();
  });

  it('matches the registration reset-request state', async () => {
    const { container } = renderAuth(
      {
        productionAuthStrategy: 'registration',
        internalAuthBootstrapEnabled: false,
      },
      '?mode=reset'
    );

    await screen.findByRole('heading', { name: 'Reset your password' });
    expect(screen.getByText('Enter your account email and we will send reset instructions.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send reset instructions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to sign in' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(container.querySelector('.auth-card')).toMatchSnapshot();
  });

  it('switches registration modes without losing the typed email', async () => {
    renderAuth({
      productionAuthStrategy: 'registration',
      internalAuthBootstrapEnabled: false,
    });

    await screen.findByRole('heading', { name: 'Sign in to Engineering Team' });
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'person@example.com' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create an account' }));
    await screen.findByRole('heading', { name: 'Create your account' });
    expect(screen.getByLabelText('Email address')).toHaveValue('person@example.com');

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('heading', { name: 'Sign in to Engineering Team' });
    expect(screen.getByLabelText('Email address')).toHaveValue('person@example.com');

    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    await screen.findByRole('heading', { name: 'Reset your password' });
    expect(screen.getByLabelText('Email address')).toHaveValue('person@example.com');
  });

  it('matches the no-login-path configuration error state', async () => {
    const { container } = renderAuth({ internalAuthBootstrapEnabled: false });

    await screen.findByRole('heading', { name: 'Sign in to Engineering Team' });
    expect(screen.getByRole('button', { name: 'Continue with enterprise sign-in' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('This deployment has no enabled sign-in method.');
    expect(container.querySelector('.auth-card')).toMatchSnapshot();
  });

  it('matches the local internal fallback state', async () => {
    const { container } = renderAuth({ internalAuthBootstrapEnabled: true });

    await screen.findByRole('heading', { name: 'Sign in to Engineering Team' });
    expect(screen.getByLabelText('Trusted auth code')).toBeInTheDocument();
    expect(screen.getByLabelText('API base URL')).toBeInTheDocument();
    expect(container.querySelector('.auth-card')).toMatchSnapshot();
  });
