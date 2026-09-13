# SDLC e2e Grok factory-loop marker

## Linked Task
- GitLab issue: http://192.168.1.116/wiinc1/engineering-team/-/work_items/293
- ET task: TSK-086
- Date: 2026-09-13
- Template tier: Simple

## Standards Alignment
- Applicable standards areas: team and process; deployment and release; observability and monitoring.
- Evidence expected for this change: a committed docs-only marker that records the GitLab issue URL, UTC date, and Grok as the live specialist runtime default after GitLab #292.
- Gap observed: the operator host stack was still on an OpenClaw runner after OpenClaw was removed. Documented rationale: GitLab #292 made `SPECIALIST_RUNTIME_PROVIDER=grok` the live default; this marker records the first GitLab-native Simple loop on that runtime (source http://192.168.1.116/wiinc1/engineering-team/-/work_items/292).

## Required Evidence
- Commands run: `npm run test:delegation:live-smoke:grok`; `node --test tests/unit/grok-specialist-runner.test.js tests/unit/factory-stack-service.test.js`; GitLab factory intake webhook for issue #293; `POST /api/v1/tasks/TSK-086/refinement/start` with `templateTier=Simple`.
- Tests added or updated: none for the original marker commit; follow-up coverage in `tests/unit/grok-specialist-runner.test.js` and `tests/integration/specialist-runtime-provider.integration.test.js` for Grok live session id prefixing.
- Rollout or rollback notes: docs-only marker; rollback is `git revert` of the marker commit. No production runtime, schema, or auth change.
- Docs updated: `docs/reports/SDLC_E2E_GROK_LOOP_MARKER.md`.
- Live default: `SPECIALIST_RUNTIME_PROVIDER=grok`. Do not treat fixture runner or OpenClaw mock `:14001` as live evidence.

## Notes
Forgeadapter seed/phases may be skipped honestly under Simple-class forge-optional policy (GitLab #273). This increment is a docs-only guinea pig toward GitLab #276; it does not by itself satisfy the ≥10 trusted Simple close bar.
