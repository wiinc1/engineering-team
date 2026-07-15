# Issue #286 dependency review

## Standards Alignment

- Applicable standards areas: architecture and design; coding and code quality; security; testing and quality assurance; deployment and release.
- Evidence expected for this change: exact dependency pins, lock integrity, license/provenance, supported API isolation, vulnerability scanning, and automated boundary tests.
- Gap observed: Runtime dependency upgrades cannot be proven safe from version metadata alone. Documented rationale: every upgrade must rerun schema-diff, migration, contract, security, chaos, mutation, and load automation before review (source https://worker.graphile.org/docs).

## Decision

Approved dependency set for the production job-runtime boundary:

- `graphile-worker` is pinned exactly to `0.17.3` in `package.json` and `package-lock.json`.
- License: MIT.
- Runtime support: Node.js 14 or newer; the repository uses Node.js 22.
- Registry integrity: `sha512-5vX/j3i/zC0B0BVkU1apWdTMuQRTlqkiJgHtxHzl2D1S3U1Ov82WxOnCqzB+2rDMp6dJb8mVSKo1m6KpUGODFw==`.
- Package provenance checked through the npm registry metadata and upstream documentation/repository: https://www.npmjs.com/package/graphile-worker and https://github.com/graphile/worker.
- Supported public API usage is restricted to `Logger`, `makeWorkerUtils`, `run`, `migrate`, `addJob`, `completeJobs`, `stop`, `kill`, and `release` inside the adapter.
- No application or domain module imports Graphile types, references internal tables, or consumes private APIs.

`ajv` is pinned exactly to `8.20.0` for strict JSON Schema validation. Existing direct `ws` was updated to `8.21.0`; development test/build dependencies were updated to exact non-high/critical versions so the lockfile does not carry unresolved high or critical audit findings.

## Automated review evidence

- `tests/security/job-runtime.security.test.js` verifies the exact package pin, lock integrity, import boundary, and absence of Graphile internal references.
- `npm audit --omit=dev --json` reports zero production vulnerabilities.
- Full `npm audit` reports no high or critical findings; remaining non-production advisories, if any, are recorded by the final compliance command output rather than suppressed.
- Mutation, property, security, real-Postgres, and 2x load tests exercise the dependency boundary.

## Risks and controls

- Dependency drift: exact pin plus lock integrity test.
- Internal schema drift: application code never reads it; the adapter produces a deterministic catalog-only schema fingerprint for migration verification.
- Pool exhaustion: shared TLS pool, reserved capacity, bounded concurrency, pool gauges, and 10-minute 2x load test.
- Payload execution or secret injection: allowlisted catalog, strict schemas, 64 KiB maximum, recursive secret-like rejection, and sanitized logging.
- Completion ambiguity: registry state is explicitly delivery acknowledgment, not canonical business completion.

## Upgrade procedure

Open a separate reviewed change, inspect upstream release notes and license/provenance, update the exact pin, run migration schema-diff automation, then rerun all #286 contract, security, integration, chaos, mutation, and load gates. Never accept an unbounded version range.

## Required Evidence

- Commands run: `npm audit --omit=dev --json`; `npm run test:graphile`; `npm run test:integration:docker`; `npm run test:security`; `npm run test:graphile:load`.
- Tests added or updated: `tests/security/job-runtime.security.test.js`, contract/property/mutation suites, and real-Postgres integration/load automation.
- Rollout or rollback notes: keep claims disabled until coordinated cutover; dependency rollback requires the prior exact pin, migration compatibility verification, and the full automated matrix.
- Docs updated: ADR-003, internal contract, runtime configuration, runbook, diagrams, and issue checklist.
