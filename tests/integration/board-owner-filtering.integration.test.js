import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import fixture from '../fixtures/board-owner/board-owner-states.json';
import { App } from '../../src/app/App';
import { clearBrowserSessionConfig, writeBrowserSessionConfig } from '../../src/app/session';

function createJsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

function buildTaskItems(currentOwnerByTask) {
  return [
    ...fixture.tasks.map((task) => ({
    task_id: task.task_id,
    tenant_id: fixture.tenant_id,
    title: task.title,
    priority: task.priority,
    current_stage: task.initial_stage,
    current_owner: currentOwnerByTask[task.task_id],
    owner: task.owner ?? (currentOwnerByTask[task.task_id] ? { actor_id: currentOwnerByTask[task.task_id], display_name: currentOwnerByTask[task.task_id] } : null),
    blocked: false,
    closed: false,
    freshness: { status: 'fresh', last_updated_at: '2026-04-02T12:00:00.000Z' },
    })),
    {
      task_id: 'GHOST-BOARD-1',
      tenant_id: fixture.tenant_id,
      title: 'Governance review task',
      priority: 'P1',
      current_stage: 'BACKLOG',
      current_owner: 'architect',
      owner: { actor_id: 'architect', display_name: 'architect' },
      task_type: 'governance_review',
      blocked: false,
      closed: false,
      freshness: { status: 'fresh', last_updated_at: '2026-04-02T12:00:01.000Z' },
    },
  ];
}

function installBoardFetchMock() {
  const currentOwnerByTask = Object.fromEntries(fixture.tasks.map((task) => [task.task_id, task.assigned_owner]));

  const fetchMock = vi.fn(async (input, init) => {
    const url = String(input);

    if (url.endsWith('/ai-agents')) return createJsonResponse({ items: fixture.agents });
    if (url.endsWith('/tasks') && (!init || !init.method || init.method === 'GET')) return createJsonResponse({ items: buildTaskItems(currentOwnerByTask) });

    if (url.endsWith('/tasks/TSK-BOARD-3/assignment')) {
      currentOwnerByTask['TSK-BOARD-3'] = fixture.tasks.find((task) => task.task_id === 'TSK-BOARD-3').reassigned_owner;
      return createJsonResponse({ success: true, data: { taskId: 'TSK-BOARD-3', owner: { agentId: 'qa', displayName: 'QA Engineer', role: 'QA' } } });
    }

    if (url.endsWith('/tasks/TSK-BOARD-3')) {
      return createJsonResponse({
        task_id: 'TSK-BOARD-3',
        tenant_id: fixture.tenant_id,
        title: 'Board reassigned task',
        priority: 'P3',
        current_stage: 'REVIEW',
        current_owner: currentOwnerByTask['TSK-BOARD-3'],
        blocked: false,
        waiting_state: null,
        next_required_action: null,
        freshness: { status: 'fresh', last_updated_at: '2026-04-02T12:00:00.000Z' },
        status_indicator: 'fresh',
        closed: false,
      });
    }

    if (url.includes('/tasks/TSK-BOARD-3/history')) return createJsonResponse({ items: [], page_info: { next_cursor: null } });
    if (url.endsWith('/tasks/TSK-BOARD-3/observability-summary')) {
      return createJsonResponse({ status: 'ok', degraded: false, stale: false, event_count: 0, last_updated_at: '2026-04-02T12:00:00.000Z', freshness: { status: 'fresh', last_updated_at: '2026-04-02T12:00:00.000Z' }, correlation: { approved_correlation_ids: [] }, access: { restricted: false, omission_applied: false, omitted_fields: [] } });
    }

    throw new Error(`Unhandled fetch URL in integration test: ${url}`);
  });

  vi.stubGlobal('fetch', fetchMock);
}

// Governance note: owner-surface changes should keep at least one integration or end-to-end path updated in the same change set.

