# Simple Operator-Trusted Cohort (GitLab #276)

## Goal

Hit Q1 near-term bar: **≥10** Simple trusted closes with **≥80%** autonomous rate and live OpenClaw session evidence.

## Commands

```bash
# Evaluate current evidence snapshot
npm run cohort:simple-trusted

# Live expansion (requires factory stack + workers + OpenClaw :18789)
export FACTORY_PROOF_PROFILE=live
export STAGING_SKIP_FORGE_SEED=true
export STAGING_SKIP_FORGE_PHASES=true
npm run factory:stack:up
npm run audit:workers   # if workers launchd not running
node scripts/verify-milestone-d-closeout.js \
  --base-url http://127.0.0.1:13000 \
  --live-openclaw \
  --openclaw-url http://127.0.0.1:18789 \
  --run-validation \
  --output-dir observability/cohort-live/run-$(date +%Y%m%d%H%M%S)

# Re-score cohort after each successful live close
npm run cohort:simple-trusted
```

## Trusted close criteria

Implemented in `lib/task-platform/simple-trusted-cohort.js`:

1. Delivery status `phase6_complete` (closeout or factory evidence)
2. Zero recorded manual interventions on closeout
3. ≥1 live `specialist-delegation-*` session id on factory evidence for the same task
4. Counted as Simple class for this cohort

## Artifacts

- `observability/trusted-simple-close/cohort-report.json`
- `docs/reports/SIMPLE_TRUSTED_COHORT_REPORT_2026-07-13.md`
