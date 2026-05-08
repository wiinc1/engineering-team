import React from 'react';
import { TaskCreationForm } from './TaskCreationForm';
import { buildAuthHeaders } from '../../app/session.browser';

type CreatedTaskSummary = {
  taskId: string | null;
  title: string;
  status: string;
  nextRequiredAction: string;
  rawRequirements: string;
};

type TaskCreationPageProps = {
  sessionConfig?: { apiBaseUrl?: string };
  envApiBaseUrl?: string;
  onTaskCreated?: (result: unknown) => void;
};

function resolveApiBaseUrl(config: { apiBaseUrl?: string } = {}, envApiBaseUrl = '') {
  return (typeof config?.apiBaseUrl === 'string' && config.apiBaseUrl.trim()) || envApiBaseUrl.trim() || '';
}

function normalizeCreatedTask(result: any, request: any): CreatedTaskSummary {
  const requestTitle = typeof request?.title === 'string' ? request.title.trim() : '';
  const rawRequirements = typeof request?.raw_requirements === 'string' ? request.raw_requirements : '';

  return {
    taskId: result?.taskId || result?.data?.taskId || null,
    title: result?.title || result?.data?.title || requestTitle || 'Untitled intake draft',
    status: result?.status || result?.data?.status || 'DRAFT',
    nextRequiredAction: result?.nextRequiredAction || result?.data?.nextRequiredAction || 'PM refinement required',
    rawRequirements,
  };
}

function useTaskCreationClient(sessionConfig: TaskCreationPageProps['sessionConfig'], envApiBaseUrl = '') {
  return React.useMemo(() => {
    const baseUrl = resolveApiBaseUrl(sessionConfig, envApiBaseUrl);
    return {
      async createTask(data: unknown) {
        const response = await window.fetch(`${baseUrl}/tasks`, {
          method: 'POST',
          headers: { ...buildAuthHeaders(sessionConfig), 'content-type': 'application/json' },
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
}

function TaskCreateHeader() {
  return (
    <div className="task-create-page__header">
      <p className="eyebrow">New task</p>
      <h1 id="task-create-title">Add a new task</h1>
      <p className="lede">Paste the raw request here to create a PM intake draft and route it into the task workflow.</p>
    </div>
  );
}

function CreatedTaskDetails({ createdTask }: { createdTask: CreatedTaskSummary }) {
  return (
    <div className="task-create-page__intake-summary">
      <h3>{createdTask.title}</h3>
      <dl>
        <div>
          <dt>Stage</dt>
          <dd>Intake Draft</dd>
        </div>
        <div>
          <dt>Next step</dt>
          <dd>{createdTask.nextRequiredAction}</dd>
        </div>
      </dl>
      {createdTask.rawRequirements ? (
        <div>
          <h4>Operator intake requirements</h4>
          <p>{createdTask.rawRequirements}</p>
        </div>
      ) : null}
    </div>
  );
}

function CreatedTaskSuccess({
  createdTask,
  onCreateAnother,
}: {
  createdTask: CreatedTaskSummary;
  onCreateAnother: () => void;
}) {
  const successRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    successRef.current?.focus();
  }, []);

  return (
    <section ref={successRef} className="task-create-page__success" role="status" aria-live="polite" tabIndex={-1}>
      <div>
        <p className="eyebrow">Intake Draft created</p>
        <h2>{createdTask.taskId || 'New task'} is ready for PM refinement</h2>
        <p>
          Status: {createdTask.status}. Next step: {createdTask.nextRequiredAction}.
        </p>
        <CreatedTaskDetails createdTask={createdTask} />
      </div>
      <div className="task-create-page__success-actions">
        {createdTask.taskId ? (
          <a href={`/tasks/${encodeURIComponent(createdTask.taskId)}?created=intake-draft`}>Open task detail</a>
        ) : null}
        <a href="/tasks?view=board">View task workspace</a>
        <button type="button" className="button-secondary" onClick={onCreateAnother}>
          Create another task
        </button>
      </div>
    </section>
  );
}

export function TaskCreationPage({ sessionConfig, envApiBaseUrl }: TaskCreationPageProps) {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [formVersion, setFormVersion] = React.useState(0);
  const [createdTask, setCreatedTask] = React.useState<null | CreatedTaskSummary>(null);
  const client = useTaskCreationClient(sessionConfig, envApiBaseUrl);

  const handleSubmit = async (data: unknown) => {
    setLoading(true);
    setError(null);
    try {
      const result = await client.createTask(data);
      setCreatedTask(normalizeCreatedTask(result, data));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAnother = () => {
    setCreatedTask(null);
    setError(null);
    setFormVersion((version) => version + 1);
  };

  return (
    <section className="task-create-page" aria-labelledby="task-create-title">
      <TaskCreateHeader />
      {createdTask ? <CreatedTaskSuccess createdTask={createdTask} onCreateAnother={handleCreateAnother} /> : null}
      {createdTask ? null : (
        <TaskCreationForm onSubmit={handleSubmit} loading={loading} error={error} resetToken={formVersion} />
      )}
    </section>
  );
}
