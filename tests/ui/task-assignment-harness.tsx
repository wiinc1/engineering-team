import React from 'react';
import { vi } from 'vitest';
import { App } from '../../src/app/App';
import { writeBrowserSessionConfig } from '../../src/app/session';

function createJsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

function makeToken(claims: Record<string, unknown>) {
  return `header.${btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}.signature`;
}

export function installTaskAssignmentFetchMock() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (url.endsWith('/tasks') && (!init?.method || init.method === 'GET')) {
      return createJsonResponse({
        items: [
          { task_id: 'TSK-42', tenant_id: 'tenant-a', title: 'Wire task detail', priority: 'P1', current_stage: 'IMPLEMENT', current_owner: 'engineer', owner: { actor_id: 'engineer', display_name: 'engineer' }, blocked: false, closed: false, waiting_state: null, next_required_action: 'Ship browser quality smoke coverage', queue_entered_at: '2026-04-01T15:00:00.000Z', freshness: { status: 'fresh', last_updated_at: '2026-04-01T15:00:00.000Z' } },
        ],
      });
    }

    if (url.includes('/tasks/TSK-42/detail')) {
      return createJsonResponse({
        task: { id: 'TSK-42', title: 'Wire task detail', priority: 'P1', stage: 'IMPLEMENT', status: 'active' },
        summary: {
          owner: { id: 'engineer', label: 'engineer', kind: 'assigned' },
          workflowStage: { value: 'IMPLEMENT', label: 'Implement' },
          nextAction: { label: 'Ship browser quality smoke coverage', source: 'system', overdue: false, waitingOn: null },
          prStatus: { label: '1 open PR linked', state: 'active', total: 1, openCount: 1, mergedCount: 0, draftCount: 0 },
          childStatus: { label: '1 child task waiting', state: 'warning', total: 1, blockedCount: 0 },
          timers: { queueAgeLabel: '5m', lastUpdatedAt: '2026-04-01T15:00:00.000Z', freshness: 'fresh' },
          blockedState: { isBlocked: false, label: 'Active', waitingOn: null },
        },
        blockers: [],
        context: {
          businessContext: 'Make task state legible in one place.',
          acceptanceCriteria: ['Given a task page loads, the summary is visible above the fold.'],
          definitionOfDone: ['Assignment is auditable and visible.'],
          technicalSpec: 'Server-rendered technical spec',
          monitoringSpec: 'Server-rendered monitoring spec',
        },
        relations: {
          linkedPrs: [{ id: 'pr-12', number: 12, title: 'feat: task detail', state: 'open', merged: false, draft: false, repository: 'wiinc1/engineering-team' }],
          childTasks: [{ id: 'TSK-43', title: 'Triage queue drift', stage: 'TODO', status: 'waiting', owner: { label: 'qa' }, blocked: false }],
        },
        activity: {
          comments: [],
          auditLog: [
            { id: 'evt-1', type: 'task.created', summary: 'Task created', actor: { id: 'pm-1', label: 'PM 1' }, occurredAt: '2026-04-01T14:55:00.000Z' },
            { id: 'evt-2', type: 'task.assigned', summary: 'Owner assigned', actor: { id: 'engineer', label: 'Engineer 1' }, occurredAt: '2026-04-01T14:58:00.000Z' },
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
      });
    }

    if (url.endsWith('/tasks/TSK-42')) {
      return createJsonResponse({
        task_id: 'TSK-42',
        tenant_id: 'tenant-a',
        title: 'Wire task detail',
        priority: 'P1',
        current_stage: 'IMPLEMENT',
        current_owner: 'engineer',
        owner: { actor_id: 'engineer', display_name: 'engineer' },
        blocked: false,
        closed: false,
        waiting_state: null,
        next_required_action: 'Ship browser quality smoke coverage',
        freshness: { status: 'fresh', last_updated_at: '2026-04-01T15:00:00.000Z' },
        status_indicator: 'fresh',
      });
    }

    if (url.endsWith('/tasks/TSK-42/history')) {
      return createJsonResponse({
        items: [],
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
        correlation: { approved_correlation_ids: ['corr-1'] },
        access: { restricted: false, omission_applied: false, omitted_fields: [] },
      });
    }

    if (url.endsWith('/ai-agents')) {
      return createJsonResponse({
        items: [
          { id: 'architect', display_name: 'Architect', role: 'Architect', active: true },
          { id: 'qa', display_name: 'QA Engineer', role: 'QA', active: true },
          { id: 'engineer', display_name: 'Engineer', role: 'Engineering', active: true },
        ],
      });
    }

    if (url.endsWith('/tasks/TSK-42/assignment') && init?.method === 'PATCH') {
      return createJsonResponse({
        success: true,
        data: {
          taskId: 'TSK-42',
          owner: { agentId: 'qa', displayName: 'QA Engineer', role: 'QA' },
          updatedAt: '2026-04-01T16:00:00.000Z',
          duplicate: false,
          eventId: 'evt-assign',
        },
      });
    }

    return createJsonResponse({ error: { code: 'not_found', message: `Unhandled mock for ${url}` } }, 404);
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export function renderTaskAssignmentApp() {
  window.history.replaceState({}, '', '/tasks/TSK-42');
  writeBrowserSessionConfig({
    bearerToken: makeToken({
      sub: 'pm-1',
      tenant_id: 'tenant-a',
      roles: ['pm', 'reader'],
      exp: Math.floor(Date.now() / 1000) + (60 * 60),
    }),
    apiBaseUrl: '',
    expiresAt: new Date(Date.now() + (60 * 60 * 1000)).toISOString(),
  });

  return React.createElement(App);
}
