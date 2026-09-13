# Markdown list conventions

## Purpose

Use these conventions to keep Markdown lists easy to scan, maintain, and review.

## Ordered lists

Use ordered lists when sequence, priority, ranking, or step count matters.

Start each item with `1.` unless a document generator or external format requires fixed numbering. Repeated `1.` markers make diffs smaller when items are added, removed, or reordered.

## Unordered lists

Use unordered lists when items are peers and the order does not change the meaning.

Use `-` for unordered list markers. Do not mix `-`, `*`, and `+` markers in the same list.

## Blank-line spacing

Put one blank line before and after each list unless the list starts immediately after a heading.

Keep multi-paragraph list items separated with blank lines and indent continuation paragraphs by two spaces so they remain part of the same item.

## Parallel phrasing

Write sibling list items with parallel grammar and similar detail.

Start sibling items consistently, such as all noun phrases, all imperative verbs, or all complete sentences. Avoid mixing terse labels with full explanations unless the list intentionally uses a term-and-definition format.

## Nesting

Use nesting only when the child items depend on a parent item.

Keep nested lists shallow. Prefer a new section or table when a list needs more than two levels of nesting or when sibling items become hard to compare.

Indent nested list markers by two spaces under the parent item. Keep each nested list aligned with its siblings.

## Task lists

Use task lists for active work tracking, checklists, or review gates where completion state matters.

Use `- [ ]` for incomplete items and `- [x]` for complete items. Do not use task lists for decorative bullets, historical summaries, or status that is better represented as prose.

## Rollback

Revert the documentation commit to remove these conventions.
