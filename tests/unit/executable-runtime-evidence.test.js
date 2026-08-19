'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { collectArtifact, evidenceDigest } = require('../../lib/release-gates/evidence-collector');
const { configuration } = require('../../scripts/normalize-runtime-gate-evidence');
const { redactReleaseEvidence } = require('../../scripts/verify-factory-staging-smoke');
const {
  buildExecutableComponent, parsePerformance, parseTapSource, sha256,
} = require('../../lib/release-gates/executable-evidence');

const revision = 'a'.repeat(40);
const context = {
  runtime: 'graphile', revision, deploymentId: 'staging-335',
  automation: 'https://gitlab.example/jobs/335', environment: 'staging',
  command: 'node --test tests/contract/job-runtime.contract.test.js',
};

function temporaryFile(contents) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-evidence-'));
  const file = path.join(directory, 'source');
  fs.writeFileSync(file, contents);
  return file;
}

test('executable evidence is derived from a passing gate source and sealed to its bytes', () => {
  const file = temporaryFile('TAP version 13\nok 1 - contract\n1..1\n# tests 1\n# pass 1\n# fail 0\n');
  const component = buildExecutableComponent({
    ...context, kind: 'contract', commandId: 'contract.graphile.v1', sourceFiles: [file],
    generatedAt: '2026-08-19T12:00:00.000Z', thresholds: { failures: 0 },
  });
  assert.equal(component.status, 'passed');
  assert.equal(component.evidence.sourceDigests[0], sha256(fs.readFileSync(file)));
  assert.equal(component.digest, evidenceDigest(component.evidence));
  assert.equal(collectArtifact(component, context).kind, 'contract');
});

test('failed empty malformed or caller-authored status inputs cannot produce evidence', () => {
  for (const source of [
    '',
    'TAP version 13\nnot ok 1 - failed\n1..1\n# pass 0\n# fail 1\n',
    JSON.stringify({ passed: true, status: 'passed' }),
  ]) {
    const file = temporaryFile(source);
    assert.throws(() => buildExecutableComponent({
      ...context, kind: 'contract', commandId: 'contract.graphile.v1', sourceFiles: [file],
    }), /passing TAP/);
  }
});

test('security evidence requires both a clean production audit and passing runtime security TAP', () => {
  const audit = temporaryFile(JSON.stringify({ metadata: { vulnerabilities: { high: 0, critical: 0 } } }));
  const tests = temporaryFile('TAP version 13\nok 1 - isolation\n1..1\n# pass 1\n# fail 0\n');
  const component = buildExecutableComponent({
    ...context, kind: 'security', commandId: 'security.graphile.v1', sourceFiles: [audit, tests],
  });
  assert.deepEqual(component.summary, { high: 0, critical: 0 });
  const unsafe = temporaryFile(JSON.stringify({ metadata: { vulnerabilities: { high: 1, critical: 0 } } }));
  assert.throws(() => buildExecutableComponent({
    ...context, kind: 'security', commandId: 'security.graphile.v1', sourceFiles: [unsafe, tests],
  }), /audit failed/);
});

test('performance components require measured complete 2x ten-minute threshold results', () => {
  const graphile = {
    duration_ms: 600_000, load_multiplier: 2, enqueue_p95_ms: 10, enqueue_p99_ms: 20,
    operational_read_p95_ms: 15, cleanup: { residual: 0 },
  };
  assert.equal(parsePerformance({ bytes: Buffer.from(JSON.stringify(graphile)) }, 'graphile').readP95Ms, 15);
  assert.throws(() => parsePerformance({ bytes: Buffer.from(JSON.stringify({
    ...graphile, operational_read_p95_ms: undefined,
  })) }, 'graphile'), /thresholds failed/);
  const langgraph = {
    passed: true, actualDurationMs: 600_000, loadMultiplier: 2,
    status: { p95Ms: 20 }, checkpointWrites: { p95Ms: 20 }, checkpointReads: { p95Ms: 15 },
    resume: { p95Ms: 100 }, graphOverheadPercent: 2,
  };
  assert.equal(parsePerformance({ bytes: Buffer.from(JSON.stringify(langgraph)) }, 'langgraph').resumeP95Ms, 100);
  assert.throws(() => parsePerformance({ bytes: Buffer.from(JSON.stringify({
    ...langgraph, graphOverheadPercent: 10,
  })) }, 'langgraph'), /thresholds failed/);
});

test('wrong revision environment missing sources and tampered JSON fail closed', () => {
  const recovery = temporaryFile(JSON.stringify({ passed: true, snapshotEqual: true, rtoMs: 1_000 }));
  assert.throws(() => buildExecutableComponent({
    ...context, revision: 'short', kind: 'dr_restore', commandId: 'dr.v1', sourceFiles: [recovery],
  }), /exact revision/);
  assert.throws(() => buildExecutableComponent({
    ...context, environment: 'local', kind: 'dr_restore', commandId: 'dr.v1', sourceFiles: [recovery],
  }), /staging/);
  assert.throws(() => buildExecutableComponent({
    ...context, kind: 'dr_restore', commandId: 'dr.v1', sourceFiles: [],
  }), /source file/);
  const tampered = temporaryFile('{"passed":true');
  assert.throws(() => buildExecutableComponent({
    ...context, kind: 'dr_restore', commandId: 'dr.v1', sourceFiles: [tampered],
  }), /valid JSON/);
});

test('TAP parser requires at least one pass, zero failures, and a completed plan', () => {
  assert.deepEqual(parseTapSource({ bytes: Buffer.from('ok 1 - x\n1..1\n# pass 1\n# fail 0\n') }, 'gate'), {
    passes: 1, failures: 0,
  });
  assert.throws(() => parseTapSource({ bytes: Buffer.from('# pass 1\n# fail 0\n') }, 'gate'), /passing TAP/);
});

test('hosted normalizer binds command provenance to protected exact-revision staging', () => {
  const currentRevision = require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const env = {
    STAGING_REVISION: currentRevision,
    STAGING_BASE_URL: 'https://staging.example.test',
    STAGING_DEPLOYMENT_ID: 'staging-335',
    CI_JOB_URL: 'https://gitlab.example.test/jobs/335',
  };
  const config = configuration(['--runtime', 'graphile', '--kind', 'contract', '--source', 'result.tap'], env);
  assert.equal(config.commandId, 'node-test:job-runtime-contract.v1');
  assert.match(config.command, /node --test/);
  assert.throws(() => configuration(['--runtime', 'graphile', '--kind', 'contract'], {
    ...env, STAGING_REVISION: 'b'.repeat(40),
  }), /exact checked-out revision/);
  assert.throws(() => configuration(['--runtime', 'langgraph', '--kind', 'browser'], env), /STAGING_BROWSER_BASE_URL/);
});

test('hosted synthetic receipts retain the source digest but remove task content and URLs', () => {
  const redacted = redactReleaseEvidence({
    generatedAt: '2026-08-19T12:00:00.000Z',
    baseUrl: 'https://secret-staging.example.test',
    requirement: { title: 'private task content' },
    summary: { passed: true, stage: 'phase1_complete', taskId: 'TSK-PRIVATE' },
  });
  assert.equal(redacted.summary.passed, true);
  assert.match(redacted.evidence.sourceDigest, /^sha256:[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(redacted), /secret-staging|private task|TSK-PRIVATE/);
});
