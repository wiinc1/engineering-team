# Accessibility coverage status for SF-019

Task Detail now has a thin browser-runtime accessibility smoke check under `npm run test:ui`.

Current coverage:
- axe-core smoke scan on the mounted `/tasks/:taskId` route
- axe-core smoke scan on the mounted `/tasks` task-list route, including owner filter and results status messaging
- axe-core smoke scan on the mounted `/inbox/qa` role inbox route, including the read-only inbox region and routed-task status messaging
- semantic assertions for the main landmark, task summary region, task-list table, tablist/tabs, tabpanel linkage, history filters, and task-id form label
- restricted-state coverage for authorization failure rendering
- explicit assertions that owner state is never color-only (`Unassigned` / fallback copy remains text-visible)

Notes:
- The task activity tabpanel now links back to its active tab with `aria-labelledby`, which closes the main semantics gap in the mounted shell.
- The task list result summary uses `role="status"` + `aria-live="polite"` so owner filter changes announce updated counts.
- The QA inbox smoke check now asserts the dedicated `QA inbox view` region stays accessible while preserving read-only inbox semantics (no owner filter/edit controls on the route).
- This is intentionally lightweight internal-use validation, not a full manual WCAG audit.

Still not covered:
- keyboard traversal/focus-order checks in a real browser
- contrast verification in a real browser engine
- screen-reader behavior validation
- full per-state axe coverage beyond the route states currently snapshotted

Related browser evidence now lives under `npm run test:browser`, which verifies responsive layout behavior and basic local render timing in Chromium, but it is not a full accessibility audit.
