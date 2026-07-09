const test = require('node:test');
const assert = require('node:assert/strict');

const {
  git,
  initGitRepo,
  makeTempDir,
  runScript,
  writeFile,
} = require('./helpers');

test('source-integrity blocks tracked patch markers', () => {
  const root = makeTempDir('source-integrity-patch-');
  initGitRepo(root);
  writeFile(root, 'lib/corrupt.js', '++ b/lib/corrupt.js\nconst restored = false;\n');
  git(root, ['add', 'lib/corrupt.js']);

  const result = runScript('check-source-integrity.js', root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /lib\/corrupt\.js:1 source-integrity:patch-marker/);
});

test('source-integrity blocks tracked diff scaffolding markers', () => {
  const root = makeTempDir('source-integrity-diff-scaffold-');
  initGitRepo(root);
  writeFile(root, 'lib/scaffold.js', [
    'index 1234567..89abcde 100644',
    'new file mode 100644',
    '@@ -1,2 +1,2 @@',
    '--- /dev/null',
    '+++ /dev/null',
    'module.exports = { ok: false };',
    '',
  ].join('\n'));
  git(root, ['add', 'lib/scaffold.js']);

  const result = runScript('check-source-integrity.js', root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /lib\/scaffold\.js:1 source-integrity:patch-marker/);
  assert.match(result.stderr, /lib\/scaffold\.js:2 source-integrity:patch-marker/);
  assert.match(result.stderr, /lib\/scaffold\.js:3 source-integrity:patch-marker/);
  assert.match(result.stderr, /lib\/scaffold\.js:4 source-integrity:patch-marker/);
  assert.match(result.stderr, /lib\/scaffold\.js:5 source-integrity:patch-marker/);
});

test('source-integrity blocks tracked apply-patch file markers', () => {
  const root = makeTempDir('source-integrity-apply-patch-scaffold-');
  initGitRepo(root);
  writeFile(root, 'lib/apply-patch-scaffold.js', [
    '*** Update File: lib/apply-patch-scaffold.js',
    '*** Move to: lib/moved-scaffold.js',
    '*** End of File',
    'module.exports = { ok: false };',
    '',
  ].join('\n'));
  git(root, ['add', 'lib/apply-patch-scaffold.js']);

  const result = runScript('check-source-integrity.js', root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /lib\/apply-patch-scaffold\.js:1 source-integrity:patch-marker/);
  assert.match(result.stderr, /lib\/apply-patch-scaffold\.js:2 source-integrity:patch-marker/);
  assert.match(result.stderr, /lib\/apply-patch-scaffold\.js:3 source-integrity:patch-marker/);
});

test('source-integrity blocks tracked JavaScript syntax errors', () => {
  const root = makeTempDir('source-integrity-syntax-');
  initGitRepo(root);
  writeFile(root, 'scripts/broken.js', 'function broken( {\n');
  git(root, ['add', 'scripts/broken.js']);

  const result = runScript('check-source-integrity.js', root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /scripts\/broken\.js:1 source-integrity:js-syntax/);
});

test('source-integrity blocks untracked source syntax errors before git add', () => {
  const root = makeTempDir('source-integrity-untracked-syntax-');
  initGitRepo(root);
  writeFile(root, 'scripts/untracked-broken.js', 'function broken( {\n');

  const result = runScript('check-source-integrity.js', root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /scripts\/untracked-broken\.js:1 source-integrity:js-syntax/);
});

test('source-integrity limits patch marker enforcement to tracked files', () => {
  const root = makeTempDir('source-integrity-untracked-patch-');
  initGitRepo(root);
  writeFile(root, 'db/untracked-patch.sql', '++ b/db/untracked-patch.sql\n');
  writeFile(root, 'scripts/clean.js', 'module.exports = { ok: true };\n');
  git(root, ['add', 'scripts/clean.js']);

  const result = runScript('check-source-integrity.js', root);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /javascript files syntax-checked: 1/);
});

