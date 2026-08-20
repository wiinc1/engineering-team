function issueNumberFromUrl(issueUrl) {
  return String(issueUrl || '').match(/\/(\d+)(?:$|[/?#])/)?.[1] || null;
}

function buildTrustedPrMetadataRules({ repository, githubIssueUrl, changedFiles = [] } = {}) {
  const expectedChangedFiles = Array.isArray(changedFiles)
    ? changedFiles.map(String).filter(Boolean)
    : [];
  const issueNumber = issueNumberFromUrl(githubIssueUrl);
  return [
    `Repository: ${repository || '(resolve from the supplied GitHub issue or checkout)'}`,
    `Source GitHub issue: ${githubIssueUrl || '(not supplied)'}`,
    `Expected changed files: ${expectedChangedFiles.length ? expectedChangedFiles.join(', ') : '(not supplied)'}`,
    'Before opening the pull request, write a complete body with non-placeholder values for every line below. Do not open the PR with an incomplete body and repair it later:',
    '- Task:',
    '- Standards baseline reviewed:',
    '- Checklist completed or updated:',
    '- Compliance checklist path:',
    '- Relevant standards areas:',
    '- Standards gaps or exceptions:',
    '- Standards check result:',
    '- Lint result:',
    '- Tests:',
    '- Test evidence paths:',
    '- Docs updated:',
    '- Doc evidence paths:',
    '- Risk level:',
    '- Rollback path:',
    '- Risk class:',
    '- Automation gap:',
    '- Test evidence:',
    '- CI result:',
    'Every Test evidence paths and Doc evidence paths entry must be a file actually changed in this PR. For a documentation-only change, use the changed documentation path for both fields because repository validation is the test evidence.',
    githubIssueUrl
      ? `Include a closing reference for the source issue (${githubIssueUrl}), such as \`Closes #${issueNumber || '<issue-number>'}\`.`
      : 'If a source issue is discoverable from the task context, include a closing reference such as `Closes #<issue-number>`.',
  ];
}

module.exports = { buildTrustedPrMetadataRules, issueNumberFromUrl };
