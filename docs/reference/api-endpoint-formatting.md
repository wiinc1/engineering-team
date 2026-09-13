# API endpoint formatting

## Purpose

Use these conventions to document API endpoints consistently across repository docs, implementation notes, and review evidence.

## Method and path notation

Write the HTTP method in uppercase followed by one space and the absolute path.

```text
GET /api/tasks
POST /api/tasks
PATCH /api/tasks/{taskId}
DELETE /api/tasks/{taskId}
```

Use backticks around inline endpoint references, such as `GET /api/tasks/{taskId}`. Do not include a host name unless the host is part of the decision being documented.

Use `{name}` for path parameters. Keep parameter names descriptive, lower camel case, and aligned with the implementation or API contract.

## Path parameters

Name each path parameter near the endpoint description when the value is not obvious.

Example:

```markdown
`GET /api/projects/{projectId}/tasks/{taskId}` returns one task in a project.

- `projectId`: Stable project identifier.
- `taskId`: Stable task identifier scoped to the project.
```

Do not document a placeholder as literal path text. Write `/api/tasks/{taskId}`, not `/api/tasks/taskId` or `/api/tasks/:taskId`, unless the API framework specifically exposes colon notation to readers.

## Query strings

Show query parameters after the path when a specific combination matters.

```text
GET /api/tasks?status=open&owner=jr-engineer
```

For optional or variable query strings, document the base endpoint first and list parameters separately.

```markdown
`GET /api/tasks` lists tasks.

- `status`: Optional task status filter.
- `owner`: Optional owner agent identifier.
```

Encode example values as they would appear in a real URL. Avoid placeholder-heavy query strings when a concrete example would be clearer.

## Complete examples

Include a complete request example when readers need to copy, test, or compare behavior.

```sh
curl --fail \
  --request GET \
  --header "Authorization: Bearer <token>" \
  --url "https://example.com/api/tasks?status=open"
```

Keep commands copy-paste safe. Use angle-bracket placeholders only for values the reader must replace, and explain them when the surrounding text does not.

When documenting a response shape, include the smallest complete response that proves the behavior.

```json
{
  "tasks": [
    {
      "id": "task-123",
      "status": "open"
    }
  ]
}
```

## Accessible prose

Introduce each endpoint with a plain-language sentence that says what the endpoint does and who or what it affects.

Prefer "returns one task" over "fetches task object" and "creates a task for the project" over "hits task creation route." Spell out unusual abbreviations before using them repeatedly.

Use link text that describes the destination, such as "task creation endpoint," instead of raw URLs or vague text such as "here."

## Validation guidance

Before publishing endpoint documentation, verify that each method, path segment, path parameter, query parameter, and example value matches the current API contract or implementation.

For documentation-only changes, review the rendered Markdown when practical and run the repository documentation or standards checks available for the changed file. Confirm that fenced examples use the correct language labels and that command examples follow the command example formatting conventions.

## Rollback

Revert the documentation commit to remove this endpoint formatting reference.
