---
version: alpha
name: Engineering Team Software Factory Control Plane
description: Visual identity for the internal Engineering Team task orchestration, audit, auth, and software-factory control-plane UI.
colors:
  palette-page-bg: "#EEF2F7"
  palette-surface: "#FFFFFF"
  palette-surface-muted: "#F6F8FB"
  palette-surface-subtle: "#EEF2F7"
  palette-border: "#CFD8E3"
  palette-border-soft: "#E2E8F0"
  palette-text: "#111827"
  palette-heading: "#0F172A"
  palette-muted: "#526174"
  palette-muted-strong: "#334155"
  palette-primary: "#2557D6"
  palette-primary-strong: "#1E40AF"
  palette-primary-soft: "#E8EEFC"
  palette-focus-ring: "#B9C9F5"
  palette-success: "#15803D"
  palette-success-text: "#166534"
  palette-success-soft: "#DCFCE7"
  palette-warning: "#A16207"
  palette-warning-text: "#92400E"
  palette-warning-soft: "#FEF3C7"
  palette-danger: "#B91C1C"
  palette-danger-text: "#991B1B"
  palette-danger-soft: "#FEE2E2"
  palette-info: "#1D4ED8"
  palette-info-soft: "#DBEAFE"
  palette-review: "#6D28D9"
  palette-review-soft: "#EDE9FE"
  page-bg: "{colors.palette-page-bg}"
  surface: "{colors.palette-surface}"
  surface-muted: "{colors.palette-surface-muted}"
  surface-subtle: "{colors.palette-surface-subtle}"
  border: "{colors.palette-border}"
  border-soft: "{colors.palette-border-soft}"
  on-surface: "{colors.palette-text}"
  on-heading: "{colors.palette-heading}"
  on-muted: "{colors.palette-muted}"
  on-muted-strong: "{colors.palette-muted-strong}"
  primary: "{colors.palette-primary}"
  primary-strong: "{colors.palette-primary-strong}"
  primary-soft: "{colors.palette-primary-soft}"
  focus-ring: "{colors.palette-focus-ring}"
  success: "{colors.palette-success}"
  success-text: "{colors.palette-success-text}"
  success-soft: "{colors.palette-success-soft}"
  warning: "{colors.palette-warning}"
  warning-text: "{colors.palette-warning-text}"
  warning-soft: "{colors.palette-warning-soft}"
  danger: "{colors.palette-danger}"
  danger-text: "{colors.palette-danger-text}"
  danger-soft: "{colors.palette-danger-soft}"
  info: "{colors.palette-info}"
  info-soft: "{colors.palette-info-soft}"
  review: "{colors.palette-review}"
  review-soft: "{colors.palette-review-soft}"
typography:
  headline-lg:
    fontFamily: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
    fontSize: 2.25rem
    fontWeight: 700
    lineHeight: 1.08
    letterSpacing: 0rem
  headline-fluid:
    fontFamily: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
    fontSize: 2.25rem
    fontWeight: 700
    lineHeight: 1.08
    letterSpacing: 0rem
  headline-mobile:
    fontFamily: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
    fontSize: 1.65rem
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: 0rem
  headline-md:
    fontFamily: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
    fontSize: 1.5rem
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: 0rem
  headline-sm:
    fontFamily: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
    fontSize: 1.125rem
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: 0rem
  body-md:
    fontFamily: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0rem
  body-sm:
    fontFamily: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
    fontSize: 0.9rem
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: 0rem
  label-md:
    fontFamily: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
    fontSize: 0.9rem
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: 0rem
  label-sm:
    fontFamily: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
    fontSize: 0.8rem
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: 0rem
  label-tracked:
    fontFamily: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
    fontSize: 0.8rem
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: 0.05rem
  app-nav:
    fontFamily: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
    fontSize: 0.84rem
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: 0rem
  button-sm:
    fontFamily: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
    fontSize: 0.8125rem
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: 0rem
  button-md:
    fontFamily: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
    fontSize: 0.875rem
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: 0rem
  button-lg:
    fontFamily: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
    fontSize: 1rem
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: 0rem
  code-md:
    fontFamily: '"SFMono-Regular", SFMono-Regular, ui-monospace, Menlo, Monaco, Consolas, "Liberation Mono", monospace'
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: 0rem
spacing:
  "0": 0px
  "1": 0.25rem
  "2": 0.5rem
  "3": 0.75rem
  "4": 1rem
  "5": 1.25rem
  "6": 1.5rem
  "8": 2rem
  "10": 2.5rem
  "12": 3rem
  control-gap: "{spacing.2}"
  dense-gap: 0.375rem
  content-gap: "{spacing.4}"
  section-gap: "{spacing.6}"
  page-padding: "{spacing.6}"
  mobile-page-padding: "{spacing.3}"
