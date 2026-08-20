# Markdown footnote conventions

## Purpose

Use these conventions to keep Markdown footnotes useful, accessible, and portable across repository views and generated documentation.

## Appropriate use

Use footnotes for supplemental context that would interrupt the main flow, such as brief source notes, implementation caveats, or definitions that only some readers need.

Do not use footnotes for required steps, warnings, decisions, ownership, or information a reader must understand before acting. Put critical information in the body text instead.

## Stable labels

Use descriptive, stable footnote labels instead of generated numbers when the label is visible in source.

Prefer labels such as `[^retention-window]`, `[^source-of-record]`, or `[^renderer-note]`. Avoid labels such as `[^1]`, `[^a]`, `[^temp]`, or labels tied to section order.

Keep labels lowercase and hyphen-separated. Reuse a label only for the same note in the same document.

## Placement

Place the footnote reference immediately after the sentence or phrase it explains.

Place footnote definitions near the end of the section when the note is local to that section. Place document-wide footnote definitions near the end of the file before any rollback section.

Keep one blank line between footnote definitions so renderers parse each note consistently.

## Accessibility

Keep footnotes short and self-contained so screen reader users can understand them out of the original paragraph context.

Use clear link text in the main sentence before the footnote. Do not rely on the footnote marker as the only explanation for why a source, caveat, or exception matters.

## Renderer portability

Use CommonMark-style references and definitions:

```markdown
The retention window starts when the record is archived.[^retention-window]

[^retention-window]: Retention timing can differ for records under legal hold.
```

Avoid inline HTML, nested footnotes, multi-paragraph footnotes, and Markdown features that depend on a single hosting renderer unless the document explicitly targets that renderer.

## Examples

Use a footnote when the main sentence should stay focused:

```markdown
Store release evidence with the change record.[^evidence-location]

[^evidence-location]: Evidence can live in the repository or in the linked system of record when the repository stores the pointer.
```

Prefer body text when the detail changes the action:

```markdown
Do not deploy until the rollback evidence is attached to the change record.
```

## Rollback

Revert the documentation commit to remove these conventions.
