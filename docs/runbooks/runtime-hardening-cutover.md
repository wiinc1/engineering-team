# Runtime hardening, DR, and cutover runbook

## Evidence collection

### Exact-revision isolated staging

The default factory stack and staging are separate launchd profiles. Staging uses independent labels,
ports, logs, state, and root binding, so an approved release cannot rebind or interrupt the host's
factory of record. Configure protected CI variables `STAGING_BASE_URL`, `STAGING_DATABASE_URL`, and
`STAGING_RELEASE_ROOT`; the base URL must be non-local HTTPS and the release root must be an absolute,
persistent path outside temporary and `_checkouts` directories.

On protected `main`, `deploy-runtime-staging` clones the exact `CI_COMMIT_SHA` into
`$STAGING_RELEASE_ROOT/releases/<sha>`, removes the credential-bearing remote, installs from the lockfile,
starts only the `staging` launchd profile, and verifies local plus hosted `/health`. It emits revision-bound
Graphile and LangGraph `staging_deploy` components. An existing release directory with another revision,
an unhealthy local stack, a redirect, or unhealthy hosted endpoint blocks deployment.

The staging and soak jobs share the `runtime-staging` resource group and are non-interruptible. This
prevents concurrent releases from sharing the dedicated staging database or contaminating the 24-hour
window. Their artifacts and deployment dotenv are retained for two weeks. Production remains a separate
manual review; the pipeline never applies a runtime cutover.

Collect immutable artifacts from the same revision and staging deployment. Run focused Graphile/LangGraph tests, Docker integration, contracts, security/SBOM/secrets, 2× load for ten minutes, deterministic chaos, browser/accessibility, rollback, three lifecycle synthetics, 24-hour soak, and disposable backup/restore/reconcile. Exercise alert delivery and both kill switches. Do not copy raw jobs, checkpoints, tokens, database URLs, or task content into evidence.

Validate with:

```sh
npm run release:graphile:verify -- artifacts/graphile-release-manifest.json
npm run release:langgraph:verify -- artifacts/langgraph-release-manifest.json
```

Any nonzero exit blocks cutover. Re-run the failing automation; do not edit or waive the result.

Do not edit a collected manifest. Its `manifestDigest` seals the deployment identity and complete artifact metadata. Copy the JSON byte-for-byte between stages; verification recomputes the canonical digest and cutover requires that verified digest in its release decision.

Run the composed staging soak from the exact deployed revision. The command defaults to 86,400 seconds,
uses five-minute concurrent Graphile/LangGraph windows, isolates Graphile rows by a generated tenant,
cleans every window, and records connection/thread cleanup without persisting database credentials:

```sh
DATABASE_URL="$STAGING_DATABASE_URL" \
SOAK_DEPLOYMENT_ID="$STAGING_DEPLOYMENT_ID" \
SOAK_REVISION="$(git rev-parse HEAD)" \
SOAK_ENVIRONMENT=staging \
npm run test:runtime:soak
```

The release components are written to `.artifacts/runtime-soak/graphile-soak-24h.json` and
`.artifacts/runtime-soak/langgraph-soak-24h.json`. A shorter `SOAK_DURATION_SECONDS` is useful only
for harness smoke testing and cannot pass the 24-hour release threshold.

## Emergency response

Set `FF_GRAPHILE_WORKER_CUTOVER=false` to stop new claims and drain Graphile. Set `LANGGRAPH_GLOBAL_KILL_SWITCH=true` to stop new graph operations while retaining checkpoints. Page P0 for duplicate/concurrent ownership, cross-tenant access, or data loss; P1 for scheduling/checkpoint outage, severe backlog, stuck run/interrupt, or security anomaly; P2 for capacity, retention, or version drift.

Restore into a disposable environment in this order: canonical domain/audit, outbox/projections, application job registry and Graphile storage, then LangGraph checkpoints/threads/interrupts. Verify schema versions and evidence digests, reconcile semantic job keys and opaque thread IDs, prove RPO, and record RTO. Never start workers during restore reconciliation.

## Cutover and rollback

Generate sanitized inventory JSON for each scope and run:

```sh
npm run cutover:graphile:preflight -- --inventory artifacts/jobs-inventory.json --evidence artifacts/graphile-release-manifest.json
npm run cutover:langgraph:preflight -- --inventory artifacts/factory-inventory.json --evidence artifacts/langgraph-release-manifest.json
```

After both allow, freeze starts, back up, drain, reconcile, activate both exclusive epochs, unfreeze, and run three immediate synthetics. Watch ownership conflicts, blocked legacy invocations, duplicate suppressions, queue/checkpoint latency, stale threads, and interrupt age. Rollback only if the automated decision proves zero active target work and compatible schema; otherwise keep both kill switches active and recover forward. Target RTO is under 15 minutes.

Do not use the apply command as a preflight. After the full soak and manifests pass, generate apply-mode
inventories with per-row reconciliation digests and zero active execution counts, prepare the exact
approval document, and obtain immediate manual approval for its SHA-256. The mutation requires all of:

```sh
RUNTIME_CUTOVER_DATABASE_URL="$PRODUCTION_DATABASE_URL" npm run cutover:runtime:apply -- \
  --apply --jobs-inventory artifacts/jobs-apply.json \
  --factory-inventory artifacts/factory-apply.json \
  --graphile-evidence artifacts/graphile-release-manifest.json \
  --langgraph-evidence artifacts/langgraph-release-manifest.json \
  --approval artifacts/runtime-cutover-approval.json \
  --confirm 'sha256:<the-immediately-approved-document-digest>'
```

The approval is valid for 15 minutes. A changed plan, manifest, revision, actor, request ID, or approval
timestamp changes the digest and blocks the transaction. Never retry with an edited confirmation or
partially apply one scope; inspect the rolled-back audit result and rebuild the entire approval bundle.
