---
version: alpha
name: Repo Visual Identity Placeholder
description: Replace this valid placeholder identity with the product's approved visual identity before shipping user-facing UI.
colors:
  palette-blue-600: "#2563EB"
  palette-blue-700: "#1D4ED8"
  palette-slate-50: "#F8FAFC"
  palette-slate-100: "#F1F5F9"
  palette-slate-200: "#E2E8F0"
  palette-slate-500: "#64748B"
  palette-slate-700: "#334155"
  palette-slate-900: "#0F172A"
  palette-white: "#FFFFFF"
  palette-red-600: "#DC2626"
  palette-amber-600: "#D97706"
  palette-green-700: "#15803D"
  palette-sky-700: "#0369A1"
  primary: "{colors.palette-blue-600}"
  primary-hover: "{colors.palette-blue-700}"
  secondary: "{colors.palette-slate-700}"
  tertiary: "{colors.palette-sky-700}"
  neutral: "{colors.palette-slate-100}"
  surface: "{colors.palette-white}"
  surface-muted: "{colors.palette-slate-50}"
  border: "{colors.palette-slate-200}"
  on-surface: "{colors.palette-slate-900}"
  on-muted: "{colors.palette-slate-500}"
  error: "{colors.palette-red-600}"
  warning: "{colors.palette-amber-600}"
  success: "{colors.palette-green-700}"
  info: "{colors.palette-sky-700}"
typography:
  headline-lg:
    fontFamily: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
    fontSize: 2rem
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: 0rem
  headline-md:
    fontFamily: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
    fontSize: 1.5rem
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: 0rem
  body-md:
    fontFamily: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0rem
  body-sm:
    fontFamily: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: 0rem
  label-md:
    fontFamily: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
    fontSize: 0.875rem
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: 0rem
  label-sm:
    fontFamily: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
    fontSize: 0.75rem
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: 0rem
  code-md:
    fontFamily: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace
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
  content-gap: "{spacing.4}"
  section-gap: "{spacing.8}"
  page-padding: "{spacing.6}"
rounded:
  none: 0px
  sm: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
  control: "{rounded.md}"
  panel: "{rounded.lg}"
  badge: "{rounded.full}"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    typography: "{typography.label-md}"
    rounded: "{rounded.control}"
    padding: "{spacing.3} {spacing.4}"
    height: 2.5rem
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.surface}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.label-md}"
    rounded: "{rounded.control}"
    padding: "{spacing.3} {spacing.4}"
    height: 2.5rem
  input-default:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
    rounded: "{rounded.control}"
    padding: "{spacing.2} {spacing.3}"
    height: 2.5rem
  input-error:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.error}"
  badge-default:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.secondary}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.badge}"
    padding: "{spacing.1} {spacing.2}"
  badge-success:
    backgroundColor: "{colors.success}"
    textColor: "{colors.surface}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.badge}"
    padding: "{spacing.1} {spacing.2}"
  badge-warning:
    backgroundColor: "{colors.warning}"
    textColor: "{colors.on-surface}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.badge}"
    padding: "{spacing.1} {spacing.2}"
  badge-error:
    backgroundColor: "{colors.error}"
    textColor: "{colors.surface}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.badge}"
    padding: "{spacing.1} {spacing.2}"
  badge-info:
    backgroundColor: "{colors.info}"
    textColor: "{colors.surface}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.badge}"
    padding: "{spacing.1} {spacing.2}"
  panel-default:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.panel}"
    padding: "{spacing.6}"
  panel-muted:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.secondary}"
    rounded: "{rounded.panel}"
    padding: "{spacing.6}"
  caption-muted:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-muted}"
    typography: "{typography.body-sm}"
  divider:
    backgroundColor: "{colors.border}"
    height: 1px
  link-default:
    textColor: "{colors.primary}"
    typography: "{typography.body-md}"
  link-tertiary:
    textColor: "{colors.tertiary}"
    typography: "{typography.body-md}"
---

# DESIGN.md

## Overview

This is a valid placeholder visual identity for a repo that needs a root `DESIGN.md`. Replace the name, rationale, palette, typography, component choices, and asset references with the approved product identity before shipping user-facing UI.

The default posture is quiet, professional, and task-focused. Interfaces should feel clear, scannable, and durable rather than decorative. Use the primary color for the main action or current selection, not as a page-wide wash.

Font delivery strategy: system stack by default. If the repo uses self-hosted or external fonts, declare that decision here and track font provenance outside this file.

## Colors

The placeholder palette uses high-contrast neutrals and one blue primary action color. Target repos must replace or explicitly accept these defaults.

- Primary is reserved for the single most important action, selection, or interactive accent in a view.
- Surface and neutral colors carry most page structure.
- Status colors are semantic only: success, warning, error, and info must communicate state and must not be used as decoration.
- Text/background pairings must meet WCAG AA contrast for normal text.

## Typography

Typography uses accessible `rem`-based implementation values and complete style tokens. Every repo-specific type style should define family, size, weight, line height, and intended usage.

