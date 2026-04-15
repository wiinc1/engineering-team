import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

function mergeValue(base: any, override: any): any {
  if (override == null) return base;
  if (Array.isArray(base) || Array.isArray(override)) return override;
  if (typeof base === 'object' && typeof override === 'object') {
    return Object.entries(override).reduce((acc, [key, value]) => {
      acc[key] = mergeValue(base?.[key], value);
      return acc;
    }, { ...base });
  }
  return override;
}

function makeToken(claims: Record<string, unknown>) {
  return `header.${btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}.signature`;
}

const TRUSTED_AUTH_CODE = 'signed-browser-auth-code';

function makeFutureExpiry(hoursAhead = 24) {
  return new Date(Date.now() + hoursAhead * 60 * 60 * 1000).toISOString();
}

function makeFutureExp(hoursAhead = 24) {
  return Math.floor(Date.parse(makeFutureExpiry(hoursAhead)) / 1000);
}

function makePastExpiry(hoursAgo = 24) {
  return new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
}

function makePastExp(hoursAgo = 24) {
  return Math.floor(Date.parse(makePastExpiry(hoursAgo)) / 1000);
}

function installTaskFetchMock({
  forbidden = false,
  reassignedOwner = 'qa',
  aiAgentsStatus = 200,
  authSessionStatus = 200,
  detailStatus = 200,
  tasksOverride,
  detailOverride,
  summaryOverride,
  telemetryOverride,
  historyOverride,
} = {}) {
  let currentOwner = 'engineer';
  const taskItems = tasksOverride || [
    { task_id: 'TSK-42', tenant_id: 'tenant-a', title: 'Wire task detail', priority: 'P1', current_stage: 'IMPLEMENT', current_owner: currentOwner, owner: currentOwner ? { actor_id: currentOwner, display_name: currentOwner } : null, blocked: false, closed: false, waiting_state: null, next_required_action: null, queue_entered_at: '2026-04-01T15:00:00.000Z', freshness: { status: 'fresh', last_updated_at: '2026-04-01T15:00:00.000Z' } },
    { task_id: 'TSK-43', tenant_id: 'tenant-a', title: 'Triage queue drift', priority: 'P2', current_stage: 'TODO', current_owner: null, owner: null, blocked: false, closed: false, waiting_state: 'awaiting_pm_decision', next_required_action: 'PM triage required', queue_entered_at: '2026-04-01T15:00:01.000Z', freshness: { status: 'fresh', last_updated_at: '2026-04-01T15:00:01.000Z' } },
    { task_id: 'TSK-44', tenant_id: 'tenant-a', title: 'Stale owner reference', priority: 'P3', current_stage: 'REVIEW', current_owner: 'ghost', owner: { actor_id: 'ghost', display_name: 'ghost' }, blocked: false, closed: false, waiting_state: null, next_required_action: null, queue_entered_at: '2026-04-01T15:00:02.000Z', freshness: { status: 'fresh', last_updated_at: '2026-04-01T15:00:02.000Z' } },
    { task_id: 'TSK-45', tenant_id: 'tenant-a', title: 'Restricted owner surface', priority: 'P2', current_stage: 'TODO', current_owner: 'masked', owner: { actor_id: 'masked', display_name: '', redacted: true }, blocked: false, closed: false, waiting_state: 'awaiting_human_approval', next_required_action: 'Human approval required', queue_entered_at: '2026-04-01T15:00:03.000Z', freshness: { status: 'fresh', last_updated_at: '2026-04-01T15:00:03.000Z' } },
    { task_id: 'TSK-46', tenant_id: 'tenant-a', title: 'Review test plan', priority: 'P2', current_stage: 'VERIFY', current_owner: 'qa', owner: { actor_id: 'qa', display_name: 'qa' }, blocked: false, closed: false, waiting_state: null, next_required_action: null, queue_entered_at: '2026-04-01T15:00:04.000Z', freshness: { status: 'fresh', last_updated_at: '2026-04-01T15:00:04.000Z' } },
    { task_id: 'TSK-47', tenant_id: 'tenant-a', title: 'Design routing architecture', priority: 'P1', current_stage: 'BACKLOG', current_owner: 'architect', owner: { actor_id: 'architect', display_name: 'architect' }, blocked: false, closed: false, waiting_state: null, next_required_action: null, queue_entered_at: '2026-04-01T15:00:05.000Z', freshness: { status: 'fresh', last_updated_at: '2026-04-01T15:00:05.000Z' } },
  ];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (url.endsWith('/auth/session') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body || '{}'));
      if (authSessionStatus !== 200) {
        return createJsonResponse({
          error: {
            code: 'invalid_auth_code',
            message: 'The sign-in code was rejected.',
          },
        }, authSessionStatus);
      }
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
      if (aiAgentsStatus !== 200) {
        return createJsonResponse(
          {
            error: {
              code: 'canonical_roster_unavailable',
              message: 'Canonical role roster unavailable.',
            },
          },
          aiAgentsStatus,
        );
      }

      return createJsonResponse({
        items: [
          { id: 'architect', display_name: 'Architect', role: 'Architect', active: true },
          { id: 'qa', display_name: 'QA Engineer', role: 'QA', active: true },
          { id: 'engineer', display_name: 'Engineer', role: 'Engineering', active: true },
          { id: 'sre', display_name: 'SRE', role: 'SRE', active: true },
        ],
      });
    }

    if (url.endsWith('/tasks') && (!init || !init.method || init.method === 'GET')) {
      return createJsonResponse({
        items: taskItems.map((item) => (
          item.task_id === 'TSK-42'
            ? {
                ...item,
                current_owner: currentOwner,
                owner: currentOwner ? { actor_id: currentOwner, display_name: currentOwner } : null,
              }
            : item
        )),
      });
    }

    if (/\/tasks\/[^/]+\/events$/.test(url) && init?.method === 'POST') {
      const taskId = url.match(/\/tasks\/([^/]+)\/events$/)?.[1];
      const body = JSON.parse(String(init.body || '{}'));
      if (body?.eventType === 'task.stage_changed' && taskId) {
        const index = taskItems.findIndex((item) => item.task_id === taskId);
        if (index >= 0) {
          taskItems[index] = {
            ...taskItems[index],
            current_stage: body.payload?.to_stage || taskItems[index].current_stage,
          };
        }
      }
      return createJsonResponse({
        success: true,
        event: {
          event_id: `evt-${taskId || 'task'}-stage`,
          occurred_at: '2026-04-01T15:01:00.000Z',
        },
      }, 202);
    }

    if (url.endsWith('/tasks/TSK-42/sre-monitoring/start') && init?.method === 'POST') {
      return createJsonResponse({
        success: true,
        data: {
          taskId: 'TSK-42',
          windowStartedAt: '2026-04-01T16:00:00.000Z',
          windowEndsAt: '2026-04-03T16:00:00.000Z',
        },
      }, 201);
    }

    if (url.endsWith('/tasks/TSK-42/sre-monitoring/approve') && init?.method === 'POST') {
      return createJsonResponse({
        success: true,
        data: {
          taskId: 'TSK-42',
          approvedAt: '2026-04-01T18:00:00.000Z',
          nextStage: 'PM_CLOSE_REVIEW',
        },
      }, 201);
    }

    if (url.includes('/tasks/TSK-42/detail')) {
      if (detailStatus !== 200) {
        return createJsonResponse({
          error: {
            code: detailStatus === 404 ? 'task_not_found' : 'projection_unavailable',
            message: detailStatus === 404 ? 'not found' : 'projection unavailable',
          },
        }, detailStatus);
      }
      const detailPayload = mergeValue(
        {
          task: { id: 'TSK-42', title: 'Wire task detail', priority: 'P1', stage: 'IMPLEMENT', status: 'active' },
          summary: {
            owner: { id: currentOwner, label: currentOwner, kind: 'assigned' },
            workflowStage: { value: 'IMPLEMENT', label: 'Implement' },
            nextAction: { label: 'Ship browser quality smoke coverage', source: 'system', overdue: false, waitingOn: null },
            prStatus: { label: '1 open PR linked', state: 'active', total: 1, openCount: 1, mergedCount: 0, draftCount: 0 },
            childStatus: { label: 'No child tasks', state: 'empty', total: 0, blockedCount: 0 },
            timers: { queueAgeLabel: '5m', lastUpdatedAt: '2026-04-01T15:00:00.000Z', freshness: 'fresh' },
            blockedState: { isBlocked: false, label: 'Active', waitingOn: null },
          },
          blockers: [],
          context: {
            businessContext: 'Make task state legible in one place.',
            acceptanceCriteria: ['Given a task page loads, the summary is visible above the fold.'],
            definitionOfDone: ['Task detail page shipped with smoke coverage.'],
            technicalSpec: 'Server-rendered technical spec',
            monitoringSpec: 'Server-rendered monitoring spec',
          },
          relations: { linkedPrs: [{ id: 'pr-12', number: 12, title: 'feat: task detail', state: 'open', merged: false, draft: false, repository: 'wiinc1/engineering-team' }], childTasks: [{ id: 'TSK-43', title: 'Triage queue drift', stage: 'TODO', status: 'waiting', owner: { label: 'qa' }, blocked: false }] },
          activity: {
            comments: [],
            auditLog: [
              { id: 'evt-1', type: 'task.created', summary: 'Task created', actor: { id: 'pm-1', label: 'PM 1' }, occurredAt: '2026-04-01T14:55:00.000Z' },
              { id: 'evt-2', type: 'task.assigned', summary: 'Owner assigned', actor: { id: currentOwner, label: 'Engineer 1' }, occurredAt: '2026-04-01T14:58:00.000Z' },
            ],
            auditLogPageInfo: { limit: 25, next_cursor: null, has_more: false },
          },
          telemetry: { availability: 'available', lastUpdatedAt: '2026-04-01T15:00:00.000Z', summary: {}, emptyStateReason: null, access: { restricted: false, omission_applied: false, omitted_fields: [] } },
          meta: {
            permissions: {
              canViewComments: true,
              canViewAuditLog: true,
              canViewTelemetry: true,
              canViewChildTasks: true,
              canViewLinkedPrMetadata: true,
            },
            freshness: { status: 'fresh', lastUpdatedAt: '2026-04-01T15:00:00.000Z' },
          },
        },
        typeof detailOverride === 'function' ? detailOverride({ currentOwner }) : detailOverride,
      );
      return createJsonResponse(detailPayload);
    }

    if (url.endsWith('/tasks/TSK-42')) {
      return createJsonResponse(mergeValue({
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
      }, typeof summaryOverride === 'function' ? summaryOverride({ currentOwner }) : summaryOverride));
    }

    if (url.includes('/tasks/TSK-42/history')) {
      return createJsonResponse(mergeValue({
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
      }, typeof historyOverride === 'function' ? historyOverride({ currentOwner }) : historyOverride));
    }

    if (url.endsWith('/tasks/TSK-42/observability-summary')) {
      return createJsonResponse(mergeValue({
        status: 'ok',
        degraded: false,
        stale: false,
        event_count: 2,
        last_updated_at: '2026-04-01T15:00:00.000Z',
        freshness: { status: 'fresh', last_updated_at: '2026-04-01T15:00:00.000Z' },
        correlation: { approved_correlation_ids: ['corr-1', 'corr-2'] },
        access: { restricted: false, omission_applied: false, omitted_fields: [] },
      }, typeof telemetryOverride === 'function' ? telemetryOverride({ currentOwner }) : telemetryOverride));
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

    if (url.endsWith('/tasks/TSK-42/architect-handoff') && init?.method === 'PUT') {
      return createJsonResponse({
        success: true,
        data: {
          taskId: 'TSK-42',
          version: 1,
          engineerTier: 'Sr',
          readyForEngineering: true,
          updatedAt: '2026-04-01T15:01:30.000Z',
        },
      });
    }

    if (url.endsWith('/tasks/TSK-42/engineer-submission') && init?.method === 'PUT') {
      return createJsonResponse({
        success: true,
        data: {
          taskId: 'TSK-42',
          version: 1,
          commitSha: 'abc1234',
          prUrl: 'https://github.com/wiinc1/engineering-team/pull/14',
          primaryReference: {
            type: 'pr_url',
            label: 'https://github.com/wiinc1/engineering-team/pull/14',
            value: 'https://github.com/wiinc1/engineering-team/pull/14',
          },
          updatedAt: '2026-04-01T15:01:45.000Z',
        },
      });
    }

    if (url.endsWith('/tasks/TSK-42/skill-escalation') && init?.method === 'POST') {
      return createJsonResponse({
        success: true,
        data: {
          taskId: 'TSK-42',
          currentEngineerTier: 'Jr',
          requestedTier: 'Sr',
          updatedAt: '2026-04-01T15:01:46.000Z',
          eventId: 'evt-skill-escalation',
          workflowThreadId: 'wf-escalation',
        },
      }, 202);
    }

    if (url.endsWith('/tasks/TSK-42/check-ins') && init?.method === 'POST') {
      return createJsonResponse({
        success: true,
        data: {
          taskId: 'TSK-42',
          occurredAt: '2026-04-01T15:01:47.000Z',
          intervalMinutes: 15,
          eventId: 'evt-checkin',
        },
      }, 202);
    }

    if (url.endsWith('/tasks/TSK-42/retier') && init?.method === 'POST') {
      return createJsonResponse({
        success: true,
        data: {
          taskId: 'TSK-42',
          previousEngineerTier: 'Jr',
          engineerTier: 'Sr',
          updatedAt: '2026-04-01T15:01:48.000Z',
          eventId: 'evt-retier',
        },
      }, 202);
    }

    if (url.endsWith('/tasks/TSK-42/reassignment') && init?.method === 'POST') {
      currentOwner = 'engineer-sr';
      return createJsonResponse({
        success: true,
        data: {
          taskId: 'TSK-42',
          previousAssignee: 'engineer',
          assignee: 'engineer-sr',
          previousEngineerTier: 'Jr',
          engineerTier: 'Sr',
          mode: 'inactivity',
          missedCheckIns: 2,
          transferSummary: {
            prior_assignee: 'engineer',
            new_assignee: 'engineer-sr',
          },
          ghostingReview: {
            reviewTaskId: 'GHOST-1',
            title: 'Inactivity review for TSK-42',
          },
        },
      }, 202);
    }

    if (url.endsWith('/tasks/TSK-42/lock') && init?.method === 'POST') {
      return createJsonResponse({
        success: true,
        data: {
          lock: {
            ownerId: 'pm-1',
            acquiredAt: '2026-04-01T15:01:50.000Z',
            expiresAt: '2026-04-01T15:16:50.000Z',
            reason: 'Manual task detail editing session',
            action: 'task_detail_edit',
          },
          updatedAt: '2026-04-01T15:01:50.000Z',
        },
      });
    }

    if (url.endsWith('/tasks/TSK-42/lock') && init?.method === 'DELETE') {
      return createJsonResponse({
        success: true,
        data: {
          released: true,
          updatedAt: '2026-04-01T15:02:10.000Z',
        },
      });
    }

    if (url.endsWith('/tasks/TSK-42/workflow-threads') && init?.method === 'POST') {
      return createJsonResponse({
        threadId: 'wt-new',
        eventId: 'evt-wt-new',
        occurredAt: '2026-04-01T15:02:00.000Z',
      }, 201);
    }

    if (/\/tasks\/TSK-42\/workflow-threads\/[^/]+\/(replies|resolve|reopen)$/.test(url) && init?.method === 'POST') {
      return createJsonResponse({
        success: true,
        event: {
          event_id: 'evt-wt-update',
          occurred_at: '2026-04-01T15:03:00.000Z',
        },
      }, 202);
    }

    if (url.endsWith('/tasks/TSK-42/qa-results') && init?.method === 'POST') {
      return createJsonResponse({
        success: true,
        data: {
          runId: 'qa-new',
          outcome: 'fail',
          runKind: 'initial',
          routedToStage: 'IMPLEMENTATION',
          updatedAt: '2026-04-01T15:04:00.000Z',
        },
      }, 201);
    }

    if (url.endsWith('/tasks/TSK-42/review-questions') && init?.method === 'POST') {
      return createJsonResponse({
        questionId: 'rq-new',
        eventId: 'evt-rq-new',
        occurredAt: '2026-04-01T15:02:00.000Z',
      }, 201);
    }

    if (/\/tasks\/TSK-42\/review-questions\/[^/]+\/(answers|resolve|reopen)$/.test(url) && init?.method === 'POST') {
      return createJsonResponse({
        success: true,
        event: {
          event_id: 'evt-rq-update',
          occurred_at: '2026-04-01T15:03:00.000Z',
        },
      }, 202);
    }

    throw new Error(`Unhandled fetch URL in test: ${url}`);
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('Task browser runtime coverage', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/tasks/TSK-42');
    writeBrowserSessionConfig({
      apiBaseUrl: '',
      bearerToken: makeToken({
        sub: 'reader-1',
        tenant_id: 'tenant-a',
        roles: ['reader'],
        exp: makeFutureExp(),
      }),
      expiresAt: makeFutureExpiry(),
    });
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

  it('redirects protected routes to sign-in when no browser session exists', async () => {
    clearBrowserSessionConfig();
    installTaskFetchMock();
    render(<App />);

    await screen.findByRole('heading', { name: 'Sign in to the workflow app' });
    expect(window.location.pathname).toBe('/sign-in');
    expect(screen.queryByText('Wire task detail')).not.toBeInTheDocument();
  });

  it('exchanges an internal sign-in code for a session and lands on the default app shell', async () => {
    clearBrowserSessionConfig();
    const fetchMock = installTaskFetchMock();
    window.history.pushState({}, '', '/sign-in');
    render(<App />);

    await screen.findByRole('heading', { name: 'Sign in to the workflow app' });
    fireEvent.change(screen.getByLabelText('Trusted auth code'), { target: { value: TRUSTED_AUTH_CODE } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await screen.findByRole('heading', { name: 'Task list' });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/auth/session'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ authCode: TRUSTED_AUTH_CODE }),
      }),
    );
    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('restores board view query state after sign-in', async () => {
    clearBrowserSessionConfig();
    installTaskFetchMock();
    window.history.pushState({}, '', '/tasks?view=board');
    render(<App />);

    await screen.findByRole('heading', { name: 'Sign in to the workflow app' });
    expect(window.location.pathname).toBe('/sign-in');
    expect(window.location.search).toContain('next=%2Ftasks%3Fview%3Dboard');

    fireEvent.change(screen.getByLabelText('Trusted auth code'), { target: { value: TRUSTED_AUTH_CODE } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await screen.findByRole('heading', { name: 'Task list' });
    await screen.findByText('6 cards shown.');
    expect(window.location.pathname).toBe('/tasks');
    expect(window.location.search).toBe('?view=board');
    expect(screen.getByRole('tab', { name: 'Board' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('TODO column')).toBeInTheDocument();
  });

  it('restores PM overview bucket query state after session recovery sign-in', async () => {
    clearBrowserSessionConfig();
    writeBrowserSessionConfig({
      apiBaseUrl: '',
      bearerToken: makeToken({
        sub: 'pm-1',
        tenant_id: 'tenant-a',
        roles: ['pm', 'reader'],
        exp: makePastExp(),
      }),
      expiresAt: makePastExpiry(),
    });
    installTaskFetchMock();
    window.history.pushState({}, '', '/overview/pm?bucket=needs-routing-attention');
    render(<App />);

    await screen.findByRole('heading', { name: 'Sign in to the workflow app' });
    expect(window.location.pathname).toBe('/sign-in');
    expect(window.location.search).toContain('next=%2Foverview%2Fpm%3Fbucket%3Dneeds-routing-attention');

    fireEvent.change(screen.getByLabelText('Trusted auth code'), { target: { value: TRUSTED_AUTH_CODE } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await screen.findByRole('heading', { name: 'PM Overview' });
    await screen.findByText('2 tasks shown in Needs routing attention.');
    expect(window.location.pathname).toBe('/overview/pm');
    expect(window.location.search).toBe('?bucket=needs-routing-attention');
    expect(screen.getByLabelText('Bucket filter')).toHaveValue('needs-routing-attention');
  });

  it('restores task detail query state after sign-in', async () => {
    clearBrowserSessionConfig();
    installTaskFetchMock();
    window.history.pushState({}, '', '/tasks/TSK-42?tab=telemetry');
    render(<App />);

    await screen.findByRole('heading', { name: 'Sign in to the workflow app' });
    expect(window.location.pathname).toBe('/sign-in');
    expect(window.location.search).toContain('next=%2Ftasks%2FTSK-42%3Ftab%3Dtelemetry');

    fireEvent.change(screen.getByLabelText('Trusted auth code'), { target: { value: TRUSTED_AUTH_CODE } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await screen.findByRole('heading', { name: 'Wire task detail' });
    expect(window.location.pathname).toBe('/tasks/TSK-42');
    expect(window.location.search).toBe('?tab=telemetry');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'task-activity-tab-telemetry');
    expect(await screen.findByText('Freshness', { selector: 'p' })).toBeInTheDocument();
  });

  it('restores inbox pathname and search exactly after sign-in', async () => {
    clearBrowserSessionConfig();
    installTaskFetchMock();
    window.history.pushState({}, '', '/inbox/qa?source=alert');
    render(<App />);

    await screen.findByRole('heading', { name: 'Sign in to the workflow app' });
    expect(window.location.pathname).toBe('/sign-in');
    expect(window.location.search).toContain('next=%2Finbox%2Fqa%3Fsource%3Dalert');

    fireEvent.change(screen.getByLabelText('Trusted auth code'), { target: { value: TRUSTED_AUTH_CODE } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await screen.findByRole('heading', { name: 'QA Inbox' });
    expect(window.location.pathname).toBe('/inbox/qa');
    expect(window.location.search).toBe('?source=alert');
    expect(await screen.findByText('Review test plan')).toBeInTheDocument();
  });

  it('redirects an expired session back to sign-in with a recovery message', async () => {
    clearBrowserSessionConfig();
    writeBrowserSessionConfig({
      apiBaseUrl: '',
      bearerToken: makeToken({
        sub: 'pm-1',
        tenant_id: 'tenant-a',
        roles: ['pm', 'reader'],
        exp: makePastExp(),
      }),
      expiresAt: makePastExpiry(),
    });
    installTaskFetchMock();
    render(<App />);

    await screen.findByRole('heading', { name: 'Sign in to the workflow app' });
    expect(screen.getByText('Your session expired. Sign in again to continue.')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/sign-in');
  });

  it('renders linked PR, child task, and spec detail from the dedicated detail model', async () => {
    installTaskFetchMock();
    render(<App />);

    await screen.findByRole('heading', { name: 'Wire task detail' });
    expect(screen.getByText('1 open PR linked')).toBeInTheDocument();
    expect(screen.getByText('Server-rendered technical spec')).toBeInTheDocument();
    expect(screen.getByText('Server-rendered monitoring spec')).toBeInTheDocument();
    expect(screen.getByText('feat: task detail')).toBeInTheDocument();
    expect(screen.getByText(/Triage queue drift/)).toBeInTheDocument();
  });

  it('renders structured architect handoff details when the backend supplies them', async () => {
    installTaskFetchMock({
      detailOverride: {
        context: {
          architectHandoff: {
            version: 2,
            readyForEngineering: true,
            engineerTier: 'Principal',
            tierRationale: 'Cross-team rollout and migration coordination.',
            technicalSpec: {
              summary: 'Summary',
              scope: 'Scope',
              design: 'Design',
              rolloutPlan: 'Rollout',
            },
            monitoringSpec: {
              service: 'workflow-audit-api',
              dashboardUrls: ['https://dash.example/1'],
              alertPolicies: ['Latency budget breach'],
              runbook: 'docs/runbooks/audit-foundation.md',
              successMetrics: ['p95 under 250ms'],
            },
            submittedAt: '2026-04-01T15:00:00.000Z',
            submittedBy: 'architect-1',
          },
        },
      },
    });
    render(<App />);

    await screen.findByRole('heading', { name: 'Wire task detail' });
    expect(screen.getByText('v2')).toBeInTheDocument();
    expect(screen.getByText('Principal')).toBeInTheDocument();
    expect(screen.getByText('Ready for engineering')).toBeInTheDocument();
    expect(screen.getByText('Cross-team rollout and migration coordination.')).toBeInTheDocument();
  });

  it('lets architects submit the engineering handoff from task detail', async () => {
    writeBrowserSessionConfig({
      apiBaseUrl: '',
      bearerToken: 'header.eyJzdWIiOiJhcmNoaXRlY3QtMSIsInRlbmFudF9pZCI6InRlbmFudC1hIiwicm9sZXMiOlsiYXJjaGl0ZWN0IiwiY29udHJpYnV0b3IiXX0.signature',
    });
    const fetchMock = installTaskFetchMock();
    render(<App />);

    await screen.findByRole('heading', { name: 'Wire task detail' });
    fireEvent.change(screen.getByPlaceholderText('Summarize the implementation contract and boundaries.'), { target: { value: 'Document API and queue boundaries.' } });
    fireEvent.change(screen.getByLabelText('Scope and constraints'), { target: { value: 'No cross-tenant writes.' } });
    fireEvent.change(screen.getByLabelText('Design and interfaces'), { target: { value: 'PATCH plus audit event.' } });
    fireEvent.change(screen.getByLabelText('Rollout plan'), { target: { value: 'Ship behind feature flag.' } });
    fireEvent.change(screen.getByLabelText('Monitored service'), { target: { value: 'workflow-audit-api' } });
    fireEvent.change(screen.getByLabelText('Dashboard URLs'), { target: { value: 'https://dash.example/1' } });
    fireEvent.change(screen.getByLabelText('Alert policies'), { target: { value: 'Latency budget breach' } });
    fireEvent.change(screen.getByLabelText('Runbook'), { target: { value: 'docs/runbooks/audit-foundation.md' } });
    fireEvent.change(screen.getByLabelText('Success metrics'), { target: { value: 'p95 under 250ms' } });
    fireEvent.change(screen.getByLabelText('Tier rationale'), { target: { value: 'Standard backend feature with audit and UI touch points.' } });
    fireEvent.click(screen.getByLabelText(/Ready for engineering/));
    fireEvent.click(screen.getByRole('button', { name: 'Submit engineering handoff' }));

    await screen.findByText('Engineering handoff submitted.');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/tasks/TSK-42/architect-handoff'),
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          readyForEngineering: true,
          engineerTier: 'Sr',
          tierRationale: 'Standard backend feature with audit and UI touch points.',
          technicalSpec: {
            summary: 'Document API and queue boundaries.',
            scope: 'No cross-tenant writes.',
            design: 'PATCH plus audit event.',
            rolloutPlan: 'Ship behind feature flag.',
          },
          monitoringSpec: {
            service: 'workflow-audit-api',
            dashboardUrls: 'https://dash.example/1',
            alertPolicies: 'Latency budget breach',
            runbook: 'docs/runbooks/audit-foundation.md',
            successMetrics: 'p95 under 250ms',
          },
        }),
      }),
    );
  });

  it('renders implementation handoff details when the backend supplies engineer metadata', async () => {
    installTaskFetchMock({
      detailOverride: {
        context: {
          engineerSubmission: {
            version: 3,
            commitSha: 'abc1234def5678',
            prUrl: 'https://github.com/wiinc1/engineering-team/pull/14',
            primaryReference: {
              type: 'pr_url',
              label: 'https://github.com/wiinc1/engineering-team/pull/14',
              value: 'https://github.com/wiinc1/engineering-team/pull/14',
            },
            submittedAt: '2026-04-01T16:00:00.000Z',
            submittedBy: 'engineer-1',
          },
        },
      },
    });
    render(<App />);

    await screen.findByRole('heading', { name: 'Wire task detail' });
    expect(screen.getByText('Ready for QA handoff')).toBeInTheDocument();
    expect(screen.getByText('abc1234def5678')).toBeInTheDocument();
    expect(screen.getAllByText('https://github.com/wiinc1/engineering-team/pull/14')).toHaveLength(2);
    expect(screen.getByText('v3')).toBeInTheDocument();
  });

  it('lets engineers submit implementation metadata from task detail', async () => {
    writeBrowserSessionConfig({
      apiBaseUrl: '',
      bearerToken: 'header.eyJzdWIiOiJlbmdpbmVlci0xIiwidGVuYW50X2lkIjoidGVuYW50LWEiLCJyb2xlcyI6WyJlbmdpbmVlciIsImNvbnRyaWJ1dG9yIl19.signature',
    });
    const fetchMock = installTaskFetchMock();
    render(<App />);

    await screen.findByRole('heading', { name: 'Wire task detail' });
    fireEvent.change(screen.getByPlaceholderText('7-40 hex characters'), { target: { value: 'abc1234' } });
    fireEvent.change(screen.getByPlaceholderText('https://github.com/owner/repo/pull/123'), { target: { value: 'https://github.com/wiinc1/engineering-team/pull/14' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit implementation handoff' }));

    await screen.findByText('Implementation metadata submitted.');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/tasks/TSK-42/engineer-submission'),
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          commitSha: 'abc1234',
          prUrl: 'https://github.com/wiinc1/engineering-team/pull/14',
        }),
      }),
    );
  });

  it('shows inline validation when engineer metadata is malformed', async () => {
    writeBrowserSessionConfig({
      apiBaseUrl: '',
      bearerToken: 'header.eyJzdWIiOiJlbmdpbmVlci0xIiwidGVuYW50X2lkIjoidGVuYW50LWEiLCJyb2xlcyI6WyJlbmdpbmVlciIsImNvbnRyaWJ1dG9yIl19.signature',
    });
    installTaskFetchMock();
    render(<App />);

    await screen.findByRole('heading', { name: 'Wire task detail' });
    fireEvent.change(screen.getByLabelText(/Commit SHA/), { target: { value: 'bad sha' } });
    fireEvent.change(screen.getByLabelText(/GitHub PR URL/), { target: { value: 'https://example.com/not-github' } });

    expect(await screen.findByText(/Commit SHA must be 7-40 hexadecimal characters\./)).toBeInTheDocument();
    expect(await screen.findByText(/GitHub PR URL must look like/)).toBeInTheDocument();
  });


  it('renders blocker banner semantics with source and age metadata', async () => {
    installTaskFetchMock({
      detailOverride: {
        task: { status: 'blocked' },
        summary: { blockedState: { isBlocked: true, label: 'Blocked', waitingOn: null } },
        blockers: [{ id: 'blk-1', label: 'Awaiting security sign-off', source: 'Security review', owner: { label: 'Security' }, ageLabel: '2d' }],
      },
    });
    render(<App />);

    await screen.findByRole('heading', { name: 'Wire task detail' });
    const blockerAlert = screen.getByRole('alert');
    expect(blockerAlert).toHaveAccessibleName('Task blockers');
    expect(within(blockerAlert).getByText('Awaiting security sign-off')).toBeInTheDocument();
    expect(within(blockerAlert).getByText('Source: Security review · Owner: Security · Age: 2d')).toBeInTheDocument();
  });

  it('pins blocking architect review questions prominently in task detail', async () => {
    installTaskFetchMock({
      detailOverride: {
        task: { status: 'blocked' },
        summary: {
          nextAction: { label: 'Resolve blocking architect review questions', source: 'pm', overdue: false, waitingOn: 'PM review question resolution' },
          blockedState: { isBlocked: true, label: 'Blocked', waitingOn: 'PM review question resolution' },
        },
        reviewQuestions: {
          summary: {
            total: 2,
            unresolvedCount: 1,
            unresolvedBlockingCount: 1,
            answeredCount: 1,
            resolvedCount: 1,
            blocking: true,
          },
          pinned: [
            {
              id: 'rq-1',
              prompt: 'What is the PM-approved state machine?',
              state: 'answered',
            },
          ],
          items: [],
        },
      },
    });
    render(<App />);

    await screen.findByRole('heading', { name: 'Wire task detail' });
    const reviewAlert = screen.getByRole('alert', { name: 'Architect review blockers' });
    expect(reviewAlert).toBeInTheDocument();
    expect(within(reviewAlert).getByText('Pending PM answers are blocking architect review')).toBeInTheDocument();
    expect(within(reviewAlert).getByText('What is the PM-approved state machine?')).toBeInTheDocument();
    expect(within(reviewAlert).getByText('Answered, awaiting PM resolution')).toBeInTheDocument();
  });

  it('renders architect review question threads with answers, resolutions, and event history in task detail', async () => {
    installTaskFetchMock({
      detailOverride: {
        task: { stage: 'ARCHITECT_REVIEW', status: 'blocked' },
        reviewQuestions: {
          summary: {
            total: 2,
            unresolvedCount: 1,
            unresolvedBlockingCount: 1,
            answeredCount: 1,
            resolvedCount: 1,
            blocking: true,
          },
          pinned: [
            {
              id: 'rq-1',
              prompt: 'What state machine did PM approve?',
              state: 'answered',
            },
          ],
          items: [
            {
              id: 'rq-1',
              prompt: 'What state machine did PM approve?',
              blocking: true,
              state: 'answered',
              createdAt: '2026-04-01T14:30:00.000Z',
              createdBy: 'architect-1',
              answer: 'Open, answered, resolved, reopened.',
              resolution: null,
              resolvedAt: null,
              resolvedBy: null,
              lastUpdatedAt: '2026-04-01T14:35:00.000Z',
              messages: [
                { id: 'rq-msg-1', eventType: 'task.review_question_asked', actorId: 'architect-1', occurredAt: '2026-04-01T14:30:00.000Z', body: 'What state machine did PM approve?' },
                { id: 'rq-msg-2', eventType: 'task.review_question_answered', actorId: 'pm-1', occurredAt: '2026-04-01T14:35:00.000Z', body: 'Open, answered, resolved, reopened.' },
              ],
            },
            {
              id: 'rq-2',
              prompt: 'Was the handoff approved?',
              blocking: false,
              state: 'resolved',
              createdAt: '2026-04-01T14:00:00.000Z',
              createdBy: 'architect-1',
              answer: 'Yes.',
              resolution: 'Resolved after PM confirmed approval.',
              resolvedAt: '2026-04-01T14:10:00.000Z',
              resolvedBy: 'pm-1',
              lastUpdatedAt: '2026-04-01T14:10:00.000Z',
              messages: [
                { id: 'rq-msg-3', eventType: 'task.review_question_resolved', actorId: 'pm-1', occurredAt: '2026-04-01T14:10:00.000Z', body: 'Resolved after PM confirmed approval.' },
              ],
            },
          ],
        },
      },
    });
    render(<App />);

    await screen.findByRole('heading', { name: 'Wire task detail' });
    const reviewSection = screen.getByRole('heading', { name: 'Architect review questions' }).closest('section');
    expect(reviewSection).not.toBeNull();
    expect(within(reviewSection as HTMLElement).getAllByText('What state machine did PM approve?').length).toBeGreaterThan(0);
    expect(within(reviewSection as HTMLElement).getAllByText('Open, answered, resolved, reopened.').length).toBeGreaterThan(0);
    expect(within(reviewSection as HTMLElement).getAllByText('Resolved after PM confirmed approval.').length).toBeGreaterThan(0);
    expect(within(reviewSection as HTMLElement).getByText('Question asked')).toBeInTheDocument();
    expect(within(reviewSection as HTMLElement).getByText('Answer recorded')).toBeInTheDocument();
    expect(within(reviewSection as HTMLElement).getAllByText('Resolved').length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('New architect review question')).not.toBeInTheDocument();
  });

  it('lets architects create review questions directly from task detail during architect review', async () => {
    writeBrowserSessionConfig({
      apiBaseUrl: '',
      bearerToken: 'header.eyJzdWIiOiJhcmNoaXRlY3QtMSIsInRlbmFudF9pZCI6InRlbmFudC1hIiwicm9sZXMiOlsiYXJjaGl0ZWN0Il19.signature',
    });
    const fetchMock = installTaskFetchMock({
      detailOverride: {
        task: { stage: 'ARCHITECT_REVIEW' },
        reviewQuestions: {
          summary: {
            total: 0,
            unresolvedCount: 0,
            unresolvedBlockingCount: 0,
            answeredCount: 0,
            resolvedCount: 0,
            blocking: false,
          },
          pinned: [],
          items: [],
        },
      },
    });
    render(<App />);

    await screen.findByRole('heading', { name: 'Wire task detail' });
    fireEvent.change(screen.getByLabelText('New architect review question'), { target: { value: 'What telemetry budget did PM approve?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask question' }));

    await screen.findByText('Architect review question created.');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/tasks/TSK-42/review-questions'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ prompt: 'What telemetry budget did PM approve?', blocking: true }),
      }),
    );
  });

  it('distinguishes waiting work from blocked work in the above-the-fold summary', async () => {
    installTaskFetchMock({
      detailOverride: {
        task: { status: 'waiting' },
        summary: {
          blockedState: { isBlocked: false, label: 'Waiting', waitingOn: 'PM decision' },
          nextAction: { label: 'Await PM decision', source: 'pm' },
        },
      },
    });
    render(<App />);

    await screen.findByRole('heading', { name: 'Wire task detail' });
    const summary = screen.getByRole('region', { name: 'Task summary' });
    expect(within(summary).getAllByText('Waiting').length).toBeGreaterThan(1);
    expect(within(summary).getByText('Waiting on PM decision')).toBeInTheDocument();
    expect(within(summary).getByText('Source: pm')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders degraded and empty task-detail states for missing specs, next action, linked resources, and stale telemetry', async () => {
    installTaskFetchMock({
      detailOverride: {
        summary: {
          nextAction: { label: '', source: null },
          prStatus: { label: 'No linked PRs', state: 'empty', total: 0 },
          childStatus: { label: 'No child tasks', state: 'empty', total: 0 },
        },
        context: {
          technicalSpec: '',
          monitoringSpec: '',
        },
        relations: {
          linkedPrs: [],
          childTasks: [],
        },
        telemetry: {
          availability: 'stale',
          lastUpdatedAt: '2026-04-01T14:00:00.000Z',
        },
      },
    });
    render(<App />);

    await screen.findByRole('heading', { name: 'Wire task detail' });
    expect(screen.getByText('No next step defined')).toBeInTheDocument();
    expect(screen.getAllByText('Technical spec is missing.').length).toBeGreaterThan(0);
    expect(screen.getByText('Monitoring spec is missing.')).toBeInTheDocument();
    expect(screen.getByText('No linked PRs yet.')).toBeInTheDocument();
    expect(screen.getByText('No child tasks linked yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Telemetry' }));
    expect(await screen.findByText('Partial data')).toBeInTheDocument();
    expect(screen.getByText('Telemetry freshness is degraded.')).toBeInTheDocument();
  });

  it('surfaces fresh telemetry metadata with explicit freshness and timestamp evidence', async () => {
    installTaskFetchMock({
      detailOverride: {
        telemetry: { availability: 'available', lastUpdatedAt: '2026-04-01T15:00:00.000Z' },
        meta: { freshness: { status: 'fresh', lastUpdatedAt: '2026-04-01T15:00:00.000Z' } },
      },
    });
    render(<App />);

    await screen.findByRole('heading', { name: 'Wire task detail' });
    expect(screen.getByText('5m')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Telemetry' }));
    expect(await screen.findByText('Freshness')).toBeInTheDocument();
    expect(screen.getByText('fresh')).toBeInTheDocument();
    expect(screen.getByText('2026-04-01T15:00:00.000Z')).toBeInTheDocument();
  });

  it('renders telemetry error copy and hides restricted non-telemetry sections when permissions remove access', async () => {
    installTaskFetchMock({
      detailOverride: {
        relations: { linkedPrs: [{ id: 'pr-12', title: 'feat: task detail' }], childTasks: [{ id: 'TSK-43', title: 'Triage queue drift', status: 'waiting' }] },
        activity: { comments: [{ id: 'c-1', actor: { label: 'PM 1' }, summary: 'Need follow-up' }], auditLog: [{ id: 'evt-1', type: 'task.created', summary: 'Task created', actor: { label: 'PM 1' }, occurredAt: '2026-04-01T14:55:00.000Z' }] },
        telemetry: { availability: 'error', emptyStateReason: 'Telemetry pipeline failed.' },
        meta: {
          permissions: {
            canViewComments: false,
            canViewAuditLog: true,
            canViewTelemetry: true,
            canViewChildTasks: false,
            canViewLinkedPrMetadata: false,
          },
        },
      },
    });
    render(<App />);

    await screen.findByRole('heading', { name: 'Wire task detail' });
    expect(screen.getByText('Linked PR metadata is hidden for this session.')).toBeInTheDocument();
    expect(screen.getByText('Child task relationships are hidden for this session.')).toBeInTheDocument();
    expect(screen.getByText('Workflow comments are hidden for this session.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Telemetry' }));
    expect(await screen.findByText('Could not load activity')).toBeInTheDocument();
    expect(screen.getByText('Telemetry pipeline failed.')).toBeInTheDocument();
    expect(screen.queryByText('feat: task detail')).not.toBeInTheDocument();
    expect(screen.queryByText('Need follow-up')).not.toBeInTheDocument();
  });

  it('keeps task-detail activity controls usable in a narrow viewport with telemetry-to-history switching', async () => {
    installTaskFetchMock();
    window.innerWidth = 390;
    window.dispatchEvent(new Event('resize'));
    render(<App />);

    await screen.findByRole('heading', { name: 'Wire task detail' });
    const tablist = screen.getByRole('tablist', { name: 'Task activity views' });
    expect(within(tablist).getByRole('tab', { name: 'History' })).toBeInTheDocument();
    expect(within(tablist).getByRole('tab', { name: 'Telemetry' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Telemetry' }));
    expect(await screen.findByText('Freshness', { selector: 'p' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    expect(await screen.findByLabelText('History filters')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Filter event type')).toBeInTheDocument();
    expect(screen.getByLabelText('Date from')).toBeInTheDocument();
    expect(screen.getByLabelText('Date to')).toBeInTheDocument();
  });

  it('preserves explicit task-detail date filters in the URL and on the rendered form', async () => {
    window.history.pushState({}, '', '/tasks/TSK-42?tab=history&historyEventType=task.assigned&dateFrom=2026-04-01&dateTo=2026-04-02');
    const fetchMock = installTaskFetchMock();
    render(<App />);

    await screen.findByRole('heading', { name: 'Wire task detail' });
    expect(screen.getByLabelText('Event type')).toHaveValue('task.assigned');
    expect(screen.getByLabelText('Date from')).toHaveValue('2026-04-01');
    expect(screen.getByLabelText('Date to')).toHaveValue('2026-04-02');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/tasks/TSK-42/detail?eventType=task.assigned&dateFrom=2026-04-01&dateTo=2026-04-02'))).toBe(true);
  });

  it('loads more history entries without replacing the first page', async () => {
    installTaskFetchMock({
      detailOverride: {
        activity: {
          auditLog: [
            { id: 'evt-2', type: 'task.assigned', summary: 'Owner assigned', actor: { id: 'engineer', label: 'Engineer 1' }, occurredAt: '2026-04-01T14:58:00.000Z' },
          ],
          auditLogPageInfo: { limit: 1, next_cursor: '2', has_more: true },
        },
      },
      historyOverride: ({ currentOwner }: { currentOwner: string }) => ({
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
        ],
        page_info: { next_cursor: null, has_more: false, limit: 1 },
      }),
    });
    render(<App />);

    await screen.findByRole('heading', { name: 'Wire task detail' });
    const timeline = screen.getByLabelText('Task history timeline');
    expect(within(timeline).getByText('Owner assigned')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await within(timeline).findByRole('heading', { name: 'Task created' })).toBeInTheDocument();
    expect(within(timeline).getByText('Owner assigned')).toBeInTheDocument();
    expect(within(timeline).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('renders a restricted telemetry state when the app falls back to summary/history/observability endpoints', async () => {
    installTaskFetchMock({
      detailStatus: 404,
      telemetryOverride: {
        event_count: 0,
        access: { restricted: true, omission_applied: true, omitted_fields: ['trace_ids', 'metrics'] },
      },
    });
    render(<App />);

    await screen.findByRole('heading', { name: 'Wire task detail' });
    fireEvent.click(screen.getByRole('tab', { name: 'Telemetry' }));
    expect(await screen.findByText('Restricted')).toBeInTheDocument();
    expect(screen.getByText(/Restricted server-side fields omitted: trace_ids, metrics/)).toBeInTheDocument();
  });

  it('uses roving tab semantics for task-detail activity tabs', async () => {
    installTaskFetchMock();
    render(<App />);

    await screen.findByRole('heading', { name: 'Wire task detail' });
    const historyTab = screen.getByRole('tab', { name: 'History' });
    const telemetryTab = screen.getByRole('tab', { name: 'Telemetry' });

    historyTab.focus();
    expect(historyTab).toHaveFocus();
    expect(historyTab).toHaveAttribute('tabindex', '0');
    expect(telemetryTab).toHaveAttribute('tabindex', '-1');

    fireEvent.keyDown(historyTab, { key: 'ArrowRight' });

    expect(telemetryTab).toHaveFocus();
    expect(telemetryTab).toHaveAttribute('tabindex', '0');
    expect(historyTab).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'task-activity-tab-telemetry');
    expect(await screen.findByText('Freshness', { selector: 'p' })).toBeInTheDocument();
  });

  it('passes an axe smoke scan for the task detail route and preserves task-detail tab semantics', async () => {
    installTaskFetchMock();
    const { container } = render(<App />);

    await screen.findByRole('heading', { name: 'Wire task detail' });
    expect(screen.getByRole('region', { name: 'Task summary' })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Task activity views' })).toBeInTheDocument();
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'task-activity-tab-history');

    const axeResults = await axe.run(container, {
      rules: {
        'color-contrast': { enabled: false },
      },
    });

    expect(axeResults.violations).toEqual([]);
  });

  it('shows lock retry and refresh affordances when another actor holds the task lock', async () => {
    writeBrowserSessionConfig({
      apiBaseUrl: '',
      bearerToken: makeToken({
        sub: 'pm-1',
        tenant_id: 'tenant-a',
        roles: ['pm'],
        exp: makeFutureExp(),
      }),
      expiresAt: makeFutureExpiry(),
    });
    installTaskFetchMock({
      detailOverride: {
        meta: {
          lock: {
            ownerId: 'architect-1',
            acquiredAt: '2026-04-01T15:00:00.000Z',
            expiresAt: '2026-04-01T15:15:00.000Z',
            reason: 'Architect review handoff',
            action: 'stage_transition',
          },
        },
      },
    });
    render(<App />);

    await screen.findByRole('heading', { name: 'Wire task detail' });
    const lockSection = screen.getByRole('region', { name: 'Task lock status' });
    expect(within(lockSection).getByText('architect-1')).toBeInTheDocument();
    expect(within(lockSection).getByRole('button', { name: 'Retry acquire after refresh' })).toBeInTheDocument();
    expect(within(lockSection).getByRole('button', { name: 'Refresh task state' })).toBeInTheDocument();
  });

  it('renders workflow notification previews and collapsible thread history for structured workflow threads', async () => {
    writeBrowserSessionConfig({
      apiBaseUrl: '',
      bearerToken: makeToken({
        sub: 'architect-1',
        tenant_id: 'tenant-a',
        roles: ['architect', 'contributor'],
        exp: makeFutureExp(),
      }),
      expiresAt: makeFutureExpiry(),
    });
    installTaskFetchMock({
      detailOverride: {
        activity: {
          workflowThreads: {
            summary: {
              total: 1,
              unresolvedCount: 1,
              unresolvedBlockingCount: 1,
              resolvedCount: 0,
            },
            items: [
              {
                id: 'wt-1',
                commentType: 'escalation',
                blocking: true,
                state: 'open',
                title: 'Need rollout approval before QA',
                body: 'Escalate the rollout guardrail decision so testing does not proceed blindly.',
                linkedEventId: 'evt-rollout-1',
                createdAt: '2026-04-01T14:30:00.000Z',
                createdBy: 'architect-1',
                lastUpdatedAt: '2026-04-01T14:45:00.000Z',
                notificationTargets: ['pm', 'engineer', 'sre'],
                messages: [
                  { id: 'wt-msg-1', actorId: 'architect-1', occurredAt: '2026-04-01T14:30:00.000Z', body: 'Initial escalation.' },
                  { id: 'wt-msg-2', actorId: 'pm-1', occurredAt: '2026-04-01T14:35:00.000Z', body: 'Need more delivery context.' },
                  { id: 'wt-msg-3', actorId: 'engineer-1', occurredAt: '2026-04-01T14:45:00.000Z', body: 'Added rollout fallback notes.' },
                ],
              },
            ],
          },
        },
      },
    });
    render(<App />);

    await screen.findByRole('heading', { name: 'Wire task detail' });
    const discussionSection = screen.getByRole('heading', { name: 'Discussion' }).closest('section');
    expect(discussionSection).not.toBeNull();
    expect(within(discussionSection as HTMLElement).getByText('Targets: Architect')).toBeInTheDocument();
    expect(within(discussionSection as HTMLElement).getByText('Notification targets: PM · Engineer · SRE')).toBeInTheDocument();
    expect(within(discussionSection as HTMLElement).getByRole('button', { name: 'Show 1 older thread updates' })).toBeInTheDocument();
    fireEvent.click(within(discussionSection as HTMLElement).getByRole('button', { name: 'Show 1 older thread updates' }));
    expect(within(discussionSection as HTMLElement).getByRole('button', { name: 'Collapse thread history' })).toBeInTheDocument();
    expect(within(discussionSection as HTMLElement).getByText('Initial escalation.')).toBeInTheDocument();
  });

  it('shows QA route previews, explicit missing-context warnings, and escalation notification previews', async () => {
    writeBrowserSessionConfig({
      apiBaseUrl: '',
      bearerToken: makeToken({
        sub: 'qa-user',
        tenant_id: 'tenant-a',
        roles: ['qa', 'contributor'],
        exp: makeFutureExp(),
      }),
      expiresAt: makeFutureExpiry(),
    });
    installTaskFetchMock({
      detailOverride: {
        task: { stage: 'QA_TESTING' },
        context: {
          implementationHistory: [
            {
              eventId: 'impl-2',
              version: 2,
              submittedAt: '2026-04-01T15:00:00.000Z',
              submittedBy: 'engineer-2',
              primaryReference: { type: 'pr_url', label: 'https://github.com/wiinc1/engineering-team/pull/102', value: 'https://github.com/wiinc1/engineering-team/pull/102' },
            },
          ],
          qaResults: {
            summary: { total: 1, passedCount: 0, failedCount: 1, retestCount: 0 },
            latest: {
              runId: 'qa-1',
              outcome: 'fail',
              runKind: 'initial',
              summary: 'History tab render failed.',
              implementationVersion: 1,
              implementationReference: { type: 'pr_url', label: 'https://github.com/wiinc1/engineering-team/pull/101', value: 'https://github.com/wiinc1/engineering-team/pull/101' },
              submittedBy: 'qa-user',
            },
            items: [
              {
                runId: 'qa-1',
                outcome: 'fail',
                runKind: 'initial',
                summary: 'History tab render failed.',
                implementationVersion: 1,
                implementationReference: { type: 'pr_url', label: 'https://github.com/wiinc1/engineering-team/pull/101', value: 'https://github.com/wiinc1/engineering-team/pull/101' },
                submittedBy: 'qa-user',
                submittedAt: '2026-04-01T14:40:00.000Z',
                reTestScope: ['history tab render', 'timeline pagination'],
                escalationPackage: {
                  reproduction_steps: ['open task detail', 'switch to history'],
                  failing_scenarios: ['history tab render'],
                  findings: ['timeline does not show the latest event'],
                  stack_traces: ['TypeError: timeline is undefined'],
                  env_logs: ['browser:chromium', 'api:local'],
                  previous_fix_history: [],
                  routing: {
                    recipient_role: 'engineer',
                    recipient_agent_id: 'engineer-2',
                    required_engineer_tier: 'Sr',
                    escalation_chain: ['qa', 'engineer', 'pm'],
                  },
                  notification_preview: {
                    headline: 'QA failure for TSK-42',
                    recipient_role: 'engineer',
                    recipient_agent_id: 'engineer-2',
                    required_engineer_tier: 'Sr',
                    highlights: ['History tab render failed.', 'open task detail', 'history tab render'],
                  },
                },
              },
            ],
          },
        },
      },
    });
    render(<App />);

    await screen.findByRole('heading', { name: 'Wire task detail' });
    const qaSection = screen.getByRole('heading', { name: 'QA' }).closest('section');
    expect(qaSection).not.toBeNull();
    expect(within(qaSection as HTMLElement).getByText('A failing result routes this task back to the implementation fix loop with a packaged escalation.')).toBeInTheDocument();
    expect(within(qaSection as HTMLElement).getByText('Next stage: implementation fix loop')).toBeInTheDocument();
    expect(within(qaSection as HTMLElement).getByText('Scoped re-test for run qa-1 stays with qa-user and should cover history tab render, timeline pagination.')).toBeInTheDocument();
    expect(within(qaSection as HTMLElement).getByText('Missing failure context: scenarios, findings, reproduction steps, stack traces, environment logs.')).toBeInTheDocument();
    expect(within(qaSection as HTMLElement).getByRole('button', { name: 'Submit QA result' })).toBeDisabled();
    expect(within(qaSection as HTMLElement).getByText('QA failure for TSK-42')).toBeInTheDocument();
    expect(within(qaSection as HTMLElement).getByText('Route: engineer-2 · Required tier: Sr')).toBeInTheDocument();
    fireEvent.click(within(qaSection as HTMLElement).getByRole('button', { name: 'Show logs and traces' }));
    expect(within(qaSection as HTMLElement).getByText('qa -> engineer -> pm')).toBeInTheDocument();
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

    fireEvent.click(screen.getAllByRole('button', { name: 'Clear all filters' })[0]);
    await screen.findByText('6 tasks shown.');
    expect(screen.getByText('Wire task detail')).toBeInTheDocument();
    expect(screen.getByText('Triage queue drift')).toBeInTheDocument();
  });


  it('renders a board view with owner labels, preserved columns, and board-wide filtering', async () => {
    installTaskFetchMock();
    window.history.pushState({}, '', '/tasks?view=board');
    render(<App />);

    await screen.findByRole('heading', { name: 'Task list' });
    await screen.findByText('6 cards shown.');
    expect(screen.getByLabelText('Task board')).toBeInTheDocument();
    expect(screen.getByLabelText('TODO column')).toBeInTheDocument();
    expect(screen.getByLabelText('IMPLEMENT column')).toBeInTheDocument();
    expect(screen.getByLabelText('REVIEW column')).toBeInTheDocument();
    expect(screen.getAllByText('Unknown owner').length).toBeGreaterThan(0);
    expect(screen.getByText('Owner hidden')).toBeInTheDocument();
    expect(screen.getByTitle('Owner hidden')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Owner filter'), { target: { value: '__unassigned__' } });
    await screen.findByText('1 unassigned cards shown.');
    expect(within(screen.getByLabelText('TODO column')).getByText('Triage queue drift')).toBeInTheDocument();
    expect(within(screen.getByLabelText('IMPLEMENT column')).getByText('No matching tasks in this column.')).toBeInTheDocument();
    expect(within(screen.getByLabelText('REVIEW column')).getByText('No matching tasks in this column.')).toBeInTheDocument();
  });

  it('keeps owner text visible in compressed board layouts without collapsing to blank metadata', async () => {
    installTaskFetchMock();
    window.history.pushState({}, '', '/tasks?view=board');
    window.innerWidth = 375;
    window.dispatchEvent(new Event('resize'));
    render(<App />);

    await screen.findByText('6 cards shown.');
    const ownerBadge = screen.getByTitle('Owner hidden');
    expect(ownerBadge).toHaveTextContent('Owner hidden');
    expect(ownerBadge.className).toContain('owner-badge--board');
  });

  it('moves a lifecycle card between valid board columns and rejects invalid drops', async () => {
    const fetchMock = installTaskFetchMock();
    window.history.pushState({}, '', '/tasks?view=board');
    render(<App />);

    await screen.findByText('6 cards shown.');

    const taskCard = screen.getByText('Design routing architecture').closest('article') as HTMLElement;
    const dataTransfer = {
      store: new Map<string, string>(),
      setData(type: string, value: string) {
        this.store.set(type, value);
      },
      getData(type: string) {
        return this.store.get(type) || '';
      },
      effectAllowed: 'move',
    };

    fireEvent.dragStart(taskCard, { dataTransfer });
    fireEvent.dragOver(screen.getByLabelText('TODO column'), { dataTransfer });
    fireEvent.drop(screen.getByLabelText('TODO column'), { dataTransfer });

    await screen.findByText('TSK-47 moved to TODO.');
    expect(within(screen.getByLabelText('TODO column')).getByText('Design routing architecture')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/tasks/TSK-47/events'))).toBe(true);

    const movedCard = screen.getByText('Design routing architecture').closest('article') as HTMLElement;
    fireEvent.dragStart(movedCard, { dataTransfer });
    fireEvent.dragOver(screen.getByLabelText('VERIFY column'), { dataTransfer });
    fireEvent.drop(screen.getByLabelText('VERIFY column'), { dataTransfer });

    await screen.findByText('Invalid transition: TODO → VERIFY is not allowed');
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
    await waitFor(() => {
      expect(screen.getAllByRole('status').some((node) => node.textContent?.includes('Assigned to qa.'))).toBe(true);
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Task list' })[0]);
    await screen.findByRole('heading', { name: 'Task list' });
    expect(screen.getAllByText('QA Engineer · QA').length).toBeGreaterThan(0);
  });

  it('shows clear empty state with reset action when no tasks match the filter', async () => {
    installTaskFetchMock();
    window.history.pushState({}, '', '/tasks?owner=nonexistent-owner');
    render(<App />);

    await screen.findByRole('heading', { name: 'Task list' });
    await screen.findByText('0 tasks shown for nonexistent-owner.');
    expect(screen.getByRole('heading', { name: 'No matching tasks' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Clear all filters' }).length).toBeGreaterThan(0);
  });

  it('renders a read-only QA inbox with deterministic ordering and queue reasons', async () => {
    installTaskFetchMock();
    window.history.pushState({}, '', '/inbox/qa');
    render(<App />);

    await screen.findByRole('heading', { name: 'QA Inbox' });
    await screen.findByText('1 task routed to QA.');
    expect(screen.getByText('Review test plan')).toBeInTheDocument();
    expect(screen.queryByText('Triage queue drift')).not.toBeInTheDocument();
    expect(screen.getByText('QA route')).toBeInTheDocument();
    expect(screen.getByText(/current assigned owner resolves to the QA canonical role/i)).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Priority' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Queue reason' })).toBeInTheDocument();
    expect(screen.getByText('P2 waiting work')).toBeInTheDocument();
    expect(screen.getByText(/Waiting for QA action\. Ordered by priority first, then queue age/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Owner filter')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save owner' })).not.toBeInTheDocument();
  });

  it('shows explicit empty state for a role inbox with no routed tasks', async () => {
    installTaskFetchMock();
    window.history.pushState({}, '', '/inbox/sre');
    render(<App />);

    await screen.findByRole('heading', { name: 'SRE Inbox' });
    await screen.findByText('0 tasks routed to SRE.');
    expect(screen.getByRole('heading', { name: 'No tasks routed to SRE' })).toBeInTheDocument();
    expect(screen.getByText(/This is not a loading state/i)).toBeInTheDocument();
  });

  it('routes SRE monitoring work into the SRE inbox by stage and shows deployment visibility', async () => {
    installTaskFetchMock({
      tasksOverride: [
        {
          task_id: 'TSK-SRE-1',
          tenant_id: 'tenant-a',
          title: 'Monitor rollout',
          priority: 'P1',
          current_stage: 'SRE_MONITORING',
          current_owner: 'engineer',
          owner: { actor_id: 'engineer', display_name: 'engineer' },
          blocked: false,
          closed: false,
          waiting_state: null,
          next_required_action: 'Observe production telemetry and approve early only if the rollout is stable.',
          queue_entered_at: '2026-04-01T15:00:00.000Z',
          freshness: { status: 'fresh', last_updated_at: '2026-04-01T15:00:00.000Z' },
          monitoring: {
            state: 'active',
            riskLevel: 'medium',
            timeRemainingMs: 3_600_000,
            timeRemainingLabel: '1h 0m',
            windowEndsAt: '2026-04-03T16:00:00.000Z',
            deployment: {
              environment: 'production',
              version: '2026.04.14-1',
              url: 'https://deploy.example/releases/501',
            },
            linkedPrs: [{ number: 501 }],
            commitSha: 'abc1234def5678',
            telemetry: {
              freshness: 'fresh',
              eventCount: 12,
              drilldowns: {
                metrics: 'https://metrics.example/task/TSK-SRE-1',
                logs: 'https://logs.example/task/TSK-SRE-1',
                traces: 'https://traces.example/task/TSK-SRE-1',
              },
            },
          },
        },
      ],
    });
    window.history.pushState({}, '', '/inbox/sre');
    render(<App />);

    await screen.findByRole('heading', { name: 'SRE Inbox' });
    await screen.findByText('1 task routed to SRE.');
    expect(screen.getByText('Monitor rollout')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Deployment' })).toBeInTheDocument();
    expect(screen.getByText('production')).toBeInTheDocument();
    expect(screen.getByText(/2026\.04\.14-1 · https:\/\/deploy\.example\/releases\/501/)).toBeInTheDocument();
    expect(screen.getByText(/actively in the SRE monitoring stage/i)).toBeInTheDocument();
  });

  it('keeps role inbox counts hidden and shows a degraded state when canonical roster loading fails', async () => {
    installTaskFetchMock({ aiAgentsStatus: 503 });
    window.history.pushState({}, '', '/inbox/sre');
    render(<App />);

    await screen.findByRole('heading', { name: 'SRE Inbox' });
    expect(screen.queryByText('0 tasks routed to SRE.')).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'SRE inbox temporarily degraded' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Canonical role roster unavailable.');
    expect(screen.getByRole('alert')).toHaveTextContent('counts stay hidden until canonical owner-to-role mapping is available');
  });

  it('moves reassigned work between role inboxes after refresh', async () => {
    writeBrowserSessionConfig({
      apiBaseUrl: '',
      bearerToken: 'header.eyJzdWIiOiJwbS0xIiwidGVuYW50X2lkIjoidGVuYW50LWEiLCJyb2xlcyI6WyJwbSJdfQ.signature',
    });
    installTaskFetchMock({ reassignedOwner: 'qa' });
    render(<App />);

    await screen.findByRole('heading', { name: 'Wire task detail' });
    fireEvent.change(screen.getByLabelText('Owner'), { target: { value: 'qa' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save owner' }));
    await screen.findByRole('heading', { name: 'Wire task detail' });

    fireEvent.click(screen.getAllByRole('button', { name: 'Engineer inbox' })[0]);
    await screen.findByRole('heading', { name: 'Engineer Inbox' });
    await screen.findByText('0 tasks routed to Engineer.');

    fireEvent.click(screen.getAllByRole('button', { name: 'QA inbox' })[0]);
    await screen.findByRole('heading', { name: 'QA Inbox' });
    expect(screen.getByText('2 tasks routed to QA.')).toBeInTheDocument();
    expect(screen.getByText('Wire task detail')).toBeInTheDocument();
  });

  it('submits responsible escalation from task detail for Jr-tier work before implementation starts', async () => {
    writeBrowserSessionConfig({
      apiBaseUrl: '',
      bearerToken: makeToken({
        sub: 'engineer-1',
        tenant_id: 'tenant-a',
        roles: ['engineer'],
        exp: makeFutureExp(),
      }),
      expiresAt: makeFutureExpiry(),
    });
    const fetchMock = installTaskFetchMock({
      detailOverride: {
        task: { stage: 'TODO' },
        context: {
          architectHandoff: { engineerTier: 'Jr' },
        },
      },
      summaryOverride: { current_stage: 'TODO' },
    });
    render(<App />);

    await screen.findByRole('heading', { name: 'Wire task detail' });
    fireEvent.change(screen.getByLabelText('Why does this need higher-tier support?'), { target: { value: 'Cross-service delivery risk requires senior support.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request higher-tier support' }));

    await waitFor(() => {
      expect(screen.getAllByRole('status').some((node) => node.textContent?.includes('Responsible escalation recorded'))).toBe(true);
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/tasks/TSK-42/skill-escalation'))).toBe(true);
  });

  it('submits engineer check-ins from task detail during implementation', async () => {
    writeBrowserSessionConfig({
      apiBaseUrl: '',
      bearerToken: makeToken({
        sub: 'engineer-1',
        tenant_id: 'tenant-a',
        roles: ['engineer'],
        exp: makeFutureExp(),
      }),
      expiresAt: makeFutureExpiry(),
    });
    const fetchMock = installTaskFetchMock({
      detailOverride: {
        context: {
          activityMonitoring: {
            requiredCheckInIntervalMinutes: 15,
            missedCheckIns: 0,
            threshold: 2,
            thresholdReached: false,
            lastActivity: null,
          },
        },
      },
    });
    render(<App />);

    await screen.findByRole('heading', { name: 'Wire task detail' });
    fireEvent.change(screen.getByLabelText('Progress summary'), { target: { value: 'Implemented the next audit projection step.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record engineer check-in' }));

    await waitFor(() => {
      expect(screen.getAllByRole('status').some((node) => node.textContent?.includes('Check-in recorded.'))).toBe(true);
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/tasks/TSK-42/check-ins'))).toBe(true);
  });

  it('submits architect re-tier and reassignment controls from task detail', async () => {
    writeBrowserSessionConfig({
      apiBaseUrl: '',
      bearerToken: makeToken({
        sub: 'architect-1',
        tenant_id: 'tenant-a',
        roles: ['architect'],
        exp: makeFutureExp(),
      }),
      expiresAt: makeFutureExpiry(),
    });
    const fetchMock = installTaskFetchMock({
      detailOverride: {
        context: {
          architectHandoff: { engineerTier: 'Jr' },
          activityMonitoring: {
            requiredCheckInIntervalMinutes: 15,
            missedCheckIns: 2,
            threshold: 2,
            thresholdReached: true,
            lastActivity: {
              summary: 'Last check-in before inactivity',
              occurredAt: '2026-04-01T14:00:00.000Z',
            },
          },
        },
      },
    });
    render(<App />);

    await screen.findByRole('heading', { name: 'Wire task detail' });
    fireEvent.change(screen.getByLabelText('Re-tier rationale'), { target: { value: 'Cross-service complexity now requires senior ownership.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update engineer tier' }));
    await waitFor(() => {
      expect(screen.getAllByRole('status').some((node) => node.textContent?.includes('Engineer tier updated.'))).toBe(true);
    });

    fireEvent.change(screen.getByLabelText('Reassignment reason'), { target: { value: 'Two check-in windows were missed.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reassign task' }));
    await waitFor(() => {
      expect(screen.getAllByRole('status').some((node) => node.textContent?.includes('Task reassigned and inactivity review created.'))).toBe(true);
    });

    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/tasks/TSK-42/retier'))).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/tasks/TSK-42/reassignment'))).toBe(true);
  });

  it('renders a dedicated governance reviews surface and keeps governance tasks out of the delivery list', async () => {
    installTaskFetchMock({
      tasksOverride: [
        { task_id: 'TSK-42', tenant_id: 'tenant-a', title: 'Wire task detail', priority: 'P1', current_stage: 'IMPLEMENT', current_owner: 'engineer', owner: { actor_id: 'engineer', display_name: 'engineer' }, blocked: false, closed: false, waiting_state: null, next_required_action: null, queue_entered_at: '2026-04-01T15:00:00.000Z', freshness: { status: 'fresh', last_updated_at: '2026-04-01T15:00:00.000Z' } },
        { task_id: 'GHOST-1', tenant_id: 'tenant-a', title: 'Inactivity review for TSK-42', priority: 'P1', current_stage: 'BACKLOG', current_owner: 'architect', owner: { actor_id: 'architect', display_name: 'architect' }, blocked: false, closed: false, waiting_state: null, next_required_action: null, task_type: 'governance_review', queue_entered_at: '2026-04-01T15:00:01.000Z', freshness: { status: 'fresh', last_updated_at: '2026-04-01T15:00:01.000Z' } },
      ],
    });
    window.history.pushState({}, '', '/overview/governance');
    render(<App />);

    await screen.findByRole('heading', { name: 'Governance Reviews' });
    await screen.findByText('1 governance review shown.');
    expect(screen.getByText('Inactivity review for TSK-42')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).queryByText('Wire task detail')).not.toBeInTheDocument();
  });

  it('shows the linked inactivity review on the parent task detail', async () => {
    installTaskFetchMock({
      detailOverride: {
        context: {
          ghostingReview: {
            reviewTaskId: 'GHOST-1',
            title: 'Inactivity review for TSK-42',
            createdAt: '2026-04-01T15:10:00.000Z',
          },
        },
      },
    });
    render(<App />);

    await screen.findByRole('heading', { name: 'Wire task detail' });
    expect(screen.getByRole('link', { name: 'Inactivity review for TSK-42' })).toBeInTheDocument();
    expect(screen.getByText(/Governance review task created at 2026-04-01T15:10:00.000Z/i)).toBeInTheDocument();
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

  it('renders the PM overview in grouped bucket order with fallback labels and no assignment controls', async () => {
    installTaskFetchMock();
    window.history.pushState({}, '', '/overview/pm');
    render(<App />);

    await screen.findByRole('heading', { name: 'PM Overview' });
    await screen.findByText('6 tasks shown across 5 buckets.');
    expect(screen.getByRole('heading', { name: 'Needs routing attention' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Unassigned' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Architect' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Engineer' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'SRE' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Needs routing attention').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Role mapping unavailable').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Unassigned').length).toBeGreaterThan(0);
    expect(screen.getByText('Triage queue drift')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save owner' })).not.toBeInTheDocument();
  });

  it('filters the PM overview to one bucket and clears back to the grouped overview', async () => {
    installTaskFetchMock();
    window.history.pushState({}, '', '/overview/pm');
    render(<App />);

    await screen.findByRole('heading', { name: 'PM Overview' });
    fireEvent.change(screen.getByLabelText('Bucket filter'), { target: { value: 'engineer' } });

    await screen.findByText('1 task shown in Engineer.');
    expect(screen.getByRole('heading', { name: 'Engineer' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Needs routing attention' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Unassigned' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }));
    await screen.findByText('6 tasks shown across 5 buckets.');
    expect(screen.getByRole('heading', { name: 'Needs routing attention' })).toBeInTheDocument();
  });

  it('keeps PM overview degraded and empty states distinct from filtered-empty results', async () => {
    installTaskFetchMock({ aiAgentsStatus: 503 });
    window.history.pushState({}, '', '/overview/pm');
    render(<App />);

    await screen.findByRole('heading', { name: 'PM Overview' });
    expect(await screen.findByRole('heading', { name: 'Some routing metadata is unavailable' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('6 tasks shown across 5 buckets.');
    expect(screen.getByText('Triage queue drift')).toBeInTheDocument();

    cleanup();
    vi.unstubAllGlobals();

    installTaskFetchMock({ tasksOverride: [] });
    window.history.pushState({}, '', '/overview/pm?bucket=sre');
    render(<App />);

    await screen.findByRole('heading', { name: 'PM Overview' });
    expect(await screen.findByRole('heading', { name: 'No tasks in SRE' })).toBeInTheDocument();
    expect(screen.getByText('No tasks currently match the selected PM overview bucket.')).toBeInTheDocument();
  });

  it('passes an axe smoke scan for the QA inbox route and preserves read-only inbox semantics', async () => {
    installTaskFetchMock();
    window.history.pushState({}, '', '/inbox/qa');
    const { container } = render(<App />);

    await screen.findByRole('heading', { name: 'QA Inbox' });
    expect(screen.getByRole('status')).toHaveTextContent('1 task routed to QA.');
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'QA inbox view' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Owner filter')).not.toBeInTheDocument();

    const axeResults = await axe.run(container, {
      rules: {
        'color-contrast': { enabled: false },
      },
    });

    expect(axeResults.violations).toEqual([]);
  });

  it('keeps PM overview rows read-only while allowing task-detail navigation', async () => {
    installTaskFetchMock();
    window.history.pushState({}, '', '/overview/pm');
    render(<App />);

    await screen.findByRole('heading', { name: 'PM Overview' });
    const taskLink = screen.getByRole('link', { name: /Wire task detail/i });
    expect(taskLink).toHaveAttribute('href', '/tasks/TSK-42');
    expect(screen.queryByRole('button', { name: 'Save owner' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Owner')).not.toBeInTheDocument();
  });

  it('renders a PM inbox route for tasks explicitly waiting on PM action', async () => {
    installTaskFetchMock();
    window.history.pushState({}, '', '/inbox/pm');
    render(<App />);

    await screen.findByRole('heading', { name: 'PM Inbox' });
    expect(screen.getByText('Triage queue drift')).toBeInTheDocument();
    expect(screen.getByText('PM triage required')).toBeInTheDocument();
    expect(screen.getByText(/Routed to PM because the task is explicitly waiting on PM action/i)).toBeInTheDocument();
  });

  it('renders a Human Stakeholder inbox route for approval-driven work', async () => {
    installTaskFetchMock();
    window.history.pushState({}, '', '/inbox/human');
    render(<App />);

    await screen.findByRole('heading', { name: 'Human Stakeholder Inbox' });
    expect(screen.getByText('Restricted owner surface')).toBeInTheDocument();
    expect(screen.getByText('Human approval required')).toBeInTheDocument();
    expect(screen.getByText(/waiting on human approval or escalation handling/i)).toBeInTheDocument();
  });

  it('passes an axe smoke scan for the PM overview route', async () => {
    installTaskFetchMock();
    window.history.pushState({}, '', '/overview/pm');
    const { container } = render(<App />);

    await screen.findByRole('heading', { name: 'PM Overview' });
    expect(screen.getByRole('region', { name: 'PM overview view' })).toBeInTheDocument();
    expect(screen.getByLabelText('Bucket filter')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('6 tasks shown across 5 buckets.');

    const axeResults = await axe.run(container, {
      rules: {
        'color-contrast': { enabled: false },
      },
    });

    expect(axeResults.violations).toEqual([]);
  });
});
