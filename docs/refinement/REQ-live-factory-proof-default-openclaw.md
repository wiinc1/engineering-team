# Requirements: Live Factory Proof as Default (Not Fixtures)

**Story / REQ ID:** REQ-LIVE-FACTORY-PROOF-DEFAULT  
**Status:** Implemented (code path + unit coverage; operator live C/D re-run still required with gateway up)  
**Template tier:** Standard  
**Decisions:** `docs/reports/FACTORY_AUTONOMY_DECISIONS.md`, PRD progressive autonomy / coordinated stack  
**Primary metric contribution:** Honest operator-trusted autonomous delivery evidence (real runtime session ownership)

---

## 1. User story

As a Software Factory operator,  
I want milestone and golden-path verification to use **live OpenClaw** whenever a gateway is available, and to **fail closed** if fixtures are used under production-like proof flags,  
so that factory green claims are backed by real specialist `sessionId`s—not fixture attribution.

---

## 2. Business context

Today:

| Surface | Current default | Live path |
| --- | --- | --- |
| `npm run milestone-b:verify` | `FACTORY_USE_FIXTURE_DELEGATION=true` | `--live-openclaw --openclaw-url …` |
| `npm run milestone-c:verify` | fixture | `milestone-c:verify:live` or `--live-openclaw` |
| `npm run milestone-d:verify` | fixture unless `--live-openclaw` | opt-in |
| Milestone E hosted phase 6 | forces non-fixture | partial |
| `resolveAgentDelegationRunner` | fixture unless `FACTORY_USE_FIXTURE_DELEGATION=false` / real-evidence flags / explicit runner | OpenClaw runner |

Milestone completion artifacts (`observability/milestone-*-complete.json`) have been proven largely with **fixture** delegation. That is insufficient for the locked success bar (≥80% operator-trusted rate on real closes).

**Problem:** Fixture proofs create false confidence. Live OpenClaw is opt-in, easy to skip, and not the primary path.

**Outcome:** One **primary** GP path that produces real `sessionId`s for agent phases, with fixtures reserved for explicit fast local smoke only.

---

## 3. Goals

1. Prefer **live OpenClaw** for milestone / golden-path verify when a gateway is available.  
2. **Fail closed** when production-like proof flags are set and a fixture runner is used.  
3. Re-run milestones **A–E** (minimum **C + D**) with live session evidence and refresh completion artifacts.  
4. **Exit:** one primary path through golden path with **real sessionIds**, not fixture attribution.

---

## 4. Non-goals

- Replacing OpenClaw with another specialist runtime.  
- Requiring live OpenClaw for pure unit tests (`tests/unit/*`).  
- Multi-repo / target-app GP-024/025.  
- Full unattended auto-merge productization beyond existing GP-022 gates.  
- Changing PRD progressive-autonomy policy (human PM/Architect on agent disagreement remains as already specified).  
- Making `dev:golden-path:up` always start a real OpenClaw process if none is installed (probe + fail closed is enough; optional doc for installing/starting gateway).

---

## 5. Definitions

| Term | Definition |
| --- | --- |
| **Fixture runner** | `tests/fixtures/specialist-runtime-runner.js` (or any runner path containing that fixture) |
| **Live runner** | `scripts/openclaw-specialist-runner.js` (or equivalent configured via `SPECIALIST_DELEGATION_RUNNER` that talks to a real gateway) |
| **Gateway available** | HTTP(S) base URL (default probe `OPENCLAW_BASE_URL` or `--openclaw-url`) responds successfully to the agreed health/probe contract within timeout |
| **Real session evidence** | Delegation result with `mode=delegated` (or equivalent), non-empty `sessionId`, `attribution.delegated=true` (or factory evidence field proving runtime session ownership), and agent id **not** a known fixture stub |
| **Production-like proof** | Any of: primary milestone verify defaults, `FACTORY_PROOF_PROFILE=live` / `production-like`, `FF_GOLDEN_PATH_REQUIRE_REAL_EVIDENCE=true`, real-evidence collection flags, or npm scripts advertised as factory green claims |
| **Fixture-allowed smoke** | Explicitly opted-in path for fast local development only (must not write `milestone-*-complete.json` or claim operator-trusted delivery) |

---

