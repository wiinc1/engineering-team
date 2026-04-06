import React from 'react';
import { TaskCreationForm } from './TaskCreationForm';
import { createTaskCreationApiClient } from './adapter';
import { buildAuthHeaders } from '../../app/session';
import { resolveApiBaseUrl } from '../../app/session';

export function TaskCreationPage({ sessionConfig, envApiBaseUrl, onTaskCreated }) {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);

  const client = React.useMemo(() => {
    const baseUrl = resolveApiBaseUrl(sessionConfig, envApiBaseUrl);
    return createTaskCreationApiClient({
      baseUrl,
      fetchImpl: (...args) => window.fetch(...args),
      getHeaders: () => buildAuthHeaders(sessionConfig),
    });
  }, [sessionConfig, envApiBaseUrl]);

  const handleSubmit = async (data) => {
    setLoading(true);
    setError(null);
    try {
      await client.createTask(data);
      if (onTaskCreated) onTaskCreated();
    } catch (err) {
      setError(err.message || 'Failed to create task');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '2rem' }}>
      <h1 style={{ textAlign: 'center', marginBottom: '2rem' }}>Create New Task</h1>
      <TaskCreationForm onSubmit={handleSubmit} loading={loading} error={error} />
    </div>
  );
}
