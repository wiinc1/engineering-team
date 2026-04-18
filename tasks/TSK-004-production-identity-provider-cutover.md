# TSK-004 — Complete Production Identity Provider Cutover

**Created:** 2026-04-17 19:15 CDT
**Updated:** 2026-04-17 20:05 CDT
**ID:** TSK-004
**Status:** DONE

## 📌 Summary

Finish the browser and deployment cutover from the internal `/auth/session` compatibility flow to a real production identity-provider path so the authenticated browser app can run without shared-secret bootstrap tokens.

## 🎯 Deliverables

- [x] Define the production browser sign-in flow and cutover plan on top of the existing JWKS-backed API validation
- [x] Replace or disable the `/auth/session` compatibility dependency for production mode while preserving a safe local/internal fallback
- [x] Add browser, API, and security verification for the provider-backed sign-in/callback flow
- [x] Update runbooks, environment configuration, and rollout/rollback notes for IdP-backed browser access

## 🧑‍💻 Agent

**Type:** dev
**Notes:** Build on the landed `SF-018` JWT/JWKS support rather than reworking API auth. Focus on the unfinished browser and operational migration path.

## 📋 SRE Verification Checklist

- [x] Logs reviewed (no ERROR-level entries)
- [x] Telemetry/metrics within baseline
- [x] Exit codes clean
- [x] Smoke/synthetic checks passed
- [x] No regressions in downstream services

## Standards Alignment

- Applicable standards areas: architecture and design, security, deployment and release, testing and quality assurance
- Evidence expected for this change: production-auth flow design, runtime/browser verification, rollout controls, and updated operator documentation
- Gap observed: the repo supports JWKS-backed provider validation today, but the browser sign-in flow still depends on `/auth/session` compatibility tokens for the default path. Documented rationale: secure systems should minimize long-lived shared-secret compatibility paths once a provider-backed flow is ready for production use (source https://sre.google/books/).

## 🔄 Status History

| Date | From | To | Actor | Note |
|------|------|----|----|------|
| 2026-04-17 | — | BACKLOG | main | Created from tracker re-baseline after shipped `SF-013` to `SF-016` work |
| 2026-04-17 | BACKLOG | TODO | main | Approved as the next execution task because the remaining auth gap is production IdP browser cutover |
| 2026-04-17 | TODO | IN_PROGRESS | main | Browser callback flow, compatibility fallback controls, docs, and verification executed on `main` |
| 2026-04-17 | IN_PROGRESS | VERIFY | main | Full automated verification passed via `npm test` |
| 2026-04-17 | VERIFY | DONE | main | Local tracker closed after push to `main` and clean worktree confirmation |

## 📎 Findings (if reopened)

<!-- SRE fills this if issues are found during VERIFY -->
- 

## 💬 Notes

Relevant existing repo evidence:
- provider-backed JWT verification and mixed rollout support already exist in `lib/audit/http.js`
- operational notes already exist in `docs/runbooks/production-identity-provider.md`
- browser app now supports hosted OIDC Authorization Code + PKCE at `/sign-in` with callback handling at `/auth/callback`
- `POST /auth/session` remains available only as an explicitly enabled local/internal fallback path

This task is intentionally narrower than "redo auth." The aim is to finish the browser/runtime cutover path and make production deployment guidance truthful.

## Required Evidence

- Commands run: `node scripts/run-playwright.js tests/browser/auth-shell.browser.spec.ts --grep "completes an enterprise callback and restores the deep-linked board route"`, `node scripts/run-playwright.js tests/browser/auth-shell.browser.spec.ts`, `node --test tests/contract/audit-openapi.contract.test.js`, `npm test`
- Tests added or updated: browser auth flow, API auth bootstrap/callback behavior, and security coverage for provider-backed sessions
- Rollout or rollback notes: explicit mixed-mode rollout plan plus production fallback/disablement notes for `/auth/session`
- Docs updated: runbooks, API/design docs, task artifacts, and README deployment guidance
