#!/usr/bin/env node
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = process.cwd();
const NODE_CHECK_EXTENSIONS = new Set(['.cjs', '.js', '.mjs']);
const NODE_CHECK_ROOTS = new Set(['api', 'chaos', 'lib', 'scripts', 'src', 'tests']);
const JSX_ROUTE_ROOT = 'src/app/routes/';
const LEGACY_FACTORY_QUEUE_PATH = 'observability/factory-delivery-queue.json';
const UNTRACKED_SOURCE_ROOTS = new Set([
  ...NODE_CHECK_ROOTS,
  'db',
  'dev-standards',
]);
const UNTRACKED_SOURCE_EXTENSIONS = new Set([
  ...NODE_CHECK_EXTENSIONS,
  '.bash',
  '.json',
  '.jsx',
  '.py',
  '.sh',
  '.sql',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
  '.zsh',
]);
const EXCLUDED_SEGMENTS = new Set([
  '.artifacts',
  '.next',
  '.tmp',
  '.vercel',
  'build',
  'coverage',
  'dist',
  'generated',
  'node_modules',
  'playwright-report',
  'third_party',
  'vendor',
]);

const PATCH_MARKER_RULES = [
  {
    pattern: /^\+\+ b\//,
    message: 'malformed patch target marker is checked into a workspace file',
  },
  {
    pattern: /^\+\+\+ b\//,
    message: 'patch target marker is checked into a workspace file',
  },
  {
    pattern: /^--- a\//,
    message: 'patch source marker is checked into a workspace file',
  },
  {
    pattern: /^diff --git /,
    message: 'git diff header is checked into a workspace file',
  },
  {
    pattern: /^index [0-9a-f]{7,}\.\.[0-9a-f]{7,}/,
    message: 'git diff index marker is checked into a workspace file',
  },
  {
    pattern: /^(new|deleted) file mode \d{6}$/,
    message: 'git diff file mode marker is checked into a workspace file',
  },
  {
    pattern: /^@@(?: .+ @@.*)?$/,
    message: 'git diff hunk marker is checked into a workspace file',
  },
  {
    pattern: /^(\+\+\+|---) \/dev\/null$/,
    message: 'git diff null-file marker is checked into a workspace file',
  },
  {
    pattern: /^\*\*\* Begin Patch$/,
    message: 'apply_patch begin marker is checked into a workspace file',
  },
  {
    pattern: /^\*\*\* (Add|Update|Delete) File: /,
    message: 'apply_patch file marker is checked into a workspace file',
  },
  {
    pattern: /^\*\*\* Move to: /,
    message: 'apply_patch move marker is checked into a workspace file',
  },
  {
    pattern: /^\*\*\* End of File$/,
    message: 'apply_patch eof marker is checked into a workspace file',
  },
  {
    pattern: /^\*\*\* End Patch$/,
    message: 'apply_patch end marker is checked into a workspace file',
  },
  {
    pattern: /^<<<<<<< (HEAD|[0-9a-f]{7,40})/,
    message: 'merge conflict marker is checked into a workspace file',
  },
  {
    pattern: /^>>>>>>> /,
    message: 'merge conflict marker is checked into a workspace file',
  },
];

function normalizePath(filePath) {
  return filePath.split(path.sep).join('/').replace(/^\.\//, '');
}

function trackedFiles(root = ROOT) {
  const output = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' });
  return output.trim()
    ? output.trim().split('\n').map(normalizePath).sort()
    : [];
}

function untrackedFiles(root = ROOT) {
  const output = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
  });
  return output.trim()
    ? output.trim().split('\n').map(normalizePath).sort()
    : [];
}

function isExcluded(filePath) {
  return normalizePath(filePath).split('/').some((segment) => EXCLUDED_SEGMENTS.has(segment));
}

function readWorkspaceText(root, filePath) {
  const absolutePath = path.join(root, filePath);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) return null;
  const buffer = fs.readFileSync(absolutePath);
  if (buffer.includes(0)) return null;
  return buffer.toString('utf8');
}

function finding(pathName, line, rule, message) {
  return { path: pathName, line, rule, message };
}

function formatFinding(item) {
  return `${item.path}:${item.line} ${item.rule} ${item.message}`;
}

function patchMarkerFindings(root, files) {
  const results = [];
  for (const filePath of files) {
    if (isExcluded(filePath)) continue;
    const text = readWorkspaceText(root, filePath);
    if (text === null) continue;
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    lines.forEach((line, index) => {
      for (const rule of PATCH_MARKER_RULES) {
        if (rule.pattern.test(line)) {
          results.push(finding(
            filePath,
            index + 1,
            'source-integrity:patch-marker',
            rule.message,
          ));
        }
      }
    });
  }
  return results;
}

function isRootConfig(filePath) {
  return /^[^/]+\.config\.(cjs|js|mjs)$/.test(filePath);
}

function isUntrackedSourceCandidate(filePath) {
  const normalized = normalizePath(filePath);
  if (isExcluded(normalized)) return false;
  if (isRootConfig(normalized)) return true;
  if (!UNTRACKED_SOURCE_EXTENSIONS.has(path.extname(normalized))) return false;
  const [rootSegment] = normalized.split('/');
  return UNTRACKED_SOURCE_ROOTS.has(rootSegment);
}

function candidateFiles(root = ROOT) {
  return [...new Set([
    ...trackedFiles(root),
    ...untrackedFiles(root).filter(isUntrackedSourceCandidate),
  ])].sort();
}

