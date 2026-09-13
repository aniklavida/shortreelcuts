# Changelog

All notable changes to ShortReelCuts are documented here, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Product specification, architecture, folder structure, roadmap and release checklist.
- Contributor and agent instructions.
- `packages/plan`: the plan schema (versioned as `planVersion`, with a
  migration entry point), the stage dependency graph, the invalidation
  function that decides which stages a plan edit must re-run, and
  content-addressed artefact keys so an unchanged stage's output can be
  reused instead of recomputed. Tested, including against every row of the
  product's invalidation table.

No stage (script, voice, footage, alignment or compose), provider or
renderer is implemented. This adds the plan document and the graph over
it, not a pipeline — nothing here can produce a video yet, and no release
exists.
