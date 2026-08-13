# Architecture Decision Record: Team Engineering Setup

**Date:** 2026-03-30  
**Status:** Accepted  
**Deciders:** Human (wiinc1), Architect (Bran)

## Context

We need a structured engineering team that can work together on TypeScript + React web application development using git-based workflows with proper code review and decision documentation.

## Decision

Establish a 4-tier engineering team:
- **Architect** — system design, ADRs, technical direction
- **Principal Engineer** — hard problems, critical subsystems
- **Sr. Software Engineer** — feature implementation, code reviews
- **Jr. Software Engineer** — focused tasks, tests, refactoring

All work happens on branches, PRs require review from:
1. The agent that provided requirements (for their area)
2. One agent senior to the implementer
3. Human approval for significant changes

All significant decisions are documented in Architecture Decision Records (ADRs).

## Rationale

- Clear hierarchy ensures appropriate review depth
- Two-reviewer rule (requirer + senior) catches issues and spreads knowledge
- ADRs create institutional memory and reduce repeated debates
- Git-based workflow provides audit trail and rollback capability

## Consequences

### Positive
- Decisions are documented and searchable
- Code review ensures quality and knowledge sharing
- Clear ownership reduces confusion
- Hierarchy enables appropriate delegation

### Negative
- More process overhead for small changes
- Requires discipline to maintain documentation
- Can create bottlenecks if reviewers are unavailable

## Alternatives Considered

### Alternative 1: Flat team, all PRs reviewed by all
**Decision:** Rejected  
**Trade-offs:** Too chaotic, no clear ownership, decision fatigue

### Alternative 2: Only human review required
**Decision:** Rejected  
**Trade-offs:** Bottlenecks on human time, agents can't self-govern

## Related Decisions

- [None yet — this is the foundational decision]