rounded:
  none: 0px
  control-sm: 6px
  control: 8px
  panel: 8px
  auth-panel: 12px
  status: 14px
  detail-panel: 16px
  pill: 999px
borders:
  default:
    width: 1px
    style: solid
    color: "{colors.border}"
  soft:
    width: 1px
    style: solid
    color: "{colors.border-soft}"
focus:
  ring:
    color: "{colors.focus-ring}"
    width: 3px
    offset: 2px
opacity:
  button-disabled: "0.5"
  control-disabled: "0.7"
  board-card-dragging: "0.68"
layers:
  base: 0
  sticky: 100
  dropdown: 1000
  popover: 1100
  modal: 1200
  toast: 1300
  tooltip: 1400
shadows:
  sm: 0 1px 2px rgba(15, 23, 42, 0.08)
  md: 0 12px 28px rgba(15, 23, 42, 0.08)
  auth-card: 0 18px 48px rgba(15, 23, 42, 0.1)
  focus-primary: 0 0 0 2px rgba(37, 99, 235, 0.16)
  success-focus: 0 0 0 3px rgba(21, 128, 61, 0.3)
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    typography: "{typography.label-md}"
    rounded: "{rounded.control}"
    padding: 10px 14px
    height: 2.5rem
  button-primary-hover:
    backgroundColor: "{colors.primary-strong}"
    textColor: "{colors.surface}"
  button-secondary:
    backgroundColor: "{colors.surface-subtle}"
    textColor: "{colors.on-surface}"
    typography: "{typography.label-md}"
    rounded: "{rounded.control}"
    padding: 10px 14px
    height: 2.5rem
  button-outline:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary-strong}"
    typography: "{typography.label-md}"
    rounded: "{rounded.control-sm}"
    padding: 10px 14px
    height: 2.5rem
  button-destructive:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.surface}"
    typography: "{typography.label-md}"
    rounded: "{rounded.control-sm}"
    padding: 10px 14px
    height: 2.5rem
  button-size-sm:
    typography: "{typography.button-sm}"
    padding: 0 12px
    height: 2rem
  button-size-md:
    typography: "{typography.button-md}"
    padding: 0 16px
    height: 2.5rem
  button-size-lg:
    typography: "{typography.button-lg}"
    padding: 0 24px
    height: 3rem
  input-default:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
    rounded: "{rounded.control}"
    padding: 10px 12px
    height: 2.5rem
  input-error:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.danger}"
  task-creation-form:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
    rounded: "{rounded.panel}"
    padding: 1.125rem
  task-creation-label:
    textColor: "{colors.on-muted-strong}"
    typography: "{typography.label-md}"
  task-creation-input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
    rounded: "{rounded.control}"
    padding: "{spacing.3}"
  task-creation-textarea:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
    rounded: "{rounded.control}"
    padding: "{spacing.3}"
    height: 220px
  task-creation-help:
    textColor: "{colors.on-muted}"
    typography: "{typography.body-sm}"
  task-creation-error:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger-text}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.control-sm}"
    padding: "{spacing.3}"
  task-creation-validation-error:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger-text}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.control-sm}"
    padding: "{spacing.2} {spacing.3}"
  task-detail-shell:
    backgroundColor: "{colors.page-bg}"
    textColor: "{colors.on-heading}"
    typography: "{typography.body-md}"
    rounded: "{rounded.panel}"
    padding: "{spacing.4}"
  task-detail-title:
    textColor: "{colors.on-heading}"
    typography: "{typography.headline-md}"
  task-detail-subtitle:
    textColor: "{colors.on-muted}"
    typography: "{typography.body-sm}"
  task-detail-label:
    textColor: "{colors.on-muted-strong}"
    typography: "{typography.label-sm}"
  task-detail-panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
    rounded: "{rounded.detail-panel}"
    padding: "{spacing.5}"
  task-detail-input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
    rounded: "{rounded.control}"
    padding: "{spacing.3}"
    height: 2.5rem
  task-detail-notice:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.on-muted-strong}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.auth-panel}"
    padding: "{spacing.4}"
  task-history-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.status}"
    padding: "{spacing.4}"
  telemetry-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.status}"
    padding: "{spacing.4}"
  badge-neutral:
    backgroundColor: "{colors.surface-subtle}"
    textColor: "{colors.on-muted-strong}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.pill}"
    padding: 4px 10px
  badge-success:
    backgroundColor: "{colors.success-soft}"
    textColor: "{colors.success-text}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.pill}"
    padding: 4px 10px
  badge-warning:
    backgroundColor: "{colors.warning-soft}"
    textColor: "{colors.warning-text}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.pill}"
    padding: 4px 10px
  badge-danger:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger-text}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.pill}"
    padding: 4px 10px
  badge-info:
    backgroundColor: "{colors.info-soft}"
    textColor: "{colors.info}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.pill}"
    padding: 4px 10px
  badge-review:
    backgroundColor: "{colors.review-soft}"
    textColor: "{colors.review}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.pill}"
    padding: 4px 10px
  page-shell:
    backgroundColor: "{colors.page-bg}"
    textColor: "{colors.on-heading}"
    typography: "{typography.body-md}"
    padding: "{spacing.6}"
  selected-row:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.primary-strong}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.panel}"
    padding: "{spacing.3}"
  status-success-solid:
    backgroundColor: "{colors.success}"
    textColor: "{colors.surface}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.pill}"
    padding: 4px 10px
  status-warning-solid:
    backgroundColor: "{colors.warning}"
    textColor: "{colors.surface}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.pill}"
    padding: 4px 10px
  border-rule:
    backgroundColor: "{colors.border}"
    height: 1px
  app-nav:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.app-nav}"
    rounded: "{rounded.panel}"
    padding: 8px 10px
  panel-default:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.panel}"
    padding: "{spacing.4}"
  panel-muted:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.on-muted-strong}"
    rounded: "{rounded.panel}"
    padding: "{spacing.4}"
  board-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.panel}"
    padding: "{spacing.3}"
  status-banner:
    backgroundColor: "{colors.warning-soft}"
    textColor: "{colors.warning-text}"
    rounded: "{rounded.panel}"
    padding: "{spacing.4}"
  table-header:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.on-muted}"
    typography: "{typography.label-md}"
  caption-muted:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-muted}"
    typography: "{typography.body-sm}"
  divider:
    backgroundColor: "{colors.border-soft}"
    height: 1px
  link-default:
    textColor: "{colors.primary}"
    typography: "{typography.body-md}"
  focus-ring:
    backgroundColor: "{colors.focus-ring}"
    width: 3px
