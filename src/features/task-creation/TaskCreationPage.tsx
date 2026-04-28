import React from 'react';
import { TaskCreationForm } from './TaskCreationForm';
import { buildAuthHeaders } from '../../app/session.browser';

function resolveApiBaseUrl(config: { apiBaseUrl?: string } = {}, envApiBaseUrl = '') {
  return (typeof config?.apiBaseUrl === 'string' && config.apiBaseUrl.trim()) || envApiBaseUrl.trim() || '';
}

export function TaskCreationPage({ sessionConfig, envApiBaseUrl, onTaskCreated }) {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);

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
      if (onTaskCreated) onTaskCreated(result);
    } catch (err) {
      setError(err.message || 'Failed to create task');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '2rem' }}>
      <h1 style={{ textAlign: 'center', marginBottom: '2rem' }}>Create Intake Draft</h1>
      <TaskCreationForm onSubmit={handleSubmit} loading={loading} error={error} />
    </div>
  );
}
