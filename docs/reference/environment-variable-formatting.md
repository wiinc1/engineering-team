# Environment variable formatting

## Purpose

Use these conventions to document environment variables in a way that is readable, safe to share, and easy to validate.

## Variable-name notation

Write environment variable names in uppercase snake case and format them as inline code.

Use descriptive names that match the real variable used by the application or deployment system.

```text
DATABASE_URL
AUTH_SESSION_SECRET
VITE_TASK_API_BASE_URL
```

Do not invent alternate spellings, omit required prefixes, or change the case to fit prose.

## Required and optional variables

State whether each variable is required or optional before describing its value.

For required variables, name the component, command, or environment that needs the variable. For optional variables, describe the default behavior when the variable is unset.

Example:

- `AUTH_SESSION_SECRET` is required for production authentication services.
- `VITE_TASK_API_BASE_URL` is optional for local browser builds; when unset, the browser app uses the same origin.

## Safe example values

Use realistic but non-sensitive example values. Examples should show the expected shape without exposing live hosts, accounts, credentials, tokens, or tenant-specific identifiers.

```sh
export TASK_API_BASE_URL="https://tasks.example.test"
export AUTH_COOKIE_NAME="engineering_team_session"
export RETRY_LIMIT="3"
```

Use reserved example domains such as `example.com`, `example.org`, or `example.test` for URLs. Use obvious dummy identifiers such as `user_12345` only when the identifier shape matters.

## Secret redaction

Never document real secrets, bearer tokens, private keys, session cookies, database passwords, or webhook signing secrets.

When showing a secret value, use a redacted placeholder that names the expected type.

```sh
export AUTH_SESSION_SECRET="<redacted-session-secret>"
export DATABASE_URL="<redacted-postgres-url>"
export GITHUB_TOKEN="<redacted-github-token>"
```

For captured logs or command output, replace secret material before committing the evidence.

```text
AUTH_SESSION_SECRET=<redacted-session-secret>
DATABASE_URL=postgres://<redacted-user>:<redacted-password>@db.example.test:5432/app
```

## Examples

Use shell-labeled fences for commands that a reader can copy after replacing placeholders.

```sh
AUTH_CONFIG_TARGET=production npm run auth:config:check
```

Use `text` fences for environment file examples or output excerpts.

```text
AUTH_CONFIG_TARGET=production
AUTH_SESSION_SECRET=<redacted-session-secret>
VITE_TASK_API_BASE_URL=https://tasks.example.test
```

Keep examples short and focused on the variables being documented.

## Validation guidance

Name the command, script, or startup check that verifies the variables whenever one exists.

```sh
npm run auth:config:check
```

If validation is manual, list the expected observable result and the environment where it was checked.

Document validation failures with the variable name, the failing command or check, and the fix. Keep the failed value redacted when the variable is secret.

## Rollback

Revert the documentation commit to remove these conventions.
