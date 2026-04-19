import React from 'react';
import axe from 'axe-core';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installOrchestrationVisibilityFetchMock, renderOrchestrationVisibilityApp } from '../ui/orchestration-visibility-harness';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/');
});

describe('orchestration visibility accessibility', () => {
  it('passes an axe smoke scan for the orchestration visibility surface', async () => {
    installOrchestrationVisibilityFetchMock();
    const { container } = render(renderOrchestrationVisibilityApp());

    await screen.findByRole('heading', { name: /wire task detail/i });
    await screen.findByRole('heading', { name: /orchestration visibility/i });
    expect(screen.getByRole('table', { name: /orchestrated child work items/i })).toBeInTheDocument();

    const results = await axe.run(container, {
      rules: {
        region: { enabled: false },
        'color-contrast': { enabled: false },
      },
    });

    expect(results.violations).toEqual([]);
  });
});
