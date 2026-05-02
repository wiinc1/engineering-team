#!/usr/bin/env node
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const SOURCE_FILE_CAP = 400;
const TEST_FILE_CAP = 500;
const FUNCTION_CAP = 50;
const BASELINE_PATH = path.join('config', 'maintainability-baseline.json');
const CODE_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
const EXCLUDED_PREFIXES = [
  '.artifacts/',
  '.next/',
  'build/',
  'coverage/',
  'dist/',
  'generated/',
  'node_modules/',
  'third_party/',
];

const failures = [];
const updateBaseline = process.argv.includes('--update-baseline');
const jsonOutput = process.argv.includes('--json');
const ignoreBaseline = process.argv.includes('--no-baseline');

function isTestFile(filePath) {
  return /(^|\/)(chaos|test|tests|__tests__)(\/|$)/.test(filePath)
    || /\.(test|spec)\.[cm]?[jt]sx?$/.test(filePath);
}

function scriptKind(filePath) {
  if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (filePath.endsWith('.ts')) return ts.ScriptKind.TS;
  if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

function isFunctionLike(node) {
  return ts.isFunctionDeclaration(node)
    || ts.isFunctionExpression(node)
    || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node)
    || ts.isGetAccessor(node)
    || ts.isSetAccessor(node)
    || ts.isConstructorDeclaration(node);
}

function functionName(node, sourceFile) {
  if (node.name) return node.name.getText(sourceFile);
  if (ts.isArrowFunction(node)) return '<arrow>';
  return '<anonymous>';
}

function lineCount(text) {
  const lines = text.split(/\r?\n/).length;
  return text.endsWith('\n') ? lines - 1 : lines;
}

function lineRange(sourceFile, node) {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const end = sourceFile.getLineAndCharacterOfPosition(node.end).line + 1;
  return { start, end, count: end - start + 1 };
}

function trackedFiles() {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean)
    .filter(filePath => CODE_EXTENSIONS.has(path.extname(filePath)))
    .filter(filePath => !EXCLUDED_PREFIXES.some(prefix => filePath.startsWith(prefix)));
}

function checkFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const fileLines = lineCount(text);
  const testFile = isTestFile(filePath);
  const fileCap = testFile ? TEST_FILE_CAP : SOURCE_FILE_CAP;

  if (fileLines > fileCap) {
    failures.push({
      path: filePath,
      line: 1,
      ordinal: null,
      name: null,
      rule: testFile ? 'maintainability:test-file-lines' : 'maintainability:source-file-lines',
      actual: fileLines,
      cap: fileCap,
      message: `${filePath}:1 file lines ${fileLines} exceeds hard cap ${fileCap}`,
    });
  }

  const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, scriptKind(filePath));
  let functionOrdinal = 0;

  function visit(node) {
    if (isFunctionLike(node)) {
      functionOrdinal += 1;
      const range = lineRange(sourceFile, node);
      if (range.count > FUNCTION_CAP) {
        const name = functionName(node, sourceFile);
        failures.push({
          path: filePath,
          line: range.start,
          ordinal: functionOrdinal,
          name,
          rule: 'maintainability:function-lines',
          actual: range.count,
          cap: FUNCTION_CAP,
          message: `${filePath}:${range.start} ${name} lines ${range.count} exceeds hard cap ${FUNCTION_CAP}`,
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

for (const filePath of trackedFiles()) {
  checkFile(filePath);
}

function failureKey(failure) {
  return [
    failure.path,
    failure.rule,
    failure.ordinal == null ? '' : failure.ordinal,
    failure.name || '',
  ].join('|');
}

function readBaseline() {
  if (ignoreBaseline || !fs.existsSync(BASELINE_PATH)) {
    return { entries: [] };
  }
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
}

function writeBaseline() {
  const payload = {
    version: 1,
    caps: {
      sourceFileLines: SOURCE_FILE_CAP,
      testFileLines: TEST_FILE_CAP,
      functionLines: FUNCTION_CAP,
    },
    entries: failures.map(failure => ({
      path: failure.path,
      rule: failure.rule,
      line: failure.line,
      ordinal: failure.ordinal,
      name: failure.name,
      actual: failure.actual,
      cap: failure.cap,
    })),
  };

  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`);
}

function applyBaseline() {
  const baseline = readBaseline();
  const baselineEntries = new Map((baseline.entries || []).map(entry => [failureKey(entry), entry]));
  const currentKeys = new Set();
  const activeFailures = [];
  const baselined = [];

  for (const failure of failures) {
    const key = failureKey(failure);
    currentKeys.add(key);
    const baselineEntry = baselineEntries.get(key);
    if (!baselineEntry) {
      activeFailures.push({
        ...failure,
        message: `${failure.message} (not in maintainability baseline)`,
      });
      continue;
    }
    if (failure.actual > baselineEntry.actual) {
      activeFailures.push({
        ...failure,
        message: `${failure.message} (baseline ${baselineEntry.actual})`,
      });
      continue;
    }
    baselined.push({ ...failure, baseline: baselineEntry.actual });
  }

  const staleBaseline = [...baselineEntries.entries()]
    .filter(([key]) => !currentKeys.has(key))
    .map(([, entry]) => entry);

  return { activeFailures, baselined, staleBaseline };
}

failures.sort((left, right) => {
  if (left.rule !== right.rule) return left.rule.localeCompare(right.rule);
  if (right.actual !== left.actual) return right.actual - left.actual;
  if (left.path !== right.path) return left.path.localeCompare(right.path);
  return left.line - right.line;
});

if (updateBaseline) {
  writeBaseline();
  process.stdout.write(`maintainability baseline updated: ${failures.length} entries\n`);
  process.exit(0);
}

const result = applyBaseline();

if (jsonOutput) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else if (result.activeFailures.length) {
  process.stderr.write(`${result.activeFailures.map(failure => failure.message).join('\n')}\n`);
}

if (result.activeFailures.length) {
  process.stderr.write(`maintainability checks failed: ${result.activeFailures.length} hard failures\n`);
  process.exit(1);
}

const staleMessage = result.staleBaseline.length
  ? `, ${result.staleBaseline.length} stale baseline entries`
  : '';
process.stdout.write(`maintainability checks passed (${result.baselined.length} legacy findings at or below baseline${staleMessage})\n`);
