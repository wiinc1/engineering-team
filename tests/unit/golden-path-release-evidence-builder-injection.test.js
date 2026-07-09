const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildReleaseEvidenceBundle,
} = require('../../lib/task-platform/golden-path-real-evidence-collector');

function withNodeEnv(value, callback) {
  const previous = process.env.NODE_ENV;
  try {
    if (value == null) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = value;
    return callback();
  } finally {
    if (previous == null) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
}

test('strict real-evidence release validation rejects custom builders outside test mode', () => {
  withNodeEnv(null, () => {
    assert.throws(
      () => buildReleaseEvidenceBundle(
        { environment: 'staging', artifacts: {} },
        {
          requireRealEvidence: true,
          releaseEvidenceBuilder: () => ({ ok: true, stdout: 'forged pass' }),
        },
      ),
      /custom releaseEvidenceBuilder is only allowed in test mode/,
    );
  });
});

test('strict real-evidence release validation allows custom builders only for tests', () => {
  withNodeEnv('test', () => {
    const result = buildReleaseEvidenceBundle(
      { environment: 'staging', artifacts: {} },
      {
        requireRealEvidence: true,
        releaseEvidenceBuilder: () => ({ ok: true, stdout: 'test pass' }),
      },
    );
    assert.equal(result.ok, true);
    assert.equal(result.stdout, 'test pass');
  });
});

test('strict real-evidence release validation rejects caller-spoofed test env', () => {
  withNodeEnv(null, () => {
    assert.throws(
      () => buildReleaseEvidenceBundle(
        { environment: 'staging', artifacts: {} },
        {
          requireRealEvidence: true,
          env: { NODE_ENV: 'test' },
          releaseEvidenceBuilder: () => ({ ok: true, stdout: 'spoofed test pass' }),
        },
      ),
      /custom releaseEvidenceBuilder is only allowed in test mode/,
    );
  });
});
