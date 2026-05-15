# Accessibility coverage status for SF-019

Task Detail now has a thin browser-runtime accessibility smoke check under `npm run test:ui`.

Current coverage:
- axe-core smoke scan on the mounted `/tasks/:taskId` route
- axe-core smoke scan on the mounted `/tasks` task-list route, including owner filter and results status messaging
- axe-core smoke scan on the mounted `/inbox/qa` role inbox route, including the read-only inbox region and routed-task status messaging
- real-browser axe scan on task workspace, QA inbox, and task-detail routes through `npm run test:browser:quality`
- keyboard focus-order and activation checks for protected sign-in recovery, task creation, and task-detail activity tabs
- visible focus assertions for interactive controls used in the protected sign-in and creation flows
- contrast checks in the real browser for visible headings, labels, tables, controls, and live status text
- semantic assertions for the main landmark, task summary region, task-list table, tablist/tabs, tabpanel linkage, history filters, and task-id form label
- semantic assertions for task-detail history date filters and the paginated `Load more` control
- restricted-state coverage for authorization failure rendering
- restricted telemetry-state coverage on the summary/history/observability fallback path
- explicit assertions that owner state is never color-only (`Unassigned` / fallback copy remains text-visible)

Notes:
- The task activity tabpanel now links back to its active tab with `aria-labelledby`, which closes the main semantics gap in the mounted shell.
- The task list result summary uses `role="status"` + `aria-live="polite"` so owner filter changes announce updated counts.
- The QA inbox smoke check now asserts the dedicated `QA inbox view` region stays accessible while preserving read-only inbox semantics (no owner filter/edit controls on the route).
- The browser quality gate writes failure screenshots, traces, and accessibility failure context to `test-results/browser/**`.
- This is intentionally lightweight internal-use validation, not a full manual WCAG audit.

Still not covered:
- real assistive-technology screen-reader execution; the automated proxy remains labels, landmarks, tab semantics, and live-region assertions
- full per-state axe coverage beyond the sign-in, task workspace, role inbox, task creation, and task-detail states currently gated

Related browser evidence now lives under `npm run test:browser` and `npm run test:browser:quality`, which verify responsive layout behavior, keyboard traversal, contrast, axe, visual baselines, and local Core Web Vitals budgets across the configured browser matrix.
