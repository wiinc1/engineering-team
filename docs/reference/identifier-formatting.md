# Identifier formatting

## Purpose

Use these conventions to document code and system identifiers consistently across repository docs, implementation notes, and review evidence.

## General rule

Preserve the exact spelling and case of an identifier when referring to code, configuration, service names, task IDs, API fields, database fields, file names, or generated artifacts.

Use backticks around inline identifiers so readers can distinguish literal names from surrounding prose.

```markdown
Call `createTask` after `validateTaskInput` succeeds.
The `TaskDetailPanel` component reads `taskId` from the route.
```

Do not rewrite an identifier to match sentence style. If the code says `taskId`, write `taskId`, not `task ID`, `taskID`, or `Task ID`, unless you are describing the concept instead of the literal field.

## Functions and methods

Write function and method names exactly as implemented. Include trailing parentheses when the reference is about the callable itself, and omit them when the reference names a field or property.

```markdown
Use `normalizeTaskId()` before persisting imported tasks.
`TaskRepository.create()` returns the stored task record.
```

When documenting arguments, use the parameter name from the implementation or API contract.

```markdown
`normalizeTaskId(rawTaskId)` accepts the untrusted source value as `rawTaskId`.
```

## Classes, components, and types

Preserve class, component, interface, and type names in their declared case.

```markdown
`TaskDetailPanel` renders the task summary.
`GitHubIntakeEvent` represents the normalized webhook payload.
`TaskStatus` is the public status enum.
```

Do not split PascalCase names into prose when the reader needs to search for the code symbol.

## Fields and properties

Use the exact field name from the payload, database column, configuration file, or source type.

```json
{
  "taskId": "TSK-082",
  "ownerAgentId": "jr-engineer",
  "sourceIssueUrl": "https://github.com/wiinc1/engineering-team/issues/437"
}
```

Prefer a short definition list when documenting fields.

```markdown
- `taskId`: Canonical task identifier shown to operators.
- `ownerAgentId`: Agent assigned to complete the task.
- `sourceIssueUrl`: GitHub issue that requested the change.
```

## Task IDs

Write task IDs in uppercase using the canonical prefix and numeric portion supplied by the source system.

```text
TSK-082
GP-002
ISSUE-437
```

Do not remove leading zeros, change separators, or convert task IDs to prose. When linking to a task or issue, keep the visible identifier unchanged.

```markdown
`TSK-082` closes GitHub issue `#437`.
```

## Service names

Preserve the service name used in configuration, scripts, logs, or deployment manifests.

```markdown
`audit-workers` consumes projection jobs.
`job-runtime` owns background job execution.
`github-intake` normalizes incoming GitHub events.
```

Use the configured service identifier for operational instructions. Use plain prose only when explaining the human-readable role of the service.

## Case preservation

Case is part of the identifier. Keep these forms distinct:

- `taskId`: JavaScript or JSON field.
- `task_id`: SQL column, environment key segment, or snake case payload field.
- `TASK_ID`: Environment variable or shell constant.
- `TaskId`: Type, class, or generated schema name when declared that way.
- `TSK-082`: Operator-facing task ID.

Do not normalize identifiers across contexts unless the system explicitly defines that transformation. If a transformation is required, document both sides.

```markdown
The API accepts `taskId` and stores it in `task_id`.
```

## Examples

Use concise examples that include real-looking values and the smallest surrounding context needed to understand the identifier.

```markdown
`GET /api/tasks/{taskId}` returns the task whose `taskId` matches `TSK-082`.
```

```sh
TASK_ID=TSK-082 npm run issue-276:cohort
```

Avoid placeholder-heavy examples when a concrete value communicates the expected format more clearly.

## Validation guidance

Before publishing identifier documentation, verify that:

- Inline literal identifiers are wrapped in backticks.
- Function, class, field, service, and task ID names match the source exactly.
- Case, separators, and leading zeros are preserved.
- Examples use valid formats for the documented system.
- Any intentional rename or case conversion names both the source identifier and the target identifier.

For documentation-only changes, review the rendered Markdown and confirm examples remain searchable in the repository or traceable to the referenced contract.
