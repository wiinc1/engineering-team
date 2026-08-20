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
    'Every governed field line MUST begin with the literal ASCII characters `- ` (hyphen followed by one space), exactly as shown below. The hosted validator matches `^- <label>:` at the start of a line; an unbulleted `Task: value` line is treated as missing. Preserve the `- ` prefix when replacing each blank value.',
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
    'Never use a bare placeholder value in a required field. The repository rejects `None`, `N/A`, `TBD`, `TODO`, and `unknown` (case-insensitive). For Standards gaps or exceptions when no gap exists, write `No gaps or exceptions; rationale: <specific reason this change conforms>`. Do not write only `None`.',
    'Do not use bare `pending` for completed local evidence. The CI result may say `Pending at PR creation; all protected checks are required before merge` because hosted checks start after the PR is opened.',
    'Every Test evidence paths and Doc evidence paths entry must be a file actually changed in this PR. For a documentation-only change, use the changed documentation path for both fields because repository validation is the test evidence.',
    githubIssueUrl
      ? `Include a closing reference for the source issue (${githubIssueUrl}), such as \`Closes #${issueNumber || '<issue-number>'}\`.`
      : 'If a source issue is discoverable from the task context, include a closing reference such as `Closes #<issue-number>`.',
  ];
}

module.exports = { buildTrustedPrMetadataRules, issueNumberFromUrl };