test('source-integrity blocks live items in the legacy factory queue file', () => {
  const root = makeTempDir('source-integrity-legacy-factory-queue-');
  initGitRepo(root);
  writeFile(root, 'observability/factory-delivery-queue.json', JSON.stringify({
    schemaVersion: '1.0',
    kind: 'factory-delivery-queue',
    items: [{ id: 'factory-legacy-1', stage: 'queued' }],
  }, null, 2));

  const result = runScript('check-source-integrity.js', root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /observability\/factory-delivery-queue\.json:1 source-integrity:legacy-factory-queue/);
  assert.match(result.stderr, /migrate them into factory_delivery_queue and clear the JSON queue/);
});

test('source-integrity allows an empty migrated legacy factory queue file', () => {
  const root = makeTempDir('source-integrity-empty-factory-queue-');
  initGitRepo(root);
  writeFile(root, 'observability/factory-delivery-queue.json', JSON.stringify({
    schemaVersion: '1.0',
    kind: 'factory-delivery-queue',
    migratedTo: 'factory_delivery_queue',
    items: [],
  }, null, 2));

  const result = runScript('check-source-integrity.js', root);

  assert.equal(result.status, 0, result.stderr);
});

test('source-integrity syntax-checks route, server, script, and test JavaScript', () => {
  const root = makeTempDir('source-integrity-node-roots-');
  initGitRepo(root);
  writeFile(root, 'api/v1/tasks/[action].js', 'module.exports = function route( {\n');
  writeFile(root, 'lib/server.js', 'module.exports = function server( {\n');
  writeFile(root, 'scripts/run-check.js', 'function run( {\n');
  writeFile(root, 'tests/unit/example.test.js', 'test("broken", ( {\n');
  git(root, ['add', 'api/v1/tasks/[action].js', 'lib/server.js', 'scripts/run-check.js', 'tests/unit/example.test.js']);

  const result = runScript('check-source-integrity.js', root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /api\/v1\/tasks\/\[action\]\.js:1 source-integrity:js-syntax/);
  assert.match(result.stderr, /lib\/server\.js:1 source-integrity:js-syntax/);
  assert.match(result.stderr, /scripts\/run-check\.js:1 source-integrity:js-syntax/);
  assert.match(result.stderr, /tests\/unit\/example\.test\.js:1 source-integrity:js-syntax/);
  assert.match(result.stderr, /javascript files syntax-checked: 4/);
});

test('source-integrity syntax-checks React route JSX files', () => {
  const root = makeTempDir('source-integrity-jsx-routes-');
  initGitRepo(root);
  writeFile(root, 'src/app/routes/BrokenRoute.jsx', 'export function BrokenRoute() { return <main><span>Broken</main>; }\n');
  git(root, ['add', 'src/app/routes/BrokenRoute.jsx']);

  const result = runScript('check-source-integrity.js', root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /src\/app\/routes\/BrokenRoute\.jsx:1 source-integrity:jsx-route-syntax/);
  assert.match(result.stderr, /jsx route files syntax-checked: 1/);
});

test('source-integrity passes clean tracked source and ignores TypeScript for node syntax checks', () => {
  const root = makeTempDir('source-integrity-pass-');
  initGitRepo(root);
  writeFile(root, 'api/route.js', 'module.exports = function route() { return { ok: true }; };\n');
  writeFile(root, 'src/app/routes/CleanRoute.jsx', 'export function CleanRoute() { return <main>Clean</main>; }\n');
  writeFile(root, 'tests/browser/example.spec.ts', 'const typed: string = "typescript-only syntax";\n');
  git(root, ['add', 'api/route.js', 'src/app/routes/CleanRoute.jsx', 'tests/browser/example.spec.ts']);

  const result = runScript('check-source-integrity.js', root);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /javascript files syntax-checked: 1/);
  assert.match(result.stdout, /jsx route files syntax-checked: 1/);
});
