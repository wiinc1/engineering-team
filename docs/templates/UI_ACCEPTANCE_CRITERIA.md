# UI Acceptance Criteria Template

Use this template for `ui_ux` execution contracts (section 2). Replace placeholders with task-specific routes, layout regions, and design anchor references.

## Scope anchor

- **Design scope mode:** `design_full` | `design_mvp` | `behavior_only`
- **Design issue:** `<GitHub issue URL>`
- **Screenshot path:** `<repo-relative path>`
- **Parity bar:** `<one sentence describing expected visual parity>`

## Operator verification path

- **Runnable surface URL:** `http://127.0.0.1:15173`
- **Sign-in:** `admin@golden-path.local` / seeded password
- **Route:** `/tasks?view=list`
- **On load:** `<expected chrome on first paint>`
- **On select:** `<expected inspector behavior>`

## Given / When / Then

1. **Default route and primary tab**
   - Given an operator opens the runnable surface at the declared route, when the page finishes loading, then the default view shows the primary queue/list/board tab without requiring navigation through inbox or task detail routes.

2. **Required layout regions**
   - Given the Command Center renders on first paint, when the operator scans the desktop layout, then required regions (sidebar groups, command bar, queue sections) are visible per the declared design scope mode.

3. **Inspector behavior**
   - Given a task is visible in the queue/list/board, when the operator selects it, then a persistent inspector opens or updates while preserving queue context.

4. **Visual comparability**
   - Given QA captures on-load evidence, when the screenshot is compared to the design anchor, then the captured route, viewport (>=1280px), and comparability note make the result reproducible by another reviewer.

5. **Runnable surface merge**
   - Given engineer submission is final, when the submission commit is checked against the runnable branch, then the commit is an ancestor of the branch HEAD served at the runnable surface URL.

## Out of scope (unless `design_full`)

- Full design-system token parity with the reference mock
- Mobile/responsive layouts
- Routes listed in `operator_verification_path.out_of_scope_routes`