## 6. Functional requirements

### FR-1 — Gateway probe

**FR-1.1** Implement a shared probe used by factory verify entrypoints (milestone A–E verify scripts, factory orchestrator verify path, and golden-path replay when agent phases run).

**FR-1.2** Probe inputs (in priority order):

1. CLI `--openclaw-url`  
2. `OPENCLAW_BASE_URL`  
3. Documented default for local live gateway (today’s live verify convention: `http://127.0.0.1:18789`) when profile is live  

**FR-1.3** Probe must return structured result: `{ available: boolean, baseUrl, latencyMs?, errorCode?, errorMessage? }` without printing secrets.

**FR-1.4** Probe timeout default ≤ 3s (configurable via env, e.g. `OPENCLAW_PROBE_TIMEOUT_MS`).

### FR-2 — Profile selection: live vs fixture

**FR-2.1** Introduce an explicit proof profile (name may vary; behavior is normative):

| Profile | When selected | Fixture allowed? |
| --- | --- | --- |
| `live` (primary / default for factory claims) | Gateway available **or** operator forces live | **No** |
| `fixture` (secondary) | Explicit opt-in only (`--allow-fixture-delegation` / `FACTORY_USE_FIXTURE_DELEGATION=true` with non-production-like profile) | Yes |
| `fail-closed` | Production-like proof requested and gateway unavailable / fixture attempted | N/A — must exit non-zero |

**FR-2.2** **Default for factory claim commands** (`milestone-b:verify`, `milestone-c:verify`, `milestone-d:verify`, factory orchestrator phase verify used for A–E completion, golden-path agent phases used for milestone complete):

1. Probe gateway.  
2. If available → select **live**, set `FACTORY_USE_FIXTURE_DELEGATION=false`, `FF_REAL_SPECIALIST_DELEGATION=true`, `SPECIALIST_DELEGATION_RUNNER` → OpenClaw runner, propagate `OPENCLAW_BASE_URL` to **client and audit API process** guidance.  
3. If unavailable → **fail closed** with actionable error (how to start gateway or how to opt into fixture-only smoke). Do **not** silently fall back to fixtures.

**FR-2.3** Fixture path remains available only via explicit flags, e.g.:

- `--allow-fixture-delegation`  
- or `FACTORY_PROOF_PROFILE=fixture`  

and must print a clear warning: evidence is **not** valid for factory green / operator-trusted claims.

**FR-2.4** Keep a convenience alias if useful (e.g. `milestone-c:verify:fixture`) but **primary** `milestone-*:verify` scripts must implement FR-2.2 (live preferred / fail closed), not fixture-default.

**FR-2.5** `--live-openclaw` remains supported as force-live; it must not be required for the primary path when the gateway is already available.

### FR-3 — Fail closed under production-like flags

**FR-3.1** When production-like proof is active, any of the following is a **hard failure** (exit non-zero, no `summary.passed: true`):

| Condition | Error code (suggested) |
| --- | --- |
| Fixture runner resolved | `FACTORY_PROOF_FIXTURE_FORBIDDEN` |
| Delegation result lacks real `sessionId` for required agent phases | `FACTORY_PROOF_MISSING_SESSION` |
| Fixture-only attribution presented as live | `FACTORY_PROOF_FIXTURE_ATTRIBUTION` |
| Gateway required but probe failed | `FACTORY_PROOF_GATEWAY_UNAVAILABLE` |
| Audit API missing live delegation config for server-side refinement/delegation | `FACTORY_PROOF_SERVER_DELEGATION_MISCONFIGURED` |

**FR-3.2** Extend / unify existing guard `assertNonFixtureDelegationRunner` in `lib/task-platform/factory-orchestration.js` so production-like profile always includes fixture ban—not only when `requireRealEvidence` / `collectRealEvidence` is set.

**FR-3.3** Verify scripts must not set `FACTORY_USE_FIXTURE_DELEGATION=true` as the default for claim paths (today: `verify-milestone-b/c/d-*.js` force fixture unless `--live-openclaw`). Invert that default per FR-2.

**FR-3.4** Completion writers for `observability/milestone-*-complete.json` must refuse to write `summary.passed: true` if agent evidence is fixture-attributed when profile is live/production-like.

### FR-4 — Live session evidence requirements

