import React from 'react';
import axe from 'axe-core';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskCreationPage } from '../../src/features/task-creation/TaskCreationPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function installTaskCreationFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({
        taskId: 'TSK-DARK',
        title: 'Dark title-first intake',
        status: 'DRAFT',
        nextRequiredAction: 'PM refinement required',
      }),
    })),
  );
}

describe('task creation accessibility', () => {
  it('passes an axe smoke scan for the title-first dark task creation surface', async () => {
    installTaskCreationFetch();
    const { container } = render(<TaskCreationPage sessionConfig={{ bearerToken: 'token' }} envApiBaseUrl="" />);

    expect(screen.getByRole('heading', { name: 'Add a new task' })).toBeInTheDocument();
    expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/requirements/i)).toBeInTheDocument();

    const results = await axe.run(container, {
      rules: {
        region: { enabled: false },
        'color-contrast': { enabled: false },
      },
    });

    expect(results.violations).toEqual([]);
  });
});
