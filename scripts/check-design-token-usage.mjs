#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_SCAN_PATHS = [
  'src/app/styles.css',
  'src/components/Button/Button.module.css',
  'src/features/task-creation/TaskCreationForm.module.css',
];

const GENERATED_ALLOWLIST = new Set([
  normalizePath('src/app/design-tokens.css'),
  normalizePath('src/components/Button/Button.tokens.css'),
  normalizePath('src/features/task-creation/TaskCreationForm.tokens.css'),
]);

const COMMON_FONT_SIZE_LITERALS = new Set(['12px', '14px', '16px', '1rem', '0.875rem']);
const EXCEPTION_MARKER = 'DESIGN-TOKEN-EXCEPTION:';

const RULES = [
  {
    id: 'hex-color',
    description: 'hex color literal',
    pattern: /#[0-9a-fA-F]{3,8}\b/g,
  },
  {
    id: 'functional-color',
    description: 'rgb()/rgba()/hsl()/hsla() color literal',
    pattern: /\b(?:rgb|rgba|hsl|hsla)\s*\(/gi,
  },
  {
    id: 'box-shadow',
    description: 'box-shadow literal',
    check(line) {
      const match = line.match(/\bbox-shadow\s*:\s*([^;]+)/i);
      if (!match) return [];
      const value = match[1].trim();
      if (/^(?:var\(|none\b|inherit\b|initial\b|unset\b)/i.test(value)) return [];
      return [{ match: match[0].trim() }];
    },
  },
  {
    id: 'border-radius',
    description: 'border-radius size literal',
    check(line) {
      const match = line.match(/\bborder-radius\s*:\s*([^;]+)/i);
      if (!match) return [];
      const value = match[1].trim();
      if (!/\b\d*\.?\d+(?:px|rem)\b/i.test(value)) return [];
      return [{ match: match[0].trim() }];
    },
  },
  {
    id: 'font-size',
    description: 'common font-size literal',
    check(line) {
      const match = line.match(/\bfont-size\s*:\s*([^;]+)/i);
      if (!match) return [];
      const value = match[1].trim().toLowerCase();
      const exactValue = value.match(/^(\d*\.?\d+(?:px|rem))\b/);
      if (!exactValue || !COMMON_FONT_SIZE_LITERALS.has(exactValue[1])) return [];
      return [{ match: match[0].trim() }];
    },
  },
];

function normalizePath(filePath) {
  return filePath.split(path.sep).join('/');
}

function scanLine(line) {
  const findings = [];
  for (const rule of RULES) {
    if (rule.pattern) {
      for (const match of line.matchAll(rule.pattern)) {
        findings.push({ rule, match: match[0] });
      }
      continue;
    }

    for (const finding of rule.check(line)) {
      findings.push({ rule, match: finding.match });
    }
  }
  return findings;
}

function parseExceptionReason(line) {
  const markerIndex = line.indexOf(EXCEPTION_MARKER);
  if (markerIndex === -1) return null;
  const rawReason = line.slice(markerIndex + EXCEPTION_MARKER.length);
  return rawReason.replace(/\*\//g, '').trim();
}

function isCommentOnlyException(line) {
  const beforeMarker = line.slice(0, line.indexOf(EXCEPTION_MARKER)).trim();
  return beforeMarker === '' || beforeMarker === '/*' || beforeMarker.startsWith('//');
}

function scanFile(filePath) {
  const normalized = normalizePath(filePath);
  if (GENERATED_ALLOWLIST.has(normalized)) return [];
  if (!fs.existsSync(filePath)) return [];

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const findings = [];
  let pendingException = null;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const reason = parseExceptionReason(line);
    if (reason !== null && reason.length === 0) {
      findings.push({
        filePath,
        lineNumber,
        ruleId: 'exception-reason',
        message: `${EXCEPTION_MARKER} requires a short reason`,
        match: EXCEPTION_MARKER,
      });
    }

    const lineFindings = scanLine(line);
    const sameLineException = reason && !isCommentOnlyException(line) ? reason : null;
    const activeException = sameLineException || pendingException;

    if (lineFindings.length > 0) {
      if (!activeException) {
        for (const finding of lineFindings) {
          findings.push({
            filePath,
            lineNumber,
            ruleId: finding.rule.id,
            message: finding.rule.description,
            match: finding.match,
          });
        }
      }
      pendingException = null;
      return;
    }

    if (reason && isCommentOnlyException(line)) {
      pendingException = { reason, lineNumber };
      return;
    }

    const trimmed = line.trim();
    if (trimmed && /[:;]/.test(trimmed) && !trimmed.startsWith('/*') && !trimmed.startsWith('*')) {
      pendingException = null;
    }
  });

  return findings;
}

function formatFinding(finding) {
  return `${finding.filePath}:${finding.lineNumber}: ${finding.message} (${finding.ruleId}) -> ${finding.match}`;
}

const scanPaths = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_SCAN_PATHS;
const findings = scanPaths.flatMap((filePath) => scanFile(filePath));

if (findings.length > 0) {
  process.stderr.write('Design token usage enforcement failed:\n');
  for (const finding of findings) {
    process.stderr.write(`- ${formatFinding(finding)}\n`);
  }
  process.stderr.write(
    `Use DESIGN.md generated tokens or document a rare one-off with ${EXCEPTION_MARKER} <short reason and follow-up if reusable>.\n`,
  );
  process.exit(1);
}

process.stdout.write(`design token usage enforcement passed for ${scanPaths.length} file(s)\n`);
