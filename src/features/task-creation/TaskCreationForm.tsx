import React from 'react';
import { Button } from '../../components/Button';
import styles from './TaskCreationForm.module.css';
import type { TaskCreatePayload } from './schema';
import { validateTaskCreatePayload } from './schema';

export interface TaskCreationFormProps {
  onSubmit: (data: TaskCreatePayload) => Promise<void>;
  loading?: boolean;
  error?: string;
}

export function TaskCreationForm({ onSubmit, loading, error }: TaskCreationFormProps) {
  const [validationErrors, setValidationErrors] = React.useState<string[]>([]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const data: TaskCreatePayload = {
      title: formData.get('title') as string,
      business_context: formData.get('business_context') as string,
      acceptance_criteria: formData.get('acceptance_criteria') as string,
      definition_of_done: formData.get('definition_of_done') as string,
      priority: formData.get('priority') as string as TaskCreatePayload['priority'],
      task_type: formData.get('task_type') as string as TaskCreatePayload['task_type'],
    };

    const validation = validateTaskCreatePayload(data);
    if (!validation.valid) {
      setValidationErrors(validation.errors);
      return;
    }

    setValidationErrors([]);
    await onSubmit(data);
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.field}>
        <label htmlFor="title">Title *</label>
        <input id="title" name="title" required placeholder="Clear, concise task title" />
      </div>

      <div className={styles.field}>
        <label htmlFor="business_context">Business Context *</label>
        <textarea id="business_context" name="business_context" required placeholder="Why is this work needed? What is the intended outcome?" />
      </div>

      <div className={styles.field}>
        <label htmlFor="acceptance_criteria">Acceptance Criteria *</label>
        <textarea id="acceptance_criteria" name="acceptance_criteria" required placeholder="Given... When... Then..." />
      </div>

      <div className={styles.field}>
        <label htmlFor="definition_of_done">Definition of Done *</label>
        <textarea id="definition_of_done" name="definition_of_done" required placeholder="What specifically marks this task as 100% complete?" />
      </div>

      <div className={styles.row}>
        <div className={styles.field}>
          <label htmlFor="priority">Priority *</label>
          <select id="priority" name="priority" required>
            <option value="">Select priority</option>
            <option value="Low">Low</option>
            <option value="Medium">Medium</option>
            <option value="High">High</option>
            <option value="Critical">Critical</option>
          </select>
        </div>

        <div className={styles.field}>
          <label htmlFor="task_type">Task Type *</label>
          <select id="task_type" name="task_type" required>
            <option value="">Select type</option>
            <option value="Feature">Feature</option>
            <option value="Bug">Bug</option>
            <option value="Refactor">Refactor</option>
            <option value="Debt">Technical Debt</option>
            <option value="Docs">Documentation</option>
          </select>
        </div>
      </div>

      {validationErrors.length > 0 && (
        <ul className={styles.validationErrors}>
          {validationErrors.map((err, i) => (
            <li key={i}>{err}</li>
          ))}
        </ul>
      )}

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.actions}>
        <Button type="submit" loading={loading}>Create Task</Button>
      </div>
    </form>
  );
}
