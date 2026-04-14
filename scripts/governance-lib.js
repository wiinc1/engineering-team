const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function getRepoRoot(cwd = process.cwd()) {
  return cwd;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function compilePatterns(patterns) {
  return patterns.map((pattern) => new RegExp(pattern));
}

function loadOwnershipConfig(root = getRepoRoot()) {
  const configPath = path.join(root, 'config', 'change-ownership-map.json');
  const config = readJson(configPath);
  return { configPath, config };
}

function loadOwnershipModel(root = getRepoRoot()) {
  const { configPath, config } = loadOwnershipConfig(root);
  return {
    configPath,
    classification: {
      runtimeRoots: config.classification.runtime_roots,
      testPatterns: compilePatterns(config.classification.test_patterns),
      docPatterns: compilePatterns(config.classification.doc_patterns),
      nonRuntimePatterns: compilePatterns(config.classification.non_runtime_patterns),
    },
    domains: config.domains.map((domain) => ({
      name: domain.name,
      runtimePatterns: compilePatterns(domain.runtime_patterns),
      testRequirements: domain.test_requirements.map((requirement) => ({
        name: requirement.name,
        patterns: compilePatterns(requirement.patterns),
      })),
      docRequirements: domain.doc_requirements.map((requirement) => ({
        name: requirement.name,
        patterns: compilePatterns(requirement.patterns),
      })),
    })),
  };
}

function runGit(args, cwd = getRepoRoot()) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function getPullRequestShas(eventPath) {
  if (!eventPath || !fs.existsSync(eventPath)) return {};
  const event = readJson(eventPath);
  return {
    body: event.pull_request?.body || '',
    baseSha: event.pull_request?.base?.sha,
    headSha: event.pull_request?.head?.sha,
  };
}

function getChangedFiles(root = getRepoRoot(), eventName = process.env.GITHUB_EVENT_NAME, eventPath = process.env.GITHUB_EVENT_PATH) {
  if (eventName === 'pull_request') {
    const { baseSha, headSha } = getPullRequestShas(eventPath);
    if (baseSha && headSha) {
      return runGit(['diff', '--name-only', `${baseSha}...${headSha}`], root)
        .split('\n')
        .map((file) => file.trim())
        .filter(Boolean);
    }
  }

  const fallback = runGit(['diff', '--name-only', 'HEAD'], root);
  return fallback
    .split('\n')
    .map((file) => file.trim())
    .filter(Boolean);
}

function getTrackedFiles(root = getRepoRoot()) {
  const output = runGit(['ls-files', '--cached', '--others', '--exclude-standard'], root);
  return output
    .split('\n')
    .map((file) => file.trim())
    .filter(Boolean);
}

function matchesAny(file, patterns) {
  return patterns.some((pattern) => pattern.test(file));
}

function isRuntimeCode(file, classification) {
  if (matchesAny(file, classification.testPatterns)) return false;
  if (matchesAny(file, classification.docPatterns)) return false;
  if (matchesAny(file, classification.nonRuntimePatterns)) return false;
  return classification.runtimeRoots.some((prefix) => file === prefix || file.startsWith(`${prefix}/`));
}

function classifyChangedFiles(files, classification) {
  return {
    runtimeChanges: files.filter((file) => isRuntimeCode(file, classification)),
    testChanges: files.filter((file) => matchesAny(file, classification.testPatterns)),
    docChanges: files.filter((file) => matchesAny(file, classification.docPatterns)),
  };
}

function matchDomains(runtimeFiles, domains) {
  const matchedDomains = new Map();
  const unmatchedRuntimeFiles = [];

  for (const file of runtimeFiles) {
    const domainMatches = domains.filter((domain) => matchesAny(file, domain.runtimePatterns));
    if (domainMatches.length === 0) {
      unmatchedRuntimeFiles.push(file);
      continue;
    }

    for (const domain of domainMatches) {
      if (!matchedDomains.has(domain.name)) {
        matchedDomains.set(domain.name, { domain, runtimeFiles: [] });
      }
      matchedDomains.get(domain.name).runtimeFiles.push(file);
    }
  }

  return { matchedDomains, unmatchedRuntimeFiles };
}

function findRequirementMatches(files, requirements) {
  return requirements.map((requirement) => ({
    name: requirement.name,
    matches: files.filter((file) => matchesAny(file, requirement.patterns)),
  }));
}

function normalizePathList(value) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.replace(/^`|`$/g, ''));
}

module.exports = {
  classifyChangedFiles,
  findRequirementMatches,
  getChangedFiles,
  getPullRequestShas,
  getTrackedFiles,
  isRuntimeCode,
  loadOwnershipConfig,
  loadOwnershipModel,
  matchesAny,
  matchDomains,
  normalizePathList,
  runGit,
};
