# Repository link conventions

## Purpose

Use these conventions to keep repository links durable, readable, and easy to review.

## Relative repository links

Use relative links for files and directories that live in this repository.

Relative links keep documentation portable across branches, forks, local checkouts, and hosted repository views. Prefer `../runbook.md` or `./markdown-heading-conventions.md` over a hosted repository URL when the target is versioned with the source document.

## Anchored links

Use anchored links when a reader needs to land on a specific section instead of the top of a document.

Anchor links should point to stable headings. If a heading is likely to change during routine editing, link to the document instead and describe the section in nearby text.

## Absolute hosted links

Use absolute hosted links when the target is outside the repository, outside the current documentation tree, or intentionally tied to a hosted review, issue, pull request, release, or external source of record.

Hosted links are also appropriate when documentation must refer to an immutable remote artifact that is not available through a relative repository path.

## Stable targets

Prefer stable targets for links that appear in standards, runbooks, architecture documents, or other long-lived references.

For repository content, link to documents, sections, or directories that are expected to remain in place. For external or hosted content, prefer canonical pages, issue or pull request URLs, release pages, or commit-specific links when the exact historical state matters.

## Link-text clarity

Write link text that names the destination or action clearly without depending on surrounding words.

Avoid vague link text such as "here", "this", or raw URLs unless the URL itself is the subject. Prefer text such as "change governance maintenance standard", "Markdown heading conventions", or "pull request #123".

## Rollback

Revert the documentation commit to remove these conventions.
