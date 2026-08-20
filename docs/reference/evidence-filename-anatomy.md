# Evidence filename anatomy

## Purpose

Use evidence filenames that are predictable, reviewable, and safe to share in pull requests, release notes, audit trails, and local validation records.

## Naming rules

Write evidence filenames in lowercase. Use hyphens between words and avoid spaces, underscores, camel case, and punctuation that is not needed by the file extension.

Start each filename with a stable prefix that identifies the evidence category. Common prefixes include `test`, `lint`, `build`, `security`, `review`, `rollback`, and `ci`.

Include the task, issue, or run identity after the prefix. Prefer canonical IDs such as `tsk-046`, `issue-102`, or a stable run identifier from the system that produced the evidence.

Add a timestamp when multiple evidence files can exist for the same task or run. Use UTC in compact sortable form: `yyyymmddthhmmssz`.

End with the normal file extension for the evidence format, such as `.md`, `.json`, `.log`, `.txt`, `.png`, or `.webm`.

## Recommended shape

Use this order:

```text
<prefix>-<task-or-run-id>-<timestamp>.<extension>
```

Examples:

```text
test-tsk-046-20260820t053000z.log
lint-issue-102-20260820t053015z.txt
rollback-tsk-046-20260820t053045z.md
ci-run-12345-20260820t053100z.json
```

For a single canonical evidence file where a timestamp would create churn, omit the timestamp:

```text
review-tsk-046.md
```

## Secret handling

Do not put secrets, tokens, credentials, customer data, private URLs, email addresses, hostnames, branch protection bypass details, or other sensitive identifiers in evidence filenames.

If sensitive context is needed, keep it inside the evidence file only when it is approved for that audience. Redact it before committing or sharing the evidence.

## Rollback

Revert the documentation commit to remove this filename guidance.
