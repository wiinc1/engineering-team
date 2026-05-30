import { describe, expect, it } from 'vitest';

import {
  De,
  Fa,
  Hn,
  Ie,
  Pe,
  qe,
  authModeFromSearch,
  authSearchWithMode,
  va,
  we,
  za,
} from './app-model.jsx';

describe('browser app route model helpers', () => {
  it('matches the browser route ownership map', () => {
    expect(za('/tasks')).toBe(true);
    expect(za('/tasks/TSK-1')).toBe(false);
    expect(Fa('/tasks/TSK-1')).toEqual({ taskId: 'TSK-1' });
    expect(Hn('/tasks/create')).toBe(true);
    expect(Ie('/inbox/qa')).toEqual({ role: 'qa' });
    expect(De('/overview/pm')).toEqual({ scope: 'pm' });
    expect(Pe('/overview/governance')).toEqual({ scope: 'governance' });
    expect(qe('/deferred-considerations')).toEqual({ scope: 'deferred-considerations' });
  });

  it('keeps persisted-agent owner surfaces on canonical inbox and PM overview routes', () => {
    for (const role of ['pm', 'architect', 'engineer', 'qa', 'sre', 'human']) {
      expect(Ie(`/inbox/${role}`)).toEqual({ role });
    }

    expect(De('/overview/pm')).toEqual({ scope: 'pm' });
  });

  it('round-trips task workspace filters without dropping route query state', () => {
    expect(va('?owner=engineer&view=list&priority=P1&status=active&search=TSK-42&project=PRJ-ABC12345')).toEqual({
      owner: 'engineer',
      view: 'list',
      bucket: '',
      priority: 'P1',
      status: 'active',
      searchTerm: 'TSK-42',
      project: 'PRJ-ABC12345',
    });

    expect(
      we({ owner: '', view: 'board', searchTerm: 'queued', project: 'PRJ-ABC12345' }, '?bucket=sre&priority=P1'),
    ).toBe('?bucket=sre&priority=P1&view=board&search=queued&project=PRJ-ABC12345');
  });

  it('keeps auth mode routing encoded in query state', () => {
    expect(authModeFromSearch('?mode=register')).toBe('register');
    expect(authModeFromSearch('?mode=reset')).toBe('resetRequest');
    expect(authSearchWithMode('?next=%2Ftasks', 'register')).toBe('?next=%2Ftasks&mode=register');
    expect(authSearchWithMode('?next=%2Ftasks&mode=register', 'signIn')).toBe('?next=%2Ftasks');
  });
});
