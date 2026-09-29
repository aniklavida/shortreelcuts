# ShortReelCuts

**Describe a short video. Get one.**

ShortReelCuts is a self-hosted, open-source web app that turns a prompt into a short vertical video. It writes the script, sources the footage, generates the voiceover, times the captions and composes the video.

Then it **shows you every decision it made**, and lets you change any one of them.

> **There is no release yet.** What runs today is a working pipeline over stub providers and a real encoder: a prompt becomes a real 1080×1920 MP4, and every decision in its plan is listed with a recorded reason. What does not exist yet is a spoken voiceover, downloaded stock footage, and override controls in the browser. Every capability below is labelled with exactly one of **implemented and tested**, **experimental**, **planned** or **unsupported**. Nothing is described here as working unless it was run.

## The idea

Tools that generate short videos tend to ask for the production settings first — video source, clip length, transition style, aspect ratio, voice, speaking rate, caption font, caption position, caption colour, caption size, stroke, background music, music volume. Twenty-odd controls, filled in before you have seen a single frame.

Every one of those is a real choice with a real effect. The problem is not that they exist. The problem is **when** they are asked.

Answered before the first render, they are twenty decisions made blind, by someone who has not yet seen what the machine would have chosen. Answered after, the same twenty are corrections — and most of them never need touching.

The controls do not disappear. They move to the other side of the result.

**The boundary of that claim:** this is a claim about interaction, not about output quality. Nothing here has been compared against any other tool, no output benchmark has been run, and none is published.

## The decision sheet

This is the product. The video plays, and underneath it is every choice that produced it:

```
▸ Script     35s · 4 beats · calm, direct               3 decisions
▸ Voice      Warm female, 1.0×                          2 decisions
▸ Footage    4 clips · vertical                         4 decisions
▸ Captions   3 words at a time · lower third · white    5 decisions
▸ Format     1080×1920 · 30fps · MP4                    3 decisions
```

Five lines, collapsed — enough to confirm at a glance that nothing strange happened.

Open one, and every decision shows three things: **what was chosen**, **why** in one line, and **the smallest control that changes it**. Change the caption colour and the video re-renders. Change the voice and the voiceover is regenerated. Each override tells you which of the two it is *before* you commit to it.

Nothing is destroyed. Every render is a version, so an override you regret is one click back.

## Change one thing, re-run one thing

A video is a **plan** — a document holding every decision — and the renderer is a function of that plan. The same plan always produces the same video, and an override edits the plan rather than starting over.

```
script ──┬──▶ voice ──▶ align ──┐
         └──▶ footage ──────────┴──▶ compose ──▶ 1080×1920 MP4
```

Because the pipeline is a graph, a change re-runs the stages that depend on it and nothing else:

| Change | Re-runs |
|---|---|
| Caption colour, size or position | compose |
| Swap or trim a clip | frames → compose |
| The search term for one beat | footage → frames → compose |
| Voice or speaking rate | voice → align → frames → compose |
| A line of script | voice → align → frames → compose |

