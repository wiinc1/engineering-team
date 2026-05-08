import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildAuthHeaders,
  clearBrowserSessionConfig,
  confirmEmailVerification,
  confirmPasswordReset,
  fetchCurrentSession,
  loginWithPassword,
  logoutSession,
  readBrowserSessionConfig,
  registerAccount,
  requestEmailVerification,
  requestPasswordReset,
} from './session.browser';

function response(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe('registration browser session helpers', () => {
  afterEach(() => {
    clearBrowserSessionConfig();
    vi.unstubAllGlobals();
    document.cookie = 'engineering_team_csrf=; Max-Age=0; path=/';
  });

  it('posts registration auth requests and persists recovered cookie sessions', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/auth/register')) return response({ ok: true });
      if (url.endsWith('/auth/email/verify/request')) return response({ ok: true });
      if (url.endsWith('/auth/email/verify/confirm')) return response({ success: true });
      if (url.endsWith('/auth/password-reset/request')) return response({ ok: true });
      if (url.endsWith('/auth/password-reset/confirm')) return response({ success: true });
      if (url.endsWith('/auth/login')) {
        return response({
          success: true,
          data: {
            actorId: 'pm-1',
            tenantId: 'tenant-a',
            roles: ['pm', 'reader'],
            authType: 'cookie-session',
            expiresAt: '2026-05-08T20:00:00.000Z',
          },
        });
      }
      if (url.endsWith('/auth/me')) {
        return response({
          data: {
            actorId: 'reader-1',
            tenantId: 'tenant-a',
            roles: ['reader'],
            authType: 'cookie-session',
            expiresAt: '2026-05-08T21:00:00.000Z',
          },
        });
      }
      if (url.endsWith('/auth/logout')) return response({ success: true });
      throw new Error(`Unhandled fetch URL: ${url} ${init?.method || 'GET'}`);
    });

    await registerAccount({
      apiBaseUrl: '/backend',
      email: 'pm@example.com',
      password: 'CorrectHorse123!',
      displayName: 'PM User',
      inviteCode: 'INVITE-1',
      fetchImpl: fetchMock as typeof fetch,
    });
    await requestEmailVerification({ apiBaseUrl: '/backend', email: 'pm@example.com', fetchImpl: fetchMock as typeof fetch });
    await confirmEmailVerification({ apiBaseUrl: '/backend', token: 'verify-token', fetchImpl: fetchMock as typeof fetch });
    await requestPasswordReset({ apiBaseUrl: '/backend', email: 'pm@example.com', fetchImpl: fetchMock as typeof fetch });
    await confirmPasswordReset({
      apiBaseUrl: '/backend',
      token: 'reset-token',
      password: 'NewPassword123!',
      fetchImpl: fetchMock as typeof fetch,
    });

    const loginSession = await loginWithPassword({
      apiBaseUrl: '/backend',
      email: 'pm@example.com',
      password: 'CorrectHorse123!',
      next: '/auth/login?unsafe=1',
      fetchImpl: fetchMock as typeof fetch,
    });
    expect(loginSession).toMatchObject({
      actorId: 'pm-1',
      tenantId: 'tenant-a',
      authType: 'cookie-session',
      apiBaseUrl: '/backend',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/backend/auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'pm@example.com', password: 'CorrectHorse123!', next: '/tasks' }),
      })
    );

    const recoveredSession = await fetchCurrentSession({ apiBaseUrl: '/backend', fetchImpl: fetchMock as typeof fetch });
    expect(recoveredSession).toMatchObject({ actorId: 'reader-1', tenantId: 'tenant-a', roles: ['reader'] });
    expect(readBrowserSessionConfig()).toMatchObject({ actorId: 'reader-1', authType: 'cookie-session' });

    document.cookie = 'engineering_team_csrf=csrf-123; path=/';
    expect(buildAuthHeaders({ authType: 'cookie-session' })).toEqual({ 'x-csrf-token': 'csrf-123' });
    await expect(logoutSession({ apiBaseUrl: '/backend', fetchImpl: fetchMock as typeof fetch })).resolves.toBe(true);
  });

  it('returns null for missing sessions and surfaces registration request errors', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ error: { code: 'missing_auth_context' } }, 401))
      .mockResolvedValueOnce(response({ data: { actorId: '', tenantId: '' } }))
      .mockResolvedValueOnce(response({ error: { message: 'Unable to sign in with those credentials.' } }, 401));

    await expect(fetchCurrentSession({ apiBaseUrl: '/backend', fetchImpl: fetchMock as typeof fetch })).resolves.toBeNull();
    await expect(fetchCurrentSession({ apiBaseUrl: '/backend', fetchImpl: fetchMock as typeof fetch })).resolves.toBeNull();
    await expect(
      loginWithPassword({
        apiBaseUrl: '/backend',
        email: 'pm@example.com',
        password: 'wrong-password',
        fetchImpl: fetchMock as typeof fetch,
      })
    ).rejects.toThrow('Unable to sign in with those credentials.');
  });
});
