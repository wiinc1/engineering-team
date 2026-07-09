# ET Product Delivery Integrity — Requirements

**Status:** Draft requirements from TSK-001 / Command Center retrospective (2026-06-28)  
**Trigger:** Golden path advanced platform workflow while the operator UI at `:15173` did not match spec or [issue #279](https://github.com/wiinc1/engineering-team/issues/279).  
**Meta-lesson:** ET orchestrates *who did what when* well; it does not prove *what the operator sees* matches spec unless merge target, served URL, design reference, and visual verification are in the definition of done.

---

## Goals

1. **Product truth** — A task cannot reach implementation-complete / QA-pass / closeout unless code is on the branch the dev UI serves (default: `main` at `http://127.0.0.1:15173`).
2. **Environment-true QA** — UI verification runs on the operator golden-path stack, not mocked Playwright on `:4174` alone.
3. **Scope clarity** — UI tasks anchor to a design issue, screenshot, and explicit parity bar (MVP vs full redesign).
4. **Visual gates** — `desktop_visual_validation` and `human_workflow` risk flags block automation until evidence exists.
5. **Layered reporting** — Platform closeout (stages, forge, gates) is separate from product closeout (visible UI, design parity).

---

## Non-goals (this epic)

- Implementing the full Command Center redesign ([issue #279](https://github.com/wiinc1/engineering-team/issues/279)) — tracked separately.
- Mobile/responsive redesign.
- Replacing forge worktrees — only requiring reconciliation to the runnable surface.

---

## Epic A — Runnable surface verification (Lessons 1, 2, 10)

### REQ-A1: Runnable surface declaration

Every UI-affecting execution contract MUST declare:

| Field | Example |
| --- | --- |
| `runnableSurface.branch` | `main` |
| `runnableSurface.serveUrl` | `http://127.0.0.1:15173` |
| `runnableSurface.mergePolicy` | `required_before_submission_final` \| `stack_serves_worktree` |
| `forgeArtifact.worktreeAllowed` | `true` (forge may use worktree) |
| `designAnchor.issueUrl` | `https://github.com/wiinc1/engineering-team/issues/279` |
| `designAnchor.screenshotPath` | `docs/design/assets/command-console-redesign-target.png` |

### REQ-A2: Merge-to-runnable-surface gate

Before `engineer_submission` is accepted as final for `ui_ux` / `affectsUi` tasks:

- Submission `commitSha` MUST be an ancestor of `runnableSurface.branch` HEAD (or equal).
- If `mergePolicy === required_before_submission_final`, reject submission when SHA is worktree-only.
- Store verification result on the submission event: `runnable_surface_verified: true|false`, `verified_branch`, `verified_at`.

**Acceptance:**

- API returns `409` with `runnable_surface_not_merged` when SHA ∉ `main`.
- Unit tests for ancestor check and policy bypass only in test env.
- Golden-path script fails fast if TSK-style orphan SHA is submitted.

### REQ-A3: Product reconciliation workflow

When operator reports UI mismatch OR submission SHA ∉ runnable branch:

1. Block QA pass and PM/Architect product closeout.
2. Expose task action: **Reconcile product with ET** (records mismatch, resets product layer only).
3. Script: `scripts/reconcile-product-delivery.js` — checks SHA on branch, optional stage rollback guidance, observability JSON output.

**Acceptance:**

- Runbook section in `docs/runbooks/golden-path-autonomous-delivery.md`.
- Observability artifact: `observability/product-reconciliation-<taskId>.json`.

### REQ-A4: Optional stack serves worktree mode

For forge-only pilots, `mergePolicy: stack_serves_worktree` MUST:

- Pin Vite root / `FORGE_WORKTREE_PATH` in `stack.json`.
- Document that `:15173` serves worktree, not `main`.
- Runnable surface check validates SHA exists in that worktree HEAD.

---

## Epic B — Environment-true QA (Lessons 3, 5, 8)

### REQ-B1: Golden-path browser verification profile

Add `playwright.golden-path.config.ts` (or env flag) that:

- `baseURL`: `http://127.0.0.1:15173`
- Uses real registration login (`admin@golden-path.local` / seeded password).
- Hits real `/backend` proxy → Postgres audit API.
- Does **not** mock `/api/tasks` unless test is explicitly marked `unit-browser-fixture`.

**Acceptance:**

- `npm run test:browser:golden-path` (or documented equivalent) runs against `:15173`.
- CI/local docs state: UI task QA evidence MUST include this profile results for `desktop_visual_validation` tasks.
- Separate from existing `playwright.config.ts` (`:4174` + mocks) which remains for fast PR feedback.

### REQ-B2: On-load visual verification

For `desktop_visual_validation` tasks, QA submission MUST include:

| Evidence | Required |
| --- | --- |
| Desktop screenshot (≥1280px width) at `runnableSurface.serveUrl` | Yes |
| Route path (e.g. `/tasks`) | Yes |
| Before/after or vs design anchor | Yes |
| On-load first paint (not only post-click) | Yes |

**Acceptance:**

- QA API validates presence of `visualEvidence.screenshotPath` or attached artifact URI when risk flag set.
- Checklist template in `docs/templates/UI_VERIFICATION_CHECKLIST.md`.

### REQ-B3: Operator verification path

Execution contract section (or intake) MUST include **Operator verification path**:

```
URL: http://127.0.0.1:15173/sign-in
Login: admin@golden-path.local / <seeded>
Nav: Task workspace (not task detail, not inbox)
Route: /tasks?view=list
On load: <expected chrome>
On select: <expected inspector behavior>
Out of scope routes: /tasks/:id, /inbox/*, /overview/*
```

**Acceptance:**

- PM refinement agent prompt includes operator path for `ui_ux` category.
- Task detail UI surfaces operator path read-only for QA/human reviewers.

---

## Epic C — Scope anchors & visual acceptance (Lessons 4, 7)

### REQ-C1: Design scope anchor

UI tasks MUST link exactly one scope mode:

| Mode | Meaning |
| --- | --- |
| `design_full` | Match design issue screenshot structure (e.g. #279) |
| `design_mvp` | Explicit MVP slice; lists in/out vs design issue |
| `behavior_only` | No visual parity claim; inspector/routing behavior only |

Stored on contract: `designScope.mode`, `designScope.issueUrl`, `designScope.parityBar`.

**Acceptance:**

- Contract approval blocked for `ui_ux` without `designScope`.
- TSK-001 class failure: `behavior_only` must not claim #279 parity in title/summary.

### REQ-C2: Visual acceptance criteria template

Replace behavior-only UI criteria with observable product outcomes:

- Default route and primary tab (Queue / List / Board).
- Required layout regions (sidebar groups, command bar, queue sections).
- Inspector fields and quick actions.
- Screenshot comparability statement.

Template: `docs/templates/UI_ACCEPTANCE_CRITERIA.md` (Given/When/Then + visual checkpoints).

**Acceptance:**

- `reseed-tsk-001-local.js` or future seeds use template for `ui_ux`.
- Contract coverage rows can map criteria → screenshot regions.

---

## Epic D — Risk flag hard gates (Lessons 8, 9)

### REQ-D1: `desktop_visual_validation` gate

When risk flag present:

| Gate | Block until |
| --- | --- |
| Engineer submission final | Screenshot attached + SHA on runnable branch |
| QA pass | Golden-path browser profile pass + on-load screenshot |
| Forge QA approve (bridge) | ET QA pass with visual evidence |
| PM product closeout | Human or UX reviewer sign-off event |

**Acceptance:**

- `evaluateExecutionContractDispatchReadiness` / QA ingest returns blocking reasons.
- No `advance-tsk-001-qa-loop.js` style bypass without `VISUAL_GATE_OVERRIDE` test flag.

### REQ-D2: `human_workflow` gate

When risk flag present:

- QA pass requires `human_visual_signoff_recorded` OR UX reviewer gate approved with screenshot reference.
- Automation may record intentional fail; pass requires human/UX event.

---

## Epic E — Platform vs product reporting (Lesson 6)

### REQ-E1: Dual closeout layers on task state

Extend task projection:

```json
{
  "platform_delivery": {
    "stage": "SRE_MONITORING",
    "forge_execution_state": "completed",
    "gates": { "ux": "approved", "qa": "approved" }
  },
  "product_delivery": {
    "status": "not_started | in_progress | verified | failed",
    "runnable_surface_verified": false,
    "visual_verified": false,
    "design_scope_mode": "design_mvp",
    "last_verified_commit": null
  }
}
```

**Acceptance:**

- `/tasks/:id/state` exposes both layers.
- UI shows “Platform: QA pass” vs “Product: not verified” when diverged (TSK-001 scenario).
- Closeout requires `product_delivery.status === verified` for `affectsUi` tasks.

---

## Epic F — Product follow-up (Issue #279)

Not part of delivery-integrity engineering; depends on Epics A–E being in place first.

| Item | GitHub | Notes |
| --- | --- | --- |
| Full Command Center redesign | [#279](https://github.com/wiinc1/engineering-team/issues/279) | Design on `codex/command-console-redesign-issue` |
| TSK-001 product completion | New child of #279 or re-scope | MVP inspector ≠ #279 mock |

---

## Implementation issue map

**Parent epic:** [#290 — ET product delivery integrity](https://github.com/wiinc1/engineering-team/issues/290)

| ID | Title | Epic | Lessons |
| --- | --- | --- | --- |
| [#280](https://github.com/wiinc1/engineering-team/issues/280) | Runnable surface verification gate for UI engineer submissions | A | 1, 2 |
| [#281](https://github.com/wiinc1/engineering-team/issues/281) | Golden-path browser verification profile (`:15173`, real auth/API) | B | 3 |
| [#282](https://github.com/wiinc1/engineering-team/issues/282) | Product reconciliation workflow and operator runbook | A | 10 |
| [#283](https://github.com/wiinc1/engineering-team/issues/283) | Design scope anchors on execution contracts (`design_full` / `mvp` / `behavior_only`) | C | 4 |
| [#284](https://github.com/wiinc1/engineering-team/issues/284) | Visual acceptance criteria template and contract integration | C | 7, 5 |
| [#285](https://github.com/wiinc1/engineering-team/issues/285) | Operator verification path in intake and task detail | B | 8 |
| [#286](https://github.com/wiinc1/engineering-team/issues/286) | Hard gates for `desktop_visual_validation` risk flag | D | 9 |
| [#287](https://github.com/wiinc1/engineering-team/issues/287) | Platform vs product delivery layers on task state | E | 6 |
| [#288](https://github.com/wiinc1/engineering-team/issues/288) | On-load screenshot requirement in QA ingest for visual UI tasks | B | 5 |
| [#289](https://github.com/wiinc1/engineering-team/issues/289) | Re-scope TSK-001 product delivery against issue #279 | F | 4, 6 |

---

## Definition of done (epic)

- [ ] Cannot QA-pass a `desktop_visual_validation` task without golden-path screenshot evidence.
- [ ] Cannot final-submit engineer work for `ui_ux` when commit ∉ `main` (default policy).
- [ ] Task state shows platform vs product divergence explicitly.
- [ ] Operator runbook documents verification path and reconciliation.
- [ ] Issue #279 product work scheduled separately with `design_full` scope anchor.

---

## References

- [Issue #279 — Command Center redesign](https://github.com/wiinc1/engineering-team/issues/279)
- [Golden path runbook](../runbooks/golden-path-autonomous-delivery.md)
- TSK-001 retrospective (conversation 2026-06-28)
- Target screenshot: `codex/command-console-redesign-issue/docs/design/assets/command-console-redesign-target.png`