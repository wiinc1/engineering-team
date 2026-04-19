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

export function installOrchestrationVisibilityFetchMock({ restricted = false } = {}) {
  const detailPayload = {
    task: { id: 'TSK-42', title: 'Wire task detail', priority: 'P1', stage: 'IMPLEMENT', status: 'active' },
    summary: {
      owner: { id: 'engineer', label: 'engineer', kind: 'assigned' },
      workflowStage: { value: 'IMPLEMENT', label: 'Implement' },
      nextAction: { label: 'Ship browser quality smoke coverage', source: 'system', overdue: false, waitingOn: null },
      prStatus: { label: '1 open PR linked', state: 'active', total: 1, openCount: 1, mergedCount: 0, draftCount: 0 },
      childStatus: { label: '3 linked child tasks', state: 'mixed', total: 3, blockedCount: 1 },
      timers: { queueAgeLabel: '5m', lastUpdatedAt: '2026-04-01T15:00:00.000Z', freshness: 'fresh' },
      blockedState: { isBlocked: false, label: 'Active', waitingOn: null },
    },
    blockers: [],
    context: {
      businessContext: 'Make orchestration state legible in one place.',
      acceptanceCriteria: ['Given a task page loads, orchestration state is visible above the fold.'],
      definitionOfDone: ['Orchestration visibility shipped with accessibility and visual coverage.'],
      technicalSpec: 'Server-rendered technical spec',
      monitoringSpec: 'Server-rendered monitoring spec',
    },
    relations: { linkedPrs: [], childTasks: [] },
    activity: { comments: [], auditLog: [], auditLogPageInfo: { limit: 25, next_cursor: null, has_more: false } },
    telemetry: { availability: 'available', lastUpdatedAt: '2026-04-01T15:00:00.000Z', summary: {}, emptyStateReason: null, access: { restricted: false, omission_applied: false, omitted_fields: [] } },
    orchestration: restricted ? null : {
      planner: {
        summary: { total: 3, readyCount: 1, blockedCount: 1, inProgressCount: 0, doneCount: 1, invalidCount: 0 },
        readyWork: [{ id: 'TSK-44', title: 'Run QA verification', taskType: 'qa', dependsOn: [] }],
        items: [],
      },
      run: {
        runId: 'run-visual-1',
        state: 'active',
        summary: { total: 3, readyCount: 1, runningCount: 1, blockedCount: 1, failedCount: 0, completedCount: 1 },
        items: [
          { id: 'TSK-43', title: 'Completed child', taskType: 'engineer', state: 'completed', dependencyState: 'done', dependsOn: [], blockers: [] },
          { id: 'TSK-44', title: 'Run QA verification', taskType: 'qa', state: 'running', dependencyState: 'ready', dependsOn: [], blockers: [], specialist: 'qa', actualAgent: 'qa' },
          { id: 'TSK-45', title: 'Blocked handoff', taskType: 'qa', state: 'blocked', dependencyState: 'blocked', dependsOn: [{ id: 'TSK-43', title: 'Completed child' }], blockers: [{ reason: 'Blocked by child task TSK-43.' }] },
        ],
      },
    },
    meta: {
      permissions: {
        canViewComments: true,
        canViewAuditLog: true,
        canViewTelemetry: true,
        canViewChildTasks: true,
        canViewLinkedPrMetadata: true,
        canViewOrchestration: !restricted,
      },
      freshness: { status: 'fresh', lastUpdatedAt: '2026-04-01T15:00:00.000Z' },
    },
  };

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
      return createJsonResponse(detailPayload);
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
      return createJsonResponse({ items: [], page_info: { next_cursor: null } });
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
      return createJsonResponse({ items: [] });
    }

    return createJsonResponse({ error: { code: 'not_found', message: `Unhandled mock for ${url}` } }, 404);
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export function renderOrchestrationVisibilityApp() {
  window.history.replaceState({}, '', '/tasks/TSK-42');
  writeBrowserSessionConfig({
    bearerToken: makeToken({
      sub: 'reader-1',
      tenant_id: 'tenant-a',
      roles: ['reader'],
      exp: Math.floor(Date.now() / 1000) + (60 * 60),
    }),
    apiBaseUrl: '',
    expiresAt: new Date(Date.now() + (60 * 60 * 1000)).toISOString(),
  });

  return React.createElement(App);
}
