# ShortReelCuts

**Describe a short video. Get one.**

ShortReelCuts is a free, self-hosted, open-source app that turns a prompt into a short vertical video. You describe what you want. It writes the script, sources the footage, generates the voiceover, times the captions and composes the video.

Then it **shows you every decision it made**, and lets you change any one of them.

> **Pre-implementation.** This repository currently contains the product specification, architecture and structure. **There is no working release yet.** Every capability below is planned unless explicitly marked implemented.

## The idea

Tools that generate short videos tend to ask for the production settings first — video source, clip length, transition style, aspect ratio, voice, speaking rate, caption font, caption position, caption colour, caption size, stroke, background music, music volume. Twenty-odd controls, filled in before you have seen a single frame.

Every one of those is a real choice with a real effect. The problem is not that they exist. The problem is **when** they are asked.

Answered before the first render, they are twenty decisions made blind, by someone who has not yet seen what the machine would have chosen. Answered after, the same twenty are corrections — and most of them never need touching.

> **Other tools make you configure. ShortReelCuts makes you describe.**

The controls do not disappear. They move to the other side of the result.

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

Open one, and every decision shows three things: **what was chosen**, **why** in one line, and **the smallest control that changes it**. Change the caption colour and the video re-renders in seconds. Change the voice and the voiceover is regenerated. Each override tells you which of the two it is *before* you commit to it.

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
| Swap or trim a clip | compose |
| The search term for one beat | footage → compose |
| Voice or speaking rate | voice → align → compose |
| A line of script | voice → align → compose |

That table is a design target for v1, not a measured result — nothing is implemented yet.

## No settings screen

**No control is reachable before the first render.** Not behind an accordion, not under "Advanced". A collapsed settings panel is still a form; it just has a lid.

Every control in ShortReelCuts is defined as an override of something that has already been chosen — and before the first render, nothing has been chosen yet.

## Self-hosted

```
docker compose up
```

Postgres, the web app, the worker. Your projects, plans and finished videos live in your own database and on your own disk. **There is no telemetry** — not opt-out telemetry, none.

Rendering is `ffmpeg`, invoked as a binary on your own hardware.

**Your app, your data, your key.** What leaves the machine depends on the model and footage sources you connect — see [self-hosting and cost](docs/SPEC.md#13--self-hosting-and-cost). This documentation will name every stage that makes an external call and state what a video costs to produce, before anyone installs it. Someone finding out about a bill after installing is the worst outcome this project could produce.

## Your model, your footage

*Planned for v1.0 — none of this is implemented yet.*

- **Any model you choose.** Bring your own API key, connect an agent subscription you already pay for by signing in, or run a model on your own hardware. All three are first-class at v1. Cost and output quality depend on the model you connect.
- **Footage chosen per scene, from three sources**, mixed freely in one video, each with your own key:
  - **Motion graphics written as code** — the lead source. The model writes the animation; ShortReelCuts renders it to video on your machine. Costs the model's tokens plus local render time.
  - **Stock clips** from Pexels or Pixabay.
  - **AI-generated video** from a generation model you connect, with its cost shown before the scene renders.

Each stage of the pipeline sits behind an adapter interface — script, voice, footage, alignment, rendering — so a model on your own hardware and a hosted one are both ordinary implementations rather than one being a later port. Beyond that, breadth is a cost: a dozen integrations per slot is a dozen surfaces that can break and a support matrix nobody can test. A new integration enters a slot when someone demonstrates a need for it.

## Output

1080 × 1920, 30 fps, H.264 + AAC in MP4, with captions burned in and a sidecar `.srt` alongside. One encode. Every short-form platform accepts it.

## Not in v1

A timeline editor · a desktop app · a hosted tier · talking-head or avatar generation · long-form video · auto-publishing to any platform · multi-tenancy.

Two of those are permanent rather than deferred. **Auto-publishing** is not planned at all: platform APIs rot faster than anything else in a product like this, and an expired token turns into a support burden for a feature worth little to someone who was going to review the video before posting it anyway. **A timeline editor** would replace the decision sheet with a different interface for a different user — the answer to "let me nudge this" is an override, or a no.

## Documentation

- [Product specification](docs/SPEC.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Folder structure](docs/STRUCTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [Release checklist](docs/RELEASE_CHECKLIST.md)

## Licence

MIT. See [LICENSE](LICENSE).
