import { expect, test } from '@playwright/test';
import { installBrowserQualityApp } from './browser-quality-fixtures';

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
          signal_id: 'adrs-browser-1',
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
        total: 1,
        pending: 1,
        leased: 1,
        expiredLeases: 0,
        retrying: 0,
        completed: 0,
        deadLetter: 0,
      },
      items: [{
        id: 'factory-browser-1',
        stage: 'phase1_complete',
        taskId: 'TSK-QUEUE-1',
        evidencePath: 'observability/factory-delivery/factory-browser-1.json',
        attempts: 0,
        maxAttempts: 5,
        leaseActive: true,
        lockedBy: 'worker-1',
      }],
    },
  };
}

test('autonomous delivery metrics dashboard renders the pilot report without overflow', async ({ page }) => {
  await installBrowserQualityApp(page, { roles: ['sre', 'reader'] });
  await page.route('**/api/v1/metrics/autonomous-delivery', async (route) => {
    await route.fulfill({ json: metricsPayload() });
  });
  await page.route('**/api/v1/metrics/autonomous-delivery/rebuild', async (route) => {
    await route.fulfill({ status: 202, json: metricsPayload() });
  });
  await page.route('**/api/v1/factory/queue**', async (route) => {
    await route.fulfill({ json: queuePayload() });
  });

  await page.goto('/metrics/autonomous-delivery', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: 'Autonomous Delivery Metrics' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Autonomous delivery metrics loaded.');
  await expect(page.getByText('Autonomous delivery', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Metric breakdown' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'TSK-AUTO-1' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Factory queue' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'factory-browser-1' })).toBeVisible();

  const overflow = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.autonomy-metrics, .autonomy-metric, .task-list-table-wrap'))
      .filter((element) => element.scrollWidth > element.clientWidth + 1)
      .map((element) => element.className);
  });
  expect(overflow).toEqual([]);
});
