import React from 'react';
import { Button } from '../../components/Button';
import styles from './TaskCreationForm.module.css';

const TITLE_MAX_LENGTH = 120;

type TaskCreationPayload = {
  title: FormDataEntryValue | null;
  raw_requirements: FormDataEntryValue | null;
};

type ValidationField = 'raw_requirements' | 'title';

type ValidationMessage = {
  field: ValidationField;
  message: string;
};

type ValidationResult = {
  valid: boolean;
  errors: ValidationMessage[];
};

type TaskCreationFormProps = {
  onSubmit: (payload: TaskCreationPayload) => Promise<void>;
  loading: boolean;
  error?: string | null;
  resetToken?: number;
};

function validatePayload(payload: TaskCreationPayload): ValidationResult {
  const errors: ValidationMessage[] = [];

  if (typeof payload.raw_requirements !== 'string' || payload.raw_requirements.trim().length === 0) {
    errors.push({ field: 'raw_requirements', message: 'Requirements are required.' });
  }

  if (typeof payload.title === 'string' && payload.title.trim().length > TITLE_MAX_LENGTH) {
    errors.push({ field: 'title', message: `Title must be ${TITLE_MAX_LENGTH} characters or fewer.` });
  }

  return { valid: errors.length === 0, errors };
}

function findFieldError(errors: ValidationMessage[], field: ValidationField) {
  return errors.find((error) => error.field === field)?.message ?? null;
}

function describedBy(ids: Array<string | null | false>) {
  return ids.filter(Boolean).join(' ') || undefined;
}

function RequirementsField({
  loading,
  error,
  inputRef,
}: {
  loading: boolean;
  error: string | null;
  inputRef: React.Ref<HTMLTextAreaElement>;
}) {
  const errorId = 'raw-requirements-error';

  return (
    <div className={styles.field}>
      <label htmlFor="raw_requirements">Requirements *</label>
      <textarea
        ref={inputRef}
        id="raw_requirements"
        name="raw_requirements"
        required
        disabled={loading}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(['task-create-guidance', error ? errorId : null])}
        placeholder="Paste the request, acceptance notes, links, and context exactly as received."
      />
      <p id="task-create-guidance" className={styles.help}>
        Include the operator request, acceptance notes, links, risks, and any known constraints.
      </p>
      {error ? (
        <p id={errorId} className={styles.fieldError} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function TitleField({
  loading,
  error,
  inputRef,
}: {
  loading: boolean;
  error: string | null;
  inputRef: React.Ref<HTMLInputElement>;
}) {
  const errorId = 'title-error';

  return (
    <div className={styles.field}>
      <label htmlFor="title">Title</label>
      <input
        ref={inputRef}
        id="title"
        name="title"
        maxLength={TITLE_MAX_LENGTH}
        disabled={loading}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy([error ? errorId : null])}
        placeholder="Optional short title"
      />
      {error ? (
        <p id={errorId} className={styles.fieldError} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ValidationSummary({ errors }: { errors: ValidationMessage[] }) {
  if (errors.length < 2) {
    return null;
  }

  return (
    <div id="task-create-validation-summary" className={styles.validationSummary} role="alert">
      <p className={styles.validationSummaryTitle}>Review these fields:</p>
      <ul className={styles.validationErrors}>
        {errors.map((error) => (
          <li key={`${error.field}-${error.message}`}>{error.message}</li>
        ))}
      </ul>
    </div>
  );
}

export function TaskCreationForm({ onSubmit, loading, error, resetToken = 0 }: TaskCreationFormProps) {
  const formRef = React.useRef<HTMLFormElement | null>(null);
  const requirementsRef = React.useRef<HTMLTextAreaElement | null>(null);
  const titleRef = React.useRef<HTMLInputElement | null>(null);
  const [validationErrors, setValidationErrors] = React.useState<ValidationMessage[]>([]);

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
      const firstInvalidField = validation.errors[0]?.field;
      if (firstInvalidField === 'raw_requirements') {
        requirementsRef.current?.focus();
      } else if (firstInvalidField === 'title') {
        titleRef.current?.focus();
      }
      return;
    }

    setValidationErrors([]);
    await onSubmit(payload);
  };

  const requirementsError = findFieldError(validationErrors, 'raw_requirements');
  const titleError = findFieldError(validationErrors, 'title');

  return (
    <form
      ref={formRef}
      className={styles.form}
      onSubmit={handleSubmit}
      aria-describedby={describedBy(['task-create-guidance', validationErrors.length > 1 && 'task-create-validation-summary'])}
    >
      <TitleField loading={loading} error={titleError} inputRef={titleRef} />
      <RequirementsField loading={loading} error={requirementsError} inputRef={requirementsRef} />
      <ValidationSummary errors={validationErrors} />
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.actions}>
        <Button type="submit" loading={loading} onClick={undefined}>
          Create task draft
        </Button>
      </div>
    </form>
  );
}
