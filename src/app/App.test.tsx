import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { App } from './App';
import { clearBrowserSessionConfig, writeBrowserSessionConfig } from './session';

function createJsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

function installTaskFetchMock({ forbidden = false, reassignedOwner = 'qa' } = {}) {
  let currentOwner = 'eng-1';

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (forbidden) {
      return createJsonResponse(
        {
          error: {
            code: 'forbidden',
            message: 'missing permission: observability:read',
            details: { permission: 'observability:read' },
          },
        },
        403,
      );
    }

    if (url.endsWith('/ai-agents')) {
      return createJsonResponse({
        items: [
          { id: 'qa', display_name: 'QA Engineer', role: 'QA', active: true },
          { id: 'engineer', display_name: 'Engineer', role: 'Engineering', active: true },
        ],
      });
    }

    if (url.endsWith('/tasks') && (!init || !init.method || init.method === 'GET')) {
      return createJsonResponse({
        items: [
          { task_id: 'TSK-42', tenant_id: 'tenant-a', title: 'Wire task detail', priority: 'P1', current_stage: 'IMPLEMENT', current_owner: currentOwner, owner: currentOwner ? { actor_id: currentOwner, display_name: currentOwner } : null, blocked: false, closed: false, freshness: { status: 'fresh', last_updated_at: '2026-04-01T15:00:00.000Z' } },
          { task_id: 'TSK-43', tenant_id: 'tenant-a', title: 'Triage queue drift', priority: 'P2', current_stage: 'TODO', current_owner: null, owner: null, blocked: false, closed: false, freshness: { status: 'fresh', last_updated_at: '2026-04-01T15:00:00.000Z' } },
          { task_id: 'TSK-44', tenant_id: 'tenant-a', title: 'Stale owner reference', priority: 'P3', current_stage: 'REVIEW', current_owner: 'ghost', owner: { actor_id: 'ghost', display_name: 'ghost' }, blocked: false, closed: false, freshness: { status: 'fresh', last_updated_at: '2026-04-01T15:00:00.000Z' } },
          { task_id: 'TSK-45', tenant_id: 'tenant-a', title: 'Restricted owner surface', priority: 'P2', current_stage: 'TODO', current_owner: 'masked', owner: { actor_id: 'masked', display_name: '' }, blocked: false, closed: false, freshness: { status: 'fresh', last_updated_at: '2026-04-01T15:00:00.000Z' } },
        ],
      });
    }

    if (url.endsWith('/tasks/TSK-42')) {
      return createJsonResponse({
        task_id: 'TSK-42',
        tenant_id: 'tenant-a',
        title: 'Wire task detail',
        priority: 'P1',
        current_stage: 'IMPLEMENT',
        current_owner: currentOwner,
        blocked: false,
        waiting_state: null,
        next_required_action: 'Ship browser quality smoke coverage',
        freshness: { status: 'fresh', last_updated_at: '2026-04-01T15:00:00.000Z' },
        status_indicator: 'fresh',
        closed: false,
      });
    }

    if (url.includes('/tasks/TSK-42/history')) {
      return createJsonResponse({
        items: [
          {
            item_id: 'evt-1',
            event_type: 'task.created',
            event_type_label: 'Task created',
            occurred_at: '2026-04-01T14:55:00.000Z',
            actor: { actor_id: 'pm-1', display_name: 'PM 1' },
            display: { summary: 'Task created' },
            sequence_number: 1,
            source: 'audit-api',
          },
          {
            item_id: 'evt-2',
            event_type: 'task.assigned',
            event_type_label: 'Task assigned',
            occurred_at: '2026-04-01T14:58:00.000Z',
            actor: { actor_id: currentOwner, display_name: 'Engineer 1' },
            display: { summary: 'Owner assigned' },
            sequence_number: 2,
            source: 'audit-api',
          },
        ],
        page_info: { next_cursor: null },
      });
    }

    if (url.endsWith('/tasks/TSK-42/observability-summary')) {
      return createJsonResponse({
        status: 'ok',
        degraded: false,
        stale: false,
        event_count: 2,
        last_updated_at: '2026-04-01T15:00:00.000Z',
        freshness: { status: 'fresh', last_updated_at: '2026-04-01T15:00:00.000Z' },
        correlation: { approved_correlation_ids: ['corr-1', 'corr-2'] },
        access: { restricted: false, omission_applied: false, omitted_fields: [] },
      });
    }

    if (url.endsWith('/tasks/TSK-42/assignment')) {
      currentOwner = reassignedOwner;
      return createJsonResponse({
        success: true,
        data: {
          taskId: 'TSK-42',
          owner: { agentId: reassignedOwner, displayName: 'QA Engineer', role: 'QA' },
          updatedAt: '2026-04-01T15:01:00.000Z',
        },
      });
    }

    throw new Error(`Unhandled fetch URL in test: ${url}`);
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('Task browser runtime coverage', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/tasks/TSK-42');
    clearBrowserSessionConfig();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders task detail with existing assignment behavior intact', async () => {
    installTaskFetchMock();
    render(<App />);

    await screen.findByRole('heading', { name: 'Wire task detail' });
    expect(screen.getByLabelText('Task summary')).toBeInTheDocument();
    expect(screen.getByText('Assignment controls are available to PM/admin bearer tokens.')).toBeInTheDocument();
  });

  it('renders task list owner metadata with explicit unassigned and fallback labels', async () => {
    installTaskFetchMock();
    window.history.pushState({}, '', '/tasks');
    render(<App />);

    await screen.findByRole('heading', { name: 'Task list' });
    expect(screen.getByRole('columnheader', { name: 'Owner' })).toBeInTheDocument();
    expect(screen.getByText('Wire task detail')).toBeInTheDocument();
    expect(screen.getAllByText('Unassigned').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Unknown owner').length).toBeGreaterThan(0);
    expect(screen.getByText('Owner hidden')).toBeInTheDocument();
    expect(screen.getAllByText('Read-only owner metadata').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Save owner' })).not.toBeInTheDocument();
  });

  it('supports single-select owner filtering including unassigned and one-click clear', async () => {
    installTaskFetchMock();
    window.history.pushState({}, '', '/tasks');
    render(<App />);

    await screen.findByRole('heading', { name: 'Task list' });
    await screen.findByText('Wire task detail');

    fireEvent.change(screen.getByLabelText('Owner filter'), { target: { value: '__unassigned__' } });

    await screen.findByText('1 unassigned tasks shown.');
    expect(screen.getByText('Triage queue drift')).toBeInTheDocument();
    expect(screen.queryByText('Wire task detail')).not.toBeInTheDocument();
    expect(screen.queryByText('Stale owner reference')).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filter' })[0]);
    await screen.findByText('4 tasks shown.');
    expect(screen.getByText('Wire task detail')).toBeInTheDocument();
    expect(screen.getByText('Triage queue drift')).toBeInTheDocument();
  });


  it('renders a board view with owner labels, preserved columns, and board-wide filtering', async () => {
    installTaskFetchMock();
    window.history.pushState({}, '', '/tasks?view=board');
    render(<App />);

    await screen.findByRole('heading', { name: 'Task list' });
    await screen.findByText('4 cards shown.');
    expect(screen.getByLabelText('Task board')).toBeInTheDocument();
    expect(screen.getByLabelText('TODO column')).toBeInTheDocument();
    expect(screen.getByLabelText('IMPLEMENT column')).toBeInTheDocument();
    expect(screen.getByLabelText('REVIEW column')).toBeInTheDocument();
    expect(screen.getAllByText('Unknown owner').length).toBeGreaterThan(0);
    expect(screen.getByText('Owner hidden')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Owner filter'), { target: { value: '__unassigned__' } });
    await screen.findByText('1 unassigned cards shown.');
    expect(within(screen.getByLabelText('TODO column')).getByText('Triage queue drift')).toBeInTheDocument();
    expect(within(screen.getByLabelText('IMPLEMENT column')).getByText('No matching tasks in this column.')).toBeInTheDocument();
    expect(within(screen.getByLabelText('REVIEW column')).getByText('No matching tasks in this column.')).toBeInTheDocument();
  });

  it('shows updated owner after reassignment and refresh from projected state', async () => {
    writeBrowserSessionConfig({
      apiBaseUrl: '',
      bearerToken: 'header.eyJzdWIiOiJwbS0xIiwidGVuYW50X2lkIjoidGVuYW50LWEiLCJyb2xlcyI6WyJwbSJdfQ.signature',
    });
    installTaskFetchMock({ reassignedOwner: 'qa' });
    render(<App />);

    await screen.findByRole('heading', { name: 'Wire task detail' });
    fireEvent.change(screen.getByLabelText('Owner'), { target: { value: 'qa' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save owner' }));
    await screen.findByText('Assigned to qa.');

    fireEvent.click(screen.getByRole('button', { name: 'Task list' }));
    await screen.findByRole('heading', { name: 'Task list' });
    expect(screen.getAllByText('QA Engineer · QA').length).toBeGreaterThan(0);
  });

  it('shows clear empty state with reset action when no tasks match the filter', async () => {
    installTaskFetchMock();
    window.history.pushState({}, '', '/tasks?owner=engineer');
    render(<App />);

    await screen.findByRole('heading', { name: 'Task list' });
    expect(screen.getByRole('heading', { name: 'No matching tasks' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Clear filter' }).length).toBeGreaterThan(0);
  });

  it('passes an axe smoke scan for the task list route', async () => {
    installTaskFetchMock();
    window.history.pushState({}, '', '/tasks');
    const { container } = render(<App />);

    await screen.findByRole('heading', { name: 'Task list' });
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();

    const axeResults = await axe.run(container, {
      rules: {
        'color-contrast': { enabled: false },
      },
    });

    expect(axeResults.violations).toEqual([]);
  });
});
