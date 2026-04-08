import React from 'react';
import { Button } from '../../components/Button';
import styles from './TaskCreationForm.module.css';

type TaskCreatePayload = {
  title: string;
  business_context: string;
  acceptance_criteria: string;
  definition_of_done: string;
  priority: string;
  task_type: string;
};

const VALID_PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];
const VALID_TASK_TYPES = ['Feature', 'Bug', 'Refactor', 'Debt', 'Docs'];

function validateTaskCreatePayload(data: TaskCreatePayload) {
  const errors: string[] = [];

  if (typeof data.title !== 'string' || data.title.trim().length === 0) {
    errors.push('title is required and must be a non-empty string');
  }
  if (typeof data.business_context !== 'string' || data.business_context.trim().length === 0) {
    errors.push('business_context is required and must be a non-empty string');
  }
  if (typeof data.acceptance_criteria !== 'string' || data.acceptance_criteria.trim().length === 0) {
    errors.push('acceptance_criteria is required and must be a non-empty string');
  }
  if (typeof data.definition_of_done !== 'string' || data.definition_of_done.trim().length === 0) {
    errors.push('definition_of_done is required and must be a non-empty string');
  }
  if (!VALID_PRIORITIES.includes(data.priority)) {
    errors.push(`priority must be one of: ${VALID_PRIORITIES.join(', ')}, got: ${String(data.priority)}`);
  }
  if (!VALID_TASK_TYPES.includes(data.task_type)) {
    errors.push(`task_type must be one of: ${VALID_TASK_TYPES.join(', ')}, got: ${String(data.task_type)}`);
  }

  return { valid: errors.length === 0, errors };
}

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
