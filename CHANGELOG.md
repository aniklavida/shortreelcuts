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

- **`docs/SELF_HOSTING.md`** — the self-hosting guide. Both run paths:
  `docker compose up`, and the three plain processes the repository already
  supports (Postgres, worker, web app) with the exact commands. Every
  environment variable the code reads, one table each, with its default, what
  it does and what leaves the machine. Plus a cost section, a measured
  re-render table, and an explicit list of what was verified against what was
  only documented.
- **`docs/DEPENDENCIES.md`** — the dependency inventory and licence audit.
  Every shipped dependency with its version, its licence, and **where that
  licence was read from** — each package's own `LICENSE` file, or its
  `package.json` metadata where the published tarball ships none. The
  production closure (57 third-party packages) and the development closure
  (102) with a full licence histogram, the spawned-binary table, and the two
  transitive entries that are not MIT/Apache/BSD (`caniuse-lite`, CC-BY-4.0,
  a build-time data file; `lightningcss`, MPL-2.0, development-only and not
  linked) disclosed rather than rounded off. The rejected list is published
  with the reason for each — Remotion, `fluent-ffmpeg`, `ffmpeg-static`,
  `edge-tts`, `piper` and its successor, Coqui TTS — so none of them is
  re-proposed, with each state re-checked on 30 Sep 2026.
- **A measured re-render cost table, published with its machine and its
  date.** The wall clock of every stage set, with every provider stubbed, on
  an Apple M4 Mac mini running macOS 26.3 with ffmpeg 9.0.1: a caption
  override 3.4 s, a typed script line 3.2 s, a voice-rate override 3.8 s, one
  beat's search term 4.1 s, a full six-stage run 4.1 s — five runs each, with
  every raw number published. What drives each one is stated as a rule — one
  `ffmpeg` spawn per beat per run for `frames`, one HTTP request per beat for
  `footage`, one model request for `script` however long the video is.
  Anything involving a hosted model, a real speech engine or a live stock
  library stays labelled a target, and **no hardware requirement table and no
  minimum specification is published**, because one machine is not a
  specification.
- **`SHORTREELCUTS_FFMPEG_PATH` / `SHORTREELCUTS_FFPROBE_PATH` in
  `.env.example`**, documented for the case where a self-hoster's default
  `ffmpeg` was not built with libass — which is this repository's own dev
  environment's situation, and which the worker already reports precisely.

Stock-footage sourcing is implemented for two libraries, but the
frames stage still does not download the clips it selects, and the
alignment stage remains unimplemented, as do OAuth-reached model
connections. Script, voice and footage exist as provider-backed
stages, and a prompt now does turn into a complete plan and a
playable file end to end — but with the deterministic stubs, so the
voiceover is a tone and the footage is a placeholder colour rather
than anything a provider produced. No release exists.

### Changed

- **`README.md` rewritten around what is actually true.** A capability table
  labelling every feature **implemented and tested / experimental / planned /
  unsupported**; the cost section naming every stage that calls something
  external, with the per-video cost as a *shape* — one model request per
  script run, one free stock-library search per beat, nothing else external,
  and no dollar figure anywhere, because none has been measured. **Your app,
  your data, your key**; never "no external services". **No auto-publishing to
  any platform and no timeline editor** are stated as permanent non-goals
  rather than deferred features, and the one comparative line is explicitly
  bounded to interaction rather than output quality. No other project in this
  category is named.
- **`docs/SPEC.md`** — §6's re-render table now separates what is implemented
  and tested (which stages re-run) from what is a target (what it costs), and
  points at the measurement; §13 points at the guide and keeps the hardware
  requirement table absent with the reason restated; §14's UI row corrected —
  it claimed shadcn/ui and Tailwind, and the UI is React with this project's
  own CSS and no framework — and points at the full inventory. The status line
  no longer claims nothing in the document is implemented, which §11 of the
  same document already contradicted.
- **`npm run test:worker` now runs its three files with
  `--fileParallelism=false`.** All three `truncate` the same `jobs` table, so
  in parallel they erased each other's rows mid-run — which is why CI was
  already passing the flag by hand. The documented command is now the one that
  works.

### Verified

- The plain-process path, end to end, on the machine named above: Postgres →
  worker → web app, a prompt submitted through the web app's HTTP API, and a
  real 10.8-second 1080×1920 30 fps H.264/AAC MP4 with captions burned in —
  the job `done` within about six seconds of submission, with all six stages
  reported and 18 decisions listed, each carrying a reason recorded by the
  stage that made it.
- A worker with `SHORTREELCUTS_FOOTAGE_PROVIDER` set and no key **refuses to
  boot**, with a message naming the variable to set.
- `npm run typecheck` clean across all 8 workspaces; `npm test` 385 passed /
  19 skipped; `npm run test:e2e` 7 passed against a real `ffmpeg`;
  `npm run test:worker` 9 passed against a real Postgres; `next build`
  compiles and prerenders.
- **Not run, and documented as not run:** `docker compose up`. No Docker was
  available on the machine this documentation was written on.

### Known

- `npm run dev --workspace @shortreelcuts/sheet` does not currently start.
  Vite's dependency optimizer resolves `unicorn-magic@0.3.0` through its
  browser condition, whose entry point does not export the `toPath` and
  `traversePathUp` that `npm-run-path@6` (via `execa`) imports; Next.js
  resolves the same package through its `node` condition, which is why the web
  app builds and the worker runs. The override components themselves are
  covered by component tests. Not fixed here: the fix belongs to the
  dependency tree, not to the documentation.
