# Error message formatting

## Purpose

Use these conventions to present error messages in repository documentation clearly, safely, and consistently enough for readers and validators to compare evidence.

## Exact-message quoting

Quote an error message exactly when the wording, punctuation, casing, or field name is part of the evidence.

Use inline code for short exact messages.

```markdown
The command fails with `Error: missing CHANGE_REFERENCE`.
```

Use a `text` code block for multiline output or when the message includes stack-like formatting.

```text
Validation failed:
- Missing required field: CHANGE_REFERENCE
- Missing required field: CHANGE_KIND
```

Do not correct spelling, normalize capitalization, or shorten an exact message inside a quote. Explain any noisy or irrelevant lines in prose outside the quote.

## Paraphrases

Paraphrase when the exact wording is not important or when a shorter summary helps the reader understand the failure.

```markdown
The validator rejected the change because the required change metadata was incomplete.
```

Do not present paraphrases as exact output. Avoid quotation marks and inline code unless the text is a literal command, field, file path, or error token.

## Code blocks

Separate commands, exact output, and explanation.

```sh
CHANGE_KIND=documentation npm run standards:check
```

```text
Error: missing CHANGE_REFERENCE
```

Use `text` for tool output unless a more specific format label, such as `json` or `yaml`, makes the output easier to validate. Keep excerpts short and describe omitted lines in prose.

## Variable redaction

Redact secrets, tokens, tenant-specific values, user identifiers, and environment-specific paths that are not required to diagnose the error.

Use descriptive angle-bracket placeholders for redacted values.

```text
Request failed for tenant <tenant-id>: token <redacted-token> is expired.
```

Keep stable, non-sensitive structure intact so readers can still compare the message shape. Do not redact generic field names, status codes, command names, or repository-relative paths unless they reveal sensitive data.

## Remediation context

Pair error messages with the smallest useful remediation context.

Name what failed, why it matters, and the next action. Link to the relevant reference, policy, or changed file when that helps the reader resolve the failure.

```markdown
`Error: missing CHANGE_REFERENCE` means the standards gate cannot trace the change to an approved task. Set `CHANGE_REFERENCE=TSK-083` before rerunning the validation command.
```

Avoid documenting broad troubleshooting trees when one direct remediation is known.

## Examples

Use exact output when validation depends on the literal text.

```markdown
The PR body validator reported `Missing required field: Tests`.
```

Use a paraphrase when only the failure category matters.

```markdown
The PR body validator rejected the submission because one governed evidence field was empty.
```

Use redaction when the message contains sensitive or host-specific values.

```text
Authentication failed for user <user-email> using token <redacted-token>.
```

Use remediation context to make the example actionable.

```markdown
`Authentication failed for user <user-email>` means the local credential was rejected. Refresh the development credential and rerun the command that produced the failure.
```

## Validation guidance

Before submitting documentation that quotes or summarizes an error message, check that:

- exact messages match the observed output byte-for-byte after intentional redaction
- paraphrases are not formatted as exact output
- code fences use labels that match the content
- redacted values use descriptive placeholders and preserve non-sensitive structure
- remediation text names the concrete next action
- examples avoid secrets, private identifiers, and machine-specific values

For pull request evidence fields on documentation-only changes, use the changed documentation path as both test evidence and documentation evidence when repository validation treats the document itself as the evidence.

## Rollback

Revert the documentation commit to remove these conventions.
