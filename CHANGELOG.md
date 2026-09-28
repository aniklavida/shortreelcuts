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
- Voice stage and provider wired into the worker. The `VoiceProvider` in
  `packages/providers` — an OpenAI-audio-speech client serving both a
  hosted bring-your-own-key provider and a local runtime — now runs the
  worker's voice stage via `createVoiceRunner`, resolved from the
  environment once at boot. When no connection is configured the
  deterministic stub runs instead, and its recorded reason says plainly
  that no speech engine was called. Declared voices are exposed as
  candidates on the decision sheet, with the stage selecting a voice and
  recording provenance. A provider failure fails the stage loudly rather
  than silently falling back. The connection key never reaches the plan,
  the database or a log line. OAuth-reached subscriptions remain out of
  scope.
- Stock-footage provider wired into the worker. A provider-neutral
  `FootageProvider` in `packages/providers` — one interface, one
  candidate-clip shape — with a real adapter per cleared library: Pexels
  and Pixabay, both bring-your-own-key, both resolved from the environment
  once at boot via `SHORTREELCUTS_FOOTAGE_PROVIDER` and
  `SHORTREELCUTS_FOOTAGE_API_KEY`. **No default provider is chosen for
  you**: with neither variable set the worker's footage stage runs its
  deterministic stub, whose recorded reason now says plainly that no
  library was searched and that its asset ids are synthetic. Naming a
  library without a key, or naming one this build has no adapter for, is
  refused at boot rather than silently stubbed.

  A library returns candidates and the stage picks one, records the
  provider, the asset, the alternatives and the search term in the plan
  reason, and exposes every returned clip as a candidate on the decision
  sheet. A non-2xx, an unparseable 2xx or an empty result fails the stage
  loudly instead of falling back to the stub.

  **A plan records the library's own asset id and never a download URL or
  a file.** Candidates carry no media link, `assertClipCarriesNoMediaUrl`
  walks every string in the clip and rejects any URL other than the
  library's allow-listed asset page, and a media URL is re-resolved from
  the asset id only at render/download time by the provider's
  `resolveMediaUrl`. The same assertion runs over **every candidate the
  library returned**, not only the chosen clip: candidates are stored next
  to the plan and shown on the decision sheet, so a leak in the clip the
  seed did not pick is just as much a leak. The rule is proved by
  sabotaging the plan on purpose —
  a URL pasted into the asset id, a URL smuggled into another field, a
  credit page on the library's media CDN, a download URL embedded in a
  losing candidate's free-text label — and asserting the stage fails
  in each case. The API key reaches neither the plan, the candidates, a
  resolved URL, an error message nor a log line, and Pixabay's required
  24-hour response cache is implemented with an injected clock and tested
  at the boundary.

  Both libraries' terms are cleared (card 10): no attribution is required
  in the exported video, cropping and trimming are permitted, and
  commercial use including selling the result is allowed. Rate limits sit
  far above one video's needs. Not in this change: re-resolving and
  downloading the media at render time is implemented and tested as a
  provider method but the frames stage does not call it yet, and neither
  adapter has been run against a live library — every test here uses a
  local mock HTTP server, so no published claim is made about a real
  response.

Stock-footage sourcing is now implemented for two libraries, but the
frames stage still does not download the clips it selects, and the
alignment stage remains unimplemented, as do OAuth-reached model
connections. Script, voice and footage now exist as provider-backed
stages, but nothing yet turns a prompt into a complete plan on its own,
and no release exists.
