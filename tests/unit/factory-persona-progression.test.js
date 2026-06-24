const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  summarizeFactoryPersonaProgression,
  assertRequiredFactoryPersonas,
  buildPhasePersonaSnapshot,
} = require('../../lib/task-platform/factory-persona-progression');

const fixturePath = path.join(
  __dirname,
  '../../observability/factory-delivery/factory-mqrfbdbe-ded159.json',
);

test('summarizeFactoryPersonaProgression extracts personas from v5 evidence fixture', () => {
  const evidence = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const summary = summarizeFactoryPersonaProgression(evidence);

  assert.equal(summary.taskId, 'TSK-62624CA5');
  assert.equal(summary.status, 'phase6_complete');
  assert.equal(summary.intake.owner, 'pm');
  assert.equal(summary.phase1.pm, 'refinement_start');
  assert.equal(summary.phase1.architect, 'embedded_in_execution_contract');
  assert.equal(summary.phase1.engineerTier, 'Jr');
  assert.equal(summary.personas.pm, 'pm');
  assert.equal(summary.personas.architect, 'architect');
  assert.equal(summary.personas.engineer, 'engineer-jr');
  assert.equal(summary.personas.qa, 'qa');
  assert.equal(summary.personas.sre, 'sre');
});

test('assertRequiredFactoryPersonas passes for complete progression', () => {
  const evidence = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const summary = summarizeFactoryPersonaProgression(evidence);
  const check = assertRequiredFactoryPersonas(summary);
  assert.equal(check.ok, true);
  assert.deepEqual(check.missing, []);
});

test('buildPhasePersonaSnapshot maps engineer tier to granular assignee', () => {
  const evidence = {
    phase1: {
      architectSpec: { engineerTier: 'Sr' },
    },
  };
  const snapshot = buildPhasePersonaSnapshot(2, evidence, { delegationSmoke: { skipped: true } });
  assert.equal(snapshot.engineer, 'engineer-sr');
  assert.equal(buildPhasePersonaSnapshot(3, evidence, {}).qa, 'qa');
  assert.equal(buildPhasePersonaSnapshot(5, evidence, { sreMonitoring: { start: { ok: true } } }).sre, 'sre');
});

test('assertRequiredFactoryPersonas reports missing personas', () => {
  const check = assertRequiredFactoryPersonas({
    personas: { pm: 'pm', architect: 'architect' },
  });
  assert.equal(check.ok, false);
  assert.deepEqual(check.missing.sort(), ['engineer', 'qa', 'sre']);
});