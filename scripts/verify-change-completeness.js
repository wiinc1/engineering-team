#!/usr/bin/env node
const {
  classifyChangedFiles,
  findRequirementMatches,
  getChangedFiles,
  getTrackedFiles,
  loadOwnershipModel,
  matchDomains,
} = require('./governance-lib');

const { classification, domains } = loadOwnershipModel();
const changedFiles = getChangedFiles();
const trackedFiles = getTrackedFiles();
const { runtimeChanges, testChanges, docChanges } = classifyChangedFiles(changedFiles, classification);
const { matchedDomains, unmatchedRuntimeFiles } = matchDomains(runtimeChanges, domains);
const violations = [];

function sampleMatches(requirements) {
  return requirements
    .map((requirement) => {
      const examples = trackedFiles.filter((file) =>
        requirement.patterns.some((pattern) => pattern.test(file))
      ).slice(0, 3);
      return `${requirement.name}${examples.length ? ` (e.g. ${examples.join(', ')})` : ''}`;
    })
    .join('; ');
}

if (runtimeChanges.length > 0 && testChanges.length === 0) {
  violations.push(
    `runtime code changed without accompanying test changes: ${runtimeChanges.join(', ')}`
  );
}

if (runtimeChanges.length > 0 && docChanges.length === 0) {
  violations.push(
    `runtime code changed without accompanying task/doc evidence updates: ${runtimeChanges.join(', ')}`
  );
}

for (const { domain, runtimeFiles } of matchedDomains.values()) {
  const testGroups = findRequirementMatches(changedFiles, domain.testRequirements);
  const docGroups = findRequirementMatches(changedFiles, domain.docRequirements);
  const missingTestGroups = testGroups.filter((group) => group.matches.length === 0).map((group) => group.name);
  const missingDocGroups = docGroups.filter((group) => group.matches.length === 0).map((group) => group.name);

  if (missingTestGroups.length > 0) {
    violations.push(
      `domain ${domain.name} changed (${runtimeFiles.join(', ')}) without required test groups: ${missingTestGroups.join(', ')}. Suggested files: ${sampleMatches(domain.testRequirements)}`
    );
  }

  if (missingDocGroups.length > 0) {
    violations.push(
      `domain ${domain.name} changed (${runtimeFiles.join(', ')}) without required doc groups: ${missingDocGroups.join(', ')}. Suggested files: ${sampleMatches(domain.docRequirements)}`
    );
  }
}

if (runtimeChanges.length > 0 && unmatchedRuntimeFiles.length > 0) {
  violations.push(
    `runtime files are not mapped to an ownership domain: ${unmatchedRuntimeFiles.join(', ')}. Update config/change-ownership-map.json to add or extend a domain.`
  );
}

if (violations.length > 0) {
  process.stderr.write(`${violations.join('\n')}\n`);
  process.exit(1);
}

process.stdout.write('change completeness checks passed\n');