**FR-4.1** For live primary path, factory evidence must include real session ownership for agent-driven phases that claim agent work:

| Phase / GP | Minimum live evidence |
| --- | --- |
| GP-013 / specialist delegation | `sessionId`, delegated attribution |
| GP-003 / PM refinement (when agent-driven phase 1) | runtime session + non-fixture runner |
| GP-014 implementer | `implementerAgent.sessionId` (or equivalent) from live path |
| GP-019 QA agent | QA agent session metadata |
| GP-017 fix loop | engineer resubmission after QA fail with live or consistent session chain |
| GP-026 SRE agent (when agent-driven phases on) | SRE agent session when phase enabled |

**FR-4.2** Acceptable session evidence fields (any stable existing schema is fine if documented):

- `sessionId` / `session_id`  
- `delegation.sessionId`  
- factory evidence `implementerAgent.sessionId`, `qaAgent.sessionId`, etc.  

**FR-4.3** Fixture runner synthetic IDs must be **detectable** and rejected under live profile (document the detection rule: runner path, attribution flag, or known fixture marker).

**FR-4.4** `agent_session_evidence` check for milestone C (and equivalents for B/D) must require **live** sessions under primary profile—not “fixture or live”.

### FR-5 — Process / env propagation (server + client)

**FR-5.1** Document and enforce that live proof requires:

- Verify client: `OPENCLAW_BASE_URL`, `FF_REAL_SPECIALIST_DELEGATION=true`, non-fixture `SPECIALIST_DELEGATION_RUNNER`  
- Audit API process (for `/refinement/start` and server-side delegation): same flags  

**FR-5.2** When using `dev:golden-path:up`, provide a documented way to point the **API process** at live OpenClaw (env file, stack flag, or restart instruction). Client-only env is insufficient (current milestone-c runbook already warns this).

**FR-5.3** If stack mock OpenClaw on `:14001` is up but live gateway on `:18789` is required, live profile must use the live URL and must not silently accept mock/fixture success as live proof.

### FR-6 — Milestone and golden-path command surface

**FR-6.1** Update package scripts so primary verify commands implement live-default/fail-closed behavior:

- `milestone-b:verify`  
- `milestone-c:verify` (today’s fixture default must change)  
- `milestone-d:verify`  
- Related orchestrator / golden-path verify entrypoints used for A–E completion  

**FR-6.2** Keep or add explicit fixture smoke scripts, e.g. `milestone-c:verify:fixture`, clearly named.

**FR-6.3** Keep/adjust `milestone-c:verify:live` as force-live alias (may become redundant with FR-2.2 but must not regress).

**FR-6.4** Golden-path replay / factory orchestrator agent phases used for milestone complete must honor the same profile rules.

### FR-7 — Re-run A–E with live evidence (operator procedure + automation hooks)

**FR-7.1** Provide a runbook section (or update existing milestone runbooks) for live primary path:

```text
1. npm run dev:golden-path:up
2. Ensure live OpenClaw gateway is reachable (document URL)
3. Configure API + workers for FF_REAL_SPECIALIST_DELEGATION + SPECIALIST_DELEGATION_RUNNER + OPENCLAW_BASE_URL
4. npm run milestone-a:verify … (through E, or documented subset)
5. Confirm completion JSON shows live sessionIds and profile=live (or equivalent)
```

**FR-7.2** Minimum acceptance re-run for this story:

| Milestone | Required? | Notes |
| --- | --- | --- |
| A | Recommended | Stack reliability; may have less agent session surface |
| B | Recommended | Agent-driven phase 1 must be live under primary path |
| **C** | **Required** | Implementer / QA / fix loop session evidence |
| **D** | **Required** | Closeout + agent evidence chain preserved |
| E | Recommended | Hosted/deploy closeout; non-fixture already partial |

**FR-7.3** Refresh artifacts after live run:

- `observability/milestone-c-complete.json`  
- `observability/milestone-d-complete.json`  
- related staging verify JSON under `observability/milestone-*-staging/`  
- optionally A/B/E complete JSON  

**FR-7.4** Each completion artifact must record:

- `profile: "live"` (or `proofProfile`)  
- `openclawBaseUrl` (non-secret URL)  
- summary flags for live session checks  
- `generatedAt`  

