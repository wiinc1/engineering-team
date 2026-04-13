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

describe('task assignment local render budget', () => {
  it('renders the assignment-enabled task detail route within a local budget', async () => {
    installTaskAssignmentFetchMock();
    const startedAt = performance.now();
    render(renderTaskAssignmentApp());

    await screen.findByRole('heading', { name: /wire task detail/i });
    await waitFor(() => expect(screen.getByRole('button', { name: /save owner/i })).toBeInTheDocument());

    const durationMs = performance.now() - startedAt;
    expect(durationMs).toBeLessThan(1000);
  });
});
