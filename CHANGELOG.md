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
- `packages/render`: a renderer. Given a plan and its resolved media, it
  assembles scenes with held/trimmed footage and crossfade transitions,
  burns in styled captions (plus a sidecar `.srt`), mixes narration with a
  ducked background bed, and encodes 1080×1920 H.264/AAC MP4 by spawning a
  system `ffmpeg` as a binary — never linked. Proved against a
  hand-written plan fixture with no AI in the loop.

No script, voice, footage-sourcing or alignment stage, and no provider,
worker or web app, is implemented. This adds a renderer that can turn an
already-complete plan into a video; nothing here can turn a prompt into a
plan yet, and no release exists.
