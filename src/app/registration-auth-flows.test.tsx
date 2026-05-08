import { jsx as jsx } from 'react/jsx-runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from './App';
import { clearBrowserSessionConfig } from './session';

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe('registration auth browser flows', () => {
  beforeEach(() => {
    clearBrowserSessionConfig();
    globalThis.__ENGINEERING_TEAM_RUNTIME_CONFIG__ = {
      productionAuthStrategy: 'registration',
      internalAuthBootstrapEnabled: false,
    };
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    delete globalThis.__ENGINEERING_TEAM_RUNTIME_CONFIG__;
    window.history.replaceState({}, '', '/sign-in');
  });

  it('confirms email verification from the public verification route', async () => {
    const fetchMock = vi.fn(async (url, init) => {
      if (String(url).endsWith('/auth/me')) return jsonResponse({ error: { code: 'missing_auth_context' } }, 401);
      expect(String(url)).toBe('/auth/email/verify/confirm');
      expect(JSON.parse(String(init?.body))).toEqual({ token: 'verify-token' });
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState({}, '', '/auth/email/verify?token=verify-token');

    render(jsx(App, {}));

    await screen.findByText('Email verified. Sign in with your password.');
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/email/verify/confirm'))).toHaveLength(1);
  });

  it('submits password reset confirmation from the public reset route', async () => {
    const fetchMock = vi.fn(async (url, init) => {
      if (String(url).endsWith('/auth/me')) return jsonResponse({ error: { code: 'missing_auth_context' } }, 401);
      expect(String(url)).toBe('/auth/password-reset/confirm');
      expect(JSON.parse(String(init?.body))).toEqual({
        token: 'reset-token',
        password: 'NewCorrectHorse123!',
      });
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState({}, '', '/auth/password-reset?token=reset-token');

    render(jsx(App, {}));

    fireEvent.change(await screen.findByLabelText('New password'), {
      target: { value: 'NewCorrectHorse123!' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/password-reset/confirm'))).toHaveLength(1)
    );
    expect(await screen.findByText('Password reset complete. Sign in with your new password.')).toBeInTheDocument();
  });
});
