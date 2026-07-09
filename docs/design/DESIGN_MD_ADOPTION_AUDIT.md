# DESIGN.md Adoption Audit

Generated from: `docs/design/design-md-adoption.config.json`
Date: 2026-06-28

## Summary

`DESIGN.md` is declared as the authoritative visual design source of truth for this repo. Runtime CSS and generated token files are derived consumers. Current operationalization covers generated global tokens, Button tokens, dark TaskCreationForm and task-create page tokens, TaskDetail tokens, Command Center queue-first workspace and persistent inspector surfaces, product delivery and operator verification path panels, app-specific route/state/data-semantics UX rules, drift checking, hard-coded visual, typography, and motion value enforcement for all authored UI CSS, semantic token contrast regression coverage, PR guidance, agent guidance, machine-readable audit config, local git hooks, local design change guards that ignore trailing-whitespace-only UI diffs, and screenshot smoke coverage.

Machine-readable audit config: `docs/design/design-md-adoption.config.json`
Generated audit document: `docs/design/DESIGN_MD_ADOPTION_AUDIT.md`

## Component Coverage

| Component / Area | Uses DESIGN.md Tokens? | Enforcement Covered? | Notes |
| --- | --- | --- | --- |
| Global styles | Yes | Yes | `src/app/styles.css` imports `src/app/design-tokens.css` and maps core colors, typography, radius, shadows, focus, navigation, panels, cards, status, table, and list tokens. The enforcement script scans this file. |
| Button | Yes | Yes | `src/components/Button/Button.module.css` imports `Button.tokens.css`; the generated token file is declared in `repo-contract.yaml`; enforcement scans the authored module. |
| TaskCreationForm | Yes | Yes | `src/features/task-creation/TaskCreationForm.module.css` imports `TaskCreationForm.tokens.css`; dark task-create page semantics are defined in `DESIGN.md` and consumed by `src/app/styles.css`; the generated token file is declared in `repo-contract.yaml`; enforcement scans the authored module. |
| Task detail modules | Yes | Yes | `StageTransition.module.css`, `TaskDetailActivityShell.module.css`, `TaskHistoryTimeline.module.css`, and `TelemetrySummary.module.css` import `TaskDetail.tokens.css`; enforcement scans every authored task-detail CSS module. The task-detail next-action panel also exposes PM refinement status as requested/pending, in progress, or complete from existing workflow context. |
| Inputs/forms | Yes | Yes | Global form controls, TaskCreationForm, task-detail filters, and stage-transition fields consume generated variables. |
| Links/nav | Yes | Yes | App navigation in `src/app/styles.css` consumes generated color, radius, border, and typography variables. Link semantics exist in `DESIGN.md`; no separate authored link module exists. |
| Panels/cards | Yes | Yes | App panels, cards, auth card, board cards, summary cards, task-detail panels, timeline cards, and telemetry cards use generated variables and are enforcement-covered. |
| Badges/status | Yes | Yes | Global task status pills, review badges, routing badges, status banners, timeline tones, telemetry tones, and task-detail notices use semantic generated variables. |
| Tables/lists | Yes | Yes | Global task list and board list styles use generated variables. Task history timeline uses generated `history-*` variables and is enforcement-covered. |

## Optional DESIGN.md Area Audit

