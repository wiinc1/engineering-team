import React from 'react';
import styles from './TaskHistoryTimeline.module.css';
import type { HistoryTimelineItem } from './types';

export interface TaskHistoryTimelineProps {
  items: HistoryTimelineItem[];
}

export function TaskHistoryTimeline({ items }: TaskHistoryTimelineProps) {
  return (
    <ol className={styles.timeline} aria-label="Task history timeline">
      {items.map((item) => (
        <li key={item.id} className={styles.item}>
          <div className={styles.rail} aria-hidden="true">
            <span className={`${styles.dot} ${item.statusTone ? styles[`tone_${item.statusTone}`] : ''}`.trim()} />
          </div>
          <article className={styles.card}>
            <header className={styles.header}>
              <div>
                <h3 className={styles.title}>{item.title}</h3>
                <p className={styles.meta}>
                  <span>{item.timestampLabel}</span>
                  {item.actorLabel ? <span>• {item.actorLabel}</span> : null}
                </p>
              </div>
            </header>
            {item.detail ? <p className={styles.detail}>{item.detail}</p> : null}
            {item.metadata?.length ? (
              <dl className={styles.metadata}>
                {item.metadata.map((entry) => (
                  <div key={`${item.id}-${entry.label}`} className={styles.metadataItem}>
                    <dt>{entry.label}</dt>
                    <dd>{entry.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </article>
        </li>
      ))}
    </ol>
  );
}
