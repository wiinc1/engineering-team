#!/usr/bin/env node
const {
  getTrackedFiles,
  isRuntimeCode,
  loadOwnershipModel,
  matchDomains,
  matchesAny,
} = require('./governance-lib');

const { configPath, classification, domains } = loadOwnershipModel();
const trackedFiles = getTrackedFiles();
const runtimeFiles = trackedFiles.filter((file) => isRuntimeCode(file, classification));
const { unmatchedRuntimeFiles } = matchDomains(runtimeFiles, domains);
const violations = [];
const domainNames = new Set();

for (const domain of domains) {
  if (domainNames.has(domain.name)) {
    violations.push(`duplicate domain name: ${domain.name}`);
  }
  domainNames.add(domain.name);

  if (domain.runtimePatterns.length === 0) {
    violations.push(`domain ${domain.name} is missing runtime patterns`);
  }
  if (domain.testRequirements.length === 0) {
    violations.push(`domain ${domain.name} is missing test requirements`);
  }
  if (domain.docRequirements.length === 0) {
    violations.push(`domain ${domain.name} is missing doc requirements`);
  }

  const runtimeMatches = runtimeFiles.filter((file) => matchesAny(file, domain.runtimePatterns));
  if (runtimeMatches.length === 0) {
    violations.push(`domain ${domain.name} does not match any tracked runtime file`);
  }

  for (const requirement of domain.testRequirements) {
    const matches = trackedFiles.filter((file) => matchesAny(file, requirement.patterns));
    if (matches.length === 0) {
      violations.push(`domain ${domain.name} test requirement ${requirement.name} matches no tracked file`);
    }
  }

  for (const requirement of domain.docRequirements) {
    const matches = trackedFiles.filter((file) => matchesAny(file, requirement.patterns));
    if (matches.length === 0) {
      violations.push(`domain ${domain.name} doc requirement ${requirement.name} matches no tracked file`);
    }
  }
}

if (unmatchedRuntimeFiles.length > 0) {
  violations.push(
    `unmapped runtime files: ${unmatchedRuntimeFiles.join(', ')}`
  );
}

if (violations.length > 0) {
  process.stderr.write(`ownership map lint failed for ${configPath}\n${violations.join('\n')}\n`);
  process.exit(1);
}

process.stdout.write('ownership map lint passed\n');