That table is the **target** for v1. Which stages re-run is **implemented and tested** — the invalidation function is unit-tested against every row of it. How long each row takes has now been measured on one machine; see [What a video costs](#what-a-video-costs).

## No settings screen

**No control is reachable before the first render.** Not behind an accordion, not under "Advanced". A collapsed settings panel is still a form; it just has a lid.

Every control in ShortReelCuts is defined as an override of something that has already been chosen — and before the first render, nothing has been chosen yet.

## Self-hosted

```
docker compose up
```

Postgres, the web app, the worker. Your projects, plans and finished videos live in your own database and on your own disk. **There is no telemetry** — not opt-out telemetry, none.

Rendering is `ffmpeg`, invoked as a binary on your own hardware, never linked into this code.

The full procedure — every environment variable, both run paths, and what was verified and what was only documented — is in **[the self-hosting guide](docs/SELF_HOSTING.md)**.

> **What was verified.** The plain-process path was run end to end on the machine named below: Postgres, worker and web app as three processes, a prompt submitted through the web app, and a real 10.8-second 1080×1920 H.264/AAC MP4 with captions burned in — the job `done` within about six seconds of submission, with 18 decisions listed, each with a reason. **What was only documented:** the Docker Compose path. It is written from `docker-compose.yml` and the two Dockerfiles, and has not been run, because the machine this documentation was written on has no Docker.

**Your app, your data, your key.** What leaves the machine depends entirely on the model, voice and footage sources you choose to connect — and the next section says exactly what.

## What a video costs

**Before you install anything.** Every stage that can call something outside your machine, and the shape of what that costs. There is no dollar figure anywhere below: none has been measured, and inventing one would be worse than useless.

With nothing configured, **no stage makes any external call at all** — each falls back to a deterministic stub that records in the plan that it did.

| Stage | Calls something external? | Calls per video | What leaves the machine | Cost shape |
|---|---|---|---|---|
| **script** | Yes — your own model, or a local runtime | **1** request per script-stage run | The brief: prompt, target length, tone | **BYOK hosted key: billed by that provider, per token.** A local model: **no API cost** — your own CPU and RAM |
| **voice** | Not yet | **0** | Nothing | **Nothing today.** The voice stage reads its voice list from your own configuration, with no request. The provider's speech call is written and unit-tested but no stage calls it, so a render's audio is a tone, not a voice. When it lands: **1 request per narration line** |
| **footage** | Yes — Pexels or Pixabay, your key | **1** search **per beat** (4 candidates each). Pixabay responses are cached for 24 h, as its terms require | The beat's search term and orientation | **Free tier.** Pexels: **200 requests/hour, 20,000/month**. Pixabay: **100 requests per 60 seconds**. Read from each library's own documentation on 30 Sep 2026. **No attribution required in the exported video** |
| **align** | No, by design | 0 | Nothing | **No API cost — CPU time only.** Intended as a local Whisper-family binary run as a separate process. Not built yet: the stage times words at a flat rate and its own reason says so |
| **frames** | No | 0 | Nothing | CPU time |
| **compose** | No — `ffmpeg`, spawned | 0 | Nothing | **No API cost — CPU time and disk** |

**The short version: a video costs you one model request plus one free stock-library search per beat, and local CPU.** There is no per-video fee anywhere in this system.

### What a change costs, measured

The wall-clock cost of each override, **measured on 30 September 2026 on an Apple M4 Mac mini (10 cores, 16 GB, macOS 26.3), Node 26.8.1, ffmpeg 9.0.1, with every provider stubbed** — 5 runs each, medians:

| Change | Stages re-run | Measured | External cost |
|---|---|---|---|
| Caption words-per-cue | compose | **3.4 s** | none |
| A line of script, typed into the plan | voice → align → frames → compose | **3.2 s** | none, with the stub script |
| Voice speaking rate | voice → align → frames → compose | **3.8 s** | none, with the stub voice |
| One beat's search term | footage → frames → compose | **4.1 s** | 1 search per beat — 0 in this measurement, because footage was stubbed |
| The prompt itself | all six stages | **3.6 s** | 1 model request + 1 search per beat |
| A full run from a prompt, through the worker | all six stages | **4.1 s** | 1 model request + 1 search per beat |

**This is not a hardware requirement table and not a benchmark.** It is one machine, one `ffmpeg` build, and stubbed providers. A row involving a hosted model, a real TTS or a live stock library is a **target, not measured**, and no minimum specification is published, because none has been established on other hardware.

Full method, every raw number, and the complete verified/not-verified list: **[docs/SELF_HOSTING.md](docs/SELF_HOSTING.md)**.

## What is and is not built

| Capability | State |
|---|---|
| Turn a prompt into a 1080×1920 H.264/AAC MP4 with captions burned in and a `.srt` sidecar | **Implemented and tested** — proved end to end and by a real-`ffmpeg` suite |
| Re-render the same plan to a byte-identical file | **Implemented and tested** — asserted against a real encoder |
| Show every decision a stage made, each with a reason, in the web app | **Implemented and tested** — 18 decisions on a 2-beat video, verified in a running app |
| The plan as raw, readable JSON | **Implemented and tested** |
| A worker that runs the graph, resumes after a crash, and survives a browser refresh | **Implemented and tested** against a real Postgres |
| Deciding which stages an edit must re-run | **Implemented and tested** against every row of the table above |
| `docker compose up` bringing up Postgres, worker and web app | **Documented, not run** — see the self-hosting guide |
| Write a script through a model you connect, hosted key or local | **Implemented and tested** against a mock endpoint. **Never called live** |
| Choose a voice from a TTS you connect | **Implemented and tested** against a mock endpoint. **Never called live.** Making the audio is **planned** |
| Search Pexels or Pixabay with your key, one call per beat | **Implemented and tested** against local mock HTTP servers. **Never called live.** Downloading the chosen clip is **planned** |
| Decide where captions sit, word by word, from the real audio | **Experimental.** A flat per-word rate today; its own recorded reason says it is not a measurement of real audio |
| Motion graphics written as code, and AI-generated video | **Planned** |
| Override controls in the browser, with the cost of a change shown before you commit | **Experimental.** The components, the controls and the cost hints are implemented and tested; they are not wired into the web app yet, and their preview app does not currently start (the cause is in the self-hosting guide) |
| Downloading the finished file from the browser | **Planned.** The file is written to the worker's work directory and its path is shown |
| Signing in to an agent subscription you already pay for, as a model or voice source | **Planned** |
| A published release, a demo, a version tag | **Unsupported at this stage** — deliberately not started |

## Your model, your footage

- **Any model you choose.** Bring your own API key, connect an agent subscription you already pay for by signing in, or run a model on your own hardware. The hosted-key and local-runtime halves are implemented; the sign-in half is planned. Cost and output quality depend on the model you connect.
- **Footage chosen per scene, from three sources**, mixed freely in one video, each with your own key:
  - **Motion graphics written as code** — the lead source. The model writes the animation; ShortReelCuts renders it to video on your machine. Planned. Costs the model's tokens plus local render time.
  - **Stock clips** from Pexels or Pixabay, with your key. Implemented as a lookup; downloading and normalising the chosen clip is planned.
  - **AI-generated video** from a generation model you connect, with its cost shown before the scene renders. Planned.

Each stage of the pipeline sits behind an adapter interface — script, voice, footage, alignment, rendering — so a model on your own hardware and a hosted one are both ordinary implementations rather than one being a later port. Beyond that, breadth is a cost: a dozen integrations per slot is a dozen surfaces that can break and a support matrix nobody can test. A new integration enters a slot when someone demonstrates a need for it.

## Not in v1

A desktop app · a hosted tier · talking-head or avatar generation · long-form video · multi-tenancy.

Two of those are **permanent non-goals**, not deferred:

**No auto-publishing to any platform. Not now, not later, not for a fee.** Platform APIs rot faster than anything else in a product like this, and an expired token turns into a support burden for a feature worth little to someone who was going to watch the video before posting it. The finished file is a file. What you do with it is your business.

**No timeline editor.** Override a decision and re-render. The moment there are keyframes, this is a different product for a different user, and the decision sheet stops being the interface. "Let me nudge this" is answered by an override, or by a no.

## Documentation

- **[Self-hosting guide](docs/SELF_HOSTING.md)** — run it, every environment variable, what a video costs, what was verified
- **[Dependency inventory](docs/DEPENDENCIES.md)** — every shipped dependency with its licence and class, and the candidates that were rejected
- [Product specification](docs/SPEC.md) · [Architecture](docs/ARCHITECTURE.md) · [Folder structure](docs/STRUCTURE.md) · [Roadmap](docs/ROADMAP.md) · [Release checklist](docs/RELEASE_CHECKLIST.md)

## Licence

MIT. See [LICENSE](LICENSE). `ffmpeg` is spawned as a separate process and is never linked, so its licence never reaches this codebase or yours.
