# Markdown heading conventions

Use headings to describe the structure of a document, not to style text.
Consistent heading levels make documents easier to scan, review, and navigate with assistive technology.

## One H1 per document
Start each Markdown file with one `#` heading that names the document.
Do not add another H1 later in the file.
Use lower-level headings for every section after the title.

## Ordered H2 sections
Use `##` headings for the primary sections of the document.
Place H2 sections in the order a reader needs them, from context to details to evidence or follow-up.
When a document follows a required template, keep the H2 sections in the template order.

## Sentence-style headings
Write headings in sentence style: capitalize the first word and proper nouns, then leave the rest lowercase.
Prefer direct, specific headings over decorative or slogan-like headings.
For example, use `## Test evidence` instead of `## TEST EVIDENCE` or `## Testing All The Things`.

## Avoid skipped levels
Do not jump from an H2 to an H4, or from an H1 to an H3.
Each nested heading should be one level deeper than the section that contains it.
If a subsection does not need children, keep it at the current level instead of adding extra depth.

## Valid outline example

```markdown
# Release readiness report

## Summary

## Scope

## Test evidence

### Unit tests

### Integration tests

## Risks and follow-up
```