---

# DESIGN.md

## Overview

The product identity is **Engineering Team Software Factory Control Plane**: an internal operations UI for task intake, task ownership, audit history, authentication, review questions, QA handoff, SRE monitoring, and software-factory workflow governance.

The visual posture is quiet, dense, and work-focused. Screens should read like an operator console: scannable tables and boards, plain status language, restrained depth, and direct controls. Avoid marketing composition, decorative color washes, and oversized hero treatments in product workflows.

Source-of-truth decision: `DESIGN.md` is the authoritative visual design source of truth. Runtime style files and generated token files are derived outputs. Update this file first for reusable visual token, component, accessibility, iconography, imagery, UX-state, and agent-guidance decisions, then regenerate runtime consumers such as `src/app/design-tokens.css`, `src/components/Button/Button.tokens.css`, `src/features/task-creation/TaskCreationForm.tokens.css`, and `src/features/task-detail/TaskDetail.tokens.css`.

## Colors

The palette is neutral-first with a single blue action color. The authenticated workspace uses a Linear-inspired dark issue-tracker chrome: charcoal page and sidebar surfaces, low-contrast dividers, compact rows, and blue reserved for primary actions, selected states, links, and focused workflow cues. The auth workflow may remain on the lighter card treatment because it is a single-purpose credential flow.

