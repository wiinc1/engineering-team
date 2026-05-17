import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveTaskFreshnessIndicator } from '../../src/app/live-task-freshness';

afterEach(() => {
  cleanup();
});

describe('live task freshness visual states', () => {
  it('renders compact state variants for rollout and fallback states', () => {
    const states = ['fresh', 'stale', 'reconnecting', 'degraded', 'disabled', 'polling'];
    const { container } = render(
      <div>
        {states.map(status => (
          <LiveTaskFreshnessIndicator
            key={status}
            state={{ status, message: `${status} state` }}
            onManualRefresh={vi.fn()}
            showDisabled
          />
        ))}
      </div>,
    );

    expect([...container.querySelectorAll('.live-freshness')].map(node => ({
      className: node.className,
      text: node.textContent,
    }))).toMatchInlineSnapshot(`
      [
        {
          "className": "live-freshness live-freshness--fresh",
          "text": "Freshfresh stateRefresh now",
        },
        {
          "className": "live-freshness live-freshness--stale",
          "text": "Stalestale stateRefresh now",
        },
        {
          "className": "live-freshness live-freshness--reconnecting",
          "text": "Reconnectingreconnecting stateRefresh now",
        },
        {
          "className": "live-freshness live-freshness--degraded",
          "text": "Degradeddegraded stateRefresh now",
        },
        {
          "className": "live-freshness live-freshness--disabled",
          "text": "Manual refreshdisabled stateRefresh now",
        },
        {
          "className": "live-freshness live-freshness--polling",
          "text": "Pollingpolling stateRefresh now",
        },
      ]
    `);
  });
});
