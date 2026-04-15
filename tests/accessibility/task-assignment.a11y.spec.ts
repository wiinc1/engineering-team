import React from 'react';
import axe from 'axe-core';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installTaskAssignmentFetchMock, renderTaskAssignmentApp } from '../ui/task-assignment-harness';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/');
});

describe('task assignment accessibility', () => {
  it('passes an axe smoke scan for the task assignment flow', async () => {
    installTaskAssignmentFetchMock();
    const { container } = render(renderTaskAssignmentApp());

    await screen.findByRole('heading', { name: /wire task detail/i });
    await waitFor(() => expect(screen.getByRole('button', { name: /save owner/i })).toBeInTheDocument());
    expect(screen.getByLabelText(/owner/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /assignment/i })).toBeInTheDocument();

    const results = await axe.run(container, {
      rules: {
        region: { enabled: false },
        'color-contrast': { enabled: false },
      },
    });

    expect(results.violations).toEqual([]);
  });
});