- `primary` maps to the app token `--primary: #2557D6`.
- `primary-strong` maps to `--primary-strong: #1E40AF` for active controls and emphasized links.
- `primary-soft` maps to `--primary-soft: #E8EEFC` for selected rows, matched board cards, and non-dominant primary emphasis.
- `page-bg`, `surface`, `surface-muted`, `surface-subtle`, `border`, and `border-soft` define the app shell, cards, tables, panels, and grouped controls.
- Authenticated shell styles may derive dark local aliases from these tokens for the issue-tracker chrome, but status colors remain semantic and sparse.
- Status colors are semantic only: success, warning, danger, info, and review must communicate workflow state or routing. They must not be used as decoration.
- Normal text/background pairs must meet WCAG AA contrast. Do not use soft status backgrounds without the paired dark status text token.

## Typography

The interface uses Inter when available, then the system UI stack. Typography is compact and optimized for dense dashboards, forms, and task records.

- `headline-lg` is for page-level task and dashboard titles.
- `headline-md` and `headline-sm` are for panels, cards, and sections.
- `body-md` is the default content style.
- `body-sm` is for secondary details, helper text, timestamps, and metadata.
- `label-md` and `label-sm` are for controls, table headers, badges, and compact labels.
- `code-md` is for IDs, command names, environment values, hashes, and technical references.
- Letter spacing is `0rem` by default. The only current exception is auth eyebrow text, which may use modest uppercase tracking where already implemented.

## Layout

Product screens should prioritize repeated operator workflows over presentation.

- Main authenticated shell: desktop uses a persistent left navigation rail plus a full-width work surface. The rail owns global workflow navigation, role inbox entry, and session controls; content views own filters, tables, boards, and task detail panels.
- The authenticated work surface should not be capped like a marketing page. It may use local gutters near `24px` on desktop and `12px-14px` on mobile, while tables and boards keep deliberate horizontal scrolling where needed.
- Authenticated desktop layout should feel like a dense issue tracker: dark fixed rail, compact content header, sticky view toolbar, low-depth panels, and board/list views that prioritize scan speed over card prominence.
- Auth shell: centered single-card workflow, max width around `480px`, with no marketing side panel.
- Task boards use horizontal scrolling columns on narrow viewports and fixed, predictable column widths on wide viewports.
- Tables use sticky headers, compact row padding, and horizontal overflow when columns cannot fit.
- Forms use direct labels, nearby help/error text, and stacked mobile layouts.
- Use panels for repeated records, forms, modals, status summaries, and genuinely framed tools. Do not put cards inside cards.

## Elevation & Depth

Depth is restrained. Use borders, spacing, and tonal surfaces first; use shadows only to separate surfaces that need to float or stand forward.

- Default shadow: `0 1px 2px rgba(15, 23, 42, 0.08)`.
- Raised card/dialog shadow: `0 12px 28px rgba(15, 23, 42, 0.08)` or the auth-card shadow already implemented.
- Avoid arbitrary stacking values. Layering should stay limited to base, sticky, dropdown or popover, modal, toast, and tooltip.

## Shapes

The shape language is modest and utilitarian.

- Standard controls and app panels use `8px` radius.
- Reusable button component internals may use the existing `6px` button radius from the button ADR.
- Auth cards may use `12px`; status containers may use `14px` where already implemented.
- Badges, chips, status pills, counters, and owner labels use `999px`.
- Do not mix highly rounded and square variants inside the same repeated component family.

## Components

Component rules reflect the current React/Vite app and the Button component ADR.

- Primary button: one dominant commit action per view or decision point.
- Secondary button: supporting action that must remain visible without competing with primary.
- Outline button: navigational or non-destructive alternative action where contrast against a surface is required.
- Destructive button: irreversible or high-risk action only; pair with clear text.
- Inputs and selects: use `surface`, `border`, `8px` radius, and nearby helper or error text.
- Task creation forms: use generated `task-creation-*` tokens for form panels, labels, inputs, helper text, and error states.
- Task detail shells, filters, timelines, telemetry cards, and stage transitions: use generated `task-detail-*`, `stage-transition-*`, `history-*`, and `telemetry-*` tokens. Keep activity history and telemetry adjacent but visually distinct.
- App nav: persistent desktop left rail with compact stacked route groups, visible selected state for the active Task workspace or Kanban board route, a primary create action, role inbox control, and muted session controls. On mobile it collapses back into a horizontally scrollable top navigation strip.
- Board columns and task cards: keep visible lane headings for the standard workflow columns even when a lane is empty, include count and empty-copy context for empty lanes, keep text readable, allow wrapping, preserve stable widths, and expose owner/status metadata without hover-only access.
- Badges: use semantic status text plus color. Do not rely on color alone.
- Review-question and QA/SRE panels: use status banners and summary grids to show route, risk, evidence, and required next action.

