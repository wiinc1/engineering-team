# Issue 92 Production Evidence

- Date: 2026-04-27
- Issue: #92 Replace internal auth bootstrap with magic-link session auth
- Status: Pending logout/replay closeout
- Applicable standards areas: security, deployment and release, observability and monitoring, testing and quality assurance
- Evidence expected for this change: Vercel production deployment status, production auth config gate, Resend delivery event, invited-user smoke, protected-route smoke, logout/replay/unknown-email smoke, monitoring counts/rates, rollback target
- Gap observed: repository implementation and automated local verification are complete, but production remediation cannot be closed until the release operator runs the production smoke against the deployed app and attaches external Vercel/Resend/monitoring evidence. Documented rationale: production authentication changes require direct operational verification because local tests cannot prove deployed env values, provider delivery, cookie behavior on the production origin, or rollback readiness.
- Commands run: local verification commands are recorded in the PR or issue closeout; production operator must run `npm run auth:config:check:vercel` and `npm run auth:magic-link:production-smoke`
- Rollout or rollback notes: rollback restores the last known-good production deployment and auth config for the selected strategy; do not switch strategies during rollback unless a separate emergency exception is approved

## Workspace Evidence Captured

- Vercel production alias currently resolves to Ready deployment `https://engineering-team-mzxvjwuzr-wiinc1-hotmailcoms-projects.vercel.app` (`dpl_9FezJZWNtNzMzDK2rfPvJNZKzo6w`).
- Production aliases include `https://engineering-team-zeta.vercel.app` and `https://engineering-team-wiinc1-hotmailcoms-projects.vercel.app`.
- `npm run auth:config:check:vercel` now executes against the linked `engineering-team` Vercel project.
- Vercel env-name validation now passes through the complete magic-link env-name set.
- Vercel build log includes `Auth config check passed for production.`
- Earlier attempted production redeploy `https://engineering-team-k0gvhp1pw-wiinc1-hotmailcoms-projects.vercel.app` failed because it rebuilt the old committed source, whose production config gate did not accept `AUTH_PRODUCTION_AUTH_STRATEGY=magic-link`; the pushed `2ad228b` deployment resolved that failure.
- Basic unauthenticated production reachability checks returned `401` for `/` and `/auth/me`, confirming production auth enforcement.
- Production smoke evidence captured for `brian-issue-92-smoke`: `auth.magic_link.sent` at `2026-04-28T01:01:55Z`, `auth.magic_link.consumed` at `2026-04-28T01:03:52Z`, and `auth.session.created` at `2026-04-28T01:03:52Z`.
- Session evidence shows tenant `tenant-int`, roles `admin` and `pm`, and expiry `2026-04-28T09:03:52Z`.
- Unknown-email smoke returned the generic 200 response and recorded `auth.magic_link.request_suppressed` at `2026-04-28T01:04:40Z`, with no adjacent sent event.
- GitHub issue status comment: `https://github.com/wiinc1/engineering-team/issues/92#issuecomment-4331556674`

## Required Production Evidence

| Requirement | Evidence source | Status |
| --- | --- | --- |
| Vercel production deployment is Ready | Vercel deployment URL/ID and status | Done: `dpl_9FezJZWNtNzMzDK2rfPvJNZKzo6w` Ready |
| Build/config gates pass with `AUTH_PRODUCTION_AUTH_STRATEGY=magic-link` | `npm run auth:config:check:vercel` plus production build log | Done: Vercel env-name check passes and Vercel build log reports config check passed |
| Internal bootstrap flags are disabled in production | Vercel env-name/value review by production config owner | Partial: names present; operator set values to false |
| Admin-created invited user exists in production | Redacted admin `/admin/users` confirmation | Done: `brian-issue-92-smoke`, tenant `tenant-int`, roles `admin`, `pm` |
| Resend sends to invited production test/admin/PM account | Resend event ID or redacted delivery screenshot | Done: `auth.magic_link.sent` for `brian-issue-92-smoke` |
| Link consumption creates a cookie session | `observability/magic-link-production-smoke.json` | Done: `auth.magic_link.consumed` and `auth.session.created` |
| `/auth/me` returns expected actor, tenant, roles | `observability/magic-link-production-smoke.json` | Partial: session table confirms actor, tenant, roles, and expiry |
| Protected views load | `observability/magic-link-production-smoke.json` | Partial: user confirmed they are in the app after clicking the delivered link |
| Logout revokes the session | `observability/magic-link-production-smoke.json` | Pending |
| Unknown email request is generic and sends no email | Smoke artifact plus Resend no-delivery check | Done: generic 200 plus `auth.magic_link.request_suppressed` |
| Expired/replayed link is rejected | Smoke artifact covers replay; expired link can be attached manually if available | Pending: requires raw consumed link URL |
| Monitoring evidence contains no tokens/secrets | Auth availability dashboard/alert screenshot with counts/rates only | Pending |
| Rollback evidence identifies last known-good deployment/config | Deployment URL/ID and config note | Pending |

## Production Smoke Commands

Phase 1 sends the magic link:

```bash
AUTH_PROD_BASE_URL=https://app.example \
AUTH_PROD_INVITED_EMAIL=approved-test-admin@example.com \
AUTH_PROD_UNKNOWN_EMAIL=unknown-smoke@example.com \
AUTH_PROD_TASK_DETAIL_PATH=/tasks/TSK-123 \
npm run auth:magic-link:production-smoke
```

Phase 2 consumes the received link and performs the session/protected-route/logout/replay checks:

```bash
AUTH_PROD_BASE_URL=https://app.example \
AUTH_PROD_INVITED_EMAIL=approved-test-admin@example.com \
AUTH_PROD_UNKNOWN_EMAIL=unknown-smoke@example.com \
AUTH_PROD_MAGIC_LINK_URL='https://app.example/auth/magic-link/consume?token=...' \
AUTH_PROD_TASK_DETAIL_PATH=/tasks/TSK-123 \
npm run auth:magic-link:production-smoke -- --require-complete
```

Expected artifact:

```text
observability/magic-link-production-smoke.json
```

The artifact must contain hashes, status codes, route classifications, role names, and boolean checks only. It must not contain raw email addresses, magic-link tokens, cookies, CSRF tokens, Resend API keys, email bodies, or session secrets.

`--dry-run` is available for command-wiring validation only. It skips network calls and does not satisfy the production evidence rows above.
