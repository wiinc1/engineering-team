# Engineering Team — local workspace layout

This directory is the **canonical home** for engineering-team work in the OpenClaw workspace.

## Primary repo

- Path: `/Users/wiinc2/.openclaw/workspace/engineering-team`
- Package name: `engineering-team` (Software Factory)
- Compatibility symlink: `../new_car` → `engineering-team` (legacy path)

## Nested local material (gitignored)

| Path | What it is |
|------|------------|
| `_checkouts/main-56ed662/` | Secondary full clone that was previously at workspace `engineering-team/` (main @ `56ed662`) |
| `_checkouts/staging-56ed662/` | Former staging checkout (independent `.git`; previously a worktree) |
| `_checkouts/issue-52/` | Linked worktree for `issue-52-review-questions` |
| `_workspace-drafts/` | Issue body drafts and software-factory notes moved from workspace root |

## Related sibling (not nested)

- `../forgeadapter` — separate repo that bridges engineering-team ↔ OpenClaw. Kept as a workspace sibling so relative `../engineering-team` scripts keep working.

## Not this project

- `../new-car` (hyphen) — personal car-purchase search automation (unrelated to this Software Factory app).