Persistent component exceptions must be promoted into this file through the protected change path and reflected in implementation tokens.

## Navigation & Role Surfaces

The app information architecture is workflow-first. Navigation must keep operational routes compact, role-aware, and recoverable after authentication.

- Authenticated navigation follows a modern issue-tracker chrome pattern: global routes stay in the left rail, while each view keeps its own filters and display controls in the content header or toolbar. Avoid duplicating the same route controls in both places.
- `/tasks` is the primary task workspace for delivery board and list scanning. It must keep owner, priority, status, waiting state, and next action visible without hover-only access.
- `/tasks/create` is the intake route. It creates an Intake Draft and keeps the operator in a local success state with links to task detail and the workspace.
- Task detail routes must keep the task summary, owner, stage, blockers, linked PRs, child task signal, activity, telemetry, governance, and assignment context in one scannable operational surface.
- `/overview/pm` groups work by routing bucket and remains read-only except for explicit PM/admin controls that the current session may use.
- `/overview/governance` is the dedicated governance-review surface. Governance review tasks do not belong in the ordinary delivery list.
- `/deferred-considerations` is a PM queue for out-of-scope ideas grouped by revisit date or trigger. Deferred items remain non-blocking until explicitly promoted.
- `/inbox/pm`, `/inbox/architect`, `/inbox/engineer`, `/inbox/qa`, `/inbox/sre`, and `/inbox/human` are role inboxes. Each inbox should explain why the shown work is routed there.
- The human inbox is limited to decision-ready close-governance and escalation items. It should not become a general task list.
- SRE inbox and monitoring surfaces expose deployment health, monitoring-window state, expiry/escalation context, and read-only operational evidence unless the session has a matching action role.
- Protected routes redirect to `/sign-in` and restore the intended route after sign-in. Safe no-login states must be explicit when no configured sign-in path is available.
- Production-like `/sign-in` deployments, including Vercel previews, default to registration auth unless a strategy explicitly selects OIDC or internal bootstrap.
- Admin registration surfaces must render the server auth-user status vocabulary directly. Pending approval, pending verification, invited, active, and disabled states must not collapse into a generic active label, and approval must be an explicit admin action.
- Role-gated controls must be omitted, disabled, or replaced with read-only status text according to server permissions. Readers may see owner metadata, but must not see assignment controls.

## Task Detail Data Semantics

Task detail UX is governed by the task-detail read model, not by ad hoc client-side reconstruction.

- `GET /tasks/:id/detail` is the canonical read model for the page. Raw history, relationships, telemetry, and task summaries are backing inputs, not independent UI sources of truth.
- Server-side omission and redaction are authoritative. The UI must render restricted or hidden states explicitly instead of implying missing data is fresh, empty, or user-editable.
- `summary.freshness` is the workflow/read-model freshness source. Telemetry recency is separate and must be labeled as telemetry-specific freshness.
- Stale, degraded, restricted, empty, and error task-detail states must be visually distinct and must include direct recovery or next-step language when recovery exists.
- Deterministic status precedence must be preserved: blocked, waiting, degraded/stale, review, done, and closed states should not compete through color alone.
- Linked child tasks, PR metadata, orchestration counts, and telemetry summaries must avoid N+1-style page behavior. Summaries should be pre-projected or loaded through explicit adjacent panels.
- Truncated payloads, hidden orchestration, redacted owner data, and unavailable telemetry must identify the limitation and its source.
- Manual refresh is the default recovery model for stale task-detail data unless a route defines a stronger live-update contract.

## UX States

Product screens must make workflow state explicit without adding instructional chrome.

