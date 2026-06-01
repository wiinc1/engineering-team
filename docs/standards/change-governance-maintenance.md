# Change Governance Maintenance

## Purpose
This repo uses a domain ownership map to enforce adjacent evidence for runtime changes.

Canonical config:
- `config/change-ownership-map.json`
- `.github/BRANCH_PROTECTION.md`

Canonical checks:
- `npm run standards:check`
- `npm run pr:check`
- `npm run change:check`
- `npm run ownership:lint`
- `npm run governance:drift`

`npm run pr:check` validates the required PR-body fields against the changed-file set. In CI, the checker prefers the current pull-request body fetched from GitHub when `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, and the PR number are available; this prevents stale `pull_request` event payloads from failing a corrected PR description. If the API lookup is unavailable, the checker falls back to the event body.

## Coverage Artifacts
`npm run standards:check` reads `.artifacts/coverage-summary.json`. That file may be produced by `npm run coverage` with per-suite JavaScript/UI coverage, or by `make verify` with Python coverage totals. The coverage policy checker accepts both schemas so developers can run the verification commands in either order without regenerating coverage only to satisfy a parser shape.

## Tracked-file lint gate
`npm run lint` is a tracked-file quality gate, not a static target list. It discovers tracked and untracked, non-ignored authored source through `git ls-files --cached --others --exclude-standard`, then applies explicit include and exclude classification before checking whitespace, tabs, and readability signals.

Included roots:
- `api/`
- `lib/`
- `scripts/`
- `src/`
- `tests/`

Included extensions:
- `.js`
- `.jsx`
- `.mjs`
- `.cjs`
- `.ts`
- `.tsx`

Excluded boundaries include dependency, generated, build, coverage, dist, artifact, third-party, vendor, and temporary/report output directories. Readability exceptions belong in `config/lint-source-allowlist.json` and must carry owner, reason, and follow-up. The lint gate validates that allowlist entries still point at scanned files and still match active readability findings.

## How the ownership map works
Each domain declares:
- `runtime_patterns`: the code files that belong to the domain
- `test_requirements`: named required evidence groups for tests
- `doc_requirements`: named required evidence groups for docs

When a pull request changes one or more runtime files in a domain, the same change set must also include:
- at least one changed file for every required test group
- at least one changed file for every required doc group

If a runtime file does not match any domain, `npm run change:check` fails with an unmapped-domain error.

## How to add or update a domain
1. Update `config/change-ownership-map.json`.
2. Use regex strings that are narrow enough to reflect a real product or operational boundary.
3. Prefer existing public contracts or operator docs for `doc_requirements` before adding generic docs.
4. Add or update governance-script tests under `tests/unit/governance/`.
5. Run:
   - `npm run standards:check`
   - `npm run change:check`
   - `npm run ownership:lint`
   - `npm run test:governance`

## How to resolve a failed adjacency check
- `without matching test updates`: add or update the nearest domain tests in the same PR
- `without matching API/runbook/design updates`: update the nearest API spec, runbook, design doc, ADR, or task artifact for that domain
- `without required test groups`: update at least one file for each missing named test requirement
- `without required doc groups`: update at least one file for each missing named doc requirement
- `not mapped to an ownership domain`: add a new domain or extend an existing one in `config/change-ownership-map.json`

## Maintenance rules
- Do not use a catch-all domain when a more specific boundary exists.
- Do not silence failures by widening `doc_requirements` to unrelated docs.
- Keep domain names stable so failure messages remain predictable.

## Branch Protection
Protect the default branch by requiring these checks:
- pull request metadata
- repo validation
- browser validation
- governance drift, if your workflow treats drift as blocking

Do not rely on the scripts existing in the repo without also requiring the CI jobs that run them.

Canonical branch-protection guidance:
- `.github/BRANCH_PROTECTION.md`
