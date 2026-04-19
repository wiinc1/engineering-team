import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installOrchestrationVisibilityFetchMock, renderOrchestrationVisibilityApp } from '../ui/orchestration-visibility-harness';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/');
});

describe('orchestration visibility visual baseline', () => {
  it('matches the orchestration visibility panel snapshot in the active state', async () => {
    installOrchestrationVisibilityFetchMock();
    const { container } = render(renderOrchestrationVisibilityApp());

    await screen.findByRole('heading', { name: /wire task detail/i });
    await screen.findByRole('heading', { name: /orchestration visibility/i });

    expect(container.querySelector('[aria-label="Orchestration visibility"]')).toMatchSnapshot();
  });
});
