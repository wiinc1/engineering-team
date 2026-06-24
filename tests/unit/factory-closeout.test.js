const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  buildFactoryCloseoutReport,
  writeFactoryCloseoutReport,
  classifyStepStatus,
} = require('../../lib/task-platform/factory-closeout');

test('classifyStepStatus marks completed automated steps', () => {
  const status = classifyStepStatus(
    { id: 'GP-014' },
    { stepsCompleted: ['GP-014'] },
    { manual: false },
  );
  assert.equal(status, 'automated');
});

test('buildFactoryCloseoutReport summarizes step classification', () => {
  const report = buildFactoryCloseoutReport({
    engineeringTeam: { taskId: 'TSK-CLOSEOUT' },
    factoryQueueId: 'factory-test',
    status: 'phase6_complete',
    stepsCompleted: ['GP-001', 'GP-002', 'GP-014', 'GP-023', 'GP-027'],
    phase6: {
      api: {
        validation: { ok: true },
        taskClosed: { ok: true },
        humanClose: { ok: true },
      },
    },
  });
  assert.equal(report.kind, 'factory-closeout-report');
  assert.equal(report.taskId, 'TSK-CLOSEOUT');
  assert.ok(report.stepClassification.total >= 27);
  assert.equal(report.phase6.validationOk, true);
});

test('writeFactoryCloseoutReport writes JSON artifact', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-closeout-'));
  const { outputPath, report } = writeFactoryCloseoutReport({
    engineeringTeam: { taskId: 'TSK-WRITE' },
    stepsCompleted: ['GP-027'],
  }, { outputDir: dir });
  assert.equal(fs.existsSync(outputPath), true);
  assert.equal(report.kind, 'factory-closeout-report');
});