# Date and time formatting

## Purpose

Use these conventions to keep dates and times in repository documentation clear, sortable, and unambiguous across time zones.

## ISO 8601 timestamps

Use ISO 8601 timestamps when recording machine-readable events, evidence capture times, audit entries, release windows, or task metadata.

Prefer UTC with a trailing `Z`.

```text
2026-08-20T13:45:30Z
```

Include seconds when the value is evidence or an operational timestamp. Include milliseconds only when the source system emits them or sub-second ordering matters.

Do not use locale-dependent numeric dates with slash separators.

## Time zones

Name the time zone whenever a time is meant for a human schedule, deadline, meeting, maintenance window, or handoff.

Use the IANA time zone name when precision matters.

```text
2026-08-20 08:45 America/Chicago
```

Use `UTC` for cross-system coordination unless a local business context is required. Avoid bare abbreviations such as `CST`, `CDT`, `PST`, or `IST` because they can be ambiguous or season-dependent.

## Human-readable dates

Use human-readable dates for narrative documentation, planning notes, and reports where readability matters more than lexical sorting.

```text
August 20, 2026
```

When a document uses both a human-readable date and a precise timestamp, keep the timestamp near the evidence or event it describes.

```text
Evidence captured on August 20, 2026 at 2026-08-20T13:45:30Z.
```

## Durations

Write durations with clear units.

```text
30 seconds
15 minutes
24 hours
7 days
```

Use ISO 8601 duration notation only when the surrounding system or API expects it.

```text
PT15M
P7D
```

Do not mix approximate and exact duration language in the same value. Write `about 15 minutes` for an estimate and `15 minutes` for a measured or configured duration.

## Relative-time cautions

Avoid relative phrases such as `today`, `yesterday`, `last week`, `soon`, or `recently` in durable documentation.

If relative language is useful for a short-lived note, pair it with an absolute date or timestamp.

```text
Today, August 20, 2026, the queue is empty.
```

Prefer absolute values in runbooks, standards, evidence files, and issue closeout notes so the document remains accurate after time passes.

## Examples

Use this table as a quick reference.

| Context | Preferred format | Example |
| --- | --- | --- |
| Audit or evidence timestamp | ISO 8601 UTC | `2026-08-20T13:45:30Z` |
| Human schedule | Date, time, and IANA zone | `2026-08-20 08:45 America/Chicago` |
| Narrative report date | Month name, day, year | `August 20, 2026` |
| Configured timeout | Number and unit | `30 seconds` |
| API duration value | ISO 8601 duration | `PT30S` |

## Validation guidance

Before publishing date or time documentation, verify that:

- Machine-readable timestamps are valid ISO 8601 values.
- Operational timestamps include a time zone or use UTC with `Z`.
- Human schedules include an IANA time zone when local time matters.
- Numeric slash dates are absent.
- Relative terms are either removed or paired with an absolute date.
- Durations use explicit units and distinguish estimates from measured values.

## Rollback

Revert the documentation commit to remove these conventions.
