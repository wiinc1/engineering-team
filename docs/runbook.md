# Runbook

## Verification

Run the standards gate locally:

```bash
make verify
```

For UI token work, run:

```bash
npm run design:tokens
npm run design:tokens:check
npm run design:tokens:enforce
make verify
```

Read `DESIGN.md` before UI changes, change reusable visual semantics there first, and avoid hard-coded visual values in migrated CSS. A rare one-off must use `DESIGN-TOKEN-EXCEPTION: <short reason and follow-up if reusable>`; reusable exceptions must be promoted into `DESIGN.md`.

## Operational Notes

- record how to gather release evidence
- record any external systems required for live approval, traceability, or deploy proof
- record who owns protected-path changes and emergency review
