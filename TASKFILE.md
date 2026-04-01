# Task File Template

> Every task is a file at `tasks/TSK-XXX-short-name.md`
> Edit this file to update task status; changes sync to BOARD.md

---

```markdown
# TSK-XXX — Task Title

**Created:** YYYY-MM-DD HH:mm CDT
**Updated:** YYYY-MM-DD HH:mm CDT
**ID:** TSK-XXX
**Status:** BACKLOG

## 📌 Summary

Brief description of what needs to be done.

## 🎯 Deliverables

- [ ] Deliverable 1
- [ ] Deliverable 2

## 🧑‍💻 Agent

**Type:** `dev | sre | qa | research | design`
**Notes:** Any specific instructions for the agent

## 📋 SRE Verification Checklist

- [ ] Logs reviewed (no ERROR-level entries)
- [ ] Telemetry/metrics within baseline
- [ ] Exit codes clean
- [ ] Smoke/synthetic checks passed
- [ ] No regressions in downstream services

## 🔄 Status History

| Date | From | To | Actor | Note |
|------|------|----|----|------|
| YYYY-MM-DD | — | BACKLOG | creator | Created |

## 📎 Findings (if reopened)

<!-- SRE fills this if issues are found during VERIFY -->
- 

## 💬 Notes

<!-- Comments, context, decisions -->

```

---

## 📁 Task Registry

| ID | Title | Status | Created |
|----|-------|--------|---------|
| — | — | — | — |
