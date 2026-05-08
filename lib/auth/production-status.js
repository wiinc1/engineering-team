const fs = require('node:fs');
const path = require('node:path');

const ISSUE_151_MIN_SMOKE_AT = '2026-05-07T00:00:00.000Z';

const REQUIRED_MAGIC_LINK_SUMMARY_CHECKS = [
  'requestGeneric',
  'consumeRedirected',
  'sessionCookieSet',
  'csrfCookieSet',
  'meReturnedIdentity',
  'protectedRoutesLoaded',
  'logoutRevoked',
  'unknownEmailGeneric',
  'replayRejected',
  'passed',
  'evidenceRedacted',
];

const REQUIRED_OIDC_SUMMARY_CHECKS = [
  'discoveryLoaded',
  'hostedCallbackRouteLoaded',
  'meReturnedIdentity',
  'protectedRoutesLoaded',
  'logoutValidated',
  'rollbackTargetPresent',
  'passed',
  'evidenceRedacted',
];

const REQUIRED_DOC_REFERENCES = [
  {
    path: 'docs/runbooks/production-auth-status.md',
    patterns: [
      /auth:oidc:production-smoke/,
      /npm run auth:status:check -- --require-complete/,
      /Issue #151/i,
      /Issue #137/i,
      /rollback target/i,
    ],
  },
  {
    path: 'README.md',
    patterns: [
      /docs\/runbooks\/production-auth-status\.md/,
      /auth:status:check -- --require-complete/,
    ],
  },
  {
    path: 'docs/runbooks/production-identity-provider.md',
    patterns: [
      /docs\/runbooks\/production-auth-status\.md/,
      /auth:status:check -- --require-complete/,
    ],
  },
  {
    path: 'docs/reports/ISSUE-137-production-login-evidence.md',
    patterns: [
      /Issue #151/i,
      /docs\/runbooks\/production-auth-status\.md/,
      /auth:status:check -- --require-complete/,
      /April issue #92/i,
    ],
  },
  {
    path: 'docs/diagrams/workflow-production-auth-status-evidence.mmd',
    patterns: [/flowchart/i, /Fresh production smoke/i],
  },
  {
    path: 'docs/diagrams/architecture-production-auth-status-evidence.mmd',
    patterns: [/flowchart/i, /Status validator/i],
  },
  {
    path: 'monitoring/dashboards/production-auth-status.json',
    patterns: [/feature_production_auth_smoke_result/, /auth-no-login-path-after-deploy/],
  },
];

