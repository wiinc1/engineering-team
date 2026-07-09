const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assertGoldenPathRealEvidencePreflight } = require('../../lib/task-platform/golden-path-real-evidence-preflight');

const REAL_PR_URL = 'https://github.com/wiinc1/engineering-team/pull/417';
const STAGING_DEPLOYMENT_URL = 'https://factory-staging.openclaw.app';
const COMPLETE_RELEASE_PROOF = {
  rollbackVerified: true,
  rollbackEvidence: 'observability/release/rollback-verification.json',
  candidateProofPath: 'observability/real-delivery-candidate-proof.json',
  healthCheckPath: '/version',
  requireHealthCommit: true,
  releaseArtifactCommands: {
    build: 'npm run build',
    compatibility: 'npm run test:unit',
    vulnerability: 'npm audit --audit-level=high',
    secret: 'npm run secrets:scan',
  },
};

function stagingProofOptions(overrides = {}) {
  return {
    collectRealEvidence: true,
    branchName: 'factory/real-proof-417',
    implementationCommitSha: '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd',
    prUrl: REAL_PR_URL,
    releaseEnv: 'staging',
    deploymentUrl: STAGING_DEPLOYMENT_URL,
    rollbackTarget: 'release-previous',
    ...COMPLETE_RELEASE_PROOF,
    ...overrides,
  };
}

function testEnvInjection(env = {}) {
  return {
    allowTestEnvInjection: true,
    env,
  };
}

function writeExistingCommandArtifacts(outDir, overrides = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const [key, fileName, artifactName] of [
    ['build', 'build.json', 'build'],
    ['compatibility', 'compatibility-report.json', 'compatibility-report'],
    ['vulnerability', 'vulnerability-scan.json', 'vulnerability-scan'],
    ['secret', 'secret-scan.json', 'secret-scan'],
  ]) {
    fs.writeFileSync(path.join(outDir, fileName), `${JSON.stringify({
      schema_version: '1.0',
      generated_by: 'release-artifact-evidence-builder',
      generated_at: '2026-07-05T00:00:00.000Z',
      artifact_name: artifactName,
      commit_sha: '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd',
      environment: 'staging',
      source_system: 'command',
      status: 'passed',
      ...(overrides[key] || {}),
    }, null, 2)}\n`);
  }
}

test('real-evidence preflight rejects default pilot PR before collection', () => {
  assert.throws(
    () => assertGoldenPathRealEvidencePreflight(stagingProofOptions({
      prUrl: 'https://github.com/wiinc1/engineering-team/pull/271',
      prNumber: 271,
    }), { context: 'test replay' }),
    /test replay preflight failed: default pilot PR #271 is not valid real evidence/,
  );
});

test('real-evidence preflight rejects non-GitHub PR URLs before collection', () => {
  assert.throws(
    () => assertGoldenPathRealEvidencePreflight(stagingProofOptions({
      prUrl: 'https://git.example.com/wiinc1/engineering-team/pull/417',
    }), { context: 'test replay' }),
    /test replay preflight failed: actual pull request target is required/,
  );
});

test('real-evidence preflight rejects fake commit inputs before collection', () => {
  assert.throws(
    () => assertGoldenPathRealEvidencePreflight(stagingProofOptions({
      implementationCommitSha: '0123456789abcdef0123456789abcdef01234567',
      mergeCommitSha: 'not-a-sha',
    }), { context: 'test replay' }),
    /implementation commit SHA: actual non-fixture.*merge commit SHA: actual 40-character/s,
  );
});

test('real-evidence preflight requires branch and implementation commit before collection', () => {
  assert.throws(
    () => assertGoldenPathRealEvidencePreflight(stagingProofOptions({
      branchName: '',
    }), { context: 'identity proof' }),
    /identity proof preflight failed: candidate branch is required/,
  );

  assert.throws(
    () => assertGoldenPathRealEvidencePreflight(stagingProofOptions({
      implementationCommitSha: '',
      commitSha: '',
    }), { context: 'identity proof' }),
    /identity proof preflight failed: implementation commit SHA: actual 40-character commit SHA is required/,
  );
});