- `headline-lg` and `headline-md` are for page and section headings.
- `body-md` is the default reading text.
- `body-sm` is for secondary detail text that remains readable.
- `label-md` and `label-sm` are for controls, metadata, and compact UI labels.
- `code-md` is for command, token, and technical values.

Letter spacing defaults to `0rem`. Change it only for a specific brand reason.

## Layout

Use a compact spacing scale and predictable alignment. Operational apps should prioritize dense, scannable layouts over oversized marketing composition.

- Small screens: use single-column task completion and avoid fixed-height text containers.
- Medium screens: use two-column form layouts only when labels, errors, and help text remain readable.
- Large screens: use constrained content widths for reading and denser grids for dashboards or comparison views.
- Prefer direct grouping, dividers, and headings before adding more panels.
- Use cards or panels only for repeated items, modals, or genuinely framed tools.

## Elevation & Depth

Depth should be restrained. Prefer borders, spacing, and tonal layers over heavy shadows. Use shadow only when a surface must float over other content, such as a dropdown, popover, modal, toast, or tooltip.

Layer order should be small and explicit: base, sticky, dropdown or popover, modal, toast, tooltip. Do not solve stacking conflicts with arbitrary large z-index values.

## Shapes

The placeholder shape language uses modest radius for controls and panels, with pill radius reserved for badges, chips, and compact tags.

- Controls use `rounded.control`.
- Panels use `rounded.panel`.
- Badges and chips use `rounded.badge`.
- Do not mix sharp and highly rounded treatments in the same repeated component family.

## Components

Component tokens are intentionally shallow while the upstream component specification evolves.

- Primary button: one per view or decision point, reserved for the main commit action.
- Secondary button: supporting action that must remain visible but not dominant.
- Input: show helper and error text close to the field; do not rely on color alone for invalid state.
- Panel: use for related controls or repeated records, not as a default wrapper around every section.
- Badge: use for short status or category labels.
- Link: use for navigation or references, not as a replacement for primary actions.

Persistent component exceptions should be promoted into this file through the protected change path.

## Do's and Don'ts

- Do use semantic tokens in implementation code rather than raw palette values.
- Do use the primary color for the most important action or selection on a screen.
- Do keep focus states visible and consistent.
- Do pair status colors with text, iconography, or labels.
- Do document one-off visual exceptions near the implementation.
- Don't invent new normative tokens during ordinary feature work.
- Don't use status colors for decorative emphasis.
- Don't use animation as the only state indicator.
- Don't add fake support for charts, dark mode, RTL, or multi-brand theming unless the repo implements it.
- Don't duplicate token values into markdown tables.

## Accessibility

Required automated checks are declared in `check-manifest.yaml`; this file defines the visual and interaction expectations those checks support.

- Normal text contrast must meet WCAG AA.
- Focus states must be keyboard-visible and not rely on color alone.
- Touch targets should be large enough for reliable interaction on supported devices.
- Disabled states must remain readable and must not hide required context.
- Respect reduced-motion preferences.
- Dark mode tokens are optional and must be complete before use.

## Iconography

Preferred icon library: repo-selected. If the frontend stack already includes a standard icon library, use that before adding a new dependency.

- Use one icon style per product surface.
- Keep stroke, fill, and corner style consistent.
- Pair unfamiliar icons with text labels.
- Use semantic colors for icon state, not decorative palette colors.

## Imagery

Store actual assets outside this file and reference their paths from prose or implementation docs. Recommended path convention: `assets/brand/`.

- Track provenance and license for logos, fonts, imagery, and generated media outside `DESIGN.md`.
- Generated imagery must follow the brand style, accessibility requirements, and review path for the repo.
- Avoid stock-like, unrelated, or purely atmospheric imagery when users need to inspect the product, place, state, or data.

## Content Tone

UI copy should be direct, specific, and task-oriented. Broader editorial or support tone belongs in a separate content guide.

- Buttons should name the action.
- Empty states should explain the state and provide a clear next action when one exists.
- Error states should explain what failed and what the user can do next.

## Localization

Localization scope: repo-defined. RTL support defaults to not required unless the repo contract or product requirements say otherwise.

- Allow text expansion without overlapping controls.
- Avoid fixed-height text containers for user-facing copy.
- Keep line lengths readable.
- Do not rely on icon-only labels for unfamiliar actions.
- Declare RTL support explicitly before implementing RTL-specific layouts.

## Agent Usage

- Treat YAML front matter tokens as normative.
- Preserve unknown sections when editing.
- Prefer `DESIGN.md` for standing tokens and design rules; prefer approved mockups for page-specific composition when they do not contradict tokens.
- If `DESIGN.md`, implementation tokens, and approved mockups materially conflict, stop and surface the conflict.
- If a needed token is missing, use the closest existing semantic token for the current change and record a follow-up.
- Do not invent new normative tokens unless the task explicitly includes updating `DESIGN.md` and the required approval path is satisfied.
- Material token, typography, source-of-truth, generated-output, accessibility, or agent-usage changes require owner approval and, when applicable, an ADR.
