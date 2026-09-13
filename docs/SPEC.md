# ShortReelCuts — product specification

**Status: draft. Nothing in this document is implemented.** Every capability described is planned. Where a table describes intended behaviour it is labelled a target, not a result.

## 1 · What it is

A self-hosted web app that turns a prompt into a short vertical video.

You describe what you want. It writes the script, sources the footage, generates the voiceover, times the captions and composes the video. Then it shows you every decision it made, and lets you change any one of them.

One text box in. A 1080 × 1920 MP4 out, plus a readable account of how it got there.

## 2 · The differentiator

> **Other tools make you configure. ShortReelCuts makes you describe.**

Tools that generate short videos tend to ask for the production settings first — video source, clip length, transition style, aspect ratio, voice, speaking rate, caption font, position, colour, size, stroke, background music, music volume. Twenty-odd controls, before a single frame exists.

Every one of them is a real choice with a real effect. The problem is not that they exist. The problem is **when** they are asked.

| | Settings-first | ShortReelCuts |
|---|---|---|
| Before the first render | ~20 controls | 1 text box |
| After the first render | Change a control, run the whole thing again | Every choice listed, explained, individually overridable — re-rendering only what moved |
| Who chose the defaults | You did, blind | The generator did, visibly, and you can disagree |

The controls do not disappear. They move to the other side of the result.

**The honest boundary of this claim:** ShortReelCuts is not claiming better output. It is claiming a better interaction. Output quality will be judged on shipped videos, and there are none yet.

## 3 · Who it is for

- **Someone with an idea and no video skills.** They want a video about a thing. They should not have to learn what "concat mode" means first.
- **Someone who makes a lot of these.** They know what they want, they are tired of filling in the same form, and they would rather correct three things than specify twenty.
- **A company that wants this inside its own product.** MIT, self-hosted, adapter-shaped. Nothing forces a vendor on them.

**Not for professional editors.** They have editors. This is not one — see §12.

## 4 · The problem

Turning an idea into a short vertical video is a five-step job: write it, find pictures for it, say it out loud, put the words on screen, stitch it together. Every step is mechanical enough for a machine.

Tools exist that do all five. They also require the production parameters of a video that does not exist yet, which means:

1. **A first-time user cannot start.** The form is a vocabulary test.
2. **A frequent user repeats themselves.** The same fields, every run, mostly at their defaults.
3. **A wrong choice costs a full re-run.** There is no "change this one thing", only "submit the form again".

The third is the expensive one, and §5 and §6 exist to fix it.

## 5 · The plan document

**A ShortReelCuts video is a plan, rendered.**

The plan is a validated JSON document holding every decision — the script, the shot list, the voice, the caption style, the format, the seed. The renderer is a function of the plan: **the same plan always produces the same video.**

```
prompt ──▶ plan (JSON, versioned, seeded) ──▶ video
                    ▲
                    └── every override edits the plan, not the video
```

This is not incidental structure. It is what the rest of the product stands on:

- **"Change one decision" needs something to change.** Without an addressable plan, an override is just a re-run with different form values.
- **"Re-render only what moved" needs a dependency graph**, and the plan is where it lives.
- **"Show me every decision" needs the decisions to be data**, not the transient internals of a function call.
- **A bug report is a plan file**, not a description of what somebody typed.

Sketch, illustrative rather than final:

```jsonc
{
  "planVersion": 1,
  "seed": 41207,
  "brief":  { "prompt": "...", "targetSeconds": 35, "tone": "calm" },
  "script": { "hook": "...", "beats": [ { "id": "b1", "narration": "...",
                                          "onScreen": "...", "search": "..." } ] },
  "voice":  { "provider": "...", "voiceId": "...", "rate": 1.0 },
  "footage":{ "b1": { "provider": "...", "assetId": "...", "in": 0.0, "out": 4.2 } },
  "captions": { "style": "...", "position": "lower-third", "wordsPerCue": 3 },
  "format": { "width": 1080, "height": 1920, "fps": 30, "container": "mp4" }
}
```

Every field in that document is a row on the decision sheet.

## 6 · Pipeline

Five stages. Each is an adapter slot, each writes into the plan, each declares what it depends on.

