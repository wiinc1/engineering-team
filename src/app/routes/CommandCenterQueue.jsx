import { jsx, jsxs } from 'react/jsx-runtime';
import {
  buildCommandCenterQueueSections,
  formatTaskFreshnessLabel,
} from '../command-center-queue.mjs';

function QueueTaskRow({
  task,
  selectedTaskId,
  buildQueueTaskHref,
  updateQueueSelection,
  ownerLookup,
  searchTerm,
  sessionClaims,
  isIntakeDraft,
  matchesTaskSearch,
  isTaskAssignedToCurrentActor,
  resolveOwnerPresentation,
  onNavigate,
}) {
  const owner = resolveOwnerPresentation(task, ownerLookup);
  const matches = matchesTaskSearch(task, searchTerm);
  const assignedToMe = isTaskAssignedToCurrentActor(task, sessionClaims, ownerLookup);

  return jsxs('tr', {
    className: `${matches ? 'task-list-row--match' : ''}${selectedTaskId === task.task_id ? ' task-list-row--selected' : ''}`,
    children: [
      jsxs('td', {
        children: [
          jsx('a', {
            href: buildQueueTaskHref(task.task_id),
            onClick: (event) => {
              event.preventDefault();
              updateQueueSelection(task.task_id);
            },
            children: jsx('strong', { children: task.title || task.task_id }),
          }),
          jsx('div', { className: 'task-list-meta', children: task.task_id }),
          isIntakeDraft(task)
            ? jsxs('div', {
              className: 'task-list-meta',
              children: [
                jsx('span', { className: 'routing-badge routing-badge--intake', children: 'Intake Draft' }),
                ' ',
                task.next_required_action || 'PM refinement required',
              ],
            })
            : null,
          task.project
            ? jsx('div', {
              className: 'task-list-meta',
              children: jsx('a', {
                href: task.project.href || `/projects/${encodeURIComponent(task.project.projectId)}`,
                onClick: (event) => {
                  event.preventDefault();
                  onNavigate(`/projects/${encodeURIComponent(task.project.projectId)}`);
                },
                children: task.project.name,
              }),
            })
            : null,
          assignedToMe
            ? jsx('div', {
              className: 'task-list-meta',
              children: jsx('span', { className: 'routing-badge', children: 'Assigned to me' }),
            })
            : null,
        ],
      }),
      jsx('td', { children: task.current_stage || '—' }),
      jsx('td', { children: task.priority || '—' }),
      jsx('td', { children: task.project?.name || '—' }),
      jsx('td', { children: formatTaskFreshnessLabel(task) }),
      jsxs('td', {
        children: [
          jsx('span', { className: `owner-badge owner-badge--${owner.tone}`, children: owner.label }),
          jsx('div', { className: 'task-list-meta', children: 'Read-only owner metadata' }),
        ],
      }),
    ],
  }, task.task_id);
}

export function CommandCenterGroupedQueue({ ctx, tasks, selectedTaskId, buildQueueTaskHref, updateQueueSelection }) {
  const sections = buildCommandCenterQueueSections(tasks, ctx.j);

  return jsx('div', {
    className: 'command-center-queue command-center-queue--grouped',
    children: sections.map((section) => jsxs('section', {
      className: `command-center-queue__section command-center-queue__section--${section.tone}`,
      'aria-label': section.label,
      children: [
        jsxs('div', {
          className: 'command-center-queue__section-header',
          children: [
            jsx('h3', { children: section.label }),
            jsx('span', { className: 'command-center-queue__section-count', children: section.items.length }),
          ],
        }),
        section.items.length
          ? jsx('div', {
            className: 'task-list-table-wrap',
            children: jsxs('table', {
              className: 'task-list-table',
              children: [
                jsx('thead', {
                  children: jsxs('tr', {
                    children: [
                      jsx('th', { scope: 'col', children: 'Task' }),
                      jsx('th', { scope: 'col', children: 'Stage' }),
                      jsx('th', { scope: 'col', children: 'Priority' }),
                      jsx('th', { scope: 'col', children: 'Project' }),
                      jsx('th', { scope: 'col', children: 'Last updated' }),
                      jsx('th', { scope: 'col', children: 'Owner' }),
                    ],
                  }),
                }),
                jsx('tbody', {
                  children: section.items.map((task) => jsx(QueueTaskRow, {
                    task,
                    selectedTaskId,
                    buildQueueTaskHref,
                    updateQueueSelection,
                    ownerLookup: ctx.j,
                    searchTerm: ctx.N.searchTerm,
                    sessionClaims: ctx.h,
                    isIntakeDraft: ctx.Pt,
                    matchesTaskSearch: ctx.Mn,
                    isTaskAssignedToCurrentActor: ctx.Qa,
                    resolveOwnerPresentation: ctx.Li,
                    onNavigate: ctx.l,
                  }, task.task_id)),
                }),
              ],
            }),
          })
          : jsx('p', {
            className: 'command-center-queue__empty',
            children: `No tasks in ${section.label.toLowerCase()}.`,
          }),
      ],
    }, section.key)),
  });
}