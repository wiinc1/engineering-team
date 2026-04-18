# TSK-004 — Complete Production Identity Provider Cutover

**Created:** 2026-04-17 19:15 CDT
**Updated:** 2026-04-17 19:15 CDT
**ID:** TSK-004
**Status:** TODO

## 📌 Summary

Finish the browser and deployment cutover from the internal `/auth/session` compatibility flow to a real production identity-provider path so the authenticated browser app can run without shared-secret bootstrap tokens.

## 🎯 Deliverables

- [ ] Define the production browser sign-in flow and cutover plan on top of the existing JWKS-backed API validation
- [ ] Replace or disable the `/auth/session` compatibility dependency for production mode while preserving a safe local/internal fallback
- [ ] Add browser, API, and security verification for the provider-backed sign-in/callback flow
- [ ] Update runbooks, environment configuration, and rollout/rollback notes for IdP-backed browser access

## 🧑‍💻 Agent

**Type:** dev
**Notes:** Build on the landed `SF-018` JWT/JWKS support rather than reworking API auth. Focus on the unfinished browser and operational migration path.

## 📋 SRE Verification Checklist

- [ ] Logs reviewed (no ERROR-level entries)
- [ ] Telemetry/metrics within baseline
- [ ] Exit codes clean
- [ ] Smoke/synthetic checks passed
- [ ] No regressions in downstream services

## Standards Alignment

- Applicable standards areas: architecture and design, security, deployment and release, testing and quality assurance
- Evidence expected for this change: production-auth flow design, runtime/browser verification, rollout controls, and updated operator documentation
- Gap observed: the repo supports JWKS-backed provider validation today, but the browser sign-in flow still depends on `/auth/session` compatibility tokens for the default path. Documented rationale: secure systems should minimize long-lived shared-secret compatibility paths once a provider-backed flow is ready for production use (source https://sre.google/books/).

## 🔄 Status History

| Date | From | To | Actor | Note |
|------|------|----|----|------|
| 2026-04-17 | — | BACKLOG | main | Created from tracker re-baseline after shipped `SF-013` to `SF-016` work |
| 2026-04-17 | BACKLOG | TODO | main | Approved as the next execution task because the remaining auth gap is production IdP browser cutover |

## 📎 Findings (if reopened)

<!-- SRE fills this if issues are found during VERIFY -->
- 

## 💬 Notes

Relevant existing repo evidence:
- provider-backed JWT verification and mixed rollout support already exist in `lib/audit/http.js`
- operational notes already exist in `docs/runbooks/production-identity-provider.md`
- browser-app auth today still uses `POST /auth/session` and compatibility tokens in `src/app/App.jsx`
- `docs/design/US-002-design.md` explicitly records that external identity-provider integration is not yet implemented in the browser flow

This task is intentionally narrower than "redo auth." The aim is to finish the browser/runtime cutover path and make production deployment guidance truthful.

## Required Evidence

- Commands run: `npm test`, targeted auth/security/browser checks, and any environment-specific verification commands used for the cutover
- Tests added or updated: browser auth flow, API auth bootstrap/callback behavior, and security coverage for provider-backed sessions
- Rollout or rollback notes: explicit mixed-mode rollout plan plus production fallback/disablement notes for `/auth/session`
- Docs updated: runbooks, API/design docs, task artifacts, and README deployment guidance