- Empty states say what is missing, name the task area affected, and show the next available action when there is one.
- Loading states keep layout stable and include readable text such as `Loading task activity` or `Creating task draft`; do not rely on spinners alone.
- Error states identify the failed operation, preserve user-entered content, and offer retry or next-step language when recovery is possible.
- Form validation appears next to the relevant field and in a summarized list only when multiple fields need attention.
- Focus and keyboard behavior must match the control pattern: tabs use arrow keys, forms preserve label associations, buttons and links expose visible focus rings.
- Responsive layouts favor single-column reading on mobile, wrapped navigation, horizontally scrollable task boards/tables where necessary, and no accidental page-wide overflow.
- Operational screens should remain dense and scannable: prioritize headings, metadata, status labels, and row/card grouping over narrative copy.

App-specific state rules:

- Auth states must distinguish normal sign-in, registration, password reset, expired session recovery, rejected sign-in code, explicit internal-bootstrap fallback, and no-login-path safe state.
- Task creation success keeps focus on the created-status region and presents the next actions: open task detail, view task workspace, or create another task.
- PM overview degraded states must stay distinct from filtered-empty results. A degraded roster or metadata dependency should not make tasks disappear.
- Role inbox empty states must name the role queue and the routing condition, such as no QA-routed work, no SRE monitoring work, or no decision-ready human close-governance items.
- Governance and deferred-consideration states must make clear when work is non-blocking, excluded from delivery scope, waiting for revisit, or promoted into committed scope.
- SRE monitoring states must distinguish not started, active, approved, expired, escalated, and blocked by child anomaly work.
- Close-review and human-decision states must show whether the item is decision-ready, missing PM/Architect evidence, awaiting human decision, requesting more context, or routed back to implementation.
- Task-detail activity states must distinguish workflow history from telemetry; telemetry must stay adjacent, not mixed into the audit stream.

## Responsive & Performance UX Criteria

Responsive and perceived-performance behavior is part of the design contract for operational trust.

- Task detail must preserve first-viewport task context across desktop, tablet, and mobile: title, stage/status, owner, next action, and blocker signal stay discoverable before deep activity panels.
- Tablet and mobile task-detail views must not create accidental page-wide horizontal overflow. Deliberate scroll containers are limited to boards, tables, logs, and similarly wide data displays.
- Mobile task activity tabs use the documented keyboard-accessible tab pattern and may collapse into a compact two-column control when space is tight.
- Task boards keep stable column widths, allow horizontal scrolling, and keep owner metadata readable on compressed mobile views.
- Local browser performance coverage expects task-detail first contentful paint and DOMContentLoaded evidence under roughly one second, with total render evidence under roughly 1.5 seconds for the tested fixture route.
- Long lists, child task summaries, telemetry cards, and task-detail panels should use precomputed summaries or paginated/explicit loading so the initial task context remains fast.

## Do's and Don'ts

- Do use semantic CSS custom properties before raw palette values.
- Do reserve blue for the primary action, active selection, links, and focused workflow cues.
- Do keep operational views dense but readable.
- Do pair status color with labels, text, or icons.
- Do document one-off visual exceptions near the implementation and sync them here when they become reusable.
- Don't add decorative gradients, unrelated imagery, or page-wide color washes to operational screens.
- Don't use animation as the only state indicator.
- Don't invent new normative tokens during ordinary feature work.
- Don't duplicate token values into another design-token file without an ADR and sync check.

## Token Exceptions

Hard-coded visual values are not allowed in migrated UI CSS when the value is represented by `DESIGN.md` tokens.

Use this comment format only for rare one-off values:

```css
/* DESIGN-TOKEN-EXCEPTION: <short reason and follow-up if reusable> */
```

Reusable exceptions must become `DESIGN.md` tokens. One-off exceptions must stay local, include a specific reason, and remain rare. The token usage enforcement script fails when the exception comment has no reason.

## Accessibility

Accessibility requirements are part of the visual identity, not a separate pass.

- Normal text contrast must meet WCAG AA.
- Focus states must be visible for keyboard users; the current app uses a 3px blue focus outline with offset.
- Touch targets should be at least the current 40px control height unless the component is purely informational.
- Disabled and loading states must remain readable and must expose state through text or ARIA, not color alone.
- Responsive layouts must avoid horizontal page overflow except inside deliberate scroll containers such as task boards and tables.
- Text must wrap or truncate intentionally; IDs, URLs, and technical values must use `overflow-wrap: anywhere` where needed.
- Respect reduced-motion preferences for nonessential animation.

