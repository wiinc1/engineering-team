---
title: Software Development Standards - First-Principles Framework
version: 1.0
date: 2026-04-14
purpose: Reference document for AI agents and engineering teams to evaluate and improve codebases for reliability, scalability, sustainability, stability, and efficiency.
audience: AI agents, engineering leads, architects
license: CC-BY-SA (attribution required when reusing)
---

# Software Development Standards

## Agent Usage Instructions
This document is to be used as a factual reference only.

- Base recommendations or evaluations on the principles and evidence stated here.
- Avoid unsupported subjective qualifiers.
- When citing a practice, reference the exact company and linked source.
- If a codebase does not meet a listed practice, state the observable gap and the documented rationale from this file.
- Update this document only with new public evidence from the referenced organizations or equivalent peer-reviewed sources.

## Repo Enforcement Policy
This repo treats this file as the canonical standards baseline.

- Every task file under `tasks/` must include `## Standards Alignment` and `## Required Evidence`.
- Every ADR under `docs/adr/` must include `## Standards Alignment` and `## Required Evidence`.
- Every report under `docs/reports/` must include `## Standards Alignment` and `## Required Evidence`.
- Every change proposal should map relevant work to this document using `docs/templates/STANDARDS_COMPLIANCE_CHECKLIST.md`.
- Every pull request must complete `.github/PULL_REQUEST_TEMPLATE.md`, including the standards evidence fields.
- CI enforces the presence of the required templates and task sections through `npm run standards:check`.
- Diff-based adjacency rules are maintained in `config/change-ownership-map.json`; maintainer guidance lives in `docs/standards/change-governance-maintenance.md`.
- Ownership-map quality is enforced through `npm run ownership:lint`.
- Scheduled governance drift reporting is available through `npm run governance:drift`.
- Branch-protection and required-status guidance lives in `.github/BRANCH_PROTECTION.md`.

## 1. First Principles
Software exists to deliver correct, measurable value to users under real-world conditions, including failure.

From fundamental computer-science truths:

- All hardware, networks, and humans are fallible, so systems must assume failure.
- Change is constant, so every modification must be verifiable, reversible, and low-risk.
- Humans must read, reason about, and modify the code years later, so readability and modularity are non-negotiable.
- Resources such as compute, developer time, and energy are finite, so efficiency must be engineered, not incidental.

All standards below derive directly from these axioms and have been observed at scale in production systems operated by Google, Amazon, Netflix, Microsoft, and others.

## 2. Architecture and Design Standards
- Modular, loosely-coupled services with explicit contracts such as APIs or events.  
  Rationale: Separation of concerns minimizes blast radius and enables independent evolution.  
  Evidence: Amazon microservices architecture and two-pizza teams.  
  Source: https://aws.amazon.com/executive-insights/content/amazon-two-pizza-team/

- Design for horizontal scaling and failure from day one, including stateless services where possible, immutable infrastructure, and sharding.  
  Rationale: Failures are inevitable and capacity planning follows queuing constraints.  
  Evidence: Google SRE practices.  
  Source: https://sre.google/books/

- API-first or contract-first design.  
  Rationale: Contracts force clarity before implementation and reduce tight coupling.  
  Evidence: Amazon working-backwards discipline.  
  Source: https://aws.amazon.com/executive-insights/content/amazon-two-pizza-team/

## 3. Coding and Code-Quality Standards
- Strict, automated coding standards covering style, naming, linting, and formatting.  
  Rationale: Uniformity reduces cognitive load and defect classes.  
  Evidence: Industry-wide adoption at scale across Amazon, Google, and Microsoft.

- Maintainability line-count thresholds are mandatory for authored code. Authored source files warn at `300` lines and hard fail at `400` lines; test files warn at `400` lines and hard fail at `500` lines; functions or methods warn at `40` lines and hard fail at `50` lines.  
  Rationale: Smaller files and functions reduce review risk, change blast radius, and maintenance cost.  
  Evidence: Repo-template standards control plane, version `0.1.0`.

- Legacy maintainability violations must be tracked in `config/maintainability-baseline.json`; the maintainability gate fails when new violations appear or existing baseline entries regress.  
  Rationale: A ratchet lets the repo adopt objective thresholds without forcing a high-risk big-bang rewrite of existing runtime and test surfaces.  
  Evidence: Repo-template maintainability ratchet policy, version `0.1.0`.

