# Issue #280 dependency review

## Decision and inventory

| Direct package | Exact pin | License | Purpose | Update policy |
| --- | --- | --- | --- | --- |
| `@langchain/langgraph` | `1.4.8` | MIT | Deterministic state graph compilation/execution | Renovate/operator review; never float production range; compatibility fixtures and full LANGGRAPH-01 gates required. |
| `@langchain/langgraph-checkpoint-postgres` | `1.0.4` | MIT | Official Postgres `BaseCheckpointSaver` implementation | Upgrade with saver migration diff, apply/rollback evidence, retained-thread read test, production audit, and crash/resume/load gates. |

The lockfile records transitive packages. Runtime code imports the graph package and Postgres saver only inside `lib/software-factory/langgraph/`. The saver accepts an existing `pg.Pool`, so no duplicate database driver or TLS configuration is introduced. The Postgres saver depends on `pg ^8.12.0`, satisfied by the repository's `pg` production dependency.

## Security and maintenance review

`npm audit --omit=dev` reports zero production vulnerabilities at implementation time. The complete development tree currently reports advisory results separately and is not used to waive the production gate. Both direct packages are MIT. Upstream APIs are public (`StateGraph`, `Annotation`, `PostgresSaver`); package-owned SQL tables are treated as opaque. Application code owns tenant binding, state validation, size/secret rejection, versions, leases, retention, stable errors, and sanitization.

Package churn and on-disk compatibility are the principal risks. Exact pins, a dedicated schema, fixture-based version policy, migration verification, package import isolation, and a dormant rollout contain them. Any vulnerability with a reachable production path blocks promotion; non-reachable transitive findings still require documented triage, not an audit bypass. References: <https://github.com/langchain-ai/langgraphjs> and <https://docs.langchain.com/oss/javascript/langgraph/persistence>.

## Standards Alignment

- Applicable standards areas: architecture and design; coding and code quality; testing and quality assurance; deployment and release; observability and monitoring; team and process.
- Evidence expected for this change: exact versions and lock integrity, licenses, production vulnerability audit, public API boundary, existing-pool composition, saver migration compatibility, crash/resume, coverage/mutation/security/load, and full clean-install CI.
- Gap observed: Hosted dependency upgrade and rollback rehearsal remains a deployment-environment activity. Documented rationale: local evidence validates the pinned implementation while deployed recovery evidence requires the post-merge environment gate (source http://192.168.1.116/wiinc1/engineering-team/-/work_items/280).

This review satisfies the dependency-management, security, licensing, reproducible-build, architecture-boundary, and operational-readiness requirements in `docs/standards/software-development-standards.md`. Exact pins and lock integrity are contract-tested; production audit, compatibility fixtures, migration/crash/load evidence, and the issue traceability checklist are promotion gates.

## Required Evidence

- Commands run: `npm ci`, production audit, focused contract/coverage/mutation/security/chaos/load, live PostgreSQL integration, full repository/browser/coverage/standards/build, and `make verify`.
- Tests added or updated: exact pin/license contract, adapter inheritance, migration contract/live round-trip, version fixture, independent-runtime resume/history, tenant rejection, state validation, and exclusive load cleanup.
- Rollout or rollback notes: update only by exact reviewed pin; apply compatible saver migrations before writers; keep the dormant schema on ordinary rollback; refuse physical removal while any retained row exists.
- Docs updated: dependency inventory and update policy, ADR-004, runtime architecture/version policy, runbook, and issue traceability checklist.

- Exact direct versions and lockfile integrity, with MIT license assertions.
- `npm audit --omit=dev` with no reachable production vulnerability.
- Existing-pool adapter contract and public-API import boundary.
- Saver migration round-trip, retained checkpoint read/resume compatibility, and canonical-data preservation.
- Focused coverage/mutation/security/chaos and exclusive 2× load results.
- Full clean-install repository, browser, standards, build, and exact-head pipeline results.
