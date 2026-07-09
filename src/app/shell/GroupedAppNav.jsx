import { jsx, jsxs } from 'react/jsx-runtime';
import { ROLE_INBOXES, getRoleInboxLabel } from '../task-owner.mjs';
import { isProjectsPath } from '../routes/ProjectsRoute.jsx';

function NavButton({ active, onClick, children, pressed }) {
  return jsx('button', {
    type: 'button',
    className: active ? '' : 'button-secondary',
    'aria-pressed': pressed ?? active,
    onClick,
    children,
  });
}

function NavGroup({ label, children }) {
  return jsxs('div', {
    className: 'app-nav__group',
    children: [
      jsx('p', { className: 'app-nav__group-label', children: label }),
      jsx('div', { className: 'app-nav__group-links', role: 'group', 'aria-label': label, children }),
    ],
  });
}

export function GroupedAppNav({ ctx }) {
  const {
    I,
    _,
    A,
    P,
    autonomyMetricsRouteActive,
    f,
    h,
    isProjectsPath: isProjectsPathFn = isProjectsPath,
    l,
    N,
    navOpen,
    projectRouteActive,
    s,
    setNavOpen,
    sidebarTaskSearch,
    we,
    i,
  } = ctx;

  const commandCenterActive = s.kind === 'list'
    && !_
    && !P
    && !A
    && !f
    && !autonomyMetricsRouteActive
    && N.view !== 'board'
    && !projectRouteActive;
  const boardActive = s.kind === 'list'
    && !_
    && !P
    && !A
    && !f
    && !autonomyMetricsRouteActive
    && N.view === 'board';

  if (!navOpen) {
    return null;
  }

  return jsxs('div', {
    className: 'app-nav__content',
    children: [
      jsx('div', { className: 'app-nav__links', children: sidebarTaskSearch }),
      jsxs('div', { className: 'app-nav__groups', children: [
        jsxs(NavGroup, {
          label: 'Work',
          children: [
            jsx(NavButton, {
              active: commandCenterActive,
              onClick: () => l('/tasks', we({ view: 'list' }, '')),
              children: 'Command Center',
            }),
            jsx(NavButton, {
              active: boardActive,
              onClick: () => l('/tasks', we({ view: 'board' }, '')),
              children: 'Kanban board',
            }),
            jsx(NavButton, {
              active: projectRouteActive,
              onClick: () => l('/projects'),
              children: 'Projects',
            }),
            jsx('button', {
              type: 'button',
              className: 'app-nav__primary-action',
              onClick: () => l('/tasks/create'),
              children: 'New task',
            }),
          ],
        }),
        jsxs(NavGroup, {
          label: 'Governance',
          children: [
            jsx(NavButton, { active: !!_, onClick: () => l('/overview/pm'), children: 'PM overview' }),
            jsx(NavButton, { active: !!P, onClick: () => l('/overview/governance'), children: 'Governance reviews' }),
            jsx(NavButton, { active: !!A, onClick: () => l('/deferred-considerations'), children: 'Deferred considerations' }),
            jsxs('label', {
              className: 'app-nav__role-select',
              children: [
                jsx('span', { children: 'Role inboxes' }),
                jsxs('select', {
                  'aria-label': 'Role inboxes',
                  value: f || '',
                  onChange: (event) => {
                    const role = event.target.value;
                    if (role) l(`/inbox/${role}`);
                  },
                  children: [
                    jsx('option', { value: '', children: 'Select inbox' }),
                    ...ROLE_INBOXES.map((role) => jsx('option', { value: role, children: `${getRoleInboxLabel(role)} inbox` }, role)),
                  ],
                }),
              ],
            }),
          ],
        }),
        jsxs(NavGroup, {
          label: 'Insights',
          children: [
            jsx(NavButton, {
              active: autonomyMetricsRouteActive,
              onClick: () => l('/metrics/autonomous-delivery'),
              children: 'Autonomy metrics',
            }),
          ],
        }),
        jsxs(NavGroup, {
          label: 'Automation',
          children: [
            I(h, ['admin']) ? jsx(NavButton, { active: false, onClick: () => l('/admin/users'), children: 'User admin' }) : null,
            I(h, ['admin', 'pm']) ? jsx(NavButton, { active: i === '/admin/ai-agents', onClick: () => l('/admin/ai-agents'), children: 'AI agents' }) : null,
          ],
        }),
      ] }),
    ],
  });
}

export function buildCollapsedNavRail(ctx) {
  const {
    _,
    A,
    P,
    autonomyMetricsRouteActive,
    collapsedKanbanSelected,
    collapsedTaskWorkspaceSelected,
    f,
    isProjectsPath: isProjectsPathFn = isProjectsPath,
    l,
    navOpen,
    projectRouteActive,
    setNavOpen,
    we,
  } = ctx;

  if (navOpen) return null;

  return jsxs('nav', {
    className: 'app-nav-rail',
    'aria-label': 'Collapsed navigation',
    children: [
      jsxs('button', {
        type: 'button',
        className: `app-nav-rail__item${collapsedTaskWorkspaceSelected ? ' app-nav-rail__item--active' : ''}`,
        'aria-label': 'Command Center',
        'aria-pressed': collapsedTaskWorkspaceSelected,
        title: 'Command Center',
        onClick: () => l('/tasks', we({ view: 'list' }, '')),
        children: [
          jsx('span', { className: 'app-nav-rail__icon', 'aria-hidden': 'true', children: 'Q' }),
          jsx('span', { className: 'app-nav-rail__label', children: 'Command Center' }),
        ],
      }),
      jsxs('button', {
        type: 'button',
        className: `app-nav-rail__item${collapsedKanbanSelected ? ' app-nav-rail__item--active' : ''}`,
        'aria-label': 'Kanban board',
        'aria-pressed': collapsedKanbanSelected,
        title: 'Kanban board',
        onClick: () => l('/tasks', we({ view: 'board' }, '')),
        children: [
          jsx('span', { className: 'app-nav-rail__icon', 'aria-hidden': 'true', children: 'K' }),
          jsx('span', { className: 'app-nav-rail__label', children: 'Kanban board' }),
        ],
      }),
      jsxs('button', {
        type: 'button',
        className: `app-nav-rail__item${isProjectsPathFn(ctx.i) ? ' app-nav-rail__item--active' : ''}`,
        'aria-label': 'Projects',
        'aria-pressed': projectRouteActive,
        title: 'Projects',
        onClick: () => l('/projects'),
        children: [
          jsx('span', { className: 'app-nav-rail__icon', 'aria-hidden': 'true', children: 'P' }),
          jsx('span', { className: 'app-nav-rail__label', children: 'Projects' }),
        ],
      }),
      jsxs('button', {
        type: 'button',
        className: 'app-nav-rail__item',
        'aria-label': 'Search tasks',
        'aria-controls': 'primary-navigation',
        'aria-expanded': navOpen,
        title: 'Search tasks',
        onClick: () => setNavOpen(true),
        children: [
          jsx('span', { className: 'app-nav-rail__icon', 'aria-hidden': 'true', children: '⌕' }),
          jsx('span', { className: 'app-nav-rail__label', children: 'Search tasks' }),
        ],
      }),
    ],
  });
}