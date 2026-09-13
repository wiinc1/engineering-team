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
- Live default: `SPECIALIST_RUNTIME_PROVIDER=grok`
- Grok CLI binary: `/Users/wiinc2/.grok/bin/grok`
- Factory stack API commit at loop start: `65a6022` (GitLab `origin/main`)
- Do not treat fixture runner or OpenClaw mock `:14001` as live evidence.
- Dual-remote: GitLab MR against `main` and a matching GitHub PR from the same tip.

## Notes
Forgeadapter seed/phases may be skipped honestly under Simple-class forge-optional policy (GitLab #273). This increment is a docs-only guinea pig toward GitLab #276; it does not by itself satisfy the ≥10 trusted Simple close bar.
