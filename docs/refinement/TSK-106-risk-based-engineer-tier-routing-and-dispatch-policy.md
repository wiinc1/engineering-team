# Refinement Decision Log: TSK-106 Risk-Based Engineer Tier Routing And Dispatch Policy

Task Display ID: TSK-106
Artifact Bundle: ART-TSK-106-v1
Execution Contract Version: v1
Template Tier: Standard
Status: Generated for artifact-bundle review

## Accepted Decisions

- Approved Execution Contract data remains the authoritative dispatch source.
- Sr Engineer is the default implementation tier for Standard, Complex, and Epic work.
- Jr Engineer is allowed only for constrained Simple tests, fixtures, docs, or clear refactors with a clear failing or pending test plan.
- Principal Engineer involvement is required for high-risk engineering triggers and failure-loop escalation triggers.
- QA coverage can run in parallel with Sr implementation for Standard-or-higher work when applicable.
- Failing QA work returns to the implementing Engineer first with evidence attached.
- Tier outcomes are measured by quality and intervention metrics, not lines of code or raw task count.

## Approval Routing

- PM: required before commit.
- Architect: required before commit.
- QA: required before commit.
- Principal Engineer: required when Principal triggers are present.

## Operator Approval Exceptions

- No exception-triggered operator approval required beyond the approved Execution Contract for this implementation slice.

## Resulting Contract Version

- EC-TSK-106-v1
