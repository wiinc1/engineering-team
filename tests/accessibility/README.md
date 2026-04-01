# Accessibility coverage status for SF-019

Task Detail now has a thin browser-runtime accessibility smoke check under `npm run test:ui`.

Current coverage:
- axe-core smoke scan on the mounted `/tasks/:taskId` route
- semantic assertions for the main landmark, task summary region, tablist/tabs, tabpanel linkage, history filters, and task-id form label
- restricted-state coverage for authorization failure rendering

Notes:
- The task activity tabpanel now links back to its active tab with `aria-labelledby`, which closes the main semantics gap in the mounted shell.
- This is intentionally lightweight internal-use validation, not a full manual WCAG audit.

Still not covered:
- keyboard traversal/focus-order checks in a real browser
- contrast verification in a real browser engine
- screen-reader behavior validation
- full per-state axe coverage beyond the route states currently snapshotted