- Mandatory code reviews and static analysis on every change.  
  Rationale: Human and machine verification together catch issues before production.  
  Evidence: Google, Meta, and Microsoft public engineering practices.

- Dedicated capacity for refactoring and technical-debt reduction, measured as a percentage of engineering effort.  
  Rationale: Technical debt compounds and continuous maintenance prevents slowdown.  
  Evidence: Meta engineering technical-debt and infrastructure investment work.  
  Source: https://engineering.fb.com/2026/03/02/data-infrastructure/investing-in-infrastructure-metas-renewed-commitment-to-jemalloc/

## 4. Testing and Quality-Assurance Standards
- Testing pyramid with fast unit tests, then integration tests, then end-to-end tests, combined with explicit failure testing.  
  Rationale: Defects are cheapest to catch early and resilience must be demonstrated under failure.  
  Evidence: Netflix Chaos Engineering.  
  Sources: https://netflixtechblog.com/tagged/chaos-engineering and http://www.principlesofchaos.org/

- Threat modeling and security-by-design reviews in every phase.  
  Rationale: Security must be designed in rather than appended later.  
  Evidence: Microsoft Security Development Lifecycle.  
  Source: https://www.microsoft.com/en-us/securityengineering/sdl

## 5. Deployment and Release Standards
- Continuous Integration and Continuous Deployment with progressive rollouts such as canaries and feature flags.  
  Rationale: Small, frequent, reversible changes reduce risk.  
  Evidence: Google SRE and Amazon release engineering.  
  Source: https://sre.google/books/

- Trunk-based development with short-lived branches and frequent integration.  
  Rationale: Long-lived branches delay verification and increase integration risk.

- Immutable infrastructure and reproducible builds.  
  Rationale: Reproducibility removes environment-specific failures.

## 6. Observability and Monitoring Standards
- Service Level Objectives, error budgets, and Service Level Indicators.  
  Rationale: Measure user experience directly and balance stability against delivery speed.  
  Evidence: Google SRE.  
  Source: https://sre.google/books/

- Full observability stack with metrics, logs, and distributed traces, plus actionable alerting only.  
  Rationale: Improvement requires measurement and alerts must map to user pain.

- Blame-free postmortems with tracked action items.  
  Rationale: Incident response should produce systemic learning and follow-through.

## 7. Team and Process Standards
- Small, autonomous, cross-functional teams that own a service end to end.  
  Evidence: Amazon two-pizza teams.  
  Source: https://aws.amazon.com/executive-insights/content/amazon-two-pizza-team/

- Documentation as code, including ADRs, runbooks, and API specs.  
  Rationale: Documentation must be versioned and reviewed with the code it describes.

- Measure developer productivity and toil with DORA metrics: deployment frequency, lead time for changes, change failure rate, and time to restore service.  
  Evidence: DORA program.  
  Source: https://dora.dev/

## Mapping Standards to Outcomes

| Outcome | Primary Standards | Key Evidence Source |
| --- | --- | --- |
| Reliability | SLOs, error budgets, chaos engineering, comprehensive testing | Google SRE, Netflix |
| Scalability | Modular services, horizontal design, observability | Amazon, Google |
| Sustainability | Coding standards, refactoring allocation, modularity | Meta, Amazon |
| Stability | Progressive rollouts, CI/CD, immutable infrastructure | Google SRE, Amazon |
| Efficiency | Automation, static analysis, DORA metrics | All cited organizations |

## References
- Google Site Reliability Engineering book: https://sre.google/books/
- Netflix Chaos Engineering: https://netflixtechblog.com/tagged/chaos-engineering
- Principles of Chaos: http://www.principlesofchaos.org/
- Amazon two-pizza teams: https://aws.amazon.com/executive-insights/content/amazon-two-pizza-team/
- DORA metrics: https://dora.dev/
- Microsoft Security Development Lifecycle: https://www.microsoft.com/en-us/securityengineering/sdl
- Meta engineering technical-debt initiatives: https://engineering.fb.com/2026/03/02/data-infrastructure/investing-in-infrastructure-metas-renewed-commitment-to-jemalloc/

## Required Gap Statement Format
When a reviewer or agent finds a gap, use this format:

`Gap observed: X. Documented rationale: Y (source Z).`
