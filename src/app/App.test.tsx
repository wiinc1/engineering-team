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

function installTaskFetchMock({
  forbidden = false,
  reassignedOwner = 'qa',
  aiAgentsStatus = 200,
  detailOverride,
  summaryOverride,
  telemetryOverride,
  historyOverride,
} = {}) {
  let currentOwner = 'engineer';

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
        items: [
          { task_id: 'TSK-42', tenant_id: 'tenant-a', title: 'Wire task detail', priority: 'P1', current_stage: 'IMPLEMENT', current_owner: currentOwner, owner: currentOwner ? { actor_id: currentOwner, display_name: currentOwner } : null, blocked: false, closed: false, waiting_state: null, next_required_action: null, queue_entered_at: '2026-04-01T15:00:00.000Z', freshness: { status: 'fresh', last_updated_at: '2026-04-01T15:00:00.000Z' } },
          { task_id: 'TSK-43', tenant_id: 'tenant-a', title: 'Triage queue drift', priority: 'P2', current_stage: 'TODO', current_owner: null, owner: null, blocked: false, closed: false, waiting_state: 'awaiting_pm_decision', next_required_action: 'PM triage required', queue_entered_at: '2026-04-01T15:00:01.000Z', freshness: { status: 'fresh', last_updated_at: '2026-04-01T15:00:01.000Z' } },
          { task_id: 'TSK-44', tenant_id: 'tenant-a', title: 'Stale owner reference', priority: 'P3', current_stage: 'REVIEW', current_owner: 'ghost', owner: { actor_id: 'ghost', display_name: 'ghost' }, blocked: false, closed: false, waiting_state: null, next_required_action: null, queue_entered_at: '2026-04-01T15:00:02.000Z', freshness: { status: 'fresh', last_updated_at: '2026-04-01T15:00:02.000Z' } },
          { task_id: 'TSK-45', tenant_id: 'tenant-a', title: 'Restricted owner surface', priority: 'P2', current_stage: 'TODO', current_owner: 'masked', owner: { actor_id: 'masked', display_name: '', redacted: true }, blocked: false, closed: false, waiting_state: 'awaiting_human_approval', next_required_action: 'Human approval required', queue_entered_at: '2026-04-01T15:00:03.000Z', freshness: { status: 'fresh', last_updated_at: '2026-04-01T15:00:03.000Z' } },
          { task_id: 'TSK-46', tenant_id: 'tenant-a', title: 'Review test plan', priority: 'P2', current_stage: 'VERIFY', current_owner: 'qa', owner: { actor_id: 'qa', display_name: 'qa' }, blocked: false, closed: false, waiting_state: null, next_required_action: null, queue_entered_at: '2026-04-01T15:00:04.000Z', freshness: { status: 'fresh', last_updated_at: '2026-04-01T15:00:04.000Z' } },
          { task_id: 'TSK-47', tenant_id: 'tenant-a', title: 'Design routing architecture', priority: 'P1', current_stage: 'BACKLOG', current_owner: 'architect', owner: { actor_id: 'architect', display_name: 'architect' }, blocked: false, closed: false, waiting_state: null, next_required_action: null, queue_entered_at: '2026-04-01T15:00:05.000Z', freshness: { status: 'fresh', last_updated_at: '2026-04-01T15:00:05.000Z' } },
        ],
      });
    }

    if (url.endsWith('/tasks/TSK-42/detail')) {
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
    window.history.pushState({}, '', '/tasks?owner=nonexistent-owner');
    render(<App />);

    await screen.findByRole('heading', { name: 'Task list' });
    await screen.findByText('0 tasks shown for nonexistent-owner.');
    expect(screen.getByRole('heading', { name: 'No matching tasks' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Clear filter' }).length).toBeGreaterThan(0);
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

    fireEvent.click(screen.getByRole('button', { name: 'Engineer inbox' }));
    await screen.findByRole('heading', { name: 'Engineer Inbox' });
    await screen.findByText('0 tasks routed to Engineer.');

    fireEvent.click(screen.getByRole('button', { name: 'QA inbox' }));
    await screen.findByRole('heading', { name: 'QA Inbox' });
    expect(screen.getByText('2 tasks routed to QA.')).toBeInTheDocument();
    expect(screen.getByText('Wire task detail')).toBeInTheDocument();
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
    await screen.findByText('6 tasks shown across 4 buckets.');
    expect(screen.getByRole('heading', { name: 'Needs routing attention' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Architect' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Engineer' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'SRE' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Needs routing attention').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Role mapping unavailable').length).toBeGreaterThan(0);
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

    fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }));
    await screen.findByText('6 tasks shown across 4 buckets.');
    expect(screen.getByRole('heading', { name: 'Needs routing attention' })).toBeInTheDocument();
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
    expect(screen.getByRole('status')).toHaveTextContent('6 tasks shown across 4 buckets.');

    const axeResults = await axe.run(container, {
      rules: {
        'color-contrast': { enabled: false },
      },
    });

    expect(axeResults.violations).toEqual([]);
  });
});
