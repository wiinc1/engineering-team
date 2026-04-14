# Agent Profiles

> Each agent has a profile defining its role, capabilities, and responsibility in the software factory.

---

## 🛠️ dev — Developer Agent

**Role:** Implementation, coding, feature development
**Trigger:** `IN_PROGRESS` task with `dev` agent type
**Responsibilities:**
- Write code per task spec
- Self-verify against deliverables before marking complete
- Produce artifacts: code files, configs, scripts, tests
- Leave a clear completion note in the task file

**Verification input:** What was built, how to test it

---

## 🖥️ sre — Site Reliability Engineer

**Role:** Observability gate — logs, telemetry, metrics, smoke tests
**Trigger:** `VERIFY` state on any task
**Responsibilities:**
- Inspect logs for errors/warnings/exceptions
- Compare telemetry against baseline (latency, error rate, traffic)
- Run or review smoke tests
- Approve → move to `DONE` or `REOPEN` with findings
- **Owns the VERIFY gate for ALL task types**

**Verification input:** Build artifacts, test output, run commands, log endpoints

---

## ✅ qa — Quality Assurance Agent

**Role:** Functional verification, edge cases, acceptance criteria
**Trigger:** `IN_PROGRESS` → `VERIFY` pipeline (runs alongside SRE)
**Responsibilities:**
- Validate functional correctness against task spec
- Check edge cases and error handling
- Verify acceptance criteria are met
- Report findings to task file

---

## 🔬 research — Research Agent

**Role:** Investigation, spike, evaluation
**Trigger:** `IN_PROGRESS` task with `research` agent type
**Responsibilities:**
- Investigate technical questions or unknown variables
- Produce findings doc linked from task
- May produce sub-tasks for implementation
- Does NOT write production code

---

## 🎨 design — Design Agent

**Role:** Architecture, UX, system design
**Trigger:** `IN_PROGRESS` task with `design` agent type
**Responsibilities:**
- Produce architecture diagrams, ADRs, wireframes
- Evaluate tradeoffs and document decisions
- Output linked from task file

---

## 🔧 Available Agents

| Agent | Role | Gate? |
|-------|------|-------|
| `dev` | Developer | No |
| `sre` | Site Reliability Engineer | **YES** (VERIFY gate) |
| `qa` | Quality Assurance | No |
| `research` | Research / Spike | No |
| `design` | Design / Architecture | No |

## Standards Enforcement

- All agents must use `docs/standards/software-development-standards.md` as the canonical standards baseline.
- Every task file must include `## Standards Alignment` and `## Required Evidence`.
- Gap statements must use: `Gap observed: X. Documented rationale: Y (source Z).`
- PRs and implementation notes should point back to `docs/templates/STANDARDS_COMPLIANCE_CHECKLIST.md`.
