const test = require('node:test');
const assert = require('node:assert/strict');

const {
  makeTempDir,
  runScript,
  writeFile,
} = require('./helpers');

function createValidStandardsFixture(root, overrides = {}) {
  writeFile(root, 'docs/standards/software-development-standards.md', `# Standards

## Repo Enforcement Policy
- Every task file under \`tasks/\` must include \`## Standards Alignment\` and \`## Required Evidence\`.
- Every ADR under \`docs/adr/\` must include \`## Standards Alignment\` and \`## Required Evidence\`.
- Every report under \`docs/reports/\` must include \`## Standards Alignment\` and \`## Required Evidence\`.
- Diff-based adjacency rules are maintained in \`config/change-ownership-map.json\`; maintainer guidance lives in \`docs/standards/change-governance-maintenance.md\`.

## Required Gap Statement Format
Gap observed: X. Documented rationale: Y (source Z).
`);
  writeFile(root, 'docs/standards/change-governance-maintenance.md', '# maintenance\n');
  writeFile(root, 'config/change-ownership-map.json', JSON.stringify({
    classification: {
      runtime_roots: ['src'],
      test_patterns: ['^tests/', '\\.test\\.[^.]+$'],
      doc_patterns: ['^docs/', '^tasks/.+\\.md$'],
      non_runtime_patterns: ['^\\.github/'],
    },
    domains: [],
  }, null, 2));
  writeFile(root, 'docs/templates/STANDARDS_COMPLIANCE_CHECKLIST.md', `# Checklist

## Architecture and Design
## Coding and Code Quality
## Testing and Quality Assurance
## Deployment and Release
## Observability and Monitoring
## Team and Process
## Required Evidence
`);
  writeFile(root, 'docs/templates/ADR_TEMPLATE.md', `# ADR

## Standards Alignment
## Required Evidence
`);
  writeFile(root, 'docs/templates/REPORT_TEMPLATE.md', `# Report

## Standards Alignment
## Required Evidence
`);
  writeFile(root, '.github/PULL_REQUEST_TEMPLATE.md', `## Standards Compliance
- Compliance checklist path:
- Standards gaps or exceptions:

## Required Evidence
- \`npm run standards:check\`
- Test evidence paths:
- Doc evidence paths:
- Docs updated:
`);
  writeFile(root, 'agents/README.md', `# Agents

## Standards Enforcement
- \`docs/standards/software-development-standards.md\`
`);

  const commonDoc = overrides.commonDoc || `## Standards Alignment

- Applicable standards areas: testing and quality assurance
- Evidence expected for this change: linked evidence
- Gap observed: Gap observed: known limitation. Documented rationale: tracked for follow-up (source https://example.com/standard).

## Required Evidence

- Commands run: npm run standards:check
- Tests added or updated: governance tests
- Rollout or rollback notes: additive validation only
- Docs updated: standards docs
`;

  writeFile(root, 'tasks/TASK-001.md', overrides.taskDoc || commonDoc);
  writeFile(root, 'docs/adr/ADR-001.md', overrides.adrDoc || commonDoc.replace('Evidence expected for this change', 'Evidence in this decision'));
  writeFile(root, 'docs/reports/REPORT-001.md', overrides.reportDoc || commonDoc.replace('Evidence expected for this change', 'Evidence in this report'));
}

test('verify-standards passes on valid task, adr, and report docs', () => {
  const root = makeTempDir('governance-standards-pass-');
  createValidStandardsFixture(root);

  const result = runScript('verify-standards.js', root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /standards checks passed/);
});

test('verify-standards fails when a required section is missing', () => {
  const root = makeTempDir('governance-standards-missing-');
  createValidStandardsFixture(root, {
    taskDoc: `## Standards Alignment

- Applicable standards areas: testing and quality assurance
- Evidence expected for this change: linked evidence
- Gap observed: Gap observed: known limitation. Documented rationale: tracked for follow-up (source https://example.com/standard).
`,
  });

  const result = runScript('verify-standards.js', root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing section: Required Evidence/);
});

test('verify-standards fails on placeholder evidence values', () => {
  const root = makeTempDir('governance-standards-placeholder-');
  createValidStandardsFixture(root, {
    taskDoc: `## Standards Alignment

- Applicable standards areas: testing and quality assurance
- Evidence expected for this change: linked evidence
- Gap observed: Gap observed: known limitation. Documented rationale: tracked for follow-up (source https://example.com/standard).

## Required Evidence

- Commands run: todo
- Tests added or updated: governance tests
- Rollout or rollback notes: additive validation only
- Docs updated: standards docs
`,
  });

  const result = runScript('verify-standards.js', root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /uses placeholder value for Commands run: todo/);
});

test('verify-standards fails on malformed gap statements', () => {
  const root = makeTempDir('governance-standards-gap-');
  createValidStandardsFixture(root, {
    reportDoc: `## Standards Alignment

- Applicable standards areas: testing and quality assurance
- Evidence in this report: linked evidence
- Gap observed: missing rationale and source

## Required Evidence

- Commands run: npm run standards:check
- Tests added or updated: governance tests
- Rollout or rollback notes: additive validation only
- Docs updated: standards docs
`,
  });

  const result = runScript('verify-standards.js', root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /gap statement must include "Documented rationale:"/);
});