```
   prompt
     │
     ▼
 ┌─────────┐   script, beats, on-screen text, search terms
 │ SCRIPT  │
 └────┬────┘
      ├──────────────────────────┐
      ▼                          ▼
 ┌─────────┐                ┌─────────┐
 │  VOICE  │                │ FOOTAGE │
 └────┬────┘                └────┬────┘
      ▼                          │
 ┌─────────┐  word-level timings │
 │  ALIGN  │                     │
 └────┬────┘                     │
      └──────────┬───────────────┘
                 ▼
            ┌─────────┐
            │ COMPOSE │
            └────┬────┘
                 ▼
            1080×1920 MP4
```

**The dependency graph is the feature.** It is what makes an override cheap.

**Target for v1, not a measured result:**

| Change this | Re-runs | Expected cost |
|---|---|---|
| Caption colour, size, position | compose | seconds, free |
| Swap one clip | compose | seconds, free |
| Crop or trim a clip | compose | seconds, free |
| The search term for one beat | footage → compose | seconds, one lookup |
| Voice, or speaking rate | voice → align → compose | tens of seconds |
| Any script line | voice → align → compose (+ footage if the search term moved) | tens of seconds |
| The prompt itself | everything | a full run |

**No stage re-runs because an unrelated stage changed.** That rule is enforced by the graph, not by discipline — it is the difference between a decision sheet people use and one they are afraid of.

Stages run in a worker, not in a web request. A browser refresh never loses a render.

## 7 · Adapter interfaces

One interface per slot, from the first commit, even while only one implementation of each exists. Retrofitting a seam after five stages are written is the expensive version of this decision.

Shapes, not final signatures:

```ts
interface ScriptProvider {
  id: string;
  generate(brief: Brief, seed: number): Promise<ScriptPlan>;
}

interface VoiceProvider {
  id: string;
  voices(): Promise<VoiceDescriptor[]>;              // populates the override control
  speak(lines: NarrationLine[], v: VoiceChoice): Promise<AudioTrack[]>;
}

interface FootageProvider {
  id: string;
  search(term: string, constraints: Constraints): Promise<FootageCandidate[]>;
  fetch(assetId: string): Promise<MediaHandle>;
}

interface Aligner {
  id: string;
  align(audio: AudioTrack, text: string): Promise<WordTiming[]>;
}

interface Renderer {
  id: string;
  render(plan: Plan, media: ResolvedMedia): Promise<VideoFile>;
}

interface MediaStore {
  put(key: string, data: Readable): Promise<void>;
  url(key: string): Promise<string>;
}
```

Three rules keep these honest:

1. **A provider returns candidates, never a final choice.** The stage picks and records *why* in the plan, so the decision sheet has something to show. A provider that decides silently produces an unexplainable video.
2. **Every provider declares its capabilities** — available voices, supported aspect ratios, whether it can honour a requested duration. The override control is generated from that declaration, so adding a provider never means editing the interface.
3. **No provider touches the database, the queue or the filesystem.** In, out, and a `MediaStore` handle if it needs bytes. Otherwise the second implementation of any slot becomes a rewrite.

## 8 · What the user sees

### Screen 1 — the prompt

One text box. A Generate button. Optionally a duration chip, because "make it 30 seconds" is the one constraint people actually have in mind before they start.

**Nothing else. No accordion labelled Advanced.** A collapsed settings panel is still a form with a lid on it. The commitment is that **no setting is reachable before the first render**, because every setting is defined as an override of something already chosen — and before the first render, nothing has been chosen.

### Screen 2 — the video and the decision sheet

The video plays. Below it, or beside it on a wide screen, is the sheet:

```
▸ Script     35s · 4 beats · calm, direct               3 decisions
▸ Voice      Warm female, 1.0×                          2 decisions
▸ Footage    4 clips · vertical                         4 decisions
▸ Captions   3 words at a time · lower third · white    5 decisions
▸ Format     1080×1920 · 30fps · MP4                    3 decisions
```

Collapsed, it is five lines — the summary a returning user reads in two seconds.

Expanded, every decision shows three things:

```
  Clip for beat 2 — "hands typing on a laptop"
  Chosen because the beat mentions writing code           [ Change ▾ ]
  ┌──────┐┌──────┐┌──────┐┌──────┐
  │ ✓    ││      ││      ││      │   ← the other candidates it did not pick
  └──────┘└──────┘└──────┘└──────┘
```

