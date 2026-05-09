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

Source-of-truth decision: `DESIGN.md` is the authoritative visual design source of truth. Runtime style files and generated token files are derived outputs. Update this file first for reusable visual token, component, accessibility, iconography, imagery, and agent-guidance decisions, then regenerate or update runtime consumers such as `src/app/styles.css` and `src/components/Button/Button.module.css`.

## Colors

The palette is neutral-first with a single blue action color. Page structure is carried by light grey-blue surfaces and borders; blue is reserved for primary actions, selected states, links, and focused workflow cues.

- `primary` maps to the app token `--primary: #2557D6`.
- `primary-strong` maps to `--primary-strong: #1E40AF` for active controls and emphasized links.
- `primary-soft` maps to `--primary-soft: #E8EEFC` for selected rows, matched board cards, and non-dominant primary emphasis.
- `page-bg`, `surface`, `surface-muted`, `surface-subtle`, `border`, and `border-soft` define the app shell, cards, tables, panels, and grouped controls.
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

- Main authenticated shell: max width `1280px`, desktop padding near `24px 20px 48px`, mobile padding near `18px 14px 36px`.
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
- App nav: compact two-region workflow navigation with wrapped links and muted session controls.
- Board columns and task cards: keep text readable, allow wrapping, preserve stable widths, and expose owner/status metadata without hover-only access.
- Badges: use semantic status text plus color. Do not rely on color alone.
- Review-question and QA/SRE panels: use status banners and summary grids to show route, risk, evidence, and required next action.

Persistent component exceptions must be promoted into this file through the protected change path and reflected in implementation tokens.

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
- Icons used for status must be paired with text and semantic color.
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

## Agent Usage

- Treat YAML front matter tokens as the design governance contract.
- Treat `DESIGN.md` as the authoritative source for reusable visual tokens and design rules.
- When changing reusable visual tokens, update `DESIGN.md` first, then regenerate or update runtime consumers such as `src/app/styles.css`, component CSS defaults, and generated token files.
- Preserve unknown sections when editing.
- Prefer `DESIGN.md` for standing tokens and design rules; prefer approved issue designs for page-specific composition when they do not contradict these tokens.
- If `DESIGN.md`, implementation tokens, and approved mockups materially conflict, stop and surface the conflict.
- If a needed token is missing, use the closest existing semantic token for the current change and record a follow-up.
- Do not invent new normative tokens unless the task explicitly includes updating `DESIGN.md` and the required approval path is satisfied.
- Material token, typography, source-of-truth, generated-output, accessibility, or agent-usage changes require owner approval and, when applicable, an ADR.
