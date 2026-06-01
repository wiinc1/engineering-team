import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installTaskAssignmentFetchMock, renderTaskAssignmentApp } from '../ui/task-assignment-harness';
import { installTaskDetailNextActionFetchMock, renderTaskDetailNextActionApp, taskDetailNextActionPayload } from '../ui/task-detail-next-action-harness';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/');
});

describe('task assignment visual baseline', () => {
  it('matches the assignment panel snapshot in the ready state', async () => {
    installTaskAssignmentFetchMock();
    const { container } = render(renderTaskAssignmentApp());

    await screen.findByRole('heading', { name: /wire task detail/i });
    await waitFor(() => expect(screen.getByRole('button', { name: /save owner/i })).toBeInTheDocument());

    expect(container.querySelector('.assignment-panel')).toMatchSnapshot();
  });

  it('matches the role-specific next-action panel snapshot', async () => {
    installTaskDetailNextActionFetchMock(taskDetailNextActionPayload({ stage: 'DRAFT', intakeDraft: true, nextAction: 'PM refinement required' }));
    const { container } = render(renderTaskDetailNextActionApp(['pm', 'reader']));

    await screen.findByRole('heading', { name: /role-specific next action/i });
    await screen.findByRole('button', { name: /retry pm refinement/i });

    expect(container.querySelector('.task-next-action')).toMatchSnapshot();
  });
});
