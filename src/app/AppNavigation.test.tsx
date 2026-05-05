import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from './App';
import { clearBrowserSessionConfig, writeBrowserSessionConfig } from './session';

function token(claims: Record<string, unknown>) {
  return `header.${btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}.signature`;
}

function response(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

describe('App navigation workspace UX', () => {
  beforeEach(() => {
    clearBrowserSessionConfig();
    window.history.pushState({}, '', '/tasks');
    writeBrowserSessionConfig({
      apiBaseUrl: '',
      bearerToken: token({
        sub: 'pm-1',
        tenant_id: 'tenant-a',
        roles: ['pm', 'reader'],
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        const href = String(url);
        if (href.endsWith('/ai-agents')) {
          return response({
            items: [
              { id: 'pm', display_name: 'PM', role: 'PM', active: true },
              { id: 'qa', display_name: 'QA Engineer', role: 'QA', active: true },
            ],
          });
        }
        if (href.endsWith('/tasks')) {
          return response({
            items: [
              {
                task_id: 'TSK-DRAFT',
                tenant_id: 'tenant-a',
                title: 'Shape raw operator notes',
                priority: null,
                current_stage: 'DRAFT',
                current_owner: 'pm',
                owner: { actor_id: 'pm', display_name: 'PM' },
                intake_draft: true,
                waiting_state: 'task_refinement',
                next_required_action: 'PM refinement required',
                freshness: { status: 'fresh', last_updated_at: '2026-04-01T15:00:00.000Z' },
              },
              {
                task_id: 'TSK-APPROVAL',
                tenant_id: 'tenant-a',
                title: 'Await operator approval',
                priority: 'P2',
                current_stage: 'TODO',
                current_owner: null,
                owner: null,
                freshness: { status: 'fresh', last_updated_at: '2026-04-01T15:01:00.000Z' },
              },
            ],
          });
        }
        throw new Error(`Unhandled fetch URL in navigation test: ${href}`);
      }),
    );
  });

  afterEach(() => {
    cleanup();
    clearBrowserSessionConfig();
    vi.unstubAllGlobals();
  });

  it('frames tasks as a workspace with lifecycle board labels and grouped role inbox navigation', async () => {
    render(<App />);

    await screen.findByRole('heading', { name: 'Task workspace' });
    expect(screen.getByRole('tab', { name: 'Kanban board' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Intake Draft column')).toBeInTheDocument();
    expect(screen.getByLabelText('Operator Approval column')).toBeInTheDocument();
    expect(within(screen.getByLabelText('Intake Draft column')).getByText('PM refinement required')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Role inboxes'), { target: { value: 'pm' } });

    await screen.findByRole('heading', { name: 'PM Inbox' });
    expect(window.location.pathname).toBe('/inbox/pm');
  });
});
