import React from 'react';
import { Button } from '../../components/Button';
import styles from './TaskCreationForm.module.css';

const INTAKE_DRAFT_TITLE_MAX_LENGTH = 120;

type TaskCreatePayload = {
  raw_requirements: string;
  title?: string;
};

function validateTaskCreatePayload(data: TaskCreatePayload) {
  const errors: string[] = [];

  if (typeof data.raw_requirements !== 'string' || data.raw_requirements.trim().length === 0) {
    errors.push('raw_requirements is required and must be a non-empty string');
  }
  if (typeof data.title === 'string' && data.title.trim().length > INTAKE_DRAFT_TITLE_MAX_LENGTH) {
    errors.push(`title must be ${INTAKE_DRAFT_TITLE_MAX_LENGTH} characters or fewer`);
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
      raw_requirements: formData.get('raw_requirements') as string,
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
        <label htmlFor="raw_requirements">Raw requirements *</label>
        <textarea
          id="raw_requirements"
          name="raw_requirements"
          required
          placeholder="Paste the operator requirements exactly as received."
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="title">Title</label>
        <input id="title" name="title" maxLength={INTAKE_DRAFT_TITLE_MAX_LENGTH} placeholder="Untitled intake draft" />
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
        <Button type="submit" loading={loading}>Create Intake Draft</Button>
      </div>
    </form>
  );
}