1. **What was chosen**, in plain language rather than as a config key.
2. **Why** — one line, recorded by the stage that made the call when it made it, not rationalised afterwards.
3. **How to change it** — the smallest control that does the job, shown only once opened.

Each override states its cost before you commit: *"Re-renders in about 4 seconds"*, or *"Regenerates the voiceover — about 30 seconds"*. People tolerate an expensive change they were warned about and resent a cheap one that surprised them.

### Screen 3 — the plan

The raw plan JSON, editable, with a Re-render button. For the power user, for the bug report, and as a promise that nothing is hidden.

It is third for a reason: it is where people who already know exactly what they want go directly, and the last place anyone else will ever need.

## 9 · Interaction principles

Six rules. They are written to be testable.

1. **Every control is an override, never a prerequisite.** A control reachable before the first render is a bug against this specification.
2. **Every decision is attributable.** If the sheet cannot say why something was chosen, the stage is not recording enough — the stage is wrong, not the interface.
3. **The cost of a change is shown before the change.**
4. **Overrides are per project, never global.** A caption colour chosen here does not silently become a preference that changes the next video. Global preferences are settings-first through the back door.
5. **Nothing is destroyed.** Every render is a version: compare, revert, branch. An override you regret is one click back, which is what makes people willing to try one.
6. **Progressive disclosure is depth, not hiding.** Level 0 is a text box. Level 1 is the five-line summary. Level 2 is one decision and one control. Level 3 is the plan. A user stops wherever their question is answered, and nothing deeper is required to finish.

## 10 · Progress

A render takes tens of seconds at best. That time is the first chance to show that decisions are being made rather than that something is churning.

Stages report as they complete, and each drops its decisions into the sheet immediately:

```
✓ Script     4 beats, 34s              ← the sheet already shows the script decisions
✓ Voice      warm female, 1.0×
◐ Footage    3 of 4 clips
· Align
· Compose
```

**The sheet is the progress indicator, not a panel that appears afterwards.** By the time the video is ready, the user has already been reading it.

A render is resumable from its last completed stage. Closing the browser does not cancel a job.

## 11 · Models and footage sources

Five slots. **All of this is planned for v1.0; none of it is implemented.**

| Slot | Planned for v1.0 |
|---|---|
| Script | **Any language model you choose.** A hosted model with your own API key, an agent subscription you already pay for connected by signing in, or a model running on your own hardware. All three are first-class at v1 |
| Voice | **A speech model you choose**, hosted with your own key or running on your own hardware |
| Footage | **Chosen per scene, from three sources**, which can be mixed in one video: stock clips from Pexels or Pixabay with your own API key · AI-generated video from a generation model you connect · **motion graphics written as code** by the model you connected, rendered to video |
| Align | a Whisper-family runtime, run as a separate process |
| Render | `ffmpeg` |

**Motion graphics written as code are the lead footage source**, not an add-on: animated text, diagrams, charts and illustrations that the model writes as animation code and ShortReelCuts renders into frames, so a scene can show exactly what the narration says rather than the nearest stock clip.

**The model is your choice, not a list this project maintains.** Script and voice sit behind a provider-neutral interface, so a hosted API and a model on your own hardware are both ordinary implementations of it rather than one being a later port. Local models run as a separate process.

**Everywhere else, breadth is still a cost.** A dozen interchangeable integrations per slot is a dozen surfaces that can break, a dozen sets of credentials to document, and a support matrix nobody can test. The interfaces make adding one cheap; **a new integration enters a slot when a user demonstrates a need for it, not when it exists.**

## 12 · Non-goals

Not a timeline editor · not a desktop app · not a hosted service · not a talking-head or avatar generator · not a long-form video tool · not an auto-publisher to any platform · not multi-tenant.

Two are permanent rather than deferred:

**Auto-publishing.** Platform APIs rot faster than anything else in a product like this, and an expired token becomes a support burden for a feature worth little to someone who was going to review the video before posting it.

**A timeline editor.** Override a decision and re-render. The moment there are keyframes, this is a different product for a different user, and the decision sheet stops being the interface.

