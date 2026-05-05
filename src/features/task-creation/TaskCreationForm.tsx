import React from 'react';
import { Button } from '../../components/Button';
import styles from './TaskCreationForm.module.css';

const TITLE_MAX_LENGTH = 120;

type TaskCreationPayload = {
  title: FormDataEntryValue | null;
  raw_requirements: FormDataEntryValue | null;
};

type ValidationResult = {
  valid: boolean;
  errors: string[];
};

type TaskCreationFormProps = {
  onSubmit: (payload: TaskCreationPayload) => Promise<void>;
  loading: boolean;
  error?: string | null;
  resetToken?: number;
};

function validatePayload(payload: TaskCreationPayload): ValidationResult {
  const errors: string[] = [];

  if (typeof payload.raw_requirements !== 'string' || payload.raw_requirements.trim().length === 0) {
    errors.push('Requirements are required.');
  }

  if (typeof payload.title === 'string' && payload.title.trim().length > TITLE_MAX_LENGTH) {
    errors.push(`title must be ${TITLE_MAX_LENGTH} characters or fewer`);
  }

  return { valid: errors.length === 0, errors };
}

export function TaskCreationForm({ onSubmit, loading, error, resetToken = 0 }: TaskCreationFormProps) {
  const formRef = React.useRef<HTMLFormElement | null>(null);
  const [validationErrors, setValidationErrors] = React.useState<string[]>([]);

  React.useEffect(() => {
    formRef.current?.reset();
    setValidationErrors([]);
  }, [resetToken]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const payload = {
      title: formData.get('title'),
      raw_requirements: formData.get('raw_requirements'),
    };
    const validation = validatePayload(payload);

    if (!validation.valid) {
      setValidationErrors(validation.errors);
      return;
    }

    setValidationErrors([]);
    await onSubmit(payload);
  };

  return (
    <form ref={formRef} className={styles.form} onSubmit={handleSubmit} aria-describedby="task-create-guidance">
      <div className={styles.field}>
        <label htmlFor="raw_requirements">Requirements *</label>
        <textarea
          id="raw_requirements"
          name="raw_requirements"
          required
          disabled={loading}
          placeholder="Paste the request, acceptance notes, links, and context exactly as received."
        />
        <p id="task-create-guidance" className={styles.help}>
          Include the operator request, acceptance notes, links, risks, and any known constraints.
        </p>
      </div>
      <div className={styles.field}>
        <label htmlFor="title">Title</label>
        <input
          id="title"
          name="title"
          maxLength={TITLE_MAX_LENGTH}
          disabled={loading}
          placeholder="Optional short title"
        />
      </div>
      {validationErrors.length > 0 ? (
        <ul className={styles.validationErrors}>
          {validationErrors.map((message, index) => (
            <li key={index}>{message}</li>
          ))}
        </ul>
      ) : null}
      {error ? <p className={styles.error}>{error}</p> : null}
      <div className={styles.actions}>
        <Button type="submit" loading={loading} onClick={undefined}>
          Create task draft
        </Button>
      </div>
    </form>
  );
}
