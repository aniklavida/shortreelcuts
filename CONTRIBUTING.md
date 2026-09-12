# Contributing

ShortReelCuts is pre-implementation. The specification, architecture and structure exist; working code does not yet.

**Implementation contributions are not being accepted until the foundation is complete.** Issues and discussion about the specification are welcome now — particularly about the decision sheet, which is the part of the product most likely to be wrong.

## When contributions open

1. Read [`AGENTS.md`](AGENTS.md) first — it is the contract for humans and agents alike.
2. **The decision sheet is the product.** A change that adds a control reachable before the first render will not be merged.
3. A new decision means a plan field, a decision row and a graph edge. A plan field with no sheet row is incomplete.
4. A schema change means a higher `planVersion` and a migration step. A stored plan must always render.
5. A new provider implements the interface and declares its capabilities. If the interface has to change to accommodate it, the capability declaration is what is wrong.
6. Every new dependency needs a licence audit in the pull request, and a check that the project is still maintained. See the dependency rules in `AGENTS.md`.
7. Pure code is tested without spawning an encoder.

## Commit messages

Describe what changed and why. If a decision was added, removed or re-priced, say so.
