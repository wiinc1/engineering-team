import { jsx } from 'react/jsx-runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AiAgentsAdminRoute } from './routes/AiAgentsAdminRoute.jsx';

function okJson(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  };
}

function routeContext(roles = ['admin']) {
  return {
    appShellClass: 'app-shell',
    appNavClass: 'app-nav',
    appNavToggle: null,
    collapsedNavRail: null,
    D: '',
    h: { sub: 'admin-1', tenant_id: 'tenant-a', roles },
    I: (claims, required) => required.some((role) => claims.roles.includes(role)),
    l: vi.fn(),
    Ma: vi.fn(),
    navOpen: true,
    sidebarTaskSearch: null,
    u: { bearerToken: 'token' },
  };
}

function previewPayload(blocked = false) {
  return {
    previewToken: 'preview-token',
    blockers: blocked ? [{ code: 'dry_run_route_mismatch', message: 'Sample dry-run input does not route to QA.' }] : [],
    assignmentControlImpact: { visibleForNewAssignment: !blocked },
    roleInboxImpact: { routedRole: blocked ? null : 'qa' },
    pmOverviewBucketImpact: { bucket: blocked ? 'unsupported' : 'qa' },
    delegationImpact: { dryRun: { pass: !blocked } },
    fallbackBehavior: { coordinatorFallbackAllowedOnActivationFailure: false },
  };
}

function installFetch() {
  const fetchMock = vi.fn(async (url, options) => {
    const payload = JSON.parse(String(options?.body || '{}'));
    if (String(url).endsWith('/v1/ai-agents/preview')) {
      return okJson({ data: previewPayload(payload.delegation?.runtimeAgent !== 'qa-engineer') });
    }
    if (String(url).endsWith('/v1/ai-agents')) {
      return okJson({ data: { agentId: payload.agentId, active: true } }, 201);
    }
    if (String(url).endsWith('/v1/agent-role-requests')) {
      return okJson({ data: { displayName: payload.displayName, status: 'requested' } }, 201);
    }
    throw new Error(`Unhandled test fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('AiAgentsAdminRoute', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('gates live save on preview confirmation and keeps unsupported role requests draft-only', async () => {
    const fetchMock = installFetch();
    render(jsx(AiAgentsAdminRoute, { ctx: routeContext() }));
    await screen.findByRole('heading', { name: 'AI Agent Activation' });

    const saveButton = screen.getByRole('button', { name: 'Save live agent' });
    expect(saveButton).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Preview activation' }));
    await screen.findByText('Preview passed. Confirm before live save.');
    expect(screen.getByText('Visible for new assignment')).toBeInTheDocument();
    expect(screen.getByText('Fail closed')).toBeInTheDocument();
    expect(saveButton).toBeDisabled();

    fireEvent.click(screen.getByLabelText('Confirm passing preview'));
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);
    await screen.findByText('Delegated AI agent saved live.');

    fireEvent.click(screen.getByRole('button', { name: 'Request unsupported role' }));
    await screen.findByText('Design Specialist recorded as requested and not live-routed.');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  });

  it('renders access denial for non-admins without hiding unsupported role request intake', async () => {
    installFetch();
    render(jsx(AiAgentsAdminRoute, { ctx: routeContext(['pm']) }));
    await screen.findByRole('heading', { name: 'AI Agent Activation' });

    expect(screen.getByRole('alert')).toHaveTextContent('Admin role is required');
    expect(screen.queryByRole('button', { name: 'Preview activation' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request unsupported role' })).toBeEnabled();
  });
});
