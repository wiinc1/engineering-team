const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildCommandCenterQueueSections,
  classifyCommandCenterQueueBucket,
  countActiveCommandCenterFilters,
  formatTaskFreshnessLabel,
} = require('../../src/app/command-center-queue.mjs');

test('classifyCommandCenterQueueBucket routes monitoring and attention lanes', () => {
  assert.equal(classifyCommandCenterQueueBucket({ current_stage: 'SRE_MONITORING' }), 'monitoring');
  assert.equal(classifyCommandCenterQueueBucket({ current_stage: 'DRAFT', intake_draft: true }), 'needs-attention');
  assert.equal(classifyCommandCenterQueueBucket({ current_stage: 'REOPEN' }), 'blocked');
  assert.equal(classifyCommandCenterQueueBucket({ current_stage: 'IN_PROGRESS' }), 'ready-to-move');
});

test('buildCommandCenterQueueSections groups tasks into operational lanes', () => {
  const sections = buildCommandCenterQueueSections([
    { task_id: 'TSK-A', current_stage: 'DRAFT', intake_draft: true, priority: 'P0' },
    { task_id: 'TSK-B', current_stage: 'IN_PROGRESS', priority: 'P1' },
    { task_id: 'TSK-C', current_stage: 'SRE_MONITORING', priority: 'P2' },
  ]);
  assert.equal(sections.find((section) => section.key === 'needs-attention').items[0].task_id, 'TSK-A');
  assert.equal(sections.find((section) => section.key === 'ready-to-move').items[0].task_id, 'TSK-B');
  assert.equal(sections.find((section) => section.key === 'monitoring').items[0].task_id, 'TSK-C');
});

test('countActiveCommandCenterFilters reports active filter count', () => {
  assert.equal(countActiveCommandCenterFilters({ owner: 'engineer-sr', searchTerm: 'TSK' }), 2);
  assert.equal(countActiveCommandCenterFilters({}), 0);
});

test('formatTaskFreshnessLabel falls back when freshness is missing', () => {
  assert.equal(formatTaskFreshnessLabel({}), 'Freshness unknown');
});