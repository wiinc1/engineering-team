#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CONFIG_PATH = 'docs/design/design-md-adoption.config.json';
const REPO_CONTRACT_PATH = 'repo-contract.yaml';
const NO_DESIGN_IMPACT_MARKER = 'docs/design/no-design-impact.txt';
const DESIGN_ARTIFACTS = [
  'DESIGN.md',
  CONFIG_PATH,
  'docs/design/DESIGN_MD_ADOPTION_AUDIT.md',
];

function normalizePath(filePath) {
  return filePath.split(path.sep).join('/');
}

function runGit(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function gitList(args) {
  const output = runGit(args);
  return output ? output.split('\n').map((file) => normalizePath(file.trim())).filter(Boolean) : [];
}

function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function generatedOutputsFromRepoContract() {
  if (!fs.existsSync(REPO_CONTRACT_PATH)) return [];
  const lines = fs.readFileSync(REPO_CONTRACT_PATH, 'utf8').split(/\r?\n/);
  const outputs = [];
  let inVisualIdentity = false;
  let inGeneratedOutputs = false;
  let inPaths = false;

  for (const rawLine of lines) {
    const indent = rawLine.match(/^\s*/)?.[0].length ?? 0;
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    if (indent === 0) {
      inVisualIdentity = line === 'visual_identity:';
      inGeneratedOutputs = false;
      inPaths = false;
      continue;
    }

    if (!inVisualIdentity) continue;
    if (indent === 2) {
      inGeneratedOutputs = line === 'generated_outputs:';
      inPaths = false;
      continue;
    }
    if (!inGeneratedOutputs) continue;
    if (indent === 4) {
      inPaths = line === 'paths:';
      continue;
    }
    if (inPaths && indent >= 4 && line.startsWith('- ')) {
      outputs.push(line.slice(2).trim().replace(/^['"]|['"]$/g, ''));
    }
  }

  return outputs.map(normalizePath);
}

function gitFile(ref, filePath) {
  try {
    return execFileSync('git', ['show', `${ref}:${filePath}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

function workingFile(filePath) {
  const absolutePath = path.join(process.cwd(), filePath);
  if (!fs.existsSync(absolutePath)) return null;
  return fs.readFileSync(absolutePath, 'utf8');
}

function stripTrailingWhitespace(content) {
  return content.replace(/[ \t]+$/gm, '');
}

function isTrailingWhitespaceOnlyChange(before, after) {
  if (before === null || after === null || before === after) return false;
  return stripTrailingWhitespace(before) === stripTrailingWhitespace(after);
}

function isBranchTrailingWhitespaceOnly(filePath, scope) {
  return isTrailingWhitespaceOnlyChange(
    gitFile(scope.baseRef, filePath),
    gitFile('HEAD', filePath),
  );
}

function isLocalTrailingWhitespaceOnly(filePath) {
  const headContent = gitFile('HEAD', filePath);
  const indexContent = gitFile('', filePath);
  const worktreeContent = workingFile(filePath);

  if (headContent === null || indexContent === null || worktreeContent === null) return false;

  const stagedChanged = headContent !== indexContent;
  const worktreeChanged = indexContent !== worktreeContent;

  if (!stagedChanged && !worktreeChanged) return false;
  if (stagedChanged && !isTrailingWhitespaceOnlyChange(headContent, indexContent)) return false;
  if (worktreeChanged && !isTrailingWhitespaceOnlyChange(indexContent, worktreeContent)) return false;

  return true;
}

function isTrailingWhitespaceOnlyUiChange(filePath, scope) {
  if (scope.name === 'branch' && scope.baseRef) {
    return isBranchTrailingWhitespaceOnly(filePath, scope);
  }
  if (scope.name === 'local') {
    return isLocalTrailingWhitespaceOnly(filePath);
  }
  return false;
}

function mergeBaseFiles() {
  const candidates = ['origin/main', 'main', 'refs/remotes/origin/main', 'refs/heads/main'];
  for (const candidate of candidates) {
    const base = runGit(['merge-base', 'HEAD', candidate]);
    if (base) {
      return {
        baseRef: base,
        files: gitList(['diff', '--name-only', `${base}...HEAD`]),
      };
    }
  }
  return { baseRef: '', files: [] };
}

function uniqueSorted(files) {
  return Array.from(new Set(files)).sort();
}

function localFiles() {
  return uniqueSorted([
    ...gitList(['diff', '--cached', '--name-only']),
    ...gitList(['diff', '--name-only']),
    ...gitList(['ls-files', '--others', '--exclude-standard']),
  ]);
}

function changedFileScopes() {
  const branch = mergeBaseFiles();
  return [
    { name: 'local', files: localFiles() },
    { name: 'branch', files: branch.files, baseRef: branch.baseRef },
  ].filter((scope) => scope.files.length > 0);
}

function designArtifactSet(config) {
  return new Set([
    ...DESIGN_ARTIFACTS,
    ...(config.generated_outputs || []),
    ...(config.enforcement?.generated_allowlist || []),
    ...generatedOutputsFromRepoContract(),
  ].map(normalizePath));
}

function authoredUiFile(filePath, config, designArtifacts) {
  const normalized = normalizePath(filePath);
  if (designArtifacts.has(normalized)) return false;
  if (normalized.endsWith('.tokens.css')) return false;
  if ((config.enforcement?.paths || []).map(normalizePath).includes(normalized)) return true;
  return /^src\/(?:app|components|features)\/.+\.(?:css|jsx|tsx)$/.test(normalized);
}

function markerReason() {
  if (!fs.existsSync(NO_DESIGN_IMPACT_MARKER)) return '';
  return fs.readFileSync(NO_DESIGN_IMPACT_MARKER, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .join(' ')
    .trim();
}

function scopeResult(scope, config, designArtifacts) {
  const authoredUiFiles = scope.files.filter((file) => authoredUiFile(file, config, designArtifacts));
  const trailingWhitespaceOnlyUiFiles = authoredUiFiles.filter((file) => isTrailingWhitespaceOnlyUiChange(file, scope));
  const uiFiles = authoredUiFiles.filter((file) => !trailingWhitespaceOnlyUiFiles.includes(file));
  const changedDesignArtifacts = scope.files.filter((file) => designArtifacts.has(normalizePath(file)));
  return { ...scope, uiFiles, trailingWhitespaceOnlyUiFiles, changedDesignArtifacts };
}

function passedScopeSummary(result) {
  return `${result.name}: ${result.uiFiles.length} UI file(s), ${result.changedDesignArtifacts.length} design artifact(s)`;
}

function writeFailure(failingResults, designArtifacts) {
  process.stderr.write('Design change guard failed.\n');
  for (const result of failingResults) {
    process.stderr.write(`${result.name} authored UI files changed without a related DESIGN.md artifact:\n`);
    for (const file of result.uiFiles) {
      process.stderr.write(`- ${file}\n`);
    }
  }
  process.stderr.write('Update at least one related design artifact in the same local or branch scope:\n');
  for (const artifact of designArtifacts) {
    process.stderr.write(`- ${artifact}\n`);
  }
  process.stderr.write(`If this truly has no design impact, create ${NO_DESIGN_IMPACT_MARKER} with a short reason, keep it local, and remove it after the change is complete.\n`);
}

function main() {
  const config = readConfig();
  const designArtifacts = designArtifactSet(config);
  const results = changedFileScopes().map((scope) => scopeResult(scope, config, designArtifacts));
  const relevantResults = results.filter((result) => result.uiFiles.length > 0);
  const failingResults = relevantResults.filter((result) => result.changedDesignArtifacts.length === 0);

  if (relevantResults.length === 0) {
    const whitespaceOnlyResults = results.filter((result) => result.trailingWhitespaceOnlyUiFiles.length > 0);
    if (whitespaceOnlyResults.length > 0) {
      process.stdout.write(`design change guard passed: trailing-whitespace-only UI changes (${whitespaceOnlyResults.map((result) => `${result.name}: ${result.trailingWhitespaceOnlyUiFiles.length}`).join('; ')})\n`);
      return;
    }
    process.stdout.write('design change guard passed: no authored UI files changed\n');
    return;
  }

  if (failingResults.length === 0) {
    process.stdout.write(`design change guard passed: ${relevantResults.map(passedScopeSummary).join('; ')}\n`);
    return;
  }

  const reason = markerReason();
  if (reason) {
    process.stdout.write(`design change guard passed with ${NO_DESIGN_IMPACT_MARKER}: ${reason}\n`);
    return;
  }

  writeFailure(failingResults, designArtifacts);
  process.exit(1);
}

main();
