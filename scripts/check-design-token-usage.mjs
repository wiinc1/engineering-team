#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_SCAN_PATHS = [
  'src/app/styles.css',
  'src/components/Button/Button.module.css',
  'src/features/task-creation/TaskCreationForm.module.css',
  'src/features/task-detail/StageTransition.module.css',
  'src/features/task-detail/TaskDetailActivityShell.module.css',
  'src/features/task-detail/TaskHistoryTimeline.module.css',
  'src/features/task-detail/TelemetrySummary.module.css',
];

const CONFIG_PATH = 'docs/design/design-md-adoption.config.json';
const DEFAULT_GENERATED_ALLOWLIST = [
  normalizePath('src/app/design-tokens.css'),
  normalizePath('src/components/Button/Button.tokens.css'),
  normalizePath('src/features/task-creation/TaskCreationForm.tokens.css'),
  normalizePath('src/features/task-detail/TaskDetail.tokens.css'),
];

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
    description: 'font-size literal',
    check(line) {
      const match = line.match(/\bfont-size\s*:\s*([^;]+)/i);
      if (!match) return [];
      const value = match[1].trim().toLowerCase();
      if (/^(?:var\(|inherit\b|initial\b|unset\b)/i.test(value)) return [];
      if (!/\b\d*\.?\d+(?:px|rem)\b/i.test(value)) return [];
      return [{ match: match[0].trim() }];
    },
  },
  {
    id: 'letter-spacing',
    description: 'letter-spacing literal',
    check(line) {
      const match = line.match(/\bletter-spacing\s*:\s*([^;]+)/i);
      if (!match) return [];
      const value = match[1].trim().toLowerCase();
      if (/^(?:var\(|normal\b|inherit\b|initial\b|unset\b)/i.test(value)) return [];
      return [{ match: match[0].trim() }];
    },
  },
  {
    id: 'opacity',
    description: 'opacity literal',
    check(line) {
      const match = line.match(/\bopacity\s*:\s*([^;]+)/i);
      if (!match) return [];
      const value = match[1].trim().toLowerCase();
      if (/^(?:var\(|inherit\b|initial\b|unset\b)/i.test(value)) return [];
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

function readAdoptionConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return {
      enforcementPaths: DEFAULT_SCAN_PATHS.map(normalizePath),
      generatedAllowlist: DEFAULT_GENERATED_ALLOWLIST,
      componentCoverage: [],
    };
  }

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const configuredEnforcementPaths = (config.enforcement?.paths || []).map(normalizePath);
  const configuredGeneratedAllowlist = (config.enforcement?.generated_allowlist || config.generated_outputs || []).map(normalizePath);
  const enforcementPaths = configuredEnforcementPaths.length > 0
    ? configuredEnforcementPaths
    : DEFAULT_SCAN_PATHS.map(normalizePath);
  const generatedAllowlist = Array.from(new Set([...DEFAULT_GENERATED_ALLOWLIST, ...configuredGeneratedAllowlist]));
  const componentCoverage = Array.isArray(config.component_coverage) ? config.component_coverage : [];
  return { enforcementPaths, generatedAllowlist, componentCoverage };
}

function listCssFiles(root = 'src') {
  if (!fs.existsSync(root)) return [];
  const results = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...listCssFiles(entryPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.css')) {
      results.push(normalizePath(entryPath));
    }
  }
  return results.sort();
}

function validateAdoptionConfig(config, explicitScanPaths) {
  const findings = [];
  const enforcementSet = new Set(config.enforcementPaths);
  const generatedSet = new Set(config.generatedAllowlist);

  if (!explicitScanPaths && fs.existsSync(CONFIG_PATH)) {
    const authoredCss = listCssFiles('src').filter((filePath) => !generatedSet.has(filePath));
    for (const filePath of authoredCss) {
      if (!enforcementSet.has(filePath)) {
        findings.push(`authored UI CSS is missing from enforcement scope: ${filePath}`);
      }
    }
  }

  for (const entry of config.componentCoverage) {
    if (!entry.enforcement_covered) continue;
    for (const filePath of entry.paths || []) {
      const normalized = normalizePath(filePath);
      if (!enforcementSet.has(normalized)) {
        findings.push(`adoption audit marks ${entry.area || 'unnamed area'} as enforced, but path is not scanned: ${normalized}`);
      }
    }
  }

  return findings;
}

function scanFile(filePath, generatedAllowlist) {
  const normalized = normalizePath(filePath);
  if (generatedAllowlist.has(normalized)) return [];
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

const config = readAdoptionConfig();
const explicitScanPaths = process.argv.slice(2).length > 0;
const scanPaths = explicitScanPaths ? process.argv.slice(2).map(normalizePath) : config.enforcementPaths;
const generatedAllowlist = new Set(config.generatedAllowlist);
const configFindings = validateAdoptionConfig(config, explicitScanPaths);
const findings = scanPaths.flatMap((filePath) => scanFile(filePath, generatedAllowlist));

if (configFindings.length > 0 || findings.length > 0) {
  process.stderr.write('Design token usage enforcement failed:\n');
  for (const finding of configFindings) {
    process.stderr.write(`- ${finding}\n`);
  }
  for (const finding of findings) {
    process.stderr.write(`- ${formatFinding(finding)}\n`);
  }
  process.stderr.write(
    `Use DESIGN.md generated tokens or document a rare one-off with ${EXCEPTION_MARKER} <short reason and follow-up if reusable>.\n`,
  );
  process.exit(1);
}

process.stdout.write(`design token usage enforcement passed for ${scanPaths.length} file(s)\n`);