| Area | Status | Reason |
| --- | --- | --- |
| Accessibility | Implemented | `DESIGN.md` includes app-specific requirements for WCAG AA contrast, visible keyboard focus, touch target sizing, disabled/loading state legibility, label/error association, overflow behavior, text wrapping, and reduced motion. |
| Iconography | Implemented | The product is text-first and has no shipped icon set. `DESIGN.md` allows lightweight status glyphs only as secondary decoration paired with visible text and semantic color, and records that any future icon library must use one consistent style and ADR-backed dependency. |
| Imagery | N/A | The product has no logo, illustration, or brand-image asset system. `DESIGN.md` directs operational screens toward real product state, tables, task records, charts, logs, and reviewed asset provenance if imagery is introduced. |
| Content Tone | Implemented | `DESIGN.md` has app-specific UI copy guidance for task actions, empty states, errors, and workflow status labels. |
| Localization | N/A | Localization and RTL are explicitly not current requirements. `DESIGN.md` still defines text expansion, fixed-height avoidance, readable line length, and explicit RTL declaration expectations. |
| Navigation | Implemented | `DESIGN.md` includes route and role-surface rules for task workspace, intake, PM overview, governance, deferred considerations, role inboxes, protected-route recovery, and permission-gated controls. Runtime nav styles consume generated variables in `src/app/styles.css`. |
| Data Visualization | Implemented | `DESIGN.md` defines current telemetry-card, timeline, table, log, label, metadata, task-detail read-model, freshness, redaction, and no-hover-only rules. Rich charting remains blocked until chart-specific tokens are added. |
| Multi Brand Theming | N/A | The repo has one internal product identity: Engineering Team Software Factory Control Plane. No multi-brand or tenant-brand theming requirement is present. Add an ADR and token strategy before introducing multi-brand runtime theming. |
| Motion | Implemented | `DESIGN.md` keeps motion intentionally limited: respect reduced motion, never use motion as the only state indicator, keep transitions local and short, and add duration/easing tokens before reusable animation patterns. |
| Visual Regression | Implemented Smoke | Existing browser screenshots cover task detail. The design-token smoke spec covers the primary app screen, Button states, TaskCreationForm token output, the dark task-create page shell, task-detail states, and mobile task-detail layout. This is smoke coverage, not a full pixel-baseline system. |

## Acceptance Criteria Status

| Criterion | Status | Evidence |
| --- | --- | --- |
| `DESIGN.md` is declared as source of truth. | Pass | `DESIGN.md` source-of-truth decision and `repo-contract.yaml` `visual_identity.file: DESIGN.md`. |
| Generated token files are reproducible. | Pass | `npm run design:tokens` regenerates committed outputs; `npm run design:tokens:check` compares generated content with committed files. |
| Drift check fails if generated files are stale. | Pass | `scripts/generate-design-tokens.mjs --check` exits nonzero when an output differs or is missing. |
| Enforcement blocks new hard-coded visual values. | Pass | `scripts/check-design-token-usage.mjs` scans all authored UI CSS listed in `docs/design/design-md-adoption.config.json`, rejects forbidden literals unless a reasoned `DESIGN-TOKEN-EXCEPTION:` is present within the configured budget, and fails if authored CSS falls outside enforcement scope. |
| Migrated components use generated variables. | Pass | Global styles, Button, TaskCreationForm, and task-detail modules import generated token CSS and use `var(--...)` values. TaskCreationForm and StageTransition preserve label/error associations required by `DESIGN.md`. |
| Optional areas are implemented, explicitly N/A, or tracked as follow-up. | Pass | The optional area table above marks implemented, N/A, and smoke-backed items with reasons. |
| Screenshot smoke tests cover at least the primary screen and migrated components. | Pass | `tests/browser/design-token-operationalization.browser.spec.ts` captures primary app, Button states, TaskCreationForm token output, the dark task-create page shell, task-detail state panels, and mobile task-detail layout. |
| `make verify` passes. | Pass | Local verification is the source of truth for DESIGN.md guarantees and runs token drift, token usage, generated audit, and design change guard checks before the rest of the repo verification. The design change guard treats trailing-whitespace-only UI diffs as lint cleanup rather than visual semantics changes. |

## Follow-Up Backlog

- Keep `docs/design/design-md-adoption.config.json` synchronized whenever a new authored UI CSS file is added; regenerate `docs/design/DESIGN_MD_ADOPTION_AUDIT.md` with `npm run design:audit`.
- Add chart-specific `DESIGN.md` tokens before introducing richer charting or graph components.
- Add duration/easing tokens before introducing reusable animation patterns.
- Consider full screenshot baseline assertions if the product needs stronger visual regression guarantees than smoke screenshots.