## 13 · Self-hosting and cost

```
docker compose up
```

Postgres, the web app, the worker.

| Component | Where it runs | Cost |
|---|---|---|
| Web app and worker | Your machine | None |
| Postgres | Your machine | None |
| `ffmpeg` | Your machine, as a binary | None. CPU time |
| Media files | Your disk, behind a `MediaStore` interface | Disk |
| Script and voice | The model you connect — a hosted API, or your own hardware | Hosted: billed by that provider to your key or subscription. Local: your hardware |
| Footage | Per scene: a stock library, a generation provider, or your machine | See below |

Both questions that decide this bill are settled. **Planned for v1.0, not implemented:**

1. **Models: whichever you choose, hosted or on your own hardware.** Bring your own API key, connect an agent subscription you already pay for by signing in, or run a model locally. With a hosted model, the prompt and the script text are sent to that provider. With a local model, they do not leave the machine. **Cost and output quality depend on the model you connect.**
2. **Footage: three sources, each with your own key, chosen per scene.**

| Footage source | What leaves the machine | What it costs |
|---|---|---|
| Stock clips (Pexels, Pixabay) | The scene's search term, to that library | Free within the library's API limits. Its terms of use will be stated here before stock footage ships |
| AI-generated video | The scene description, to the generation provider you connect | Billed per clip by that provider. **Shown before the scene renders** |
| Motion graphics written as code | The request to the model you connected, as for the script | The model's tokens, plus render time on your machine |

**This documentation will state exactly which stages make an external call and what a video costs to produce, before anyone installs.** Nobody should find out about a bill after installing.

**Hardware requirements are deliberately absent.** Video encoding is CPU-heavy and alignment may want a GPU, but nobody has measured this on real machines. A guess published in a README reads as a specification, so there is no table here until there is a measurement.

## 14 · Dependency policy

**Every dependency is licence-audited before it enters**, because a self-hoster inherits every obligation the project takes on. Two classes, audited differently:

| Class | Rule |
|---|---|
| Compiled into this code or a user's | **MIT / Apache / BSD only** |
| Run as a separate process, or invoked as a binary | Copyleft acceptable — it never reaches anyone's source |

That split is why `ffmpeg` is fine while a company-size-gated renderer is not. The question is never "is it good" but **"does a self-hoster inherit an obligation they did not choose"**.

Verified through the GitHub API and by reading licence files, 13 Sep 2026:

| Concern | Choice | Licence | Class |
|---|---|---|---|
| Web app | Next.js | MIT | compiled |
| UI | shadcn/ui + Tailwind | MIT | compiled |
| Schema validation | zod | MIT | compiled |
| Database | PostgreSQL + Drizzle | PostgreSQL / Apache-2.0 | process / compiled |
| Queue | pg-boss, on the same PostgreSQL | MIT | compiled |
| Spawning binaries | execa | MIT | compiled |
| Rendering | **`ffmpeg`, invoked as a binary** | LGPL v2.1+ by default; GPL v2+ only when built with `--enable-gpl` | **process** |
| Alignment | a Whisper-family runtime | MIT or BSD-2-Clause depending on which | **process** |

**Rejected, with the reason recorded so they are not re-proposed:**

| Candidate | Verified state | Why |
|---|---|---|
| **Remotion** | Not an OSI licence. Its `LICENSE.md` grants free use to individuals and to for-profit organisations with **up to 3 employees**; a paid company licence is required above that, and derivative products are restricted | The obvious TypeScript renderer for this job, and **every self-hoster would inherit a company-size-gated commercial obligation**. Disqualifying regardless of quality |
| **`fluent-ffmpeg`** | MIT, but the repository is archived — last push 2025-05-22 | Unmaintained. Spawn `ffmpeg` through `execa` instead |
| **`ffmpeg-static`** | GPL-3.0 | The convenient binary downloader is GPL-3.0. Require a system `ffmpeg` instead |
| **`edge-tts`** | LGPLv3 apart from one MIT file | Copyleft, and it depends on a third party's undocumented speech endpoint. A self-hosted product whose voice needs someone else's service is not self-hosted |
| **Coqui TTS** | MPL-2.0, last push 2024-08-16 | Unmaintained for over two years |
| **`piper` (original repository)** | MIT, but archived. Its successor is GPL-3.0 | Archived. The successor is usable only as a separate process |