test('real-evidence preflight rejects default and detached candidate branches', () => {
  assert.throws(
    () => assertGoldenPathRealEvidencePreflight(stagingProofOptions({
      branchName: 'main',
    }), { context: 'branch proof' }),
    /branch proof preflight failed: candidate branch must not be main/,
  );

  assert.throws(
    () => assertGoldenPathRealEvidencePreflight(stagingProofOptions({
      branchName: 'HEAD',
    }), { context: 'branch proof' }),
    /branch proof preflight failed: candidate branch cannot be detached HEAD/,
  );
});

test('real-evidence preflight rejects phase 6 without auto-merge and GitHub token', () => {
  assert.throws(
    () => assertGoldenPathRealEvidencePreflight(stagingProofOptions({
      fromPhase: 6,
      toPhase: 6,
      autoMerge: false,
      githubToken: '',
      ...testEnvInjection({ FF_FACTORY_AUTO_MERGE: '', GITHUB_TOKEN: '', GH_TOKEN: '' }),
    }), { context: 'phase6' }),
    /phase6 preflight failed: .*real-evidence phase 6 requires --auto-merge.*real-evidence phase 6 requires GITHUB_TOKEN/s,
  );
});

test('real-evidence preflight accepts phase 6 with auto-merge and GitHub token', () => {
  const result = assertGoldenPathRealEvidencePreflight(stagingProofOptions({
    fromPhase: 6,
    toPhase: 6,
    autoMerge: true,
    githubToken: 'gh-token',
    baseUrl: 'https://api.factory.openclaw.app',
    ...testEnvInjection({ FF_FACTORY_AUTO_MERGE: '', GITHUB_TOKEN: '', GH_TOKEN: '' }),
  }));
  assert.equal(result.required, true);
});

test('real-evidence preflight rejects local runtime URLs for hosted phase 6 proof', () => {
  assert.throws(
    () => assertGoldenPathRealEvidencePreflight(stagingProofOptions({
      fromPhase: 6,
      toPhase: 6,
      autoMerge: true,
      githubToken: 'gh-token',
      baseUrl: 'http://127.0.0.1:13000',
      operatorUrl: 'http://localhost:15173',
      forgeAdapterBaseUrl: 'http://127.0.0.1:14010',
      ...testEnvInjection({ FF_FACTORY_AUTO_MERGE: '', GITHUB_TOKEN: '', GH_TOKEN: '' }),
    }), { context: 'phase6' }),
    /phase6 preflight failed: .*operator URL must be hosted.*base URL must be hosted.*forge adapter URL must be hosted/s,
  );
});

test('real-evidence preflight does not let caller env hide a non-GitHub API base', () => {
  const saved = process.env.GITHUB_API_BASE_URL;
  process.env.GITHUB_API_BASE_URL = 'http://127.0.0.1:9999';
  try {
    assert.throws(
      () => assertGoldenPathRealEvidencePreflight(stagingProofOptions({
        env: { GITHUB_API_BASE_URL: '' },
      }), { context: 'github source' }),
      /github source preflight failed: GitHub evidence API base must be https:\/\/api\.github\.com/,
    );
  } finally {
    if (saved == null) delete process.env.GITHUB_API_BASE_URL;
    else process.env.GITHUB_API_BASE_URL = saved;
  }
});

test('real-evidence preflight does not let caller env fake a GitHub token', () => {
  const savedGithub = process.env.GITHUB_TOKEN;
  const savedGh = process.env.GH_TOKEN;
  delete process.env.GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
  try {
    assert.throws(
      () => assertGoldenPathRealEvidencePreflight(stagingProofOptions({
        fromPhase: 6,
        toPhase: 6,
        autoMerge: true,
        githubToken: '',
        baseUrl: 'https://api.factory.openclaw.app',
        env: { GITHUB_TOKEN: 'spoofed-token' },
      }), { context: 'github token' }),
      /github token preflight failed: real-evidence phase 6 requires GITHUB_TOKEN or GH_TOKEN/,
    );
  } finally {
    if (savedGithub == null) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = savedGithub;
    if (savedGh == null) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = savedGh;
  }
});