**FR-7.5** Do not overwrite live completion artifacts with fixture runs.

### FR-8 — Observability and operator messaging

**FR-8.1** On fixture opt-in, stderr/stdout must include a single clear warning line, e.g.  
`FACTORY_PROOF_PROFILE=fixture: results are not valid for operator-trusted factory claims.`

**FR-8.2** On fail-closed, print remediation:

- start OpenClaw gateway  
- set `--openclaw-url` / `OPENCLAW_BASE_URL`  
- configure API process  
- or explicitly `--allow-fixture-delegation` for non-claim smoke  

**FR-8.3** Verify JSON reports must include `proofProfile`, `fixtureDelegation: boolean`, and per-agent session evidence summary.

---

## 7. Acceptance criteria (must-have)

### AC-1 — Primary path prefers live gateway

**Given** the coordinated stack is up and OpenClaw gateway responds at the configured URL  
**When** the operator runs `npm run milestone-c:verify` (primary script, no fixture flags)  
**Then** the run uses the live OpenClaw runner (not `tests/fixtures/specialist-runtime-runner.js`)  
**And** evidence includes at least one real implementer or QA `sessionId`  
**And** `summary.passed` is true only if live session checks pass.

### AC-2 — Fail closed when gateway missing (no silent fixture)

**Given** production-like / primary verify path and no reachable OpenClaw gateway  
**When** the operator runs `npm run milestone-c:verify` without fixture opt-in  
**Then** the process exits non-zero  
**And** does not set fixture delegation as a silent fallback  
**And** error identifies gateway unavailability and remediation.

### AC-3 — Fail closed if fixture used under production-like flags

**Given** `FACTORY_PROOF_PROFILE=live` or equivalent production-like flags  
**When** configuration resolves to the fixture runner or fixture attribution appears in agent evidence  
**Then** the run fails with a stable error code (`FACTORY_PROOF_FIXTURE_FORBIDDEN` or `FACTORY_PROOF_FIXTURE_ATTRIBUTION`)  
**And** milestone complete JSON is not written as passed.

### AC-4 — Explicit fixture smoke still works

**Given** the operator passes `--allow-fixture-delegation` (or `milestone-*:verify:fixture`)  
**When** verify runs  
**Then** fixture path may pass for local smoke  
**And** output warns that results are not valid factory claims  
**And** completion artifacts for live claims are not updated as live-passed.

### AC-5 — Milestone C + D live re-run

**Given** live gateway + correctly configured stack  
**When** operator completes milestone C and D verify on primary path  
**Then** `observability/milestone-c-complete.json` and `milestone-d-complete.json` (or successor paths) record live proof profile and real session evidence  
**And** GP-014 / GP-019 (and D closeout agent fields as applicable) are satisfied without fixture attribution.

### AC-6 — Server-side delegation config

**Given** live profile  
**When** agent-driven refinement or server-mediated delegation runs  
**Then** documentation and preflight check confirm audit API has live runner config  
**And** misconfiguration fails closed before claiming phase success.

### AC-7 — Unit / contract coverage

**Given** the implementation  
**When** unit tests run  
**Then** coverage exists for:

- gateway probe available / unavailable  
- default profile selects live when probe ok  
- default profile fails closed when probe fails  
- fixture forbidden under production-like flags  
- fixture allowed only with explicit opt-in  
- session evidence validator accepts live and rejects fixture markers  

---

## 8. Technical design constraints (implementation guidance)

### 8.1 Likely touch points

| Area | Paths |
| --- | --- |
| Runner resolution | `lib/task-platform/factory-orchestration.js` (`resolveAgentDelegationRunner`, `assertNonFixtureDelegationRunner`) |
| Agent phases | `lib/task-platform/factory-agent-phases.js` |
| Phase options | `lib/task-platform/factory-phase-runner-options.js`, `factory-delivery-shared.js` |
| Milestone CLIs | `scripts/verify-milestone-b-orchestration.js`, `verify-milestone-c-agent.js`, `verify-milestone-d-closeout.js`, `verify-milestone-a-staging.js`, `verify-milestone-hosted-phase6.js` |
| OpenClaw bridge | `scripts/openclaw-specialist-runner.js` |
| Fixture runner | `tests/fixtures/specialist-runtime-runner.js` (detect only; keep for opt-in smoke) |
| Package scripts | `package.json` `milestone-*:verify*` |
| Runbooks | `docs/runbooks/milestone-b-orchestration.md`, `milestone-c-agent-autonomy.md`, `milestone-d-closeout-automation.md`, `milestone-a-hosted-factory.md`, `specialist-delegation.md`, `golden-path-autonomous-delivery.md` |

