# DESIGN.md Migration Guide

Use this guide when adopting a root `DESIGN.md` in an existing repo.

## 1. Identify Current Design Sources

Find the current visual identity source of truth:

- Tailwind theme config
- CSS variables
- DTCG `tokens.json`
- Figma variables
- Storybook theme files
- handwritten component styles
- product or brand docs

Record whether the source is authoritative, generated, or stale.

## 2. Decide Source Of Truth

Choose one:

- `DESIGN.md` becomes the visual identity source of truth.
- `DESIGN.md` is a synchronized mirror of another approved design source.

If an existing UI repo changes its source of truth or validation gates, record
the decision in an ADR.

## 3. Create Root DESIGN.md

Start from `dev-standards/templates/DESIGN.md`.

Keep the YAML front matter valid. Replace placeholder values with approved
brand tokens and explain usage in markdown prose instead of duplicating token
tables.

## 4. Declare Repo Policy

Add a `visual_identity` block to `repo-contract.yaml`:

```yaml
visual_identity:
  required: true
  file: DESIGN.md
  validator_command: npm run design:lint
  owner: design-owner
  reviewers:
    - repo-owner
  review:
    cadence_days: 90
    last_reviewed: "2026-05-08"
```

Also add `DESIGN.md` to:

- `directories.protected_paths`
- `architecture.source_of_truth`

## 5. Wire Validation

Use a pinned upstream validator. For npm repos:

```json
{
  "scripts": {
    "design:lint": "design.md lint DESIGN.md"
  },
  "devDependencies": {
    "@google/design.md": "0.1.1"
  }
}
```

For non-Node repos, declare a stable command in
`visual_identity.validator_command`, such as a wrapper script, Docker command,
or pinned toolchain invocation.

## 6. Declare Generated Outputs

If implementation tokens are committed, declare the output paths and a drift
check command:

```yaml
visual_identity:
  generated_outputs:
    strategy: committed
    paths:
      - src/styles/design-tokens.css
    drift_check_command: npm run design:tokens:check
```

If tokens are generated during build, declare the build command:

```yaml
visual_identity:
  generated_outputs:
    strategy: build-time
    build_command: make build
```

## 7. Verify

Run:

```bash
make lint
make verify
```

Resolve any failures before merging. Freshness is a hard failure for repos with
`visual_identity.required: true`.

## 8. Upgrade Later By Diff

Downstream repos should not receive automatic `DESIGN.md` overwrites from the
shared template. Apply template updates manually, review the diff, and use the
protected visual identity change path for material token or governance changes.
