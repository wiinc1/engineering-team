import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installTaskAssignmentFetchMock, renderTaskAssignmentApp } from '../ui/task-assignment-harness';

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
});
