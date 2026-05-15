import React from 'react';
import { vi } from 'vitest';
import { App } from '../../src/app/App';
import { writeBrowserSessionConfig } from '../../src/app/session';

function response(payload: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

function token(claims: Record<string, unknown>) {
  const body = btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return `header.${body}.signature`;
}

export function taskDetailNextActionPayload(overrides: Record<string, any> = {}) {
  const stage = overrides.stage || 'DRAFT';
  const status = overrides.status || 'waiting';
  return {
    task: { id: 'TSK-153', title: overrides.title || 'Role-specific next action', priority: 'P1', stage, status },
    summary: {
      owner: overrides.owner === null ? null : { id: overrides.ownerId || 'pm', label: overrides.ownerLabel || 'PM', kind: 'assigned' },
      workflowStage: { value: stage, label: overrides.stageLabel || stage },
      nextAction: overrides.nextAction === null ? null : { label: overrides.nextAction || 'PM refinement required', source: 'system' },
      prStatus: { label: 'No linked PRs', state: 'empty', total: 0 },
      childStatus: { label: 'No child tasks', state: 'empty', total: 0 },
      timers: { queueAgeLabel: '5m', lastUpdatedAt: '2026-05-15T10:00:00.000Z', freshness: overrides.freshness || 'fresh' },
      blockedState: { isBlocked: Boolean(overrides.blocked), label: overrides.blocked ? 'Blocked' : 'Active', waitingOn: overrides.waitingOn || null },
    },
    blockers: overrides.blocked ? [{ id: 'blk-1', label: overrides.waitingOn || 'External blocker' }] : [],
    context: {
      intakeDraft: Boolean(overrides.intakeDraft ?? stage === 'DRAFT'),
      businessContext: 'Operators need the next workflow step surfaced first.',
      acceptanceCriteria: ['The next action panel appears above the fold.'],
      definitionOfDone: ['Role-specific next actions are accessible and tested.'],
      sreMonitoring: overrides.monitoring || {},
      closeGovernance: overrides.closeGovernance || null,
      qaResults: { summary: { total: 0, passedCount: 0, failedCount: 0, retestCount: 0 }, items: [] },
    },
    relations: { linkedPrs: [], childTasks: [] },
    activity: { comments: [], auditLog: [], auditLogPageInfo: { limit: 25, next_cursor: null, has_more: false } },
    telemetry: {
      availability: overrides.freshness === 'stale' ? 'stale' : 'available',
      lastUpdatedAt: '2026-05-15T10:00:00.000Z',
      access: { restricted: false, omission_applied: false, omitted_fields: [] },
    },
    meta: {
      permissions: overrides.permissions || {
        canViewComments: true,
        canViewAuditLog: true,
        canViewTelemetry: true,
        canViewChildTasks: true,
        canViewLinkedPrMetadata: true,
      },
      freshness: { status: overrides.freshness || 'fresh', lastUpdatedAt: '2026-05-15T10:00:00.000Z' },
    },
  };
}

export function installTaskDetailNextActionFetchMock(detail = taskDetailNextActionPayload()) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/tasks') && (!init?.method || init.method === 'GET')) {
      return response({
        items: [{
          task_id: 'TSK-153',
          tenant_id: 'tenant-a',
          title: detail.task.title,
          priority: 'P1',
          current_stage: detail.task.stage,
          current_owner: detail.summary.owner?.id || null,
          owner: detail.summary.owner ? { actor_id: detail.summary.owner.id, display_name: detail.summary.owner.label } : null,
          blocked: detail.summary.blockedState.isBlocked,
          closed: detail.task.status === 'done',
          waiting_state: detail.summary.blockedState.waitingOn,
          next_required_action: detail.summary.nextAction?.label || null,
          freshness: { status: detail.meta.freshness.status, last_updated_at: detail.meta.freshness.lastUpdatedAt },
        }],
      });
    }
    if (url.includes('/tasks/TSK-153/detail')) return response(detail);
    if (url.endsWith('/ai-agents')) return response({ items: [{ id: 'pm', display_name: 'PM', role: 'PM', active: true }] });
    return response({ error: { code: 'not_found', message: `Unhandled mock for ${url}` } }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export function renderTaskDetailNextActionApp(roles = ['pm', 'reader']) {
  window.history.replaceState({}, '', '/tasks/TSK-153');
  writeBrowserSessionConfig({
    bearerToken: token({ sub: 'actor-1', tenant_id: 'tenant-a', roles, exp: Math.floor(Date.now() / 1000) + 3600 }),
    apiBaseUrl: '',
    expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
  });
  return React.createElement(App);
}
