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
  window.localStorage.removeItem('engineering-team-nav-open');
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
      if (href.endsWith('/v1/tasks')) {
        return response({ data: [] });
      }
      if (href.includes('/v1/projects') && !href.includes('/v1/projects/')) {
        return response({ data: [{ projectId: 'PRJ-ABC12345', name: 'Launch Plan', status: 'ACTIVE', ownerActorId: 'pm-1', taskCount: 2, version: 1 }] });
      }
      throw new Error(`Unhandled fetch URL in navigation test: ${href}`);
    }),
  );
}

function assertWorkspaceNavigation(primaryNav: HTMLElement, secondaryNav: HTMLElement) {
  expect(within(primaryNav).getByRole('button', { name: 'Task workspace' })).toBeInTheDocument();
  expect(within(primaryNav).getByRole('button', { name: 'Kanban board' })).toBeInTheDocument();
  expect(within(primaryNav).getByRole('button', { name: 'Projects' })).toBeInTheDocument();
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

function assertCompactSessionNavigation() {
  const appNav = screen.getByRole('navigation', { name: 'Primary navigation' });

  expect(within(appNav).getByText(/pm-1.*tenant-a/)).toBeInTheDocument();
  expect(within(appNav).getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  expect(screen.queryByLabelText('Current session')).not.toBeInTheDocument();
  expect(screen.queryByText('Signed-in browser access for internal use.')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Task ID')).not.toBeInTheDocument();
}

async function assertWorkspaceBoardNavigation() {
  render(<App />);

  await screen.findByRole('heading', { name: 'Command Center' });
  const primaryNav = screen.getByRole('group', { name: 'Primary task navigation' });
  const secondaryNav = screen.getByRole('group', { name: 'Secondary workspace navigation' });

  assertWorkspaceNavigation(primaryNav, secondaryNav);
  assertCompactSessionNavigation();
  expect(screen.getByRole('tab', { name: 'Kanban board' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByLabelText('Intake Draft column')).toBeInTheDocument();
  expect(screen.getByLabelText('Operator Approval column')).toBeInTheDocument();
  expect(within(screen.getByLabelText('Intake Draft column')).getByText('PM refinement required')).toBeInTheDocument();

  expect(within(secondaryNav).getByLabelText('Role inboxes')).toBeInTheDocument();
}

async function assertKanbanButtonRouteState() {
  vi.unstubAllGlobals();
  installNavigationFetch(taskPayload([]));
  window.history.pushState({}, '', '/tasks?view=list');

  render(<App />);

  await screen.findByRole('heading', { name: 'Command Center' });
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

async function assertSidebarTaskSearch() {
  render(<App />);

  await screen.findByRole('heading', { name: 'Command Center' });
  const appNav = screen.getByRole('navigation', { name: 'Primary navigation' });
  const taskSearch = within(appNav).getByRole('search', { name: 'Task search' });

  fireEvent.change(within(taskSearch).getByLabelText('Search tasks'), { target: { value: 'approval' } });
  fireEvent.click(within(taskSearch).getByRole('button', { name: 'Search' }));

  await screen.findByText('Await operator approval');
  expect(window.location.pathname).toBe('/tasks');
  expect(screen.getByLabelText('Operator Approval column')).toHaveTextContent('Await operator approval');
}

function collapsedRailButton(name: string) {
  return within(screen.getByRole('navigation', { name: 'Collapsed navigation' })).getByRole('button', { name });
}

function assertCollapsedNavigationRailActions(shell: HTMLElement) {
  const collapsedRail = screen.getByRole('navigation', { name: 'Collapsed navigation' });
  const railKanban = within(collapsedRail).getByRole('button', { name: 'Kanban board' });
  const railWorkspace = within(collapsedRail).getByRole('button', { name: 'Task workspace' });
  const railProjects = within(collapsedRail).getByRole('button', { name: 'Projects' });
  const railSearch = within(collapsedRail).getByRole('button', { name: 'Search tasks' });

  expect(railKanban).toHaveAttribute('aria-pressed', 'true');
  expect(railWorkspace).toHaveAttribute('title', 'Task workspace');
  expect(railProjects).toHaveAttribute('title', 'Projects');
  expect(railSearch).toHaveAttribute('aria-controls', 'primary-navigation');
  expect(railSearch.querySelector('.app-nav-rail__icon svg')).toBeInTheDocument();

  fireEvent.click(railWorkspace);

  expect(window.location.pathname).toBe('/tasks');
  expect(window.location.search).toContain('view=list');
  expect(shell).toHaveClass('app-shell--nav-collapsed');
  expect(collapsedRailButton('Task workspace')).toHaveAttribute('aria-pressed', 'true');

  fireEvent.click(collapsedRailButton('Kanban board'));

  expect(window.location.search).toContain('view=board');
  expect(collapsedRailButton('Kanban board')).toHaveAttribute('aria-pressed', 'true');

  fireEvent.click(collapsedRailButton('Search tasks'));
}

async function assertSlidingNavigationPanel() {
  render(<App />);

  await screen.findByRole('heading', { name: 'Command Center' });

  const shell = screen.getByRole('main');
  const collapseButton = screen.getByRole('button', { name: 'Collapse navigation' });
  const appNav = screen.getByRole('navigation', { name: 'Primary navigation' });

  expect(shell).not.toHaveClass('app-shell--nav-collapsed');
  expect(collapseButton).toHaveAttribute('aria-controls', 'primary-navigation');
  expect(collapseButton).toHaveAttribute('aria-expanded', 'true');
  expect(appNav).toHaveAttribute('id', 'primary-navigation');
  expect(appNav).toHaveAttribute('aria-hidden', 'false');

  fireEvent.click(collapseButton);

  const openButton = screen.getByRole('button', { name: 'Open navigation' });
  const hiddenNav = document.getElementById('primary-navigation');

  expect(shell).toHaveClass('app-shell--nav-collapsed');
  expect(openButton).toHaveAttribute('aria-expanded', 'false');
  expect(hiddenNav).toHaveClass('app-nav--collapsed');
  expect(hiddenNav).toHaveAttribute('aria-hidden', 'true');
  expect(window.localStorage.getItem('engineering-team-nav-open')).toBe('false');

  assertCollapsedNavigationRailActions(shell);

  expect(screen.getByRole('button', { name: 'Collapse navigation' })).toHaveAttribute('aria-expanded', 'true');
  expect(shell).not.toHaveClass('app-shell--nav-collapsed');
  expect(screen.getByRole('navigation', { name: 'Primary navigation' })).not.toHaveClass('app-nav--collapsed');
  expect(screen.queryByRole('navigation', { name: 'Collapsed navigation' })).not.toBeInTheDocument();
  expect(window.localStorage.getItem('engineering-team-nav-open')).toBe('true');
}

async function assertMobileNavigationDefaultsCollapsed() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query === '(max-width: 800px)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );

  render(<App />);

  await screen.findByRole('heading', { name: 'Command Center' });

  const shell = screen.getByRole('main');
  const openButton = screen.getByRole('button', { name: 'Open navigation' });
  const hiddenNav = document.getElementById('primary-navigation');

  expect(shell).toHaveClass('app-shell--nav-collapsed');
  expect(openButton).toHaveAttribute('aria-controls', 'primary-navigation');
  expect(openButton).toHaveAttribute('aria-expanded', 'false');
  expect(hiddenNav).toHaveAttribute('aria-hidden', 'true');
  expect(screen.getByRole('navigation', { name: 'Collapsed navigation' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Kanban board' })).toHaveAttribute('title', 'Kanban board');

  fireEvent.click(openButton);

  expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Collapse navigation' })).toHaveAttribute('aria-expanded', 'true');
  expect(window.localStorage.getItem('engineering-team-nav-open')).toBe('true');
}

describe('App navigation workspace UX', () => {
  beforeEach(() => {
    setupNavigationSession();
    installNavigationFetch();
  });

  afterEach(() => {
    cleanup();
    clearBrowserSessionConfig();
    window.localStorage.removeItem('engineering-team-nav-open');
    vi.unstubAllGlobals();
  });

  it('frames tasks as a workspace with lifecycle board labels and grouped role inbox navigation', async () => {
    await assertWorkspaceBoardNavigation();
  });

  it('switches from list to Kanban with selected state, route state, and empty board columns', async () => {
    await assertKanbanButtonRouteState();
  });

  it('searches task workspace results from the sidebar', async () => {
    await assertSidebarTaskSearch();
  });

  it('opens Projects as a planning workspace from primary navigation', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: 'Command Center' });
    expect(within(screen.getByRole('group', { name: 'Primary task navigation' })).getByRole('button', { name: 'Projects' })).toBeInTheDocument();
  });

  it('collapses and reopens the sliding left navigation panel', async () => {
    await assertSlidingNavigationPanel();
  });

  it('defaults the mobile sliding navigation drawer closed until opened', async () => {
    await assertMobileNavigationDefaultsCollapsed();
  });
});
