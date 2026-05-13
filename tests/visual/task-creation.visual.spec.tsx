import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

describe('task creation visual baseline', () => {
  it('matches the title-first dark form state', () => {
    installTaskCreationFetch();
    const { container } = render(<TaskCreationPage sessionConfig={{ bearerToken: 'token' }} envApiBaseUrl="" />);

    expect(screen.getByRole('heading', { name: 'Add a new task' })).toBeInTheDocument();
    expect(container.querySelector('.task-create-page')).toMatchSnapshot();
  });

  it('matches the validation error state', async () => {
    installTaskCreationFetch();
    const { container } = render(<TaskCreationPage sessionConfig={{ bearerToken: 'token' }} envApiBaseUrl="" />);

    fireEvent.change(screen.getByLabelText(/requirements/i), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create task draft' }));
    await screen.findByText('Requirements are required.');

    expect(container.querySelector('.task-create-page')).toMatchSnapshot();
  });

  it('matches the dark success state with the created title first', async () => {
    installTaskCreationFetch();
    const { container } = render(<TaskCreationPage sessionConfig={{ bearerToken: 'token' }} envApiBaseUrl="" />);

    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Dark title-first intake' } });
    fireEvent.change(screen.getByLabelText(/requirements/i), {
      target: { value: 'Raw operator request from the visual baseline.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create task draft' }));
    await screen.findByRole('heading', { name: 'Dark title-first intake' });

    expect(container.querySelector('.task-create-page')).toMatchSnapshot();
  });
});
