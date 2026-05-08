# Maintainability Standard

## 1. Intent

Maintainability must be enforced through objective thresholds, not code review
taste. File size, function size, complexity, and public-surface growth are
leading indicators of change risk and refactoring need.

## 2. Enforcement Model

Thresholds are enforced immediately as hard CI failures for:

- all new files
- all newly added functions
- all changed files that were previously compliant

Legacy noncompliant files are governed by a ratchet rule:

- every touch must improve at least one maintainability signal
- no protected maintainability signal may regress without a waiver
- if the file remains noncompliant after the change, a time-boxed waiver is
  required

## 3. Base Default Thresholds

These are universal defaults. Repo profiles may tighten them or define narrow,
explicit overrides.

### Authored Source Files

- warning at `300` lines
- hard fail at `400` lines

### Test Files

- warning at `400` lines
- hard fail at `500` lines

### Functions or Methods

- warning at `40` lines
- hard fail at `50` lines

### Complexity

- cyclomatic or cognitive complexity warning at `10`
- hard fail at `15`

### Nesting Depth

- warning at `4`
- hard fail at `6`

### Public Surface

- module export warning at `12`
- hard fail at `20`

## 4. Combined Rule

No single metric is sufficient. CI should fail when any hard threshold is
exceeded for a governed artifact, even if other metrics are acceptable.

Large but simple files and small but tangled files are both noncompliant.

## 5. Measurable Improvement

For touched legacy noncompliant files, acceptable measurable improvement
includes any machine-checkable reduction in maintainability risk such as:

- lower line count
- fewer oversized functions
- lower complexity
- lower nesting depth
- fewer exports
- extracted modules or helpers that reduce file responsibility
- improved dependency direction compliance
- improved testability at the correct boundary

At least one maintainability signal must improve on every touch to a
noncompliant file.

## 6. Protected Maintainability Signals

The following may not regress on a touched noncompliant file without a waiver:

- total file line count
- number of over-limit functions
- maximum function length
- maximum complexity
- maximum nesting depth
- public export count

## 7. Exceptions

These paths may use profile-defined alternate thresholds:

- generated files
- committed schema snapshots
- fixtures
- migrations
- vendored third-party code

These are exceptions, not loopholes. Every exception class must have explicit
policy treatment in the repo contract.

## 8. Waivers

If a touched noncompliant file still remains over a hard threshold after
improvement, the change must include a waiver with:

- rule
- path
- owner
- expiry date
- mitigation
- follow-up reference

Waivers must be time-boxed and fail CI on expiry.

## 9. Refactoring Triggers

Refactoring is mandatory when any of the following occur:

- a hard threshold is crossed
- repeated waivers occur on the same file or module
- a hotspot file is changed repeatedly
- recurring bug fixes cluster in the same oversized area
- dependency boundary violations accumulate around a file

## 10. Operational Rule

The standard is not “do not make it worse.” The standard is:

- new files must be compliant
- compliant changed files must remain compliant
- noncompliant changed files must improve
- noncompliant changed files that remain over the limit must carry a waiver
