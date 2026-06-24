const test = require('node:test');
const assert = require('node:assert/strict');
const { runMilestoneHostedPhase6Verify } = require('../../lib/audit/milestone-hosted-phase6-verify');

test('hosted phase 6 verify requires evidence and hosted base URL', async () => {
  await assert.rejects(
    () => runMilestoneHostedPhase6Verify({ baseUrl: 'https://api.example.com', jwtSecret: 'secret' }),
    /requires factory evidence/,
  );
});

test('hosted phase 6 verify rejects local base URL without override', async () => {
  await assert.rejects(
    () => runMilestoneHostedPhase6Verify({
      baseUrl: 'http://127.0.0.1:13000',
      jwtSecret: 'secret',
      pilot: { factoryQueueId: 'factory-test', status: 'phase5_complete' },
    }),
    /non-local base URL/,
  );
});