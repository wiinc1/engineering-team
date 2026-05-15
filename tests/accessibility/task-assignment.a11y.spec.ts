import React from 'react';
import axe from 'axe-core';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installTaskAssignmentFetchMock, renderTaskAssignmentApp } from '../ui/task-assignment-harness';
import {
  installTaskDetailNextActionFetchMock,
  renderTaskDetailNextActionApp,
  taskDetailNextActionPayload,
} from '../ui/task-detail-next-action-harness';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/');
});

describe('task assignment accessibility', () => {
  it('passes an axe smoke scan for the task assignment flow', async () => {
    installTaskAssignmentFetchMock();
    const { container } = render(renderTaskAssignmentApp());

    await screen.findByRole('heading', { name: /wire task detail/i });
    await waitFor(() => expect(screen.getByRole('button', { name: /save owner/i })).toBeInTheDocument());
    expect(screen.getByLabelText(/owner/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /assignment/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save owner/i })).toHaveAttribute('type', 'submit');
    expect(screen.getByText(/writes to the task assignment endpoint/i)).toBeInTheDocument();

    const results = await axe.run(container, {
      rules: {
        region: { enabled: false },
        'color-contrast': { enabled: false },
      },
    });

    expect(results.violations).toEqual([]);
  });
});

describe('task detail next-action accessibility', () => {
  it('passes an axe smoke scan for the role-specific next action panel', async () => {
    installTaskDetailNextActionFetchMock(taskDetailNextActionPayload({ stage: 'QA_TESTING', nextAction: 'QA verification required', ownerId: 'qa', ownerLabel: 'QA Engineer' }));
    const { container } = render(renderTaskDetailNextActionApp(['qa', 'reader']));

    await screen.findByRole('heading', { name: /role-specific next action/i });
    expect(screen.getByRole('region', { name: /qa verification required/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /submit qa result/i })).toHaveAttribute('href', '#task-detail-qa-section');
    expect(screen.getByText(/evidence needed/i)).toBeInTheDocument();

    const results = await axe.run(container, {
      rules: {
        region: { enabled: false },
        'color-contrast': { enabled: false },
      },
    });

    expect(results.violations).toEqual([]);
  });
});
