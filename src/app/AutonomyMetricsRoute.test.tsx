import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import axe from 'axe-core';

import { AutonomyMetricsRoute } from './routes/AutonomyMetricsRoute.jsx';
import { clearBrowserSessionConfig, writeBrowserSessionConfig } from './session.browser';

function response(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response;
}

function metricsPayload() {
  return {
    success: true,
    data: {
      schema_version: 'autonomous-delivery-metrics-mvp.v1',
      policy_version: 'autonomous-delivery-metrics-policy.v1',
      generated_at: '2026-05-01T12:00:00.000Z',
      summary: {
        total_signals: 2,
        included_signals: 2,
        known_signals: 2,
        unknown_signals: 0,
        autonomous_deliveries: 1,
        autonomous_delivery_rate: 0.5,
        operator_interventions_total: 1,
        operator_intervention_rate: 0.5,
        qa_sre_rework_total: 1,
        qa_sre_rework_rate: 0.5,
        rollback_total: 0,
        rollback_rate: 0,
        escaped_defects_total: 0,
        escaped_defect_rate: 0,
      },
      breakdowns: {
        by_task_class: [{ key: 'Simple', included: 2, autonomous: 1, operator_intervention_rate: 0.5 }],
        by_template_tier: [{ key: 'Simple', included: 2, autonomous: 1, operator_intervention_rate: 0.5 }],
        by_implementation_agent: [{ key: 'engineer-sr', included: 2, autonomous: 1, operator_intervention_rate: 0.5 }],
      },
      signals: [
        {
          signal_id: 'adrs-1',
          task_id: 'TSK-AUTO-1',
          task_class: 'Simple',
          implementation_agent: 'engineer-sr',
          classification_status: 'known',
          operator_interventions: { count: 0 },
        },
      ],
    },
  };
}

function queuePayload() {
  return {
    success: true,
    data: {
      schemaVersion: 'factory-queue-status.v1',
      queueBackend: 'postgres',
      queueTable: 'factory_delivery_queue',
      tenantId: 'tenant-a',
      generatedAt: '2026-07-05T12:00:00.000Z',
      summary: {
        total: 3,
        pending: 2,
        leased: 1,
        expiredLeases: 0,
        retrying: 1,
        completed: 1,
        deadLetter: 0,
      },
      items: [{
        id: 'factory-queue-1',
        title: 'Ship queue status',
        stage: 'phase1_complete',
        taskId: 'TSK-QUEUE-1',
        evidencePath: 'observability/factory-delivery/factory-queue-1.json',
        attempts: 1,
        maxAttempts: 5,
        leaseActive: true,
        lockedBy: 'worker-1',
        realDelivery: {
          requested: true,
          prNumber: 418,
          releaseEnv: 'staging',
          rollbackVerified: true,
          preflight: { required: true, ok: true, failures: [] },
        },
      }],
    },
  };
}

function blockedQueuePayload() {
  const payload = queuePayload();
  payload.data.summary.deadLetter = 1;
  payload.data.items = [{
    ...payload.data.items[0],
    id: 'factory-queue-blocked',
    taskId: null,
    stage: 'dead_letter',
    leaseActive: false,
    lockedBy: null,
    realDelivery: {
      requested: true,
      releaseEnv: 'staging',
      rollbackVerified: false,
      preflight: {
        required: true,
        ok: false,
        failures: [
          'actual pull request target is required (--pr-url or --repository/--pr-number)',
          'hosted staging release evidence requires --rollback-target',
          'hosted staging release evidence requires --deployment-url',
        ],
      },
    },
  }];
  return payload;
}

function registerRenderTest() {
  it('renders the autonomous delivery report with summary, breakdown, and signals', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.headers).toHaveProperty('authorization');
      if (url.endsWith('/v1/metrics/autonomous-delivery')) return response(metricsPayload());
      if (url.endsWith('/v1/factory/queue?limit=8')) return response(queuePayload());
      throw new Error(`Unhandled URL ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AutonomyMetricsRoute ctx={{ D: '', u: { bearerToken: 'header.payload.signature' } }} />);

    expect(await screen.findByText('Autonomous delivery metrics loaded.')).toBeInTheDocument();
    expect(screen.getByText('Autonomous delivery')).toBeInTheDocument();
    expect(screen.getAllByText('50%').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Metric breakdown' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'TSK-AUTO-1' })).toHaveAttribute('href', '/tasks/TSK-AUTO-1');
    expect(screen.getByRole('heading', { name: 'Factory queue' })).toBeInTheDocument();
    expect(screen.getByText('Queue pending')).toBeInTheDocument();
    expect(screen.getByText('staging · PR #418 · rollback verified')).toBeInTheDocument();
    expect(screen.getByText('Preflight ready')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'factory-queue-1' })).toHaveAttribute('href', '/tasks/TSK-QUEUE-1');
  });
}

function registerQueuePreflightFailureTest() {
  it('renders real-delivery preflight blockers for factory queue items', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/v1/metrics/autonomous-delivery')) return response(metricsPayload());
      if (url.endsWith('/v1/factory/queue?limit=8')) return response(blockedQueuePayload());
      throw new Error(`Unhandled URL ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AutonomyMetricsRoute ctx={{ D: '', u: { bearerToken: 'header.payload.signature' } }} />);

    expect(await screen.findByText('Preflight blocked')).toBeInTheDocument();
    expect(screen.getByText('actual pull request target is required (--pr-url or --repository/--pr-number)')).toBeInTheDocument();
    expect(screen.getByText('hosted staging release evidence requires --rollback-target')).toBeInTheDocument();
    expect(screen.queryByText('hosted staging release evidence requires --deployment-url')).not.toBeInTheDocument();
    expect(screen.getByText('staging · PR missing · rollback missing')).toBeInTheDocument();
    expect(screen.getByText('factory-queue-blocked')).toBeInTheDocument();
  });
}

function registerAxeTest() {
  it('passes an axe smoke scan', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(metricsPayload())));
    const { container } = render(<AutonomyMetricsRoute ctx={{ D: '', u: { bearerToken: 'header.payload.signature' } }} />);

    await screen.findByRole('heading', { name: 'Metric breakdown' });
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });

    expect(results.violations).toEqual([]);
  });
}

function registerRebuildFailureTest() {
  it('shows rebuild failures without dropping the current report', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/v1/metrics/autonomous-delivery') && init?.method !== 'POST') return response(metricsPayload());
      if (url.endsWith('/v1/metrics/autonomous-delivery/rebuild')) {
        return response({ error: { message: 'missing permission: projections:rebuild' } }, 403);
      }
      throw new Error(`Unhandled URL ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AutonomyMetricsRoute ctx={{ D: '', u: { bearerToken: 'header.payload.signature' } }} />);
    await screen.findByText('Autonomous delivery metrics loaded.');
    screen.getByRole('button', { name: 'Rebuild' }).click();

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('missing permission: projections:rebuild'));
    expect(screen.getByText('Autonomous delivery')).toBeInTheDocument();
  });
}

describe('AutonomyMetricsRoute', () => {
  beforeEach(() => {
    writeBrowserSessionConfig({
      bearerToken: 'header.payload.signature',
      apiBaseUrl: '',
      actorId: 'sre-1',
      tenantId: 'tenant-a',
      roles: ['sre'],
      expiresAt: '2030-01-01T00:00:00.000Z',
    });
  });

  afterEach(() => {
    cleanup();
    clearBrowserSessionConfig();
    vi.unstubAllGlobals();
  });

  registerRenderTest();
  registerQueuePreflightFailureTest();
  registerAxeTest();
  registerRebuildFailureTest();
});
