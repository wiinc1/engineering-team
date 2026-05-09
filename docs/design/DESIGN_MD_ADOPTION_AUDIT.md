# DESIGN.md Adoption Audit

Date: 2026-05-08

## Summary

`DESIGN.md` is declared as the authoritative visual design source of truth for this repo. Runtime CSS and generated token files are derived consumers. Current operationalization covers generated global tokens, Button tokens, TaskCreationForm tokens, drift checking, hard-coded visual value enforcement for migrated CSS, PR guidance, agent guidance, and screenshot smoke coverage.

## Component Coverage

| Component / Area | Uses DESIGN.md Tokens? | Enforcement Covered? | Notes |
| --- | --- | --- | --- |
| Global styles | Yes, partial | Yes | `src/app/styles.css` imports `src/app/design-tokens.css` and maps core colors, typography, radius, shadows, and focus tokens. The enforcement script scans this file. Some non-common legacy typography literals remain as incremental follow-up, but common forbidden literals are blocked. |
| Button | Yes | Yes | `src/components/Button/Button.module.css` imports `Button.tokens.css`; the generated token file is declared in `repo-contract.yaml`; enforcement scans the authored module. |
| TaskCreationForm | Yes | Yes | `src/features/task-creation/TaskCreationForm.module.css` imports `TaskCreationForm.tokens.css`; the generated token file is declared in `repo-contract.yaml`; enforcement scans the authored module. |
| Inputs/forms | Yes, partial | Yes, scoped | Global form controls and TaskCreationForm consume generated variables. Task-detail form modules such as `StageTransition.module.css` are not migrated yet and remain outside enforcement scope. |
| Links/nav | Yes, partial | Yes, scoped | App navigation in `src/app/styles.css` consumes generated color, radius, border, and typography variables. Link semantics exist in `DESIGN.md`; fuller link-specific runtime migration remains incremental. |
| Panels/cards | Yes, partial | Partial | App panels, cards, auth card, board cards, and summary cards in `src/app/styles.css` use generated variables and are enforcement-covered. Task-detail panel/card CSS modules still contain local fallback literals and should be migrated next. |
| Badges/status | Yes, partial | Yes, scoped | Global task status pills, review badges, routing badges, and status banners use semantic generated variables. Task-detail timeline/telemetry tone modules still have hard-coded fallbacks and are not in the first enforcement scope. |
| Tables/lists | Yes, partial | Yes, scoped | Global task list and board list styles use generated variables and are enforcement-covered. Task history timeline CSS is not migrated yet. |

## Optional DESIGN.md Area Audit

| Area | Status | Notes |
| --- | --- | --- |
| Accessibility | Implemented | `DESIGN.md` includes app-specific requirements for WCAG AA contrast, visible keyboard focus, touch target sizing, disabled/loading state legibility, overflow behavior, text wrapping, and reduced motion. |
| Iconography | N/A | The product is currently text-first and has no shipped icon set. `DESIGN.md` records that any future icon library must use one consistent style and ADR-backed dependency. |
| Imagery | N/A | The product has no logo, illustration, or brand-image asset system. `DESIGN.md` directs operational screens toward real product state, tables, task records, charts, logs, and reviewed asset provenance if imagery is introduced. |
| Content Tone | Implemented | `DESIGN.md` has app-specific UI copy guidance for task actions, empty states, errors, and workflow status labels. |
| Localization | N/A | Localization and RTL are explicitly not current requirements. `DESIGN.md` still defines text expansion, fixed-height avoidance, readable line length, and explicit RTL declaration expectations. |
| Navigation | Implemented | `DESIGN.md` includes app-nav rules for compact workflow navigation, wrapped links, and muted session controls. Runtime nav styles consume generated variables in `src/app/styles.css`. |
| Data Visualization | Needs work | `DESIGN.md` mentions real product state, charts, logs, and telemetry as preferred operational content, but it does not yet define chart, graph, or data visualization tokens. Track as follow-up before adding richer charting. |
| Multi-Brand Theming | N/A | The repo has one internal product identity: Engineering Team Software Factory Control Plane. No multi-brand or tenant-brand theming requirement is present. Add an ADR and token strategy before introducing multi-brand runtime theming. |
| Motion | Needs work | `DESIGN.md` requires respecting reduced-motion preferences, but it does not define a motion system, duration tokens, or transition rules. Track as follow-up before adding meaningful motion beyond existing small interaction transitions. |
| Visual Regression | Implemented | Existing browser screenshots cover task detail. This PR adds screenshot smoke coverage for the primary app screen, Button states, and TaskCreationForm token output. This is smoke coverage, not a full screenshot baseline system. |

## Acceptance Criteria Status

| Criterion | Status | Evidence |
| --- | --- | --- |
| `DESIGN.md` is declared as source of truth. | Pass | `DESIGN.md` source-of-truth decision and `repo-contract.yaml` `visual_identity.file: DESIGN.md`. |
| Generated token files are reproducible. | Pass | `npm run design:tokens` regenerates committed outputs; `npm run design:tokens:check` compares generated content with committed files. |
| Drift check fails if generated files are stale. | Pass | `scripts/generate-design-tokens.mjs --check` exits nonzero when an output differs or is missing. |
| Enforcement blocks new hard-coded visual values. | Pass | `scripts/check-design-token-usage.mjs` scans migrated CSS and rejects forbidden literals unless a reasoned `DESIGN-TOKEN-EXCEPTION:` is present. Focused unit coverage validates pass, fail, exception, missing-reason, and generated-output allowlist behavior. |
| Migrated components use generated variables. | Pass | Global styles, Button, and TaskCreationForm import generated token CSS and use `var(--...)` values. |
| Optional areas are implemented, explicitly N/A, or tracked as follow-up. | Pass | The optional area table above marks implemented, N/A, and follow-up items. |
| Screenshot smoke tests cover at least the primary screen and migrated components. | Pass | `tests/browser/design-token-operationalization.browser.spec.ts` captures primary app, Button states, and TaskCreationForm token output. |
| `make verify` passes. | Pass | Latest local verification passed with only the existing non-blocking maintainability warning on `dev-standards/templates/DESIGN.md`. |

## Follow-Up Backlog

- Migrate task-detail CSS modules next: `StageTransition.module.css`, `TaskDetailActivityShell.module.css`, `TaskHistoryTimeline.module.css`, and `TelemetrySummary.module.css`.
- Expand enforcement scope as each task-detail CSS module is migrated.
- Replace remaining non-common raw typography literals in `src/app/styles.css` with generated typography variables.
- Add `DESIGN.md` guidance for data visualization before introducing richer charting or graph components.
- Add `DESIGN.md` motion tokens and transition rules before adding meaningful animation beyond small existing interaction transitions.
- Consider full screenshot baseline assertions if the product needs stronger visual regression guarantees than smoke screenshots.