test('real-evidence preflight rejects hosted release without final artifact inputs', () => {
  assert.throws(
    () => assertGoldenPathRealEvidencePreflight({
      collectRealEvidence: true,
      prUrl: REAL_PR_URL,
      releaseEnv: 'staging',
      deploymentUrl: STAGING_DEPLOYMENT_URL,
      rollbackTarget: 'release-previous',
    }, { context: 'artifact proof' }),
    /artifact proof preflight failed: .*rollback-verified.*rollback-evidence.*candidate-proof.*require-health-commit.*health-check-path.*release-build-command.*release-secret-command/s,
  );
});

test('real-evidence preflight can accept explicitly reused release artifacts', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'release-artifact-preflight-'));
  writeExistingCommandArtifacts(tmp);

  const result = assertGoldenPathRealEvidencePreflight(stagingProofOptions({
    releaseArtifactCommands: {},
    releaseArtifactDir: tmp,
    useExistingReleaseArtifacts: true,
  }));
  assert.equal(result.required, true);
});

test('real-evidence preflight rejects missing or failed reused release artifacts', () => {
  const missingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-artifact-missing-'));
  assert.throws(
    () => assertGoldenPathRealEvidencePreflight(stagingProofOptions({
      releaseArtifactCommands: {},
      releaseArtifactDir: missingDir,
      useExistingReleaseArtifacts: true,
    }), { context: 'artifact reuse' }),
    /artifact reuse preflight failed: .*existing build artifact cannot be read.*existing secret-scan artifact cannot be read/s,
  );

  const failedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-artifact-failed-'));
  writeExistingCommandArtifacts(failedDir, { build: { status: 'failed' } });
  assert.throws(
    () => assertGoldenPathRealEvidencePreflight(stagingProofOptions({
      releaseArtifactCommands: {},
      releaseArtifactDir: failedDir,
      useExistingReleaseArtifacts: true,
    }), { context: 'artifact reuse' }),
    /artifact reuse preflight failed: existing build artifact status must be passed/,
  );
});

test('real-evidence preflight rejects stale or malformed reused release artifacts', () => {
  const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-artifact-env-'));
  writeExistingCommandArtifacts(envDir, { build: { environment: 'prod' } });
  assert.throws(
    () => assertGoldenPathRealEvidencePreflight(stagingProofOptions({
      releaseArtifactCommands: {},
      releaseArtifactDir: envDir,
      useExistingReleaseArtifacts: true,
    }), { context: 'artifact reuse' }),
    /artifact reuse preflight failed: existing build artifact environment must match release environment staging/,
  );

  const fixtureShaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-artifact-fixture-sha-'));
  writeExistingCommandArtifacts(fixtureShaDir, { build: { commit_sha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' } });
  assert.throws(
    () => assertGoldenPathRealEvidencePreflight(stagingProofOptions({
      releaseArtifactCommands: {},
      releaseArtifactDir: fixtureShaDir,
      useExistingReleaseArtifacts: true,
    }), { context: 'artifact reuse' }),
    /artifact reuse preflight failed: existing build artifact commit_sha: actual non-fixture 40-character commit SHA is required/,
  );

  const mismatchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-artifact-commit-mismatch-'));
  writeExistingCommandArtifacts(mismatchDir);
  assert.throws(
    () => assertGoldenPathRealEvidencePreflight(stagingProofOptions({
      commitSha: '4f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd',
      releaseArtifactCommands: {},
      releaseArtifactDir: mismatchDir,
      useExistingReleaseArtifacts: true,
    }), { context: 'artifact reuse' }),
    /artifact reuse preflight failed: existing build artifact commit_sha must match expected release commit/,
  );
});
