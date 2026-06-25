## GP-005: GitHub issue → Project bootstrap

**Golden-path step:** `GP-005` in `observability/golden-path-manual-steps.json`  
**Depends on:** GP-002 (`FF_GITHUB_INTAKE_NORMALIZER=true`)  
**Feature flag:** `FF_GITHUB_INTAKE_PROJECT_BOOTSTRAP` (default off)

### Goal

When a GitHub issue with `factory-intake` or `golden-path` becomes an Intake Draft (GP-002), automatically create an ACTIVE Project and link the task — replacing manual `golden-path-phase0.js` / `seed-golden-path-phase0.js` project bootstrap.

### Acceptance criteria

- [x] `issues.opened` intake with `factory-intake` creates Project + links task
- [x] Project metadata includes `githubIssueUrl` for idempotent re-delivery
- [x] Duplicate webhook preserves single project + task link
- [x] `FF_GITHUB_INTAKE_PROJECT_BOOTSTRAP=false` skips bootstrap without blocking GP-002 intake
- [x] `npm run gp-005:verify` proves coordinated-stack path

### Verification

```bash
npm run dev:golden-path:up
npm run gp-005:verify
```

Writes `observability/gp-005-staging/gp-005-complete.json`.