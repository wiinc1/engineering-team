#!/usr/bin/env node
const {
  getTrackedFiles,
  isRuntimeCode,
  loadOwnershipModel,
  matchDomains,
  matchesAny,
} = require('./governance-lib');

const strict = process.argv.includes('--strict');
const { classification, domains } = loadOwnershipModel();
const trackedFiles = getTrackedFiles();
const runtimeFiles = trackedFiles.filter((file) => isRuntimeCode(file, classification));
const { matchedDomains, unmatchedRuntimeFiles } = matchDomains(runtimeFiles, domains);
const issues = [];
const lines = ['Governance drift report'];

if (unmatchedRuntimeFiles.length > 0) {
  issues.push(`Unmapped runtime files: ${unmatchedRuntimeFiles.join(', ')}`);
}

for (const { domain } of matchedDomains.values()) {
  const matchedRuntime = runtimeFiles.filter((file) => matchesAny(file, domain.runtimePatterns));
  const testGaps = domain.testRequirements.filter((requirement) => !trackedFiles.some((file) => matchesAny(file, requirement.patterns)));
  const docGaps = domain.docRequirements.filter((requirement) => !trackedFiles.some((file) => matchesAny(file, requirement.patterns)));

  lines.push(`- ${domain.name}: ${matchedRuntime.length} runtime files`);
  if (testGaps.length > 0) {
    issues.push(`Domain ${domain.name} has missing test requirement coverage: ${testGaps.map((gap) => gap.name).join(', ')}`);
  }
  if (docGaps.length > 0) {
    issues.push(`Domain ${domain.name} has missing doc requirement coverage: ${docGaps.map((gap) => gap.name).join(', ')}`);
  }
}

if (issues.length === 0) {
  lines.push('No governance drift detected.');
} else {
  lines.push('Issues:');
  for (const issue of issues) {
    lines.push(`- ${issue}`);
  }
}

process.stdout.write(`${lines.join('\n')}\n`);

if (strict && issues.length > 0) {
  process.exit(1);
}