**The pattern worth naming:** the licence traps sit exactly where the convenience is. The easiest renderer, the easiest `ffmpeg` wrapper and the easiest speech engines are all disqualified — some by licence, some by abandonment. Every dependency goes through the audit before it is added, and **checking that a project is still maintained is part of the audit, not a separate courtesy**.

## 15 · Output

| | v1 |
|---|---|
| Resolution | 1080 × 1920 |
| Frame rate | 30 fps |
| Codec | H.264 video, AAC audio |
| Container | MP4 |
| Captions | burned in, plus a sidecar `.srt` |
| Delivery | download the file |

One encode, no second pass. Every short-form platform accepts this. Captions are burned in because most platforms do not render a sidecar; the sidecar ships anyway because it costs nothing.

Other aspect ratios are an override on the format group, not a v1 promise — each one means the footage crop logic has to be right for a shape that has not been tested.

## 16 · Data and privacy

- Projects, plans and media live in your PostgreSQL and on your disk.
- Nothing is sent anywhere except to the providers you connect. §13 lists which stages can leave the machine for each choice. With local script and voice models and motion-graphics footage, nothing is planned to leave it; a stock scene sends only its search term.
- **No telemetry.** Not opt-out telemetry — none.
- Secrets live in `.env` and never in the database, the plan document or a log line. A plan is exportable and shareable, so a key inside one would be a leak with legs.

## 17 · v1 acceptance criteria

Binary. Every one is something a person can watch happen.

- [ ] A prompt alone, with no other input, produces a playable 1080 × 1920 MP4 with voiceover and burned-in captions.
- [ ] **No setting is reachable before the first render.** Verified by walking the interface, not by assertion.
- [ ] After a render, **every** field in the plan document appears on the decision sheet. A field present in the plan and absent from the sheet fails this.
- [ ] Every decision on the sheet shows a reason recorded by the stage that made it.
- [ ] Changing a caption colour re-runs **compose only**, proved by stage logs rather than by timing.
- [ ] Changing the voice re-runs **voice → align → compose only**.
- [ ] Swapping a clip re-runs **compose only**.
- [ ] Every override shows its cost before it is applied.
- [ ] Re-rendering the same plan twice produces byte-identical output.
- [ ] Editing the plan JSON directly and re-rendering produces the corresponding video.
- [ ] Caption word timings stay within **150 ms** of the spoken word across a full render, measured on a fixed test script.
- [ ] A browser refresh mid-render loses nothing; the job continues and reattaches.
- [ ] `docker compose up` from a clean checkout renders a video with no manual step beyond filling in `.env`.
- [ ] Every shipped dependency passes the licence audit and is listed with its licence.
- [ ] The README states exactly what leaves the machine and what a video costs to produce.
- [ ] Every public claim has working evidence or is labelled planned. **No benchmark, support matrix or provider result appears unless a person has run it.**

## 18 · Risks

- **The decision sheet is unproven, and it is the whole thesis.** If people ignore it and just regenerate until something is acceptable, the differentiator exists on paper and not in practice. It needs testing with real users while the pipeline is still cheap to change.
- **Alignment is the hardest stage.** 150 ms of caption drift looks broken to a viewer even when everything else is right, and it is the acceptance criterion most likely to fail.
- **Footage relevance is the standing complaint about every tool of this kind**, and a stock library caps it structurally. That is why each scene can instead use generated video or motion graphics written as code (§11) — and why those two sources have to be good, not just present.
- **Cost lands on the self-hoster.** It depends on the model and footage sources they connect, and §13 has to state it before they install.
- **Code written by a model is untrusted.** Motion-graphics code is generated, so rendering it must not be able to reach the network or the filesystem, and it must render the same frames every time for the same plan.
- **Scope creep toward an editor.** Every "just let me nudge this" request points at a timeline. The answer is an override, or a no.
- **Writing the pipeline from scratch is the slow path.** Five stages, each with real failure modes — weak scripts, wrong footage, flat delivery, drifting captions, encoder edge cases. v1 output will be rough before it is good, and the decision sheet has to be worth that.
