# Specialist runtime runner contract

Payload version: `1`

The factory coordinator does not import Grok or OpenClaw types. It spawns `SPECIALIST_DELEGATION_RUNNER` (resolved from `SPECIALIST_RUNTIME_PROVIDER`) and exchanges JSON.

## Stdin

```json
{
  "payloadVersion": 1,
  "specialist": "engineer",
  "request": "Please implement this fix",
  "delegationId": "uuid-or-opaque-id",
  "context": {}
}
```

Missing `payloadVersion` is treated as `1`. Any other version must fail with `SPECIALIST_RUNTIME_VERSION_UNSUPPORTED`.

## Stdout (success)

```json
{
  "agentId": "sr-engineer",
  "sessionId": "runtime-owned-session-id",
  "output": "assistant text",
  "ownership": {
    "specialistId": "engineer",
    "runtimeAgentId": "sr-engineer",
    "sessionId": "runtime-owned-session-id",
    "runtimeProvider": "grok"
  }
}
```

`agentId` and `sessionId` are required. Empty or fixture session ids are not live evidence.

## Providers

| Name | Runner | Health |
| --- | --- | --- |
| `grok` (default) | `scripts/grok-specialist-runner.js` | CLI `GROK_BIN` / `grok --help` |
| `openclaw` | `scripts/openclaw-specialist-runner.js` | HTTP `OPENCLAW_BASE_URL/health` |
| extra | `SPECIALIST_RUNTIME_PROVIDERS` JSON `runner` | `health.kind` `cli` or `http` |

Register another runtime by adding a `scripts/<name>-specialist-runner.js` that implements this contract and an entry in `SPECIALIST_RUNTIME_PROVIDERS`. Do not edit `lib/software-factory/delegation.js` for a new vendor.

## Errors

Stable codes: `SPECIALIST_RUNTIME_NOT_CONFIGURED`, `SPECIALIST_RUNTIME_EXEC_FAILED`, `SPECIALIST_RUNTIME_INVALID_JSON`, `SPECIALIST_RUNTIME_MISSING_EVIDENCE`, `SPECIALIST_RUNTIME_TIMEOUT`, `SPECIALIST_RUNTIME_PROVIDER_UNKNOWN`, `SPECIALIST_RUNTIME_VERSION_UNSUPPORTED`.
