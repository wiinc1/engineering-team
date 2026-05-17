import React from 'react';
import axe from 'axe-core';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveTaskFreshnessIndicator } from '../../src/app/live-task-freshness';

afterEach(() => {
  cleanup();
});

describe('live task freshness accessibility', () => {
  it('uses a polite live region and keyboard-accessible manual refresh control', async () => {
    const refresh = vi.fn();
    const { container } = render(
      <LiveTaskFreshnessIndicator
        state={{ status: 'stale', message: 'Updates are delayed. Manual refresh remains available.' }}
        onManualRefresh={refresh}
      />,
    );

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('Updates are delayed');
    screen.getByRole('button', { name: /refresh now/i }).click();
    expect(refresh).toHaveBeenCalledTimes(1);

    const results = await axe.run(container, {
      rules: {
        'color-contrast': { enabled: false },
      },
    });
    expect(results.violations).toEqual([]);
  });
});
