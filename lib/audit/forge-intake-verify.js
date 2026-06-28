const { githubSignature } = require('../../scripts/golden-path-smoke-lib');
const { resolveForgeIntakeProvider } = require('./forge-intake-provider');

const DEFAULT_GITLAB_PROJECT = 'wiinc1/engineering-team';
const DEFAULT_GITLAB_BASE_URL = 'http://192.168.1.116';
const DEFAULT_GITHUB_REPO = 'wiinc1/engineering-team';

function resolveGitLabBaseUrl(options = {}) {
  return String(
    options.gitlabBaseUrl
    || process.env.GITLAB_BASE_URL
    || process.env.GITLAB_INTAKE_BASE_URL
    || DEFAULT_GITLAB_BASE_URL,
  ).replace(/\/+$/, '');
}

function resolveGitLabProjectPath(options = {}) {
  return String(
    options.gitlabProjectPath
    || process.env.GITLAB_INTAKE_PROJECT
    || process.env.GITLAB_PROJECT_PATH
    || DEFAULT_GITLAB_PROJECT,
  ).trim();
}

function buildGitLabIssuePayload(issueIid, overrides = {}, options = {}) {
  const projectPath = resolveGitLabProjectPath(options);
  const gitlabBaseUrl = resolveGitLabBaseUrl(options);
  const issueUrl = `${gitlabBaseUrl}/${projectPath}/-/issues/${issueIid}`;
  const base = {
    object_kind: 'issue',
    event_type: 'issue',
    project: {
      id: 1,
      name: 'engineering-team',
      path_with_namespace: projectPath,
      web_url: `${gitlabBaseUrl}/${projectPath}`,
    },
    object_attributes: {
      id: 10_000 + issueIid,
      iid: issueIid,
      title: 'GP-002 verify intake draft',
      description: 'Automated GP-002 verify — issue description becomes raw_requirements.',
      url: issueUrl,
      action: 'open',
      state: 'opened',
    },
    labels: [{ title: 'factory-intake' }],
    user: { username: 'wiinc1' },
  };
  return {
    ...base,
    ...overrides,
    object_attributes: {
      ...base.object_attributes,
      ...(overrides.object_attributes || {}),
      iid: issueIid,
      url: overrides.object_attributes?.url || issueUrl,
    },
    project: {
      ...base.project,
      ...(overrides.project || {}),
      path_with_namespace: overrides.project?.path_with_namespace || projectPath,
    },
  };
}

function buildGitHubIssuePayload(issueNumber, overrides = {}) {
  const base = {
    action: 'opened',
    issue: {
      number: issueNumber,
      title: 'GP-002 verify intake draft',
      body: 'Automated GP-002 verify — issue body becomes raw_requirements.',
      html_url: `https://github.com/wiinc1/engineering-team/issues/${issueNumber}`,
      labels: [{ name: 'factory-intake' }],
    },
    repository: {
      full_name: DEFAULT_GITHUB_REPO,
      owner: { login: 'wiinc1' },
      name: 'engineering-team',
    },
    sender: { login: 'wiinc1' },
  };
  return {
    ...base,
    ...overrides,
    issue: {
      ...base.issue,
      ...(overrides.issue || {}),
      number: issueNumber,
      html_url: overrides.issue?.html_url || base.issue.html_url,
    },
  };
}

function buildIssuePayload(issueNumber, overrides = {}, options = {}) {
  const provider = resolveForgeIntakeProvider(options);
  if (provider === 'github') {
    return buildGitHubIssuePayload(issueNumber, overrides);
  }
  return buildGitLabIssuePayload(issueNumber, overrides, options);
}

function resolveWebhookPath(options = {}) {
  return resolveForgeIntakeProvider(options) === 'github'
    ? '/github/webhooks'
    : '/gitlab/webhooks';
}

function expectedForgeIssueUrl(issueNumber, options = {}) {
  const provider = resolveForgeIntakeProvider(options);
  if (provider === 'github') {
    return `https://github.com/wiinc1/engineering-team/issues/${issueNumber}`;
  }
  const projectPath = resolveGitLabProjectPath(options);
  const gitlabBaseUrl = resolveGitLabBaseUrl(options);
  return `${gitlabBaseUrl}/${projectPath}/-/issues/${issueNumber}`;
}

async function postIssueWebhook(runtime, { issueNumber, deliveryId, secret, options = {} }) {
  const provider = resolveForgeIntakeProvider({ ...runtime, ...options });
  const payload = buildIssuePayload(issueNumber, {}, { ...runtime, ...options });
  const body = JSON.stringify(payload);
  const baseUrl = runtime.baseUrl.replace(/\/+$/, '');
  const path = resolveWebhookPath({ ...runtime, ...options });

  const headers = {
    'content-type': 'application/json',
  };

  if (provider === 'github') {
    headers['x-github-event'] = 'issues';
    headers['x-github-delivery'] = deliveryId;
    headers['x-hub-signature-256'] = githubSignature(secret, body);
  } else {
    headers['x-gitlab-event'] = 'Issue Hook';
    headers['x-gitlab-token'] = secret;
    headers['x-gitlab-event-uuid'] = deliveryId;
  }

  const response = await runtime.fetchImpl(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body,
  });
  const responseBody = await response.json().catch(() => ({}));
  return {
    status: response.status,
    ok: response.ok,
    body: responseBody,
    provider,
    webhookPath: path,
  };
}

function resolveWebhookSecret(runtime = {}, options = {}) {
  const provider = resolveForgeIntakeProvider({ ...runtime, ...options });
  if (provider === 'github') {
    return runtime.githubWebhookSecret
      || process.env.GITHUB_WEBHOOK_SECRET
      || 'golden-path-local-webhook-secret';
  }
  return runtime.gitlabWebhookSecret
    || process.env.GITLAB_WEBHOOK_SECRET
    || process.env.GITHUB_WEBHOOK_SECRET
    || 'golden-path-local-webhook-secret';
}

function readCreatedForgeIssueUrl(historyBody = {}, issueNumber, options = {}) {
  const created = (historyBody.items || []).find((item) => item.event_type === 'task.created');
  const payload = created?.payload || {};
  const provider = resolveForgeIntakeProvider(options);
  if (provider === 'gitlab') {
    return payload.gitlab_issue_url || payload.forge_issue_url || null;
  }
  return payload.github_issue_url || payload.forge_issue_url || null;
}

module.exports = {
  DEFAULT_GITLAB_BASE_URL,
  DEFAULT_GITLAB_PROJECT,
  buildGitHubIssuePayload,
  buildGitLabIssuePayload,
  buildIssuePayload,
  expectedForgeIssueUrl,
  postIssueWebhook,
  resolveForgeIntakeProvider,
  resolveWebhookPath,
  resolveWebhookSecret,
  readCreatedForgeIssueUrl,
};