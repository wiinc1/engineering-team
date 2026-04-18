import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { App } from './App';
import { clearBrowserSessionConfig } from './session';

function createJsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

const TRUSTED_AUTH_CODE = 'signed-browser-auth-code';
const OIDC_DISCOVERY_URL = 'https://idp.example/.well-known/openid-configuration';
const OIDC_AUTHORIZE_URL = 'https://idp.example/oauth2/authorize';
const OIDC_TOKEN_URL = 'https://idp.example/oauth2/token';

function makeToken(claims: Record<string, unknown>) {
  return `header.${btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}.signature`;
}

function makeFutureExpiry(hoursAhead = 24) {
  return new Date(Date.now() + hoursAhead * 60 * 60 * 1000).toISOString();
}

function makeFutureExp(hoursAhead = 24) {
  return Math.floor(Date.parse(makeFutureExpiry(hoursAhead)) / 1000);
}

function installAuthFetchMock() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (url === OIDC_DISCOVERY_URL) {
      return createJsonResponse({
        authorization_endpoint: OIDC_AUTHORIZE_URL,
        token_endpoint: OIDC_TOKEN_URL,
      });
    }

    if (url === OIDC_TOKEN_URL && init?.method === 'POST') {
      return createJsonResponse({
        access_token: makeToken({
          sub: 'pm-1',
          tenant_id: 'tenant-a',
          roles: ['pm', 'reader'],
          exp: makeFutureExp(),
        }),
        expires_in: 3600,
        token_type: 'Bearer',
      });
    }

    if (url.endsWith('/auth/session') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body || '{}'));
      if (body.authCode !== TRUSTED_AUTH_CODE) {
        return createJsonResponse({
          error: {
            code: 'invalid_auth_code',
            message: 'The sign-in code was rejected.',
          },
        }, 401);
      }
      return createJsonResponse({
        success: true,
        data: {
          accessToken: makeToken({
            sub: 'pm-1',
            tenant_id: 'tenant-a',
            roles: ['pm', 'reader'],
            exp: makeFutureExp(),
          }),
          expiresAt: makeFutureExpiry(),
          claims: {
            tenant_id: 'tenant-a',
            actor_id: 'pm-1',
            roles: ['pm', 'reader'],
          },
        },
      });
    }

    if (url.endsWith('/tasks')) {
      return createJsonResponse({
        items: [
          {
            task_id: 'TSK-42',
            tenant_id: 'tenant-a',
            title: 'Wire task detail',
            priority: 'P1',
            current_stage: 'IMPLEMENT',
            current_owner: 'engineer',
            owner: { actor_id: 'engineer', display_name: 'Engineer' },
            blocked: false,
            closed: false,
            waiting_state: null,
            next_required_action: null,
            queue_entered_at: '2026-04-01T15:00:00.000Z',
            freshness: { status: 'fresh', last_updated_at: '2026-04-01T15:00:00.000Z' },
          },
        ],
      });
    }

    if (url.endsWith('/ai-agents')) {
      return createJsonResponse({
        items: [
          { id: 'architect', display_name: 'Architect', role: 'Architect', active: true },
          { id: 'qa', display_name: 'QA Engineer', role: 'QA', active: true },
          { id: 'engineer', display_name: 'Engineer', role: 'Engineering', active: true },
          { id: 'sre', display_name: 'SRE', role: 'SRE', active: true },
        ],
      });
    }

    throw new Error(`Unhandled fetch URL in auth-shell test: ${url}`);
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('Authenticated browser app shell', () => {
  beforeEach(() => {
    clearBrowserSessionConfig();
    window.sessionStorage.removeItem('engineering-team.oidc-transaction');
    (globalThis as any).__ENGINEERING_TEAM_RUNTIME_CONFIG__ = {
      oidcDiscoveryUrl: OIDC_DISCOVERY_URL,
      oidcClientId: 'browser-client',
      oidcRedirectUri: 'http://localhost:3000/auth/callback',
      internalAuthBootstrapEnabled: true,
    };
    window.history.pushState({}, '', '/sign-in');
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    delete (globalThis as any).__ENGINEERING_TEAM_RUNTIME_CONFIG__;
  });

  it('passes an axe smoke scan for the sign-in route', async () => {
    installAuthFetchMock();
    const { container } = render(<App />);

    await screen.findByRole('heading', { name: 'Sign in to the workflow app' });
    expect(screen.getByRole('button', { name: 'Continue with enterprise sign-in' })).toBeInTheDocument();
    expect(screen.getByLabelText('Trusted auth code')).toBeInTheDocument();
    expect(screen.getByLabelText('API base URL')).toBeInTheDocument();

    const axeResults = await axe.run(container, {
      rules: {
        'color-contrast': { enabled: false },
      },
    });

    expect(axeResults.violations).toEqual([]);
  });

  it('signs in and restores a deep-linked board route', async () => {
    installAuthFetchMock();
    window.history.pushState({}, '', '/sign-in?next=%2Ftasks%3Fview%3Dboard');
    render(<App />);

    await screen.findByRole('heading', { name: 'Sign in to the workflow app' });
    fireEvent.change(screen.getByLabelText('Trusted auth code'), { target: { value: TRUSTED_AUTH_CODE } });
    fireEvent.click(screen.getByRole('button', { name: 'Use internal bootstrap fallback' }));

    await screen.findByRole('tablist', { name: 'Task overview mode' });
    expect(window.location.pathname).toBe('/tasks');
    expect(window.location.search).toContain('view=board');
    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeInTheDocument();
  });

  it('completes the enterprise callback flow and restores the deep-linked board route', async () => {
    installAuthFetchMock();
    window.sessionStorage.setItem('engineering-team.oidc-transaction', JSON.stringify({
      state: 'callback-state',
      codeVerifier: 'callback-verifier',
      nonce: 'callback-nonce',
      next: '/tasks?view=board',
      apiBaseUrl: '',
    }));
    window.history.pushState({}, '', '/auth/callback?code=oidc-code&state=callback-state');
    render(<App />);

    await screen.findByRole('tablist', { name: 'Task overview mode' });
    expect(window.location.pathname).toBe('/tasks');
    expect(window.location.search).toContain('view=board');
    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeInTheDocument();
  });
});
