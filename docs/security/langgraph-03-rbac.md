# LangGraph 03 RBAC Matrix

| Operation | Allowed roles | Server-enforced condition |
| --- | --- | --- |
| Read sanitized run status | reader, engineer, PM, Architect, SRE, admin | Authenticated tenant and actor; thread belongs to tenant |
| Execution Contract decision | PM, admin | Pending exact interrupt/checkpoint/version |
| Architect handoff decision | Architect, admin | Pending exact interrupt/checkpoint/version |
| Implementation review decision | Architect, PM, admin | Pending exact interrupt/checkpoint/version |
| Merge readiness decision | SRE, admin | Pending exact interrupt/checkpoint/version |
| Closeout decision | PM, admin | Pending exact interrupt/checkpoint/version |
| Retry failed node | SRE, admin | Exact current node, recoverable status, retry budget remains |
| Cancel run | SRE, admin | Run is nonterminal and no concurrent lease owner wins |

Every mutation also requires CSRF protection where session auth is used, `Idempotency-Key`, and the global controls flag. The server derives tenant, actor, and roles; the browser never authorizes itself.
