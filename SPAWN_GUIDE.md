# SPAWN_GUIDE.md — Subagent Spawning Reference

> Based on Pete Steinberger's parallel-agent philosophy: spawn agents for specific, atomic tasks rather than complex hierarchies. Keep depth ≤ 2. Prioritize visibility.

---

## Quick Reference

| Agent | Spawn Command | Best For |
|-------|---------------|----------|
| 🚀 PM | `/subagents spawn product-manager` | Requirements, roadmap, prioritization |
| 🎨 Design | `/subagents spawn ux-designer` | User flows, interaction design, accessibility |
| 🏛️ Arch | `/subagents spawn architect` | System design, ADRs, technical direction |
| ⚡ Prime | `/subagents spawn principal` | Hard problems, critical subsystems |
| 👨‍💻 Senior | `/subagents spawn sr-engineer` | Feature implementation, code review |
| 🌱 Junior | `/subagents spawn jr-engineer` | Focused tasks, tests, refactoring |
| 🧪 QA | `/subagents spawn qa-engineer` | Test strategy, quality assurance |
| 🧱 Infra | `/subagents spawn infrastructure-engineer` | Cloud infrastructure, CI/CD, deployment systems |
| 🔧 SRE | `/subagents spawn sre` | Reliability, observability, SLOs, incidents |

---

## Spawn Patterns

### Single Agent Spawn

```python
sessions_spawn(
  task="Your specific task description here",
  agentId="sr-engineer",
  label="feature-auth"
)
```

### Parallel Spawn (Recommended)

Spawn multiple agents simultaneously for independent work:

```python
# In your main agent session, call sessions_spawn twice:
sessions_spawn(task="Implement user auth module", agentId="sr-engineer", label="impl-auth")
sessions_spawn(task="Write tests for auth module", agentId="qa-engineer", label="test-auth")
```

### Thread-Bound Spawn (Persistent)

For tasks requiring follow-up:

```python
sessions_spawn(
  task="Implement and iterate on the checkout flow based on feedback",
  agentId="sr-engineer",
  thread=True,
  mode="session"
)
```

---

## When to Spawn What

### Feature Request Flow

```
User Request
    ↓
[PM] writes requirements
    ↓
[UX] shapes flow/interaction when needed
    ↓
[Arch] designs system (skip for small tasks)
    ↓
[Sr + Jr] implement in parallel
    ↓
[QA + Infra + SRE] test, platform, and reliability in parallel
    ↓
Main agent synthesizes → delivers
```

### Detailed Spawn Table

| Phase | Spawn | Task Example |
|-------|-------|--------------|
| **Discovery** | `product-manager` | "Write requirements for user auth feature" |
| **UX** | `ux-designer` | "Design the onboarding flow and error states" |
| **Design** | `architect` | "Design the auth service architecture" |
| **Build** | `sr-engineer` | "Implement JWT token generation" |
| **Build** | `jr-engineer` | "Add unit tests for token service" |
| **Test** | `qa-engineer` | "Review test coverage, identify gaps" |
| **Platform** | `infrastructure-engineer` | "Set up CI/CD and deployment path for auth service" |
| **Reliability** | `sre` | "Define SLOs, alerts, and runbooks for auth service" |
| **Hard Problem** | `principal` | "Debug race condition in session handler" |

---

## Subagent Configuration

```json
{
  "maxSpawnDepth": 2,          // main → orchestrator → worker
  "maxChildrenPerAgent": 5,     // max 5 direct children per agent
  "maxConcurrent": 8,          // global cap
  "runTimeoutSeconds": 900,    // 15 min default timeout
  "archiveAfterMinutes": 60    // auto-archive after 1 hour
}
```

---

## Tool Access by Depth

| Depth | Session Tools | Notes |
|-------|--------------|-------|
| **0** (Main) | All tools | Orchestrator |
| **1** (Subagent) | `sessions_spawn`, `subagents`, `sessions_list`, `sessions_history` | Orchestrator (depth 2 only) |
| **1** (Leaf) | No session tools | Default when depth=1 |
| **2** (Worker) | None | Cannot spawn further |

---

## Announce Flow

Subagents announce results back to the main session when complete:

- Status: `completed successfully` / `failed` / `timed out`
- Includes: result text, runtime duration, token usage, session key
- Main agent rewrites in normal assistant voice before displaying

---

## Slash Commands

```
/subagents list                          # Show active subagents
/subagents info <id|#>                   # Show run metadata
/subagents log <id|#> [limit] [tools]   # Show output logs
/subagents kill <id|#|all>              # Stop subagent(s)
/subagents send <id|#> <message>        # Send message to subagent
/subagents steer <id|#> <message>       # Steer subagent direction
/subagents spawn <agentId> <task>       # Spawn new subagent
```

---

## Thread Controls

```
/focus <target>      # Bind current thread to a subagent
/unfocus            # Detach thread binding
/agents             # List active runs and binding state
/session idle <dur> # Set inactivity auto-unfocus
/session max-age <dur> # Hard cap for thread binding
```

---

## Best Practices (Pete Steinberger Style)

1. **Small, atomic tasks** — "Write auth middleware" not "Build the whole app"
2. **Parallel over sequential** — Spawn Sr + Jr + QA simultaneously
3. **Visibility over cleverness** — Prefer separate terminal windows for research
4. **Trust the announce** — Let subagents report back, don't micromanage
5. **Think in blast radius** — Small bombs are easier to track than big ones
6. **Max depth 2** — Sub-sub-agents add opacity without benefit

---

## Anti-Patterns to Avoid

- ❌ Spawning depth 3+ ("I'll have my subagent manage the workers")
- ❌ Complex role definitions with buzzwords ("You are an elite AI engineer...")
- ❌ One subagent doing everything ("Build the entire feature")
- ❌ Ignoring announce results and doing the work manually anyway
- ❌ Using subagents when a simple file write would suffice

---

_Last updated: 2026-03-31_
