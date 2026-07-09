import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isLiveTaskFreshnessPollingEnabled,
  LiveTaskFreshnessIndicator,
  permissionSafeMerge,
  reconcileLiveUpdates,
  useLiveTaskFreshnessPolling,
} from './live-task-freshness';

function update(entityId: string, version: number, projectId?: string, tenantId = 'tenant-a') {
  return {
    entityType: 'task',
    entityId,
    tenantId,
    version,
    updatedAt: new Date(Date.UTC(2026, 4, 17, 12, 0, version)).toISOString(),
    payload: { task: { task_id: entityId, tenant_id: tenantId, version, project_id: projectId || null } },
  };
}

const TEST_SESSION = { apiBaseUrl: '/api', bearerToken: 'token' };

function HookHarness({ onUpdates, staleAfterMs = 15000 }: { onUpdates: (updates: unknown[]) => void; staleAfterMs?: number }) {
  const state = useLiveTaskFreshnessPolling({
    session: TEST_SESSION,
    defaultBaseUrl: '/api',
    scope: { kind: 'list' },
    onUpdates,
    enabled: true,
    pollMs: 100,
    staleAfterMs,
  });
  return <div data-testid="live-status">{state.status}:{state.message}</div>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.localStorage.clear();
});

describe('live task freshness reconciliation', () => {
  it('ignores older and duplicate updates while preserving the newest version', () => {
    const first = reconcileLiveUpdates({}, [update('TSK-1', 2)]);
    const second = reconcileLiveUpdates(first, [update('TSK-1', 1), update('TSK-1', 2), update('TSK-1', 3)]);

    expect(second.accepted.map(item => item.version)).toEqual([3]);
    expect(second.ignored.map(item => item.version)).toEqual([1, 2]);
    expect(second.versions['task:tenant-a:TSK-1'].version).toBe(3);
  });

  it('keeps same task ids separate across tenant namespaces', () => {
    const result = reconcileLiveUpdates({}, [
      update('TSK-1', 1, undefined, 'tenant-a'),
      update('TSK-1', 1, undefined, 'tenant-b'),
    ]);

    expect(result.accepted).toHaveLength(2);
    expect(result.versions['task:tenant-a:TSK-1'].tenantId).toBe('tenant-a');
    expect(result.versions['task:tenant-b:TSK-1'].tenantId).toBe('tenant-b');
  });

  it('drops restricted detail fields during permission-safe merges', () => {
    const merged = permissionSafeMerge(
      { task_id: 'TSK-1', title: 'Visible' },
      { title: 'Updated', comments: ['hidden'], telemetry: { raw: true }, context: { secret: true } },
    );

    expect(merged).toEqual({ task_id: 'TSK-1', title: 'Updated' });
  });

  it('keeps the browser flag disabled unless env or local rollout enables it', () => {
    expect(isLiveTaskFreshnessPollingEnabled({})).toBe(false);
    expect(isLiveTaskFreshnessPollingEnabled({ VITE_FF_LIVE_TASK_FRESHNESS_POLLING: '1' })).toBe(true);
    window.localStorage.setItem('engineering-team.live-task-freshness-polling', '0');
    expect(isLiveTaskFreshnessPollingEnabled({ VITE_FF_LIVE_TASK_FRESHNESS_POLLING: '1' })).toBe(false);
  });
});

describe('LiveTaskFreshnessIndicator', () => {
  it.each(['fresh', 'stale', 'reconnecting', 'degraded', 'disabled', 'polling'])('renders the %s status with manual refresh', (status) => {
    const refresh = vi.fn();
    render(<LiveTaskFreshnessIndicator state={{ status, message: `${status} message` }} onManualRefresh={refresh} showDisabled />);

    expect(screen.getByRole('status')).toHaveTextContent(`${status} message`);
    screen.getByRole('button', { name: /refresh now/i }).click();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('useLiveTaskFreshnessPolling', () => {
  it('polls with a cursor and calls the route refresh callback for later relevant updates', async () => {
    const onUpdates = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { cursor: 'cursor-1', updates: [update('TSK-1', 1)] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { cursor: 'cursor-2', updates: [update('TSK-1', 2)] } }),
      })
      .mockResolvedValue({
        ok: true,
        json: async () => ({ data: { cursor: 'cursor-2', updates: [] } }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<HookHarness onUpdates={onUpdates} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(onUpdates).not.toHaveBeenCalled();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(fetchMock.mock.calls[1][0]).toContain('cursor=cursor-1');
    expect(onUpdates).toHaveBeenCalledTimes(1);
    expect(onUpdates.mock.calls[0][0][0].version).toBe(2);
    expect(screen.getByTestId('live-status')).toHaveTextContent('fresh:Fresh updates applied.');
  });

  it('moves through retry, stale, and degraded states when polling fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    render(<HookHarness onUpdates={vi.fn()} staleAfterMs={-1} />);

    await waitFor(() => expect(screen.getByTestId('live-status')).toHaveTextContent('stale:network down'));
    await waitFor(() => expect(screen.getByTestId('live-status')).toHaveTextContent('degraded:network down'));
  });
});