function readFile(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function resolveInputPath(root, inputPath) {
  return path.isAbsolute(inputPath) ? inputPath : path.join(root, inputPath);
}

function parseEvidence(input) {
  if (!input) return null;
  if (typeof input === 'string') return JSON.parse(input);
  return input;
}

function isValidDate(value) {
  const time = Date.parse(value);
  return Number.isFinite(time);
}

function strategyDocPatterns(selectedStrategy) {
  return selectedStrategy === 'oidc'
    ? [
        /Active production strategy:\s*`?oidc`?/i,
        /observability\/oidc-production-smoke\.json/,
        /auth:oidc:production-smoke/,
      ]
    : [
        /Active production strategy:\s*`?magic-link`?/i,
        /observability\/magic-link-production-smoke\.json/,
        /auth:magic-link:production-smoke/,
      ];
}

function docPatterns(reference, selectedStrategy) {
  return reference.path === 'docs/runbooks/production-auth-status.md'
    ? [...reference.patterns, ...strategyDocPatterns(selectedStrategy)]
    : reference.patterns;
}

function validateStatusDocs({ root = process.cwd(), selectedStrategy = 'magic-link' } = {}) {
  const checks = [];
  const failures = [];

  for (const reference of REQUIRED_DOC_REFERENCES) {
    const fullPath = path.join(root, reference.path);
    if (!fs.existsSync(fullPath)) {
      failures.push(`${reference.path} is missing.`);
      checks.push({ path: reference.path, ok: false, missing: ['file'] });
      continue;
    }

    const body = readFile(root, reference.path);
    const missing = docPatterns(reference, selectedStrategy)
      .filter((pattern) => !pattern.test(body))
      .map((pattern) => pattern.toString());

    if (missing.length) {
      failures.push(`${reference.path} is missing required production-auth status references.`);
    }
    checks.push({ path: reference.path, ok: missing.length === 0, missing });
  }

  return { ok: failures.length === 0, checks, failures };
}

function validateEvidenceTimestamp(evidence, failures, minGeneratedAt) {
  if (!isValidDate(evidence.generatedAt)) {
    failures.push('Evidence must include a valid generatedAt timestamp.');
  } else if (minGeneratedAt && Date.parse(evidence.generatedAt) < Date.parse(minGeneratedAt)) {
    failures.push(`Evidence generatedAt must be on or after ${minGeneratedAt}.`);
  }

  if (evidence.dryRun) {
    failures.push('Dry-run evidence does not satisfy the production smoke requirement.');
  }
}

function validateEvidenceSummary(evidence, failures) {
  for (const check of REQUIRED_MAGIC_LINK_SUMMARY_CHECKS) {
    if (evidence.summary?.[check] !== true) {
      failures.push(`Evidence summary.${check} must be true.`);
    }
  }
}

function validateOidcEvidenceSummary(evidence, failures) {
  for (const check of REQUIRED_OIDC_SUMMARY_CHECKS) {
    if (evidence.summary?.[check] !== true) {
      failures.push(`Evidence summary.${check} must be true.`);
    }
  }
}

function validateEvidenceDeployment(evidence, failures, expectedStrategy) {
  if (evidence.deployment?.selectedAuthStrategy !== expectedStrategy) {
    failures.push(`Evidence deployment.selectedAuthStrategy must be "${expectedStrategy}".`);
  }

  if (!evidence.deployment?.url && !evidence.deployment?.id) {
    failures.push('Evidence deployment must include a deployment URL or ID.');
  }

  if (!evidence.deployment?.rollbackTarget) {
    failures.push('Evidence deployment.rollbackTarget must identify the rollback target.');
  }
}

function secretEvidencePatterns() {
  return [
    /AUTH_PROD_MAGIC_LINK_URL/i,
    /AUTH_PROD_INVITED_EMAIL/i,
    /AUTH_PROD_UNKNOWN_EMAIL/i,
    /AUTH_PROD_OIDC_ACCESS_TOKEN/i,
    /RESEND_API_KEY/i,
    /engineering_team_session=/i,
    /engineering_team_csrf=/i,
    /cookieHeader/i,
    /csrfToken/i,
    /Bearer\s+[A-Za-z0-9._~+/=-]+/i,
    /access_token/i,
    /id_token/i,
    /refresh_token/i,
    /client_secret/i,
    /approved-admin@example\.com/i,
    /unknown-smoke@example\.com/i,
    /token=[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+/i,
  ];
}

function validateEvidenceRedaction(evidence, failures) {
  const serialized = JSON.stringify(evidence);
  for (const pattern of secretEvidencePatterns()) {
    if (pattern.test(serialized)) {
      failures.push(`Evidence appears to contain secret-bearing material matching ${pattern}.`);
    }
  }
}

function validateMagicLinkEvidence(
  input,
  { minGeneratedAt = ISSUE_151_MIN_SMOKE_AT } = {}
) {
  const evidence = parseEvidence(input);
  const failures = [];

  if (!evidence) {
    return { ok: false, failures: ['Magic-link production smoke evidence is missing.'] };
  }

  validateEvidenceTimestamp(evidence, failures, minGeneratedAt);
  validateEvidenceSummary(evidence, failures);
  validateEvidenceDeployment(evidence, failures, 'magic-link');
  validateEvidenceRedaction(evidence, failures);

  return { ok: failures.length === 0, failures };
}

function validateOidcEvidence(
  input,
  { minGeneratedAt = ISSUE_151_MIN_SMOKE_AT } = {}
) {
  const evidence = parseEvidence(input);
  const failures = [];

  if (!evidence) {
    return { ok: false, failures: ['OIDC production smoke evidence is missing.'] };
  }

  validateEvidenceTimestamp(evidence, failures, minGeneratedAt);
  validateOidcEvidenceSummary(evidence, failures);
  validateEvidenceDeployment(evidence, failures, 'oidc');
  validateEvidenceRedaction(evidence, failures);

  return { ok: failures.length === 0, failures };
}

function defaultEvidencePath(selectedStrategy) {
  return selectedStrategy === 'oidc'
    ? 'observability/oidc-production-smoke.json'
    : 'observability/magic-link-production-smoke.json';
}

function validateEvidenceForStrategy(strategy, input, options = {}) {
  return strategy === 'oidc'
    ? validateOidcEvidence(input, options)
    : validateMagicLinkEvidence(input, options);
}

function validateProductionAuthStatus({
  root = process.cwd(),
  selectedStrategy = 'magic-link',
  evidencePath = defaultEvidencePath(selectedStrategy),
  requireComplete = false,
  minGeneratedAt = ISSUE_151_MIN_SMOKE_AT,
} = {}) {
  const docs = validateStatusDocs({ root, selectedStrategy });
  const evidenceFullPath = resolveInputPath(root, evidencePath);
  const warnings = [];
  let evidence = {
    ok: false,
    failures: [`${evidencePath} is missing.`],
  };

  if (fs.existsSync(evidenceFullPath)) {
    evidence = validateEvidenceForStrategy(selectedStrategy, fs.readFileSync(evidenceFullPath, 'utf8'), {
      minGeneratedAt,
    });
  }

  if (!evidence.ok) {
    warnings.push(...evidence.failures);
  }

  return {
    ok: docs.ok && (!requireComplete || evidence.ok),
    requireComplete,
    selectedStrategy,
    docs,
    evidence,
    warnings,
  };
}

module.exports = {
  ISSUE_151_MIN_SMOKE_AT,
  REQUIRED_DOC_REFERENCES,
  REQUIRED_MAGIC_LINK_SUMMARY_CHECKS,
  REQUIRED_OIDC_SUMMARY_CHECKS,
  validateMagicLinkEvidence,
  validateOidcEvidence,
  validateProductionAuthStatus,
  validateStatusDocs,
};
