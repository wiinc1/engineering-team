#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const MAX_FILE_BYTES = 1024 * 1024;
const EXCLUDED_DIRS = new Set([
  '.git',
  '.next',
  '.vercel',
  'coverage',
  'data',
  'dist',
  'node_modules',
  'observability',
  'tmp',
  'vendor',
]);
const EXCLUDED_FILES = new Set(['package-lock.json']);

const TOKEN_PATTERNS = Object.freeze([
  ['aws-access-key-id', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9_]{36,255}\b/g],
  ['github-fine-grained-token', /\bgithub_pat_[A-Za-z0-9_]{20,}_[A-Za-z0-9_]{20,}\b/g],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['private-key', /-----BEGIN (?:RSA |DSA |EC |OPENSSH |)?PRIVATE KEY-----/g],
  ['slack-token', /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g],
  ['stripe-live-key', /\b(?:sk|rk)_live_[0-9A-Za-z]{16,}\b/g],
]);

const ASSIGNMENT_PATTERN = /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|private[_-]?key|secret)\b\s*[:=]\s*["']?([A-Za-z0-9_./+=-]{32,})["']?/ig;

function readArg(name, fallback = '', argv = process.argv) {
  const index = argv.indexOf(name);
  return index === -1 || index === argv.length - 1 ? fallback : argv[index + 1];
}

function hasFlag(name, argv = process.argv) {
  return argv.includes(name);
}

function isExcluded(relativePath) {
  const normalized = relativePath.replace(/\\/g, '/');
  if (EXCLUDED_FILES.has(path.basename(normalized))) return true;
  return normalized.split('/').some((part) => EXCLUDED_DIRS.has(part));
}

function gitFiles(root) {
  const result = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) return null;
  return result.stdout.split('\0').filter(Boolean);
}

function walkFiles(root, current = root, files = []) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    const relative = path.relative(root, absolute);
    if (isExcluded(relative)) continue;
    if (entry.isDirectory()) walkFiles(root, absolute, files);
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

function candidateFiles(root) {
  const files = gitFiles(root) || walkFiles(root);
  return files.filter((filePath) => !isExcluded(filePath));
}

function lineForIndex(text, index) {
  let line = 1;
  for (let offset = 0; offset < index; offset += 1) {
    if (text.charCodeAt(offset) === 10) line += 1;
  }
  return line;
}

function entropy(value) {
  const counts = new Map();
  for (const char of value) counts.set(char, (counts.get(char) || 0) + 1);
  let score = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    score -= probability * Math.log2(probability);
  }
  return score;
}

function isPlaceholder(value) {
  return /^(?:x+|0+|1+)$/.test(value)
    || /(?:example|placeholder|redacted|changeme|dummy|sample|test|local|secret)/i.test(value);
}

function finding(relativePath, line, rule) {
  return {
    path: relativePath,
    line,
    rule,
    message: 'secret-like value detected; value redacted',
  };
}

function patternFindings(relativePath, text) {
  const findings = [];
  for (const [rule, pattern] of TOKEN_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      if (isPlaceholder(match[0])) continue;
      findings.push(finding(relativePath, lineForIndex(text, match.index || 0), rule));
    }
  }
  return findings;
}

function assignmentFindings(relativePath, text) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    ASSIGNMENT_PATTERN.lastIndex = 0;
    for (const match of line.matchAll(ASSIGNMENT_PATTERN)) {
      const value = match[1] || '';
      if (isPlaceholder(value)) continue;
      if (entropy(value) < 3.5) continue;
      findings.push(finding(relativePath, index + 1, 'high-entropy-secret-assignment'));
    }
  });
  return findings;
}

function scanText(relativePath, text) {
  return [
    ...patternFindings(relativePath, text),
    ...assignmentFindings(relativePath, text),
  ];
}

function readTextIfSafe(root, relativePath) {
  const absolute = path.resolve(root, relativePath);
  const stats = fs.statSync(absolute);
  if (stats.size > MAX_FILE_BYTES) return null;
  const buffer = fs.readFileSync(absolute);
  if (buffer.includes(0)) return null;
  return buffer.toString('utf8');
}

function scanSecrets(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const findings = [];
  let scannedFiles = 0;
  for (const filePath of candidateFiles(root)) {
    const text = readTextIfSafe(root, filePath);
    if (text == null) continue;
    scannedFiles += 1;
    findings.push(...scanText(filePath, text));
  }
  return {
    ok: findings.length === 0,
    scannedFiles,
    findingCount: findings.length,
    findings,
  };
}

function printHumanReport(report, output = process) {
  if (report.ok) {
    output.stdout.write(`PASS  secrets-scan: scanned ${report.scannedFiles} files\n`);
    return;
  }
  for (const item of report.findings) {
    output.stderr.write(`FAIL  secrets-scan: ${item.rule} at ${item.path}:${item.line}\n`);
  }
  output.stderr.write(`secret scan failed: ${report.findingCount} findings\n`);
}

function main(argv = process.argv) {
  const report = scanSecrets({ root: readArg('--root', process.cwd(), argv) });
  if (hasFlag('--json', argv)) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else printHumanReport(report);
  if (!report.ok) process.exitCode = 1;
  return report;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  assignmentFindings,
  candidateFiles,
  entropy,
  main,
  patternFindings,
  scanSecrets,
  scanText,
};
