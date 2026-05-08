const fs = require('node:fs');
const path = require('node:path');

const ISSUE_REGISTRATION_MIN_SMOKE_AT = '2026-05-08T00:00:00.000Z';
const ISSUE_151_MIN_SMOKE_AT = ISSUE_REGISTRATION_MIN_SMOKE_AT;

const REQUIRED_REGISTRATION_SUMMARY_CHECKS = [
  'registrationStrategySelected',
  'loginAccepted',
  'sessionCookieSet',
  'csrfCookieSet',
  'meReturnedIdentity',
  'protectedRoutesLoaded',
  'passwordResetGeneric',
  'logoutRevoked',
  'afterLogoutRejected',
  'magicLinkRemoved',
  'rollbackTargetPresent',
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
      /Active production strategy:\s*`?registration`?/i,
      /observability\/registration-auth-production-smoke\.json/,
      /auth:registration:production-smoke/,
      /auth:status:check -- --require-complete/,
      /Issue #151/i,
      /Issue #160/i,
      /Issue #166/i,
      /Issue #167/i,
      /rollback target/i,
    ],
  },
  {
    path: 'README.md',
    patterns: [/docs\/runbooks\/production-auth-status\.md/, /auth:status:check -- --require-complete/, /registration/i],
  },
  {
    path: 'docs/runbooks/production-identity-provider.md',
    patterns: [/docs\/runbooks\/production-auth-status\.md/, /auth:status:check -- --require-complete/, /registration/i],
  },
  {
    path: 'docs/reports/ISSUE-151-requirements-audit.md',
    patterns: [/registration/i, /Issue #160/i, /Issue #167/i],
  },
  {
    path: 'docs/diagrams/workflow-registration-production-gates.mmd',
    patterns: [/flowchart/i, /Registration production smoke/i],
  },
  {
    path: 'docs/diagrams/workflow-remove-magic-link-auth.mmd',
    patterns: [/flowchart/i, /Magic-link removed/i],
  },
  {
    path: 'monitoring/dashboards/production-auth-status.json',
    patterns: [/feature_production_auth_smoke_result/, /registration/i],
  },
  {
    path: 'monitoring/dashboards/registration-auth-security.json',
    patterns: [/auth_login_failures/, /auth_password_reset_requests/, /registration/i],
  },
  {
    path: 'monitoring/alerts/registration-auth-security.yml',
    patterns: [/registration-auth-login-failure-spike/, /registration-auth-smoke-failure/, /redaction/i],
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
  return Number.isFinite(Date.parse(value));
}

function validateStatusDocs({ root = process.cwd() } = {}) {
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
    const missing = reference.patterns.filter((pattern) => !pattern.test(body)).map((pattern) => pattern.toString());
    if (missing.length) failures.push(`${reference.path} is missing required registration auth status references.`);
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
  if (evidence.dryRun) failures.push('Dry-run evidence does not satisfy the production smoke requirement.');
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
    /AUTH_PROD_REGISTRATION_PASSWORD/i,
    /AUTH_PROD_REGISTRATION_EMAIL/i,
    /AUTH_PROD_PASSWORD_RESET_EMAIL/i,
    /AUTH_PROD_OIDC_ACCESS_TOKEN/i,
    /RESEND_API_KEY/i,
    /engineering_team_session=/i,
    /engineering_team_csrf=/i,
    /cookieHeader/i,
    /csrfToken/i,
    /"password"\s*:/i,
    /Bearer\s+[A-Za-z0-9._~+/=-]+/i,
    /access_token/i,
    /id_token/i,
    /refresh_token/i,
    /client_secret/i,
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

function validateSummaryChecks(evidence, failures, checks) {
  for (const check of checks) {
    if (evidence.summary?.[check] !== true) failures.push(`Evidence summary.${check} must be true.`);
  }
}

function validateRegistrationEvidence(input, { minGeneratedAt = ISSUE_REGISTRATION_MIN_SMOKE_AT } = {}) {
  const evidence = parseEvidence(input);
  const failures = [];
  if (!evidence) return { ok: false, failures: ['Registration production smoke evidence is missing.'] };

  validateEvidenceTimestamp(evidence, failures, minGeneratedAt);
  validateSummaryChecks(evidence, failures, REQUIRED_REGISTRATION_SUMMARY_CHECKS);
  validateEvidenceDeployment(evidence, failures, 'registration');
  validateEvidenceRedaction(evidence, failures);

  if (evidence.magicLink?.requestStatus !== 410) {
    failures.push('Evidence must show /auth/magic-link/request returns 410 after cutover.');
  }
  if (evidence.login?.status !== 200) {
    failures.push('Evidence login.status must be 200.');
  }

  return { ok: failures.length === 0, failures };
}

function validateOidcEvidence(input, { minGeneratedAt = ISSUE_REGISTRATION_MIN_SMOKE_AT } = {}) {
  const evidence = parseEvidence(input);
  const failures = [];
  if (!evidence) return { ok: false, failures: ['OIDC production smoke evidence is missing.'] };

  validateEvidenceTimestamp(evidence, failures, minGeneratedAt);
  validateSummaryChecks(evidence, failures, REQUIRED_OIDC_SUMMARY_CHECKS);
  validateEvidenceDeployment(evidence, failures, 'oidc');
  validateEvidenceRedaction(evidence, failures);

  return { ok: failures.length === 0, failures };
}

function validateMagicLinkEvidence() {
  return {
    ok: false,
    failures: ['Magic-link production smoke evidence no longer satisfies production auth after registration cutover.'],
  };
}

function defaultEvidencePath(selectedStrategy) {
  return selectedStrategy === 'oidc'
    ? 'observability/oidc-production-smoke.json'
    : 'observability/registration-auth-production-smoke.json';
}

function validateEvidenceForStrategy(strategy, input, options = {}) {
  if (strategy === 'oidc') return validateOidcEvidence(input, options);
  if (strategy === 'registration') return validateRegistrationEvidence(input, options);
  return validateMagicLinkEvidence(input, options);
}

function validateProductionAuthStatus({
  root = process.cwd(),
  selectedStrategy = 'registration',
  evidencePath = defaultEvidencePath(selectedStrategy),
  requireComplete = false,
  minGeneratedAt = ISSUE_REGISTRATION_MIN_SMOKE_AT,
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
  if (!evidence.ok) warnings.push(...evidence.failures);

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
  ISSUE_REGISTRATION_MIN_SMOKE_AT,
  REQUIRED_DOC_REFERENCES,
  REQUIRED_OIDC_SUMMARY_CHECKS,
  REQUIRED_REGISTRATION_SUMMARY_CHECKS,
  validateMagicLinkEvidence,
  validateOidcEvidence,
  validateProductionAuthStatus,
  validateRegistrationEvidence,
  validateStatusDocs,
};
