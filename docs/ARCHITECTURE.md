# Architecture

**Nothing here is implemented.** This describes the intended design.

## System boundary

```
        browser
           │
           ▼
   ┌───────────────┐        creates a job         ┌──────────────┐
   │    web app    │ ───────────────────────────▶ │    worker    │
   │  Next.js      │ ◀─────────────────────────── │              │
   └───────┬───────┘        streams progress      └──────┬───────┘
           │                                             │
           └──────────────────┬──────────────────────────┘
                              ▼
                      ┌───────────────┐
                      │  PostgreSQL   │  projects · plans · renders · jobs
                      └───────────────┘

                      ┌───────────────┐
                      │  media store  │  local disk by default
                      └───────────────┘

                      ┌───────────────┐
                      │    ffmpeg     │  a binary in the worker image
                      └───────────────┘
```

Three services in the compose file: PostgreSQL, the web app, the worker. `ffmpeg` is a binary inside the worker image, not a service. The job queue runs on the same PostgreSQL, which removes a fourth service for a workload that is one video at a time.

**The worker is separate because a render takes tens of seconds.** A web request must never be the thing holding a render, or a browser refresh cancels work and a timeout looks like a bug.

## The plan is the interface between everything

A video is a plan, rendered. The plan is a validated, versioned, seeded JSON document holding every decision, and the renderer is a function of it: **the same plan always produces the same video.**

```
prompt ──▶ plan ──▶ video
             ▲
             └── every override edits the plan
```

Stages communicate through the plan and nowhere else. A stage that needs something an earlier stage produced reads it from the plan; there are no side channels. That constraint is what makes a stage runnable in a test without a queue, a database or a browser.

The plan is also the unit of storage, of export, of bug reports and of reproducibility. It carries a `planVersion`, and a migration step exists from the first commit — a plan written today must still render after the schema moves.

## The stage graph

```
script ──┬──▶ voice ──▶ align ──┐
         └──▶ footage ──────────┴──▶ compose
```

Each stage takes the plan and returns a plan patch plus the decisions it made. **A stage never chooses silently:** a provider returns candidates, the stage picks, and the stage records the reason. A decision without a recorded reason cannot be displayed, and a decision that cannot be displayed is a product defect rather than a cosmetic one.

### Invalidation is the load-bearing part

When a field of the plan changes, a pure function walks the graph and returns the stages that must re-run — and only those.

This is the mechanism the whole product rests on. A bug here either re-runs too much, which surprises the user with a bill and a wait, or too little, which silently ships a wrong video. It is pure, it is exhaustively unit-tested, and it is tested without running `ffmpeg`.

## Providers

Each stage's external dependency sits behind an interface: script, voice, footage, alignment, rendering, and a media store. **v1 ships one implementation of each.** The interfaces exist from the first commit anyway, because retrofitting a seam after five stages are written is the expensive version of the same decision.

Three boundaries, enforced by tests:

- **A provider returns candidates, never a final choice.** Choosing belongs to the stage, because the stage is what records the reason.
- **A provider declares its capabilities** — voices, aspect ratios, whether it honours a requested duration. The override control is generated from that declaration, so adding a provider never means editing the interface. The moment it does, the adapter boundary has leaked into the UI.
- **A provider never touches the database, the queue or the filesystem.** In, out, and a media handle if it needs bytes.

## Rendering

The renderer is `ffmpeg`, spawned as a binary and never linked. That keeps its copyleft in the separate-process class, where it reaches neither this code nor a user's.

The path is deliberately split so that most of it is testable without spawning anything:

```
plan  ──▶  timeline  ──▶  filter graph  ──▶  ffmpeg
          (pure)          (pure)            (spawned)
```

The timeline compiler is pure and snapshot-tested. That is what makes byte-identical re-rendering checkable in CI, where running an encoder on every commit would not be.

## Determinism

Every plan carries a seed. Every stage that makes a non-deterministic call records its result *in the plan* rather than re-deriving it.

That is why re-rendering a plan produces the same file, why changing one decision changes exactly one thing in the output, and why a bug can be reproduced from an attached plan rather than from a description of what somebody typed.

## Versions, not mutations

A render is an append-only row. Overriding a decision produces a new render alongside the old one rather than replacing it.

Compare, revert and branch fall out of that, and so does the willingness to try an override — which is the behaviour the product depends on. It is a schema decision before it is an interface one.

## Accepted costs

- **The plan document is extra machinery** compared with passing values between functions. It is the price of every decision being addressable, and without it the product is a form with a nicer font.
- **Determinism constrains the stages.** A stage may not quietly re-roll; it records and re-uses. That is stricter than it sounds in practice and has to hold in every stage.
- **The worker must be resumable**, so every stage's output is persisted before the next begins. More writes, and a render that survives a restart.
- **One provider per slot means a provider outage is an outage.** Accepted at v1 — the interface is what makes a second one cheap when a user shows it is needed.
