import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { LangGraphRunPanel } from './routes/LangGraphRunPanel.jsx';

function response(data: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, json: async () => data } as Response;
}

const status = {
  threadId: 'lg_123', status: 'paused', lifecycleStatus: 'waiting', currentNode: 'review',
  completedNodes: ['intake', 'implementation'], attempts: { review: 1 },
  checkpoint: { id: 'cp-7', stale: false }, error: null,
  nextAction: 'Review the implementation.',
  interrupt: {
    interruptId: 'int-7', checkpointId: 'cp-7', type: 'implementation_review',
    decisionVersion: 2, waitReason: 'Implementation review is required.', nextAction: 'Accept, reject, or edit.',
  },
};

describe('LangGraphRunPanel', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('renders durable wait state and submits a versioned idempotent decision', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return response({ success: true, data: { outcome: 'succeeded' } });
      return response({ success: true, data: status });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<LangGraphRunPanel runRef={{ threadId: 'lg_123' }} ctx={{ D: '', u: { bearerToken: 'token' } }} />);
    expect(await screen.findByText('Implementation review is required.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await screen.findByText('Graph run status loaded.');
    const actionCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(actionCall?.[1]?.headers).toMatchObject({ 'if-match': '2', 'idempotency-key': 'decision:int-7:2:accept' });
  });

  it('requires a cancellation reason and passes an axe smoke scan', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ success: true, data: status })));
    const { container } = render(<LangGraphRunPanel runRef={{ threadId: 'lg_123' }} ctx={{ D: '', u: { bearerToken: 'token' } }} />);
    await screen.findByText('Implementation review is required.');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel run' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A recovery reason is required.');
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});
