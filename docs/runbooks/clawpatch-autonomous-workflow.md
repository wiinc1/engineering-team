# Clawpatch Autonomous Workflow Runbook

Use this runbook when a Software Factory operator asks how Clawpatch fits into an autonomous implementation loop. Clawpatch is an optional patch-review and repair aid; it does not replace Codex, OpenClaw, GitHub PRs, task approvals, branch protection, tests, Vercel checks, QA, SRE, or operator closeout.

Related operator question: GitHub issue #207. Installation source: https://clawpatch.ai/#installation.

## Decision Summary

For the first supervised autonomous pilot, Clawpatch is optional, not required. The default fallback remains the normal Codex/OpenClaw workflow: task and Project context, approved Execution Contract, branch, implementation, local validation, PR, required checks, Vercel status, merge, QA/SRE closeout, and retrospective evidence.

| Situation | Decision | Operator action |
| --- | --- | --- |
| Issue, Execution Contract, or operator explicitly requires Clawpatch | Required for that task | Validate setup, run only in the task branch/worktree, record commands and evidence, and block merge if validation fails. |
| Low-risk docs, tests, fixtures, or clear refactor where operator wants patch assistance | Optional | Use Clawpatch after branch setup and before final validation; keep Codex/OpenClaw as fallback. |
| First supervised autonomous pilot with no explicit Clawpatch requirement | Optional, not required | Proceed without Clawpatch unless the operator chooses to trial it and records that decision. |
| Auth, secrets, credentials, production data, schema migration, deployment, or compliance-sensitive change | Out of scope unless explicitly approved | Do not provide secrets to Clawpatch; use normal workflow and security review. |
| Dirty worktree with unrelated user changes | Out of scope until isolated | Stop and move to a clean branch/worktree or get owner approval before applying any patch. |
| Clawpatch unavailable, setup fails, or smoke validation fails | Not required | Preserve setup evidence and fall back to Codex/OpenClaw. |

## Prerequisites

- A task or issue ID, Project ID when applicable, and approved Execution Contract or documented operator scope.
- A short-lived branch or isolated worktree named for the task.
- A clean `git status -sb` for the files Clawpatch may touch.
- GitHub permissions to push a branch and open a PR.
- Local test commands identified before patching.
- Operator acceptance that Clawpatch output is advisory until reviewed, tested, and merged through the normal PR workflow.

## Installation And Setup

Use the upstream installation page as the source of truth: https://clawpatch.ai/#installation. As of 2026-05-18, the checked page documents global npm and pnpm installation, source installation from `https://github.com/openclaw/clawpatch`, and `clawpatch doctor` as the setup check.

Allowed setup patterns:

```bash
npm install -g clawpatch
pnpm add -g clawpatch
```

Source installation is also documented upstream, but prefer package-manager installation unless the operator explicitly needs a local Clawpatch development build.

Setup validation:

```bash
clawpatch doctor
git status -sb
```

The smoke check is successful only when `clawpatch doctor` exits successfully and `git status -sb` shows no unexpected repo changes. If Clawpatch creates local state such as `.clawpatch/`, treat it as generated local tooling state unless the task explicitly requires committing a Clawpatch configuration or report.

## Secret Handling

- Do not paste tokens, API keys, cookies, passwords, private keys, customer records, production env values, or credentials into Clawpatch prompts, configuration, generated reports, issue comments, PR bodies, or logs.
- Do not ask Clawpatch to inspect unredacted `.env` files, production credentials, private incident records, or restricted customer data.
- If a patch or report contains a secret-like value, stop the workflow, preserve a redacted summary, notify the security/operator owner, and rotate the credential when required.
- Clawpatch does not bypass repo authentication, GitHub permissions, branch protection, PR metadata checks, Vercel checks, task approvals, or closeout gates.

## Operator Workflow

1. Open the task, issue, and Project. Record the task ID, Project ID, branch name, and whether Clawpatch is `required`, `optional`, or `not used`.
2. Confirm the approved scope and local validation commands. If scope is unclear, create or resolve the PM blocking question before using Clawpatch.
3. Create or switch to the task branch/worktree. Confirm unrelated local changes are absent.
4. Validate setup with `clawpatch doctor`.
5. Start in review mode. Use Clawpatch to inspect only the task-relevant surface before applying a fix.
6. Select one finding or repair target at a time. The selected target must map to the approved task scope.
7. Apply the patch only after confirming the target, files, and expected validation command.
8. Review the diff manually. Reject patches that touch unrelated files, generated artifacts, secrets, auth boundaries, deployment configuration, or unapproved runtime behavior.
9. Run the task validation matrix. At minimum, run the commands required by the task and the repo standards checks.
10. Open the PR with normal metadata. Include whether Clawpatch was used, the setup smoke result, commands run, and any fallback or recovery action.
11. Merge only after required GitHub checks and Vercel are green.
12. Record closeout evidence in the task history or report, including whether Clawpatch was used and whether any Clawpatch suggestion was rejected.

