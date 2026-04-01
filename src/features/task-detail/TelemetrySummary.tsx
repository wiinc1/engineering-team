import React from 'react';
import styles from './TelemetrySummary.module.css';
import type { TelemetrySummaryCard } from './types';

export interface TelemetrySummaryProps {
  cards: TelemetrySummaryCard[];
}

export function TelemetrySummary({ cards }: TelemetrySummaryProps) {
  return (
    <section className={styles.grid} aria-label="Telemetry summary">
      {cards.map((card) => (
        <article key={card.id} className={`${styles.card} ${card.tone ? styles[`tone_${card.tone}`] : ''}`.trim()}>
          <p className={styles.label}>{card.label}</p>
          <p className={styles.value}>{card.value}</p>
          {card.hint ? <p className={styles.hint}>{card.hint}</p> : null}
        </article>
      ))}
    </section>
  );
}
