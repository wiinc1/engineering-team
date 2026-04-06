import React, { useState } from 'react';
import styles from './StageTransition.module.css';

export function StageTransition({ 
  currentStage, 
  onTransition, 
  taskId 
}: { 
  currentStage: string; 
  onTransition: (toStage: string, payload: any) => Promise<void>;
  taskId: string;
}) {
  const [toStage, setToStage] = useState('');
  const [rationale, setRationale] = useState('');
  const [artifact, setArtifact] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!toStage) return;

    setLoading(true);
    try {
      const payload: any = {};
      if (currentStage === 'DONE') {
        payload.rationale = rationale;
        payload.agreement_artifact = artifact;
      }
      await onTransition(toStage, payload);
      setToStage('');
      setRationale('');
      setArtifact('');
    } catch (err: any) {
      setError(err.message || 'Transition failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.title}>Workflow Transition</span>
        <span className={styles.currentStage}>{currentStage}</span>
      </div>

      <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.field}>
          <label className={styles.label}>Target Stage</label>
          <input 
            className={styles.input} 
            value={toStage} 
            onChange={(e) => setToStage(e.target.value)} 
            placeholder="e.g. TECHNICAL_SPEC"
          />
        </div>

        {currentStage === 'DONE' && (
          <div className={styles.specialForm}>
            <div className={styles.field}>
              <label className={styles.label}>Agreement Artifact (ID/Link)</label>
              <input 
                className={styles.input} 
                value={artifact} 
                onChange={(e) => setArtifact(e.target.value)} 
                placeholder="Required for backward move from DONE"
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Rationale</label>
              <textarea 
                className={styles.input} 
                value={rationale} 
                onChange={(e) => setRationale(e.target.value)} 
                placeholder="Why is this backward transition needed?"
              />
            </div>
          </div>
        )}

        <div className={styles.actions}>
          <button type="submit" disabled={loading}>
            {loading ? 'Transitioning...' : 'Advance Stage'}
          </button>
        </div>

        {error && <div className={styles.error}>{error}</div>}
      </form>
    </div>
  );
}
