import { describe, expect, it } from 'vitest';

import { Fn, Vn, Wn, Xn, Zn, es, jn } from './app-model.jsx';

describe('task detail read-model defaults', () => {
  it('keeps form state stable when optional sections are null', () => {
    expect(Fn(null)).toMatchObject({
      readyForEngineering: false,
      engineerTier: 'Sr',
      technicalSpec: { summary: '', scope: '', design: '', rolloutPlan: '' },
    });
    expect(Wn(null)).toEqual({ commitSha: '', prUrl: '' });
    expect(jn(null)).toEqual({ reason: '' });
    expect(Vn(null)).toEqual({ summary: '', evidence: '' });
    expect(Xn(null)).toMatchObject({ outcome: 'fail', summary: '' });
    expect(Zn(null)).toMatchObject({ deploymentEnvironment: 'production', deploymentUrl: '' });
    expect(es(null)).toEqual({ reason: '', evidence: '' });
  });
});
