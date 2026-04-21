# Test Suite Report SF-044

## Summary
- Command: `npm run test:delegation:verification`
- Result: 37 specialist-delegation verification tests passed, 0 failed.
- Scope covered:
- unit fallback classification and command-router attribution behavior
- runtime contract validation
- integration artifact persistence and unsupported task-type fail-closed behavior
- end-to-end success, truthful fallback, runtime execution failure, unsupported-routing fallback, attribution mismatch rejection, and malformed-runtime rejection
- performance budget and security sanitization

## Commands
- `npm run test:delegation:verification`
- `node --test tests/integration/specialist-delegation.integration.test.js`

## Notes
- This report is the dedicated delegation verification matrix for `SF-044`.
- The repo-wide `npm run test:unit` command still has one unrelated pre-existing UI failure in `src/app/App.test.tsx`; that is outside the specialist delegation matrix covered here.