## Iconography

The current product is text-first and does not define a shipped icon set.

- Prefer clear text labels for workflow actions, especially in nav, forms, review states, and task controls.
- If an icon library is introduced, use one library and one stroke/fill style across the product; record the dependency and style choice in an ADR.
- Lightweight status glyphs may be used only as secondary decoration when paired with visible status text and semantic color. The text, not the glyph, carries the meaning.
- Icons used for status must be paired with text and semantic color, and decorative glyphs should be hidden from assistive technology when the adjacent text already names the state.
- Do not add decorative icons to dense operational surfaces.

## Imagery

The product currently has no logo, illustration, or brand-image asset system in the repository.

- Operational screens should use real product state, tables, task records, charts, or logs instead of stock imagery.
- Screenshots, generated media, and diagrams must track provenance outside `DESIGN.md`.
- Store future brand assets under a documented asset path, such as `assets/brand/`, and reference their license/provenance in docs.
- Generated imagery must be reviewed for brand fit, accessibility, and source disclosure before it appears in user-facing UI.

## Content Tone

UI copy should be direct, specific, and task-oriented.

- Buttons should name the action: `Save owner`, `Create thread`, `Approve early`.
- Empty states should say what is missing and identify the next available action when there is one.
- Error states should explain what failed and what the user can do next.
- Status labels should use workflow language that matches the task model: blocked, waiting, done, review, QA, SRE monitoring, assigned, unassigned.

## Localization

Localization and RTL are not currently product requirements.

- Allow text expansion without overlapping controls.
- Avoid fixed-height text containers for user-facing copy.
- Keep line lengths readable in forms, task cards, and panels.
- Do not rely on icon-only labels for unfamiliar actions.
- Declare RTL support explicitly before implementing RTL-specific layouts.

## Data Visualization

The product currently uses operational summaries, telemetry cards, tables, timelines, and logs instead of a charting system.

- Telemetry cards must use semantic `telemetry-*` tokens and pair values with labels and hints.
- Timeline and table status cues must pair color with text, event type, timestamp, actor, or source metadata.
- Do not introduce chart colors, graph legends, or heatmap scales without adding reusable tokens here first.
- Data displays should prioritize auditability: visible labels, stable sort/grouping, readable timestamps, and no hover-only critical information.

## Motion

Motion is limited to functional state feedback.

- Respect `prefers-reduced-motion` for nonessential animation.
- Do not use motion as the only indicator for loading, success, failure, or route changes.
- Transitions should be short, local to the control being changed, and must not move task rows, form fields, or summary cards in a way that harms scanning.
- Add duration/easing tokens here before introducing reusable animation patterns.

## Agent Usage

- Treat YAML front matter tokens as the design governance contract.
- Treat `DESIGN.md` as the authoritative source for reusable visual tokens and design rules.
- When changing reusable visual tokens, update `DESIGN.md` first, then regenerate runtime consumers with `npm run design:tokens`.
- Regenerate committed token outputs with `npm run design:tokens` and verify with `npm run design:tokens:check` plus `npm run design:tokens:enforce`.
- Do not add hard-coded visual values to authored CSS covered by `docs/design/design-md-adoption.config.json`.
- Update `docs/design/DESIGN_MD_ADOPTION_AUDIT.md` and `docs/design/design-md-adoption.config.json` whenever a UI component family is migrated into enforcement.
- Preserve unknown sections when editing.
- Prefer `DESIGN.md` for standing tokens and design rules; prefer approved issue designs for page-specific composition when they do not contradict these tokens.
- If `DESIGN.md`, implementation tokens, and approved mockups materially conflict, stop and surface the conflict.
- If a needed token is missing, use the closest existing semantic token for the current change and record a follow-up.
- Do not invent new normative tokens unless the task explicitly includes updating `DESIGN.md` and the required approval path is satisfied.
- Material token, typography, source-of-truth, generated-output, accessibility, or agent-usage changes require owner approval and, when applicable, an ADR.