function shouldNodeCheck(filePath) {
  const normalized = normalizePath(filePath);
  if (isExcluded(normalized)) return false;
  if (!NODE_CHECK_EXTENSIONS.has(path.extname(normalized))) return false;
  const [rootSegment] = normalized.split('/');
  return NODE_CHECK_ROOTS.has(rootSegment) || isRootConfig(normalized);
}

function shouldJsxRouteCheck(filePath) {
  const normalized = normalizePath(filePath);
  if (isExcluded(normalized)) return false;
  return normalized.startsWith(JSX_ROUTE_ROOT) && path.extname(normalized) === '.jsx';
}

function syntaxFailureMessage(stderr, stdout) {
  const lines = `${stderr || ''}\n${stdout || ''}`
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.find((line) => /^(SyntaxError|TypeError|ReferenceError):/.test(line))
    || 'node --check failed';
}

function esbuildFailure(error) {
  const detail = Array.isArray(error?.errors) ? error.errors[0] : null;
  return {
    line: detail?.location?.line || 1,
    message: detail?.text || error?.message || 'JSX route syntax transform failed',
  };
}

function nodeSyntaxFindings(root, files) {
  const results = [];
  for (const filePath of files.filter(shouldNodeCheck)) {
    const absolutePath = path.join(root, filePath);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) continue;
    const result = spawnSync(process.execPath, ['--check', filePath], {
      cwd: root,
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      results.push(finding(
        filePath,
        1,
        'source-integrity:js-syntax',
        syntaxFailureMessage(result.stderr, result.stdout),
      ));
    }
  }
  return results;
}

function jsxRouteSyntaxFindings(root, files) {
  const results = [];
  for (const filePath of files.filter(shouldJsxRouteCheck)) {
    const text = readWorkspaceText(root, filePath);
    if (text === null) continue;
    let transformed;
    try {
      transformed = esbuild.transformSync(text, {
        loader: 'jsx',
        jsx: 'automatic',
        format: 'esm',
        sourcefile: filePath,
      });
    } catch (error) {
      const failure = esbuildFailure(error);
      results.push(finding(
        filePath,
        failure.line,
        'source-integrity:jsx-route-syntax',
        failure.message,
      ));
      continue;
    }
    const result = spawnSync(process.execPath, ['--check', '--input-type=module'], {
      cwd: root,
      encoding: 'utf8',
      input: transformed.code,
    });
    if (result.status !== 0) {
      results.push(finding(
        filePath,
        1,
        'source-integrity:jsx-route-syntax',
        syntaxFailureMessage(result.stderr, result.stdout),
      ));
    }
  }
  return results;
}

function legacyFactoryQueueFindings(root = ROOT) {
  const text = readWorkspaceText(root, LEGACY_FACTORY_QUEUE_PATH);
  if (text === null) return [];
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return [finding(
      LEGACY_FACTORY_QUEUE_PATH,
      1,
      'source-integrity:legacy-factory-queue',
      'legacy factory queue file must be valid JSON or removed after Postgres migration',
    )];
  }
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) return [];
  return [finding(
    LEGACY_FACTORY_QUEUE_PATH,
    1,
    'source-integrity:legacy-factory-queue',
    'legacy factory queue file still contains live items; migrate them into factory_delivery_queue and clear the JSON queue',
  )];
}

function runSourceIntegrity(options = {}) {
  const root = options.root || ROOT;
  const files = options.files || candidateFiles(root);
  const patchFiles = options.patchFiles || (options.files ? files : trackedFiles(root));
  const patchFindings = patchMarkerFindings(root, patchFiles);
  const syntaxFindings = nodeSyntaxFindings(root, files);
  const jsxRouteFindings = jsxRouteSyntaxFindings(root, files);
  const legacyQueueFindings = legacyFactoryQueueFindings(root);
  return {
    checkedFiles: files.length,
    patchMarkerCheckedFiles: patchFiles.length,
    failures: [...patchFindings, ...syntaxFindings, ...jsxRouteFindings, ...legacyQueueFindings]
      .sort((left, right) => formatFinding(left).localeCompare(formatFinding(right))),
    nodeCheckedFiles: files.filter(shouldNodeCheck).length,
    jsxRouteCheckedFiles: files.filter(shouldJsxRouteCheck).length,
  };
}

function printResult(result, output = process) {
  const summary = [
    `workspace files scanned: ${result.checkedFiles}`,
    `javascript files syntax-checked: ${result.nodeCheckedFiles}`,
    `jsx route files syntax-checked: ${result.jsxRouteCheckedFiles}`,
  ].join(', ');
  if (result.failures.length) {
    output.stderr.write(`${result.failures.map(formatFinding).join('\n')}\n`);
    output.stderr.write(`source integrity checks failed: ${result.failures.length} findings (${summary})\n`);
    return 1;
  }
  output.stdout.write(`source integrity checks passed (${summary})\n`);
  return 0;
}

if (require.main === module) {
  process.exitCode = printResult(runSourceIntegrity());
}

module.exports = {
  NODE_CHECK_EXTENSIONS,
  NODE_CHECK_ROOTS,
  candidateFiles,
  formatFinding,
  isUntrackedSourceCandidate,
  jsxRouteSyntaxFindings,
  legacyFactoryQueueFindings,
  nodeSyntaxFindings,
  patchMarkerFindings,
  runSourceIntegrity,
  shouldJsxRouteCheck,
  shouldNodeCheck,
  trackedFiles,
  untrackedFiles,
};
