function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

function checkRunFrom(check = {}, index = 0) {
  return {
    id: check.id || index + 1,
    name: check.name || check.context || 'check-run',
    status: check.status || 'completed',
    conclusion: check.conclusion || 'success',
    html_url: check.url || `https://github.example/checks/${index + 1}`,
  };
}

function createGithubEvidenceFetchMock(options = {}) {
  const prNumber = Number(options.prNumber || 1);
  const repository = options.repository || 'wiinc1/engineering-team';
  const [owner, repo] = repository.split('/');
  const branchName = options.branchName || 'factory/real-candidate-proof';
  const commitSha = options.commitSha || '3f4a7c9e12b84d6f90a1c2e3b4d5f6789012abcd';
  const baseBranch = options.baseBranch || 'main';
  const prUrl = options.prUrl || `https://github.com/${owner}/${repo}/pull/${prNumber}`;
  const changedFiles = options.changedFiles || [
    'lib/task-platform/factory-delivery.js',
    'tests/unit/factory-delivery.test.js',
  ];
  const requiredChecks = options.requiredChecks || ['Unit tests', 'Merge readiness'];
  const checks = options.checks || [
    { name: 'Unit tests', conclusion: 'success', source: 'github_check_run' },
    { name: 'Merge readiness', conclusion: 'success', source: 'github_check_run' },
  ];

  return async (url) => {
    const target = String(url);
    if (target.includes(`/repos/${owner}/${repo}/branches/${encodeURIComponent(baseBranch)}/protection`)) {
      return jsonResponse({ required_status_checks: { checks: requiredChecks.map((context) => ({ context })) } });
    }
    if (target.includes(`/repos/${owner}/${repo}/pulls/${prNumber}/files`)) {
      return jsonResponse(changedFiles.map((filename) => ({ filename })));
    }
    if (target.includes(`/repos/${owner}/${repo}/pulls/${prNumber}`)) {
      return jsonResponse({
        number: prNumber,
        html_url: prUrl,
        head: { ref: branchName, sha: commitSha },
        base: { ref: baseBranch },
        merged: options.merged === true,
        merge_commit_sha: options.mergeCommitSha || null,
        merged_at: options.mergedAt || null,
      });
    }
    if (target.includes(`/repos/${owner}/${repo}/commits/${commitSha}/check-runs`)) {
      return jsonResponse({ check_runs: checks.map(checkRunFrom) });
    }
    if (target.includes(`/repos/${owner}/${repo}/commits/${commitSha}/status`)) {
      return jsonResponse({ statuses: options.statuses || [] });
    }
    return jsonResponse({ message: `unexpected GitHub mock route ${target}` }, 404);
  };
}

module.exports = {
  createGithubEvidenceFetchMock,
  jsonResponse,
};
