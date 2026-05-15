#!/usr/bin/env node
const { execFileSync } = require('child_process');

const { formatFinding, runLint } = require('./lint-repo');

const BROWSER_SOURCE_PREFIXES = ['src/app/', 'src/features/'];

function gitDiscoveredFiles(root = process.cwd()) {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard'],
    { cwd: root, encoding: 'utf8' },
  );
  return output.trim().split('\n').filter(Boolean);
}

function browserSourceFiles(files = gitDiscoveredFiles()) {
  return files.filter((filePath) => (
    BROWSER_SOURCE_PREFIXES.some((prefix) => filePath.startsWith(prefix))
      && !isTestFile(filePath)
  ));
}

function isTestFile(filePath) {
  return /(^|\/)(test|tests|__tests__)(\/|$)/.test(filePath)
    || /\.(test|spec)\.[cm]?[jt]sx?$/.test(filePath);
}

function runBrowserSourceReadability(options = {}) {
  const root = options.root || process.cwd();
  const files = browserSourceFiles(options.files || gitDiscoveredFiles(root));
  return runLint({
    root,
    files,
    allowlist: { version: 1, entries: [] },
  });
}

function printResult(result, output = process) {
  if (result.failures.length) {
    output.stderr.write(`${result.failures.map(formatFinding).join('\n')}\n`);
    output.stderr.write(`browser source readability checks failed: ${result.failures.length} findings\n`);
    return 1;
  }
  output.stdout.write(`browser source readability checks passed (files scanned: ${result.scannedCount})\n`);
  return 0;
}

if (require.main === module) {
  process.exitCode = printResult(runBrowserSourceReadability());
}

module.exports = {
  BROWSER_SOURCE_PREFIXES,
  browserSourceFiles,
  isTestFile,
  printResult,
  runBrowserSourceReadability,
};
