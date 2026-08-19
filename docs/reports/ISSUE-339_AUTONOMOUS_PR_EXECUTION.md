# Issue 339 — Autonomous PR execution

The trusted Simple path previously required strict PR evidence before the live implementer ran, while its prompt also prohibited tools and file edits. That made a zero-intervention real PR impossible.

The repaired path gives the live OpenClaw implementer an isolated-worktree workflow, accepts only real branch/SHA/PR output, performs clean QA without an invented failure, verifies protected checks, emits `Merge readiness`, confirms the merge, and writes a task-bound close package whose SHA-256 is embedded in the closeout. Hosted release evidence remains an independent staging gate.

Rollback is a normal revert of the issue-339 commit. No schema migration or destructive data operation is involved.

Verification covers prompt contracts, trusted pre-merge admission, confirmed prior merges, closeout evidence references, and the cross-module trusted-close contract.

## Standards Alignment

The change is reversible, keeps hosted release gates fail-closed, uses the existing GitHub branch-protection inventory, records immutable evidence before closeout, and adds unit plus contract coverage for the changed task-platform boundary.

- Applicable standards areas: architecture and design; coding quality; testing and quality assurance; release governance; observability; team process.
- Evidence expected for this change: exact-head tests, protected-check inventory, live OpenClaw session ids, confirmed GitHub merge fields, and a digest-bound close package.
- Gap observed: protected staging credentials and a nonlocal staging host are unavailable. Documented rationale: trusted PR closeout and hosted release proof are separate gates, so this PR must not claim deployment or soak evidence without the protected environment (source https://github.com/wiinc1/engineering-team/issues/339).

## Required Evidence

- Full unit suite passes.
- Change completeness and ownership-map lint pass.
- Standards, maintainability, coverage-policy, source-integrity, and secret scans pass.
- A live trusted Simple run must retain its OpenClaw session ids, exact PR head, protected-check inventory, `Merge readiness`, confirmed merge SHA/time, zero post-approval interventions, and content-addressed close package.
- Commands run: `npm run test:unit`; focused unit and contract tests; `npm run change:check`; `npm run ownership:lint`; `npm run standards:check`.
- Tests added or updated: trusted merge unit tests, autonomous close contract, prompt tests, completion mode tests, phase 6 prior-merge proof, and closeout reference retention.
- Rollout or rollback notes: merge the coordinator change before trusted runs; rollback by reverting this PR. Hosted deployment and runtime cutover remain independently gated.
- Docs updated: autonomous-delivery runbook, architecture boundary, and this issue evidence report.
