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

function installTaskDetailFetchMock({ forbidden = false } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
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

    if (url.endsWith('/tasks/TSK-42')) {
      return createJsonResponse({
        task_id: 'TSK-42',
        tenant_id: 'tenant-a',
        title: 'Wire task detail',
        priority: 'P1',
        current_stage: 'IMPLEMENT',
        current_owner: 'eng-1',
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
            actor: { actor_id: 'eng-1', display_name: 'Engineer 1' },
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
      return createJsonResponse({
        success: true,
        data: {
          taskId: 'TSK-42',
          owner: { agentId: 'qa', displayName: 'QA Engineer', role: 'QA' },
          updatedAt: '2026-04-01T15:01:00.000Z',
        },
      });
    }

    throw new Error(`Unhandled fetch URL in test: ${url}`);
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function normalizeHtml(element: Element | null) {
  return (element?.innerHTML || '')
    .replace(/ class="[^"]*"/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('Task detail browser runtime quality coverage', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/tasks/TSK-42');
    clearBrowserSessionConfig();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('keeps a stable ready-state UI snapshot for the mounted task detail route', async () => {
    installTaskDetailFetchMock();
    const { container } = render(<App />);

    await screen.findByRole('heading', { name: 'Wire task detail' });

    expect(normalizeHtml(container.querySelector('main'))).toMatchSnapshot();
  });

  it('keeps a stable restricted-state UI snapshot when access is denied', async () => {
    installTaskDetailFetchMock({ forbidden: true });
    window.history.pushState({}, '', '/tasks/TSK-42?tab=telemetry');
    const { container } = render(<App />);

    await screen.findByRole('heading', { name: 'Task detail unavailable' });
    await screen.findByText('Restricted');

    expect(normalizeHtml(container.querySelector('main'))).toMatchSnapshot();
  });

  it('passes an axe smoke scan and exposes the expected landmark/tabpanel semantics', async () => {
    installTaskDetailFetchMock();
    const { container } = render(<App />);

    await screen.findByRole('heading', { name: 'Wire task detail' });

    const main = screen.getByRole('main');
    const summary = screen.getByLabelText('Task summary');
    const tablist = screen.getByRole('tablist', { name: 'Task activity views' });
    const tabs = within(tablist).getAllByRole('tab');
    const panel = screen.getByRole('tabpanel');

    expect(main).toBeInTheDocument();
    expect(summary).toBeInTheDocument();
    expect(tabs).toHaveLength(2);
    expect(panel).toHaveAttribute('aria-labelledby', 'task-activity-tab-history');
    expect(screen.getByLabelText('History filters')).toBeInTheDocument();
    expect(screen.getByLabelText('Task ID')).toBeInTheDocument();
    expect(screen.getByLabelText('Task assignment')).toBeInTheDocument();
    expect(screen.getByText('Assignment controls are available to PM/admin bearer tokens.')).toBeInTheDocument();

    const axeResults = await axe.run(container, {
      rules: {
        'color-contrast': { enabled: false },
      },
    });

    expect(axeResults.violations).toEqual([]);
  });

  it('meets a small render-budget smoke check for the ready state', async () => {
    installTaskDetailFetchMock();

    const started = performance.now();
    render(<App />);
    await screen.findByRole('heading', { name: 'Wire task detail' });
    const durationMs = performance.now() - started;

    expect(durationMs).toBeLessThan(200);
  });

  it('wires PM assignment controls to the assignment API and refreshes the owner summary', async () => {
    writeBrowserSessionConfig({
      apiBaseUrl: '',
      bearerToken: 'header.eyJzdWIiOiJwbS0xIiwidGVuYW50X2lkIjoidGVuYW50LWEiLCJyb2xlcyI6WyJwbSJdfQ.signature',
    });
    const fetchMock = installTaskDetailFetchMock();
    render(<App />);

    await screen.findByRole('heading', { name: 'Wire task detail' });

    fireEvent.change(screen.getByLabelText('Owner'), { target: { value: 'qa' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save owner' }));

    await screen.findByText('Assigned to qa.');
    expect(fetchMock).toHaveBeenCalledWith(
      '/tasks/TSK-42/assignment',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });
});
