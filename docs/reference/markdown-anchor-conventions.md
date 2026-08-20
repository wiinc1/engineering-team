# Markdown anchor conventions

## Purpose

Use these conventions to keep heading anchors and fragment links stable across repository documentation.

## Heading-derived anchors

Prefer links to anchors generated from Markdown headings when the target section has a clear, stable heading.

Write unique headings so generated anchors resolve to one intended section. Use sentence-case heading text and avoid punctuation that makes anchors harder to read or remember.

Example:

```markdown
See [validation guidance](#validation-guidance) before opening a documentation pull request.

## Validation guidance
```

## Explicit HTML anchors

Use explicit HTML anchors only when a stable fragment must survive a heading rename or when external documents already depend on a published fragment.

Place the anchor immediately before the target heading and use a short, descriptive lowercase name.

Example:

```markdown
<a id="stable-validation"></a>

## Validation guidance
```

Do not add explicit anchors for routine internal links when a stable heading-derived anchor is sufficient.

## Renaming risks

Renaming a heading can break existing fragment links because most Markdown renderers derive the anchor from the heading text.

Before renaming a linked heading, search for links to the old fragment and update them in the same change. If external links may exist, keep a justified explicit HTML anchor for the old fragment.

## Fragment link examples

Use relative links with fragments for sections in repository documents.

Examples:

```markdown
[Markdown heading conventions](./markdown-heading-conventions.md)
[Logical nesting](./markdown-heading-conventions.md#logical-nesting)
[Validation guidance](#validation-guidance)
```

Avoid raw fragments without clear link text unless the fragment itself is the subject of the sentence.

## Validation guidance

Validate anchor changes by checking that changed fragment links point to existing headings or justified explicit anchors.

For documentation-only changes, review rendered Markdown when practical and use repository link or documentation validation checks when they are available.

## Rollback

Revert the documentation commit to remove these conventions.
