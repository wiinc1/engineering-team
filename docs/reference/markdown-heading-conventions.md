# Markdown heading conventions

Use consistent heading structure so readers, screen readers, table-of-contents tools, and standards checks can understand each document.

## Use one H1

Start each Markdown document with exactly one H1. The H1 should name the whole document, not a section inside it.

## Order H2 sections

Use H2 headings for the main sections of the document. Put them in the order a reader needs: context first, then guidance or decisions, then examples or reference details.

## Write sentence-style headings

Use sentence-style capitalization for headings. Capitalize the first word and proper nouns, and leave the rest lowercase.

## Avoid skipped levels

Do not jump from an H1 to an H3, or from an H2 to an H4. Add the missing parent heading or change the lower heading to the next valid level.

## Valid outline example

```markdown
# Service runbook

## Purpose

## Alert response

### Check current status

### Escalate unresolved incidents

## Recovery notes
```
