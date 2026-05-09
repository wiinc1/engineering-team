# DESIGN.md Adoption Audit

Date: 2026-05-08

## Summary

`DESIGN.md` is declared as the authoritative visual design source of truth for this repo. Runtime CSS and generated token files are derived consumers. Current operationalization covers generated global tokens, Button tokens, TaskCreationForm tokens, TaskDetail tokens, drift checking, hard-coded visual value enforcement for all authored UI CSS, PR guidance, agent guidance, machine-readable audit config, and screenshot smoke coverage.

Machine-readable audit config: `docs/design/design-md-adoption.config.json`

## Component Coverage

| Component / Area | Uses DESIGN.md Tokens? | Enforcement Covered? | Notes |
| --- | --- | --- | --- |
| Global styles | Yes | Yes | `src/app/styles.css` imports `src/app/design-tokens.css` and maps core colors, typography, radius, shadows, focus, navigation, panels, cards, status, table, and list tokens. The enforcement script scans this file. |
| Button | Yes | Yes | `src/components/Button/Button.module.css` imports `Button.tokens.css`; the generated token file is declared in `repo-contract.yaml`; enforcement scans the authored module. |
| TaskCreationForm | Yes | Yes | `src/features/task-creation/TaskCreationForm.module.css` imports `TaskCreationForm.tokens.css`; the generated token file is declared in `repo-contract.yaml`; enforcement scans the authored module. |
| Task detail modules | Yes | Yes | `StageTransition.module.css`, `TaskDetailActivityShell.module.css`, `TaskHistoryTimeline.module.css`, and `TelemetrySummary.module.css` import `TaskDetail.tokens.css`; enforcement scans every authored task-detail CSS module. |
| Inputs/forms | Yes | Yes | Global form controls, TaskCreationForm, task-detail filters, and stage-transition fields consume generated variables. |
| Links/nav | Yes | Yes | App navigation in `src/app/styles.css` consumes generated color, radius, border, and typography variables. Link semantics exist in `DESIGN.md`; no separate authored link module exists. |
| Panels/cards | Yes | Yes | App panels, cards, auth card, board cards, summary cards, task-detail panels, timeline cards, and telemetry cards use generated variables and are enforcement-covered. |
| Badges/status | Yes | Yes | Global task status pills, review badges, routing badges, status banners, timeline tones, telemetry tones, and task-detail notices use semantic generated variables. |
| Tables/lists | Yes | Yes | Global task list and board list styles use generated variables. Task history timeline uses generated `history-*` variables and is enforcement-covered. |

## Optional DESIGN.md Area Audit

| Area | Status | Notes |
| --- | --- | --- |
| Accessibility | Implemented | `DESIGN.md` includes app-specific requirements for WCAG AA contrast, visible keyboard focus, touch target sizing, disabled/loading state legibility, overflow behavior, text wrapping, and reduced motion. |
| Iconography | N/A | The product is currently text-first and has no shipped icon set. `DESIGN.md` records that any future icon library must use one consistent style and ADR-backed dependency. |
| Imagery | N/A | The product has no logo, illustration, or brand-image asset system. `DESIGN.md` directs operational screens toward real product state, tables, task records, charts, logs, and reviewed asset provenance if imagery is introduced. |
| Content Tone | Implemented | `DESIGN.md` has app-specific UI copy guidance for task actions, empty states, errors, and workflow status labels. |
| Localization | N/A | Localization and RTL are explicitly not current requirements. `DESIGN.md` still defines text expansion, fixed-height avoidance, readable line length, and explicit RTL declaration expectations. |
| Navigation | Implemented | `DESIGN.md` includes app-nav rules for compact workflow navigation, wrapped links, and muted session controls. Runtime nav styles consume generated variables in `src/app/styles.css`. |
| Data Visualization | Implemented | `DESIGN.md` defines current telemetry-card, timeline, table, log, label, metadata, and no-hover-only rules. Rich charting remains blocked until chart-specific tokens are added. |
| Multi-Brand Theming | N/A | The repo has one internal product identity: Engineering Team Software Factory Control Plane. No multi-brand or tenant-brand theming requirement is present. Add an ADR and token strategy before introducing multi-brand runtime theming. |
| Motion | Implemented | `DESIGN.md` keeps motion intentionally limited: respect reduced motion, never use motion as the only state indicator, keep transitions local and short, and add duration/easing tokens before reusable animation patterns. |
| Visual Regression | Implemented | Existing browser screenshots cover task detail. This PR adds screenshot smoke coverage for the primary app screen, Button states, TaskCreationForm token output, task-detail states, and mobile task-detail layout. This is smoke coverage, not a full pixel-baseline system. |

## Acceptance Criteria Status

| Criterion | Status | Evidence |
| --- | --- | --- |
| `DESIGN.md` is declared as source of truth. | Pass | `DESIGN.md` source-of-truth decision and `repo-contract.yaml` `visual_identity.file: DESIGN.md`. |
| Generated token files are reproducible. | Pass | `npm run design:tokens` regenerates committed outputs; `npm run design:tokens:check` compares generated content with committed files. |
| Drift check fails if generated files are stale. | Pass | `scripts/generate-design-tokens.mjs --check` exits nonzero when an output differs or is missing. |
| Enforcement blocks new hard-coded visual values. | Pass | `scripts/check-design-token-usage.mjs` scans all authored UI CSS listed in `docs/design/design-md-adoption.config.json`, rejects forbidden literals unless a reasoned `DESIGN-TOKEN-EXCEPTION:` is present, and fails if authored CSS falls outside enforcement scope. Focused unit coverage validates pass, fail, exception, missing-reason, generated-output allowlist, config scope, and audit coverage behavior. |
| Migrated components use generated variables. | Pass | Global styles, Button, TaskCreationForm, and task-detail modules import generated token CSS and use `var(--...)` values. |
| Optional areas are implemented, explicitly N/A, or tracked as follow-up. | Pass | The optional area table above marks implemented, N/A, and follow-up items. |
| Screenshot smoke tests cover at least the primary screen and migrated components. | Pass | `tests/browser/design-token-operationalization.browser.spec.ts` captures primary app, Button states, TaskCreationForm token output, task-detail state panels, and mobile task-detail layout. |
| `make verify` passes. | Pass | Latest local verification passed with only the existing non-blocking maintainability warning on `dev-standards/templates/DESIGN.md`. |

## Follow-Up Backlog

- Keep `docs/design/DESIGN_MD_ADOPTION_AUDIT.md` and `docs/design/design-md-adoption.config.json` synchronized whenever a new authored UI CSS file is added.
- Add chart-specific `DESIGN.md` tokens before introducing richer charting or graph components.
- Add duration/easing tokens before introducing reusable animation patterns.
- Consider full screenshot baseline assertions if the product needs stronger visual regression guarantees than smoke screenshots.