## Suggested Command Sequence

These commands are examples, not a required automation contract. Follow upstream Clawpatch documentation for exact CLI behavior.

```bash
git status -sb
clawpatch doctor
clawpatch init
clawpatch map
clawpatch review --limit 10
clawpatch report
clawpatch fix --finding <finding-id>
clawpatch revalidate --finding <finding-id>
git status -sb
git diff --check
npm run standards:check
npm run lint
```

Only run `clawpatch fix` after selecting a scoped finding. If the task adds no executable schema or runtime code, tests may remain documentation validation only; otherwise run the relevant unit, integration, browser, security, or build commands before opening the PR.

## Fallback Path Without Clawpatch

Use the normal agent workflow when Clawpatch is unavailable, optional but skipped, or out of scope:

1. Keep the task in the approved Project and branch.
2. Implement with Codex and OpenClaw using the approved Execution Contract.
3. Review `git diff` manually.
4. Run the required local validation matrix.
5. Open the PR with standards metadata and evidence.
6. Wait for GitHub checks and Vercel.
7. Merge only when checks are green.
8. Record closeout evidence and note `Clawpatch not used`.

Skipping Clawpatch is not a workflow failure unless the issue or Execution Contract explicitly required it.

## Failure Recovery

| Failure mode | Required recovery |
| --- | --- |
| Clawpatch unavailable or installation fails | Stop Clawpatch usage, record the command and redacted error summary, and fall back to Codex/OpenClaw. |
| `clawpatch doctor` fails | Do not patch. Record the failure and use the fallback path. |
| Patch conflicts with local changes | Stop. Preserve evidence with a redacted summary. Move to a clean worktree or ask the owner how to handle existing changes. |
| Patch changes unrelated files | Reject the patch. Do not commit unrelated changes. Re-run from a narrower finding or fall back. |
| Patch touches secrets, credentials, auth, compliance, production config, or customer data unexpectedly | Stop, notify the operator/security owner, redact evidence, and do not continue under Simple docs/test workflow. |
| Tests or standards checks fail | Treat the patch as unverified. Fix through the normal workflow or revert the task-scoped patch only after confirming ownership of the changed files. |
| Patch cannot be explained or mapped to the task | Reject the patch and open a PM blocking question if scope is ambiguous. |

Avoid broad destructive cleanup commands. If a patch must be discarded, preserve the diff or a redacted summary first, confirm the affected files are owned by the current task, and then restore only those task-owned files.

## Evidence Checklist

- Task ID, Project ID, branch/worktree, and PR URL.
- Decision: `required`, `optional`, `not used`, or `out of scope`.
- Installation source and setup smoke result.
- Clawpatch commands run, if any.
- Findings or repair target IDs, if any.
- Diff review summary and rejected-patch notes.
- Test, lint, standards, build, browser, and Vercel evidence as applicable.
- Failure recovery notes, if any.
- Closeout note stating whether Clawpatch was used.

## Standards Alignment

- Applicable standards areas: documentation as code, team and process, testing and quality assurance, deployment and release, authentication and secret handling.
- Evidence expected for changes that use Clawpatch: task/Project linkage, branch and PR evidence, explicit validation commands, redacted setup or failure output, and closeout notes.
- Gap observed: issue #207 contains only the Clawpatch installation link and no repo-specific operator workflow guidance. Documented rationale: operators need repo-specific boundaries before using a patch tool in an autonomous implementation workflow (source https://github.com/wiinc1/engineering-team/issues/207).

## Required Evidence

- Required local checks for this runbook change: `npm run standards:check`, `npm run lint`, docs validation relevant to changed files, and external installation URL validation.
- Required future evidence when Clawpatch is used on a task: setup smoke result, patch review summary, validation commands, PR checks, Vercel status when applicable, and closeout note.
- Rollback: revert the documentation change if this guidance is rejected.
