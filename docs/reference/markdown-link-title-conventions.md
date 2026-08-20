# Markdown link title conventions

## Purpose

Use these conventions to decide when Markdown link title attributes add useful context and when they only repeat information readers already have.

## Useful title attributes

Use a link title only when it adds short, nonessential context that helps a reader decide whether to follow the link.

Good title attributes can clarify a linked artifact's source, status, format, or scope when that detail would interrupt the sentence. Examples include an external source name, an archived artifact note, or a warning that the target opens a large file.

## Duplicated visible text

Do not add a title when it repeats the visible link text or nearby sentence.

Duplicated titles make Markdown noisier, add review churn, and can create repetitive output for assistive technology. Prefer clear link text such as `[repository link conventions](./repository-link-conventions.md)` over `[repository link conventions](./repository-link-conventions.md "repository link conventions")`.

## Wording constraints

Keep title text concise, factual, and stable.

Use sentence case unless the title contains a proper noun, acronym, or quoted title. Avoid promotional wording, instructions that belong in visible text, and details likely to become stale such as temporary ownership, draft status, or expected completion dates.

Do not use titles to hide required context. If the information is necessary for understanding the document, put it in visible prose instead.

## Accessibility considerations

Assume some readers will not receive title text at all.

Browsers, mobile devices, Markdown renderers, and assistive technologies expose title attributes inconsistently. A title must never be the only place where a reader can learn what the link is, why it matters, or whether following it has a consequence.

Write visible link text that stands on its own, then use a title only as optional supporting context.

## Examples

Preferred:

```markdown
[Markdown heading conventions](./markdown-heading-conventions.md)

[external audit report](https://example.com/audit.pdf "PDF, published by the auditor")
```

Avoid:

```markdown
[Markdown heading conventions](./markdown-heading-conventions.md "Markdown heading conventions")

[report](https://example.com/audit.pdf "Read the report")
```

## Rollback

Revert the documentation commit to remove these conventions.
