# File path formatting

## Purpose

Use these conventions to document repository and filesystem paths consistently, clearly, and in a way that automated validation can check.

## Relative repository paths

Use relative paths for files and directories that live in this repository.

Relative paths keep documentation portable across branches, forks, local checkouts, and hosted repository views. Write paths from the repository root unless the surrounding document explicitly says a path is relative to another directory.

```text
docs/reference/file-path-formatting.md
dev-standards/policies/testing-standard.md
```

Use `./` or `../` only when the relationship to the current document matters.

```text
./repository-link-conventions.md
../policies/change-control.md
```

## Absolute filesystem paths

Use absolute filesystem paths only when the location is outside the repository or when an operational instruction depends on the machine-specific location.

Absolute paths are useful for logs, temporary files, mounted volumes, or user-local configuration. They are less portable than repository paths, so include them only when the exact host path matters.

```text
/var/log/engineering-team/audit.log
/Users/<user>/work/engineering-team/.env.local
```

## Clickable links and code formatting

Use clickable Markdown links when the reader should navigate to a repository document, section, or reviewed artifact.

```markdown
[repository link conventions](./repository-link-conventions.md)
```

Use inline code formatting when the path is a literal value, command argument, configuration value, or validation field value.

```markdown
Set `TEST_EVIDENCE_PATH=docs/reference/file-path-formatting.md`.
```

Do not wrap a Markdown link in backticks. A path can be either a link target or a literal code value, but combining both makes the rendered document harder to read and may break link detection.

## Placeholders

Use angle-bracket placeholders for values the reader must replace.

Name placeholders with lowercase words separated by hyphens, and keep the surrounding path concrete enough to show where the replacement belongs.

```text
/Users/<user>/work/<repository-name>
docs/reference/<topic-name>.md
```

Explain placeholders in nearby prose when the expected value is not obvious from the placeholder name.

## Paths with spaces

Quote paths with spaces in command examples and shell instructions.

```sh
ls "docs/reference/path examples"
```

When a Markdown link target contains spaces, replace spaces with `%20` or wrap the target in angle brackets.

```markdown
[path examples](<./path examples.md>)
```

Prefer paths without spaces for repository files when adding new documentation, scripts, test evidence, or generated artifacts.

## Examples

Use repository-relative paths for pull request evidence fields that refer to changed files.

```text
docs/reference/file-path-formatting.md
```

Use inline code when naming a path in a sentence.

```markdown
Update `docs/reference/file-path-formatting.md` when the path-formatting guidance changes.
```

Use a clickable link when the reader should open the destination.

```markdown
See [command example formatting](./command-example-formatting.md).
```

Use an absolute path only when documenting a local or runtime location outside the repository.

```text
/tmp/engineering-team/validation-output.txt
```

## Validation guidance

Evidence and compliance fields should use paths that exist in the repository or are produced by the documented command.

For documentation-only changes, point test evidence and documentation evidence to the changed documentation file when repository validation treats the document itself as the evidence.

Avoid placeholder-only values in validation fields. Replace placeholders with concrete repository paths, artifact paths, or a specific explanation before submitting evidence for review.

## Rollback

Revert the documentation commit to remove these conventions.
