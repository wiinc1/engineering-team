# Markdown Task List Conventions

Markdown task lists are for short, reviewable checklists that help readers track completion inside a document. Use them for acceptance criteria, verification steps, release or rollback actions, and small follow-up lists that belong with the surrounding context.

Do not use Markdown task lists as the canonical task system, source of ownership truth, or a substitute for audit records. Durable work tracking belongs in the approved task platform, issue tracker, ADR, or runbook named by the work item.

## Syntax

Use GitHub-flavored Markdown task list markers:

```markdown
- [ ] Unchecked item
- [x] Checked item
```

- Use `- [ ]` for incomplete items.
- Use `- [x]` for completed items.
- Keep one action per checkbox.
- Write each item so it can be independently verified.
- Prefer sentence-style text after the marker.
- Do not use partial states such as `[-]`, `[~]`, or `[?]`; add a short note after the item when status needs context.

## Nesting

Nest task lists only when a parent item has a small set of directly related child checks.

```markdown
- [ ] Verify release readiness
  - [ ] Run focused tests
  - [ ] Confirm rollback path
```

- Limit nesting to one level.
- Keep child items under the parent they prove or complete.
- Avoid mixing task-list nesting with long prose blocks.
- Split the section into headings when a checklist needs more than one nested group.

## Ownership

Every task list must make ownership clear from nearby context.

- Use the document owner, section owner, or named role already established in the document.
- Add an inline owner only when items have different accountable owners.
- Use stable roles for reusable docs, such as `QA`, `Release owner`, or `Security reviewer`.
- Use named people only in time-bound reports or issue-specific evidence.
- Do not mark an item checked until the accountable owner or verifier has completed the work.

Example:

```markdown
- [ ] QA: Verify keyboard navigation
- [ ] Release owner: Confirm rollback command
```

## Accessibility

Task lists must remain understandable when read as plain text or by assistive technology.

- Do not rely on checkbox state alone; item text should include the action and expected outcome.
- Avoid vague labels such as `Done`, `Review`, or `Fix`.
- Keep labels concise, but include enough context for screen reader users.
- Place any blocking reason or evidence link in the same bullet or the sentence immediately following it.
- Preserve normal list indentation so rendered checkboxes follow the intended reading order.

## Examples

Good:

```markdown
- [x] Standards baseline reviewed: `docs/standards/software-development-standards.md`
- [ ] Run `npm run standards:check` and record the result in the PR body
- [ ] QA: Verify the task detail page announces status changes with `role="status"`
```

Avoid:

```markdown
- [x] Done
- [-] Maybe blocked
- [ ] Fix stuff
- [ ] Someone should check this later
```

## Review Rules

- Keep Markdown task lists close to the work they describe.
- Convert recurring or cross-document checklists into a template or runbook.
- Remove completed one-time checklists from long-lived reference docs when they no longer provide evidence.
- Preserve checked historical evidence in issue-specific reports when the checklist documents completed verification.
