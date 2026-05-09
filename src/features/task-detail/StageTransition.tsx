import { type FormEvent, useId, useRef, useState } from 'react';
import styles from './StageTransition.module.css';

type StageTransitionPayload = {
  rationale?: string;
  agreement_artifact?: string;
};

type StageTransitionProps = {
  currentStage: string;
  onTransition: (targetStage: string, payload: StageTransitionPayload) => Promise<void> | void;
  taskId?: string;
};

type FieldName = 'targetStage' | 'agreementArtifact' | 'rationale';

type FieldErrors = Partial<Record<FieldName, string>>;

function idSegment(value: string | undefined) {
  return String(value || 'task').replace(/[^A-Za-z0-9_-]+/g, '-');
}

function validateTransition(currentStage: string, targetStage: string, agreementArtifact: string, rationale: string): FieldErrors {
  const errors: FieldErrors = {};

  if (!targetStage.trim()) {
    errors.targetStage = 'Target stage is required.';
  }

  if (currentStage === 'DONE') {
    if (!agreementArtifact.trim()) {
      errors.agreementArtifact = 'Agreement artifact is required when moving backward from DONE.';
    }
    if (!rationale.trim()) {
      errors.rationale = 'Rationale is required when moving backward from DONE.';
    }
  }

  return errors;
}

function firstInvalidField(errors: FieldErrors): FieldName | null {
  return (['targetStage', 'agreementArtifact', 'rationale'] as FieldName[]).find((field) => errors[field]) ?? null;
}

function describedBy(ids: Array<string | null | false>) {
  return ids.filter(Boolean).join(' ') || undefined;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) {
    return null;
  }

  return (
    <p id={id} className={styles.fieldError} role="alert">
      {message}
    </p>
  );
}

export function StageTransition({ currentStage, onTransition, taskId }: StageTransitionProps) {
  const reactId = useId().replace(/[^A-Za-z0-9_-]+/g, '');
  const idBase = `stage-transition-${idSegment(taskId)}-${reactId}`;
  const targetStageId = `${idBase}-target-stage`;
  const agreementArtifactId = `${idBase}-agreement-artifact`;
  const rationaleId = `${idBase}-rationale`;

  const targetStageRef = useRef<HTMLInputElement | null>(null);
  const agreementArtifactRef = useRef<HTMLInputElement | null>(null);
  const rationaleRef = useRef<HTMLTextAreaElement | null>(null);
  const [targetStage, setTargetStage] = useState('');
  const [rationale, setRationale] = useState('');
  const [agreementArtifact, setAgreementArtifact] = useState('');
  const [statusError, setStatusError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const focusField = (field: FieldName | null) => {
    if (field === 'targetStage') targetStageRef.current?.focus();
    if (field === 'agreementArtifact') agreementArtifactRef.current?.focus();
    if (field === 'rationale') rationaleRef.current?.focus();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatusError(null);

    const nextErrors = validateTransition(currentStage, targetStage, agreementArtifact, rationale);
    setFieldErrors(nextErrors);
    const invalidField = firstInvalidField(nextErrors);

    if (invalidField) {
      focusField(invalidField);
      return;
    }

    setSubmitting(true);
    try {
      const payload: StageTransitionPayload = {};
      if (currentStage === 'DONE') {
        payload.rationale = rationale.trim();
        payload.agreement_artifact = agreementArtifact.trim();
      }
      await onTransition(targetStage.trim(), payload);
      setTargetStage('');
      setRationale('');
      setAgreementArtifact('');
      setFieldErrors({});
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : 'Transition failed');
    } finally {
      setSubmitting(false);
    }
  };

  const validationMessages = Object.values(fieldErrors).filter((message): message is string => Boolean(message));
  const summaryId = `${idBase}-validation-summary`;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.title}>Workflow Transition</span>
        <span className={styles.currentStage}>{currentStage}</span>
      </div>
      <form
        className={styles.form}
        onSubmit={handleSubmit}
        aria-describedby={describedBy([validationMessages.length > 1 && summaryId])}
      >
        <div className={styles.field}>
          <label className={styles.label} htmlFor={targetStageId}>
            Target Stage
          </label>
          <input
            ref={targetStageRef}
            id={targetStageId}
            name="target_stage"
            className={styles.input}
            value={targetStage}
            onChange={(event) => setTargetStage(event.target.value)}
            placeholder="e.g. TECHNICAL_SPEC"
            aria-invalid={fieldErrors.targetStage ? true : undefined}
            aria-describedby={describedBy([fieldErrors.targetStage && `${targetStageId}-error`])}
          />
          <FieldError id={`${targetStageId}-error`} message={fieldErrors.targetStage} />
        </div>
        {currentStage === 'DONE' && (
          <div className={styles.specialForm}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor={agreementArtifactId}>
                Agreement Artifact (ID/Link)
              </label>
              <input
                ref={agreementArtifactRef}
                id={agreementArtifactId}
                name="agreement_artifact"
                className={styles.input}
                value={agreementArtifact}
                onChange={(event) => setAgreementArtifact(event.target.value)}
                placeholder="Required for backward move from DONE"
                aria-invalid={fieldErrors.agreementArtifact ? true : undefined}
                aria-describedby={describedBy([fieldErrors.agreementArtifact && `${agreementArtifactId}-error`])}
              />
              <FieldError id={`${agreementArtifactId}-error`} message={fieldErrors.agreementArtifact} />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor={rationaleId}>
                Rationale
              </label>
              <textarea
                ref={rationaleRef}
                id={rationaleId}
                name="rationale"
                className={styles.input}
                value={rationale}
                onChange={(event) => setRationale(event.target.value)}
                placeholder="Why is this backward transition needed?"
                aria-invalid={fieldErrors.rationale ? true : undefined}
                aria-describedby={describedBy([fieldErrors.rationale && `${rationaleId}-error`])}
              />
              <FieldError id={`${rationaleId}-error`} message={fieldErrors.rationale} />
            </div>
          </div>
        )}
        {validationMessages.length > 1 ? (
          <div id={summaryId} className={styles.validationSummary} role="alert">
            <p className={styles.validationSummaryTitle}>Review these fields:</p>
            <ul>
              {validationMessages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className={styles.actions}>
          <button type="submit" disabled={submitting}>
            {submitting ? 'Transitioning...' : 'Advance Stage'}
          </button>
        </div>
        {statusError ? (
          <div className={styles.error} role="alert">
            {statusError}
          </div>
        ) : null}
      </form>
    </div>
  );
}
