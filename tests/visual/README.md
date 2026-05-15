# Visual regression coverage status for SF-019

The browser-rendered task detail history and telemetry UI now ships in this repository.

Current visual evidence lives in the Playwright browser suite under `tests/browser/task-detail.browser.spec.ts`, which covers:
- mounted task-detail summary + activity shell rendering
- responsive history timeline layout on tablet/mobile breakpoints
- history and telemetry tab activation plus panel visibility
- blocked-state first-screen rendering without horizontal overflow

Issue #158 adds committed browser screenshot baselines under
`tests/browser/__screenshots__/browser-quality-visual.browser.spec.ts/`.
Those baselines compare the critical mobile and desktop states for:
- sign-in
- task workspace
- QA role inbox
- task creation
- task detail

Run the focused visual gate with:

```bash
npm run test:browser:quality
```

Local Chromium keeps a strict `0.04` pixel-diff cap. CI uses `0.10` to absorb
Linux runner font rasterization and long-page height drift while still failing
large layout, spacing, or content regressions.
The long mobile task-detail state is captured at the viewport instead of full
page so the gate does not depend on cross-platform full-page height rounding.

Update baselines intentionally with:

```bash
node scripts/run-playwright.js tests/browser/browser-quality-visual.browser.spec.ts --project=chromium --update-snapshots
```

What is still not in place:
- per-substate screenshots for history filtered, paginated, telemetry restricted, and telemetry degraded task-detail variants
- non-Chromium pixel baselines; Firefox, mobile Chrome, and CI WebKit remain behavioral/accessibility matrix coverage

When expanding visual coverage, prioritize:
- task history timeline default state
- date-filtered and paginated history views
- telemetry ready / empty / restricted / degraded states
- separation pattern between workflow history and telemetry
