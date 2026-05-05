import React from 'react';
import { TaskCreationForm } from './TaskCreationForm';
import { buildAuthHeaders } from '../../app/session.browser';

function resolveApiBaseUrl(config: { apiBaseUrl?: string } = {}, envApiBaseUrl = '') {
  return (typeof config?.apiBaseUrl === 'string' && config.apiBaseUrl.trim()) || envApiBaseUrl.trim() || '';
}

export function TaskCreationPage({ sessionConfig, envApiBaseUrl, onTaskCreated }) {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [createdTask, setCreatedTask] = React.useState<null | {
    taskId: string | null;
    status: string;
    nextRequiredAction: string;
  }>(null);

  const client = React.useMemo(() => {
    const baseUrl = resolveApiBaseUrl(sessionConfig, envApiBaseUrl);
    return {
      async createTask(data: unknown) {
        const response = await window.fetch(`${baseUrl}/tasks`, {
          method: 'POST',
          headers: {
            ...buildAuthHeaders(sessionConfig),
            'content-type': 'application/json',
          },
          body: JSON.stringify(data),
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error((payload as { error?: { message?: string } })?.error?.message || 'Failed to create task');
        }

        return payload;
      },
    };
  }, [sessionConfig, envApiBaseUrl]);

  const handleSubmit = async (data) => {
    setLoading(true);
    setError(null);
    try {
      const result = await client.createTask(data);
      const taskId = result?.taskId || result?.data?.taskId || null;
      setCreatedTask({
        taskId,
        status: result?.status || result?.data?.status || 'DRAFT',
        nextRequiredAction:
          result?.nextRequiredAction || result?.data?.nextRequiredAction || 'PM refinement required',
      });
      if (onTaskCreated) onTaskCreated(result);
    } catch (err) {
      setError(err.message || 'Failed to create task');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="task-create-page" aria-labelledby="task-create-title">
      <div className="task-create-page__header">
        <p className="eyebrow">New task</p>
        <h1 id="task-create-title">Add a new task</h1>
        <p className="lede">
          Paste the raw request here to create a PM intake draft and route it into the task workflow.
        </p>
      </div>
      {createdTask ? (
        <section className="task-create-page__success" role="status" aria-live="polite">
          <div>
            <p className="eyebrow">Intake Draft created</p>
            <h2>{createdTask.taskId || 'New task'} is ready for PM refinement</h2>
            <p>
              Status: {createdTask.status}. Next step: {createdTask.nextRequiredAction}.
            </p>
          </div>
          {createdTask.taskId ? (
            <a href={`/tasks/${encodeURIComponent(createdTask.taskId)}`}>Open task detail</a>
          ) : null}
        </section>
      ) : null}
      <TaskCreationForm onSubmit={handleSubmit} loading={loading} error={error} />
    </section>
  );
}
