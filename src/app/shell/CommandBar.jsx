import { jsx, jsxs } from 'react/jsx-runtime';
import { countActiveCommandCenterFilters } from '../command-center-queue.mjs';

export function CommandBar({ ctx }) {
  const {
    La,
    N,
    h,
    k,
    l,
    navOpen,
    setNavOpen,
    wt,
  } = ctx;

  const activeFilterCount = countActiveCommandCenterFilters(N);

  return jsxs('div', {
    className: 'command-bar',
    role: 'region',
    'aria-label': 'Command bar',
    children: [
      jsxs('div', {
        className: 'command-bar__search',
        children: [
          jsx('label', {
            className: 'command-bar__search-label',
            children: 'Global search',
          }),
          jsx('input', {
            'aria-label': 'Global task search',
            value: N.searchTerm,
            placeholder: 'Search task ID, title, or owner',
            onChange: (event) => wt({ searchTerm: event.target.value }),
          }),
        ],
      }),
      jsxs('div', {
        className: 'command-bar__status',
        children: [
          jsx('span', { className: 'command-bar__chip', children: 'Environment: Local' }),
          jsx('span', { className: 'command-bar__chip command-bar__chip--accent', children: 'Queue mode' }),
          activeFilterCount ? jsx('span', {
            className: 'command-bar__chip command-bar__chip--warning',
            children: `${activeFilterCount} active filter${activeFilterCount === 1 ? '' : 's'}`,
          }) : null,
        ],
      }),
      jsxs('div', {
        className: 'command-bar__actions',
        children: [
          jsx('button', {
            type: 'button',
            className: 'button-secondary',
            onClick: () => setNavOpen(!navOpen),
            children: navOpen ? 'Hide navigation' : 'Show navigation',
          }),
          jsx('button', {
            type: 'button',
            className: 'button-secondary',
            onClick: () => k(),
            children: 'Refresh queue',
          }),
          jsx('button', {
            type: 'button',
            onClick: () => l('/tasks/create'),
            children: 'New task',
          }),
          jsxs('span', {
            className: 'command-bar__user',
            children: [h?.sub || 'operator', ' · ', h?.tenant_id || 'tenant'],
          }),
        ],
      }),
    ],
  });
}