# Runbook

## Verification

Run the standards gate locally:

```bash
make verify
```

`make verify` is the local source of truth for DESIGN.md enforcement. GitHub Actions can repeat these checks, but it is not required for any DESIGN.md guarantee.

For UI token work, run:

```bash
npm run design:tokens
npm run design:tokens:check
npm run design:tokens:enforce
npm run design:audit:check
npm run design:change-guard
make verify
```

Read `DESIGN.md` before UI changes, change reusable visual semantics there first, and avoid hard-coded visual values in migrated CSS. A rare one-off must use `DESIGN-TOKEN-EXCEPTION: <short reason and follow-up if reusable>`; reusable exceptions must be promoted into `DESIGN.md`.

Install local hooks once per clone:

```bash
scripts/setup-local-hooks.sh
```

This runs:

```bash
git config core.hooksPath scripts/hooks
chmod +x scripts/hooks/pre-commit scripts/hooks/pre-push
```

The pre-commit hook runs token drift, token usage, generated audit, and design change guard checks. The pre-push hook runs `make verify`.

If an authored UI file changes but there is truly no visual or UX impact, create `docs/design/no-design-impact.txt` with a short reason. Keep the marker local, do not use it for reusable visual decisions, and remove it after the change is complete.

## Operational Notes

- record how to gather release evidence
- record any external systems required for live approval, traceability, or deploy proof
- record who owns protected-path changes and emergency review
