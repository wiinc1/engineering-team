# Markdown code fence conventions

## Purpose

Use these conventions to keep Markdown code fences clear, safe to copy, and easy to review.

## Language tags

Add a language tag to every code fence when the content has a known syntax.

Use common, lowercase tags such as `js`, `ts`, `json`, `yaml`, `sql`, `bash`, `sh`, `md`, `text`, or `diff`. Use `text` for logs, terminal output, prose examples, and other content that should not be highlighted as executable code.

Avoid custom tags unless a renderer or tool in this repository already supports them.

## Commands and output

Separate commands from their output so readers can copy only the command.

Use a `bash` or `sh` fence for commands:

```bash
npm run lint
```

Use a separate `text` fence for output:

```text
Lint passed.
```

Do not include shell prompts such as `$` or `>` in command fences unless the prompt itself is the subject of the example.

## Fence nesting

Use longer outer fences when documenting Markdown that contains fenced code blocks.

````md
```json
{
  "status": "ok"
}
```
````

Choose an outer fence with more backticks than any inner fence. This keeps the example valid without escaping the inner block.

## Placeholder safety

Mark placeholders clearly and keep them non-secret.

Use angle-bracket placeholders such as `<project-id>`, `<branch-name>`, and `<token-value>` when showing values the reader must replace. Do not include real access tokens, passwords, private keys, personal data, or production-only identifiers in examples.

Prefer safe sample values when the shape matters:

```text
https://example.com/callback
```

## Concise examples

Keep examples short and focused on the convention being explained. Remove unrelated flags, environment setup, and long output unless they are needed to understand the example.

When a longer excerpt is unavoidable, trim the middle and show the omission explicitly:

```text
Starting validation...
...
Validation passed.
```

## Rollback

Revert the documentation commit to remove these conventions.
