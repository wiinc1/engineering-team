const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  scanSecrets,
  scanText,
} = require('../../../scripts/check-secrets');

const SCRIPT = path.join(__dirname, '../../..', 'scripts/check-secrets.js');
const TOKEN_PREFIX = 'ghp_';
const TOKEN_BODY = 'a234567890123456789012345678901234567';

function writeFile(root, relativePath, text) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

test('secret scan reports high-confidence token findings without exposing values', () => {
  const text = [
    `const token = "${TOKEN_PREFIX}${TOKEN_BODY}";`,
    'const safe = "ghp_exampleSecretTokenValue1234567890";',
  ].join('\n');

  const findings = scanText('src/example.js', text);

  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'github-token');
  assert.equal(findings[0].line, 1);
  assert.doesNotMatch(findings[0].message, /ghp_/);
});

test('secret scan ignores placeholders and local test secrets', () => {
  const text = [
    'AUTH_JWT_SECRET=golden-path-local-dev-secret',
    'API_KEY="<api-key>"',
    'password = "test-password"',
    'const token = "redacted";',
  ].join('\n');

  assert.deepEqual(scanText('docs/example.md', text), []);
});

test('secret scan CLI exits non-zero on findings and redacts output', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-scan-'));
  writeFile(root, 'src/leak.js', `const token = "${TOKEN_PREFIX}${TOKEN_BODY}";\n`);

  const result = spawnSync(process.execPath, [SCRIPT, '--root', root], {
    cwd: root,
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /github-token at src\/leak.js:1/);
  assert.doesNotMatch(result.stderr, /ghp_a234/);
});

test('secret scan CLI passes on the current repository fixtures', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-scan-clean-'));
  writeFile(root, 'docs/runbook.md', 'AUTH_JWT_SECRET=golden-path-local-dev-secret\n');
  writeFile(root, 'src/config.js', 'const token = process.env.GITHUB_TOKEN;\n');

  const result = scanSecrets({ root });

  assert.equal(result.ok, true, result.findings.map((item) => item.rule).join(','));
  assert.equal(result.findingCount, 0);
});

test('package exposes the release secret scan command', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../../..', 'package.json'), 'utf8'));

  assert.equal(packageJson.scripts['secrets:scan'], 'node scripts/check-secrets.js');
});

test('standards gate runs the release secret scan', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../../..', 'package.json'), 'utf8'));

  assert.match(packageJson.scripts['standards:check'], /npm run secrets:scan/);
});
