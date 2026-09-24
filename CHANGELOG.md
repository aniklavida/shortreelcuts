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
- Script generation wired into the worker. The `ScriptProvider` in
  `packages/providers` — one OpenAI-chat-completions client serving both a
  hosted bring-your-own-key provider and a local runtime — now runs the
  worker's script stage, resolved from the environment once at boot. When
  no connection is configured the deterministic stub runs instead, and its
  recorded reason says plainly that no model was called. A model response
  that cannot be parsed fails the stage loudly rather than falling back.
  The connection never reaches the plan, the database or a log line.
  OAuth-reached subscriptions and a `VoiceProvider` are explicitly not
  part of this change.

Voice, footage-sourcing and alignment stages remain unimplemented, as do
OAuth-reached model connections and a `VoiceProvider`. Script generation now
exists, but nothing yet turns a prompt into a complete plan on its own, and
no release exists.