### 8.2 Suggested new small module

Prefer a dedicated helper (example name):

`lib/task-platform/factory-proof-profile.js`

Responsibilities:

- resolve profile from argv/env/probe  
- set env for child processes  
- validate evidence post-run  
- stable error codes  

Avoid scattering inverted `FACTORY_USE_FIXTURE_DELEGATION` defaults across five scripts without a shared helper.

### 8.3 Backward compatibility

| Caller | Expected after change |
| --- | --- |
| CI/unit tests using fixture runner explicitly | Still pass if they set fixture opt-in or never enable production-like proof |
| Operators using old `--live-openclaw` | Continues to force live |
| Operators using bare `milestone-c:verify` | **Behavior change:** live or fail closed (document in CHANGELOG / runbooks) |

### 8.4 Security / privacy

- Do not log OpenClaw auth tokens or raw specialist prompts in verify JSON.  
- Session IDs may be recorded; treat as operational identifiers, not secrets.  
- Probe must be read-only / health-level, not a full agent invocation.

---

## 9. Test plan

| Layer | Cases |
| --- | --- |
| Unit | Profile resolution matrix; fixture detection; fail-closed codes; env builder |
| Unit | `resolveAgentDelegationRunner` under new defaults |
| Integration / script | Mock gateway available → live runner selected (if cheap) |
| Manual / stack | Full C + D with real gateway; capture completion JSON |
| Regression | Explicit fixture smoke still green; unit suite green |

---

## 10. Evidence required for done

1. Code + unit tests for profile + fail-closed (AC-7).  
2. Runbook updates stating **live is primary**; fixture is opt-in smoke only.  
3. Live run artifacts for **milestone C and D** with real `sessionId`s and `proofProfile=live`.  
4. Package script behavior matches AC-1–AC-4.  
5. Short note in `docs/reports/` or milestone complete `notes[]` that prior fixture-era complete JSON is superseded for claim purposes.

---

## 11. Rollout plan

1. Land helper + fail-closed guards + unit tests.  
2. Flip primary milestone verify scripts; add `:fixture` aliases.  
3. Update runbooks / package docs.  
4. Operator re-runs C + D (then A/B/E as capacity allows) with live gateway.  
5. Commit refreshed live completion evidence (redacted as needed).

**Rollback:** restore fixture default only behind explicit env `FACTORY_PROOF_PROFILE=fixture` emergency override; do not re-advertise fixture as primary claim path.

---

## 12. Open implementation choices (non-blocking)

Resolved defaults unless implementer finds a blocker:

| Choice | Decision |
| --- | --- |
| Default when gateway **down** | Fail closed (not fixture) |
| Default when gateway **up** | Live |
| Fixture for unit tests | Allowed; not production-like |
| Mock OpenClaw on `:14001` | Not sufficient for live claim profile |
| Minimum milestones for story exit | **C + D required**; A/B/E recommended |

---

## 13. Exit criteria (story complete)

- [ ] Primary GP/milestone verify path uses live OpenClaw when gateway available  
- [ ] Production-like proof **never** silently uses fixtures  
- [ ] Gateway unavailable → fail closed with remediation  
- [ ] Explicit fixture smoke remains for local speed  
- [ ] Milestone **C** and **D** re-run with real sessionIds; completion artifacts updated  
- [ ] Unit tests cover profile + fail-closed matrix  
- [ ] Runbooks match behavior  

**Exit statement:**  
There is one primary path through golden-path / milestone verify that produces **real sessionIds** and rejects fixture attribution under claim profiles.

## Local coordinated-stack note (2026-07-10)

Local live milestone C/D may set `STAGING_SKIP_FORGE_SEED/PHASES=true` and does not imply hosted real-evidence collection unless explicit `FF_GOLDEN_PATH_*` flags are set.
