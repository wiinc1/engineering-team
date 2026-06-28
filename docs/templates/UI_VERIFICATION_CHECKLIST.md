# UI Verification Checklist

Complete this checklist for `desktop_visual_validation` tasks before QA pass.

## Environment

- [ ] Golden-path stack running (`npm run dev:golden-path:up`)
- [ ] Runnable surface URL reachable (`http://127.0.0.1:15173`)
- [ ] Audit API reachable via `/backend` proxy
- [ ] Signed in as `admin@golden-path.local`

## On-load visual evidence (required)

- [ ] Desktop screenshot captured at runnable surface URL (not mocked `:4174` fixture)
- [ ] Viewport width >= 1280px
- [ ] Route path recorded (e.g. `/tasks?view=list`)
- [ ] Capture phase is **on-load first paint** (not only post-click state)
- [ ] Comparability note references design anchor or before/after intent
- [ ] `npm run test:browser:golden-path` pass attached for visual tasks

## Product behavior

- [ ] Default route matches operator verification path
- [ ] Queue/list/board selection updates persistent inspector
- [ ] Out-of-scope routes were not used as proof of delivery

## Submission integrity

- [ ] Engineer submission commit is on runnable branch (`main` by default)
- [ ] Task detail shows `product_delivery.runnable_surface_verified: true` after submission

## QA ingest payload

Include in QA result body:

```json
{
  "visualEvidence": {
    "screenshotPath": "observability/product-visual/<task-id>-on-load.png",
    "routePath": "/tasks?view=list",
    "viewportWidth": 1280,
    "capturePhase": "on_load",
    "comparabilityNote": "Compared against docs/design/assets/command-console-redesign-target.png",
    "goldenPathBrowserProfile": "playwright.golden-path"
  }
}
```