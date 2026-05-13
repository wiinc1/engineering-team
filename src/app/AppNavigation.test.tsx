import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from './App';
import { clearBrowserSessionConfig, writeBrowserSessionConfig } from './session';

function token(claims: Record<string, unknown>) {
  return `header.${btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}.signature`;
}

function response(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

function agentPayload() {
  return {
    items: [
      { id: 'pm', display_name: 'PM', role: 'PM', active: true },
      { id: 'qa', display_name: 'QA Engineer', role: 'QA', active: true },
    ],
  };
}

function taskPayload(items = [
  {
    task_id: 'TSK-DRAFT',
    tenant_id: 'tenant-a',
    title: 'Shape raw operator notes',
    priority: null,
    current_stage: 'DRAFT',
    current_owner: 'pm',
    owner: { actor_id: 'pm', display_name: 'PM' },
    intake_draft: true,
    waiting_state: 'task_refinement',
    next_required_action: 'PM refinement required',
    freshness: { status: 'fresh', last_updated_at: '2026-04-01T15:00:00.000Z' },
  },
  {
    task_id: 'TSK-APPROVAL',
    tenant_id: 'tenant-a',
    title: 'Await operator approval',
    priority: 'P2',
    current_stage: 'TODO',
    current_owner: null,
    owner: null,
    freshness: { status: 'fresh', last_updated_at: '2026-04-01T15:01:00.000Z' },
  },
]) {
  return {
    items,
  };
}

function setupNavigationSession() {
  clearBrowserSessionConfig();
  window.history.pushState({}, '', '/tasks');
  writeBrowserSessionConfig({
    apiBaseUrl: '',
    bearerToken: token({
      sub: 'pm-1',
      tenant_id: 'tenant-a',
      roles: ['pm', 'reader'],
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
    expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
  });
}

function installNavigationFetch(tasks = taskPayload()) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      const href = String(url);
      if (href.endsWith('/ai-agents')) {
        return response(agentPayload());
      }
      if (href.endsWith('/tasks')) {
        return response(tasks);
      }
      throw new Error(`Unhandled fetch URL in navigation test: ${href}`);
    }),
  );
}

function assertWorkspaceNavigation(primaryNav: HTMLElement, secondaryNav: HTMLElement) {
  expect(within(primaryNav).getByRole('button', { name: 'Task workspace' })).toBeInTheDocument();
  expect(within(primaryNav).getByRole('button', { name: 'Kanban board' })).toBeInTheDocument();
  expect(within(primaryNav).getByRole('button', { name: 'New task' })).toBeInTheDocument();
  expect(within(secondaryNav).getByRole('button', { name: 'PM overview' })).toBeInTheDocument();
  expect(within(secondaryNav).getByRole('button', { name: 'Governance reviews' })).toBeInTheDocument();
  expect(within(secondaryNav).getByLabelText('Role inboxes')).toBeInTheDocument();
}

function assertBoardIntakeGuidance() {
  const intakeDraftColumn = within(screen.getByLabelText('Intake Draft column'));
  expect(intakeDraftColumn.getByText('No matching tasks in this column.')).toBeInTheDocument();
  expect(
    intakeDraftColumn.getByText('Raw request awaiting PM refinement.', {
      selector: '.task-board__empty-guidance',
    }),
  ).toBeInTheDocument();
}

async function assertWorkspaceBoardNavigation() {
  render(<App />);

  await screen.findByRole('heading', { name: 'Task workspace' });
  const primaryNav = screen.getByRole('group', { name: 'Primary task navigation' });
  const secondaryNav = screen.getByRole('group', { name: 'Secondary workspace navigation' });

  assertWorkspaceNavigation(primaryNav, secondaryNav);
  expect(screen.getByRole('tab', { name: 'Kanban board' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByLabelText('Intake Draft column')).toBeInTheDocument();
  expect(screen.getByLabelText('Operator Approval column')).toBeInTheDocument();
  expect(within(screen.getByLabelText('Intake Draft column')).getByText('PM refinement required')).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Owner filter'), { target: { value: '__unassigned__' } });

  await screen.findByText('1 unassigned cards shown.');
  assertBoardIntakeGuidance();

  fireEvent.change(within(secondaryNav).getByLabelText('Role inboxes'), { target: { value: 'pm' } });

  await screen.findByRole('heading', { name: 'PM Inbox' });
  expect(window.location.pathname).toBe('/inbox/pm');
}

async function assertKanbanButtonRouteState() {
  vi.unstubAllGlobals();
  installNavigationFetch(taskPayload([]));
  window.history.pushState({}, '', '/tasks?view=list');

  render(<App />);

  await screen.findByRole('heading', { name: 'Task workspace' });
  expect(screen.getByRole('tab', { name: 'List' })).toHaveAttribute('aria-selected', 'true');

  const primaryNav = screen.getByRole('group', { name: 'Primary task navigation' });
  fireEvent.click(within(primaryNav).getByRole('button', { name: 'Kanban board' }));

  await screen.findByLabelText('Task board');
  expect(window.location.pathname).toBe('/tasks');
  expect(window.location.search).toContain('view=board');
  expect(screen.getByRole('tab', { name: 'Kanban board' })).toHaveAttribute('aria-selected', 'true');
  expect(within(primaryNav).getByRole('button', { name: 'Kanban board' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('heading', { name: 'Intake Draft' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Operator Approval' })).toBeInTheDocument();
  expect(screen.getByLabelText('Task Refinement column')).toHaveTextContent('0');
  expect(screen.getByLabelText('Task Refinement column')).toHaveTextContent('No matching tasks in this column.');
}

describe('App navigation workspace UX', () => {
  beforeEach(() => {
    setupNavigationSession();
    installNavigationFetch();
  });

  afterEach(() => {
    cleanup();
    clearBrowserSessionConfig();
    vi.unstubAllGlobals();
  });

  it('frames tasks as a workspace with lifecycle board labels and grouped role inbox navigation', async () => {
    await assertWorkspaceBoardNavigation();
  });

  it('switches from list to Kanban with selected state, route state, and empty board columns', async () => {
    await assertKanbanButtonRouteState();
  });
});