describe('board owner filtering integration', () => {
  beforeEach(() => {
    clearBrowserSessionConfig();
    window.history.pushState({}, '', '/tasks?view=board');
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('filters the board by owner, preserves empty columns, and refreshes reassignment visibility after reload', async () => {
    writeBrowserSessionConfig({
      apiBaseUrl: '',
      bearerToken: 'header.eyJzdWIiOiJwbS0xIiwidGVuYW50X2lkIjoidGVuYW50LWJvYXJkLW93bmVyIiwicm9sZXMiOlsicG0iXX0.signature',
    });
    installBoardFetchMock();
    render(React.createElement(App));

    await screen.findByText('5 cards shown.');
    expect(screen.getByText('Owner hidden')).toBeInTheDocument();
    expect(screen.getByText('Unknown owner')).toBeInTheDocument();
    expect(screen.queryByText('Governance review task')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Owner filter'), { target: { value: '__unassigned__' } });
    await screen.findByText('1 unassigned cards shown.');
    expect(within(screen.getByLabelText('TODO column')).getByText('Board unassigned task')).toBeInTheDocument();
    expect(within(screen.getByLabelText('IMPLEMENT column')).getByText('No matching tasks in this column.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear all filters' }));
    await screen.findByText('5 cards shown.');

    fireEvent.click(screen.getByText('Board reassigned task'));
    await screen.findByRole('heading', { name: 'Board reassigned task' });
    fireEvent.change(screen.getByLabelText('Owner'), { target: { value: 'qa' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save owner' }));
    await screen.findByText('Assigned to qa.');

    fireEvent.click(screen.getAllByRole('button', { name: 'Task list' })[0]);
    fireEvent.click(screen.getByRole('tab', { name: 'Board' }));
    await screen.findByText('5 cards shown.');
    expect(screen.getAllByText('QA Engineer · QA').length).toBeGreaterThan(0);
  });

  it('routes SRE monitoring work to the SRE inbox by stage even when an engineer remains assigned', async () => {
    writeBrowserSessionConfig({
      apiBaseUrl: '',
      bearerToken: 'header.eyJzdWIiOiJzcmUtMSIsInRlbmFudF9pZCI6InRlbmFudC1ib2FyZC1vd25lciIsInJvbGVzIjpbInNyZSIsInJlYWRlciJdfQ.signature',
    });

    const fetchMock = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/ai-agents')) return createJsonResponse({ items: fixture.agents });
      if (url.endsWith('/tasks') && (!init || !init.method || init.method === 'GET')) {
        return createJsonResponse({
          items: [
            {
              task_id: 'TSK-SRE-STAGE-1',
              tenant_id: fixture.tenant_id,
              title: 'Stage-routed SRE task',
              priority: 'P1',
              current_stage: 'SRE_MONITORING',
              current_owner: 'engineer',
              owner: { actor_id: 'engineer', display_name: 'Engineer' },
              blocked: false,
              closed: false,
              waiting_state: null,
              next_required_action: 'SRE monitoring validation is required.',
              freshness: { status: 'fresh', last_updated_at: '2026-04-15T12:00:00.000Z' },
              monitoring: {
                riskLevel: 'low',
                timeRemainingLabel: '47h remaining',
                windowEndsAt: '2026-04-17T12:00:00.000Z',
                deployment: { environment: 'production', version: '2026.04.15-1', url: 'https://deploy.example/releases/901' },
                linkedPrs: [{ number: 901 }],
                commitSha: 'abc1234def5678',
                telemetry: { freshness: 'fresh', eventCount: 3, drilldowns: {} },
              },
            },
          ],
        });
      }

      throw new Error(`Unhandled fetch URL in integration test: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);
    window.history.pushState({}, '', '/inbox/sre');
    render(React.createElement(App));

    await screen.findByRole('heading', { name: 'SRE Inbox' });
    expect(screen.getByText('Stage-routed SRE task')).toBeInTheDocument();
    expect(screen.getByText(/actively in the SRE monitoring stage/i)).toBeInTheDocument();
    expect(screen.getByText('production')).toBeInTheDocument();
  });
});
