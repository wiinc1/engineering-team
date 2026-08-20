# Markdown Heading Conventions

## 1. Use one H1 per document

Every Markdown document should have exactly one H1 heading. The H1 names the document as a whole and should appear before the main content.

Use lower-level headings for sections inside the document instead of adding another H1.

## 2. Order H2 sections consistently

Use H2 headings for the document's main sections. Keep those sections in a logical order that matches how a reader should move through the material.

When a document has a standard structure, keep the same H2 order across similar files so reviewers can scan them quickly.

## 3. Write sentence-style headings

Use sentence-style capitalization for headings unless the heading contains a proper noun, acronym, code identifier, or official title.

Example:

- Preferred: `## 2. Order H2 sections consistently`
- Avoid: `## 2. Order H2 Sections Consistently`

## 4. Avoid skipped heading levels

Do not skip heading levels. A subsection under an H2 should use H3, and a subsection under an H3 should use H4.

Skipped levels make the document outline harder to navigate for readers and assistive technology.

## 5. Valid outline example

```markdown
# Deployment Runbook

## 1. Purpose

## 2. Prerequisites

## 3. Deployment steps

### 3.1 Prepare the release

### 3.2 Deploy the release

## 4. Rollback steps

## 5. Verification
```
