import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TaskCreationPage } from '../../src/features/task-creation/TaskCreationPage';

function response(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

describe('TaskCreationPage', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the created Intake Draft status and PM refinement next step', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response(
          {
            taskId: 'TSK-INTAKE',
            status: 'DRAFT',
            intakeDraft: true,
            nextRequiredAction: 'PM refinement required',
          },
          201,
        ),
      ),
    );

    render(<TaskCreationPage sessionConfig={{ bearerToken: 'token' }} envApiBaseUrl="" />);

    fireEvent.change(screen.getByLabelText(/requirements/i), {
      target: { value: 'Raw operator request that needs PM shaping.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create task draft/i }));

    await screen.findByRole('status');
    expect(screen.getByText(/TSK-INTAKE is ready for PM refinement/i)).toBeInTheDocument();
    expect(screen.getByText(/Status: DRAFT. Next step: PM refinement required./i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('status')).toHaveFocus());
    expect(screen.getByRole('link', { name: /open task detail/i })).toHaveAttribute(
      'href',
      '/tasks/TSK-INTAKE?created=intake-draft',
    );
    expect(screen.getByRole('link', { name: /view task workspace/i })).toHaveAttribute('href', '/tasks?view=board');
    expect(screen.getByRole('button', { name: /create another task/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create task draft/i })).not.toBeInTheDocument();
  });

  it('keeps the routed success state local instead of calling the legacy navigation callback', async () => {
    const onTaskCreated = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response(
          {
            taskId: 'TSK-INTAKE',
            status: 'DRAFT',
            nextRequiredAction: 'PM refinement required',
          },
          201,
        ),
      ),
    );

    render(
      <TaskCreationPage sessionConfig={{ bearerToken: 'token' }} envApiBaseUrl="" onTaskCreated={onTaskCreated} />,
    );

    fireEvent.change(screen.getByLabelText(/requirements/i), {
      target: { value: 'Raw operator request that should not navigate.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create task draft/i }));

    await screen.findByRole('status');
    expect(onTaskCreated).not.toHaveBeenCalled();
  });

  it('keeps the operator input visible when creation fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ error: { message: 'Tenant or user not found' } }, 404)));

    render(<TaskCreationPage sessionConfig={{ bearerToken: 'token' }} envApiBaseUrl="" />);

    fireEvent.change(screen.getByLabelText(/requirements/i), {
      target: { value: 'Do not lose this raw request.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create task draft/i }));

    await waitFor(() => expect(screen.getByText(/Tenant or user not found/i)).toBeInTheDocument());
    expect(screen.getByLabelText(/requirements/i)).toHaveValue('Do not lose this raw request.');
  });

  it('resets the form when the operator chooses to create another task', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response(
          {
            taskId: 'TSK-INTAKE',
            status: 'DRAFT',
            nextRequiredAction: 'PM refinement required',
          },
          201,
        ),
      ),
    );

    render(<TaskCreationPage sessionConfig={{ bearerToken: 'token' }} envApiBaseUrl="" />);

    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: 'Keep the workspace clear' },
    });
    fireEvent.change(screen.getByLabelText(/requirements/i), {
      target: { value: 'Raw operator request that should clear after success.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create task draft/i }));

    await screen.findByRole('status');
    fireEvent.click(screen.getByRole('button', { name: /create another task/i }));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/title/i)).toHaveValue('');
    expect(screen.getByLabelText(/requirements/i)).toHaveValue('');
  });
});
