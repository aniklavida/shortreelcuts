## What changed


## Why


## The decision sheet

- [ ] This change adds no decision
- [ ] It adds a decision, and the plan field, the sheet row, the reason string and the graph edge all exist
- [ ] No control is reachable before the first render

## The plan

- [ ] The plan schema is unchanged
- [ ] The schema changed, `planVersion` was raised, and a migration step was added
- [ ] A plan from the previous version still renders

## Invalidation

- [ ] No stage dependency changed
- [ ] A dependency changed, and the invalidation tests were updated to match

## Verification evidence

- [ ] Tests added or updated
- [ ] Pure code is tested without spawning an encoder
- [ ] Re-rendering the same plan still produces identical output
- [ ] Documentation updated where behaviour changed

## Dependencies

- [ ] No new dependency
- [ ] New dependency declared with its licence, confirmed maintained, and it passes the rules in `AGENTS.md`

## Truthfulness

- [ ] No claim in this change describes something planned as if it worked
- [ ] Any table of intended behaviour is labelled a target, not a result

## Risk and limitations


## Provenance

- [ ] No copied or adapted code
- [ ] Copied or adapted code is declared with its source, commit and licence
