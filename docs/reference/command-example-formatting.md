# Command example formatting

## Purpose

Use these conventions to keep command examples readable, copy-paste safe, and easy to verify.

## Shell fence labels

Label shell command fences with the shell a reader should use.

Use `sh` for portable POSIX shell commands and `bash` only when the example depends on Bash syntax. Use the specific tool or format label, such as `json` or `yaml`, for non-shell content.

```sh
npm run lint
```

Do not include prompt characters such as `$`, `>`, or `#` inside copyable command fences.

## Copy-paste-safe commands

Write command examples so a reader can paste them directly into a terminal when the placeholders are replaced.

Prefer complete commands over fragments. Include required flags, quote arguments that may contain spaces, and avoid hidden setup steps unless the surrounding text names them explicitly.

```sh
git switch -c docs/command-example-formatting
```

Do not combine unrelated commands in one line. Use separate lines when the sequence matters.

## Placeholder notation

Use angle-bracket placeholders for values the reader must replace.

Name placeholders with lowercase words separated by hyphens. Keep placeholders descriptive enough to show the expected value.

```sh
git remote add <remote-name> <repository-url>
```

Explain placeholders before or after the command when the expected value is not obvious from the name.

## Command and output separation

Keep commands and expected output in separate fences.

Use a shell-labeled fence for commands and a `text` fence for output. This keeps the command fence copyable and makes it clear which lines are evidence.

```sh
node --version
```

```text
v22.16.0
```

Use short output excerpts when full output is noisy. Mark omitted sections with plain prose outside the output fence.

## Multiline examples

Use multiline command examples when a command is too long to scan on one line or when the sequence is safer as ordered steps.

For one logical command split across lines, use trailing backslashes in `sh` examples.

```sh
curl --fail \
  --header "Authorization: Bearer <token>" \
  --url "<api-url>/health"
```

For multiple commands, put one command per line in the order the reader should run them.

```sh
npm ci
npm run lint
npm test
```

## Rollback

Revert the documentation commit to remove these conventions.
