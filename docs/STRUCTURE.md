# Folder structure

**Nothing here exists yet.** This is the intended layout.

## The naming rule

**Use the words engineers already know.** A structure nobody recognises is a structure nobody adopts, and every invented word is something a contributor has to learn before they can help.

So: `apps/`, `packages/`, `providers/`, `schema.ts`, `migrations/`. Nothing here needs a glossary.

Four words carry meaning specific to this product, and all four come from the domain rather than from us:

| Word | Meaning |
|---|---|
| **plan** | The JSON document holding every decision. The unit of work |
| **stage** | One step of the pipeline: script, voice, footage, align, compose |
| **provider** | One implementation of one stage's external dependency |
| **decision** | One field of the plan, with the reason it was chosen. One row on the sheet |

Someone who knows those four words can navigate the whole repository.

## The repository

```
shortreelcuts/
├── apps/
│   ├── web/                  Next.js — the entire user-facing surface
│   └── worker/               the pipeline runner
├── packages/
│   ├── plan/                 the plan schema, versioning, the stage graph
│   ├── stages/               the five stages
│   ├── providers/            adapters, one folder per slot
│   ├── render/               the ffmpeg timeline compiler
│   ├── db/                   schema, migrations, queries
│   └── config/               environment schema and loading
├── infra/                    compose.yaml, container files
├── docs/
├── .github/
└── package.json              workspace root
```

Two applications, six packages. The split is not ceremony: **the worker must run without the web app**, because a render takes tens of seconds and a web request must never be holding it.

## `apps/web`

```
apps/web/
├── app/                            routes only — thin
│   ├── page.tsx                    the prompt. One text box
│   ├── projects/[id]/page.tsx      the video and the decision sheet
│   ├── projects/[id]/plan/page.tsx the plan editor
│   └── api/                        job creation, job status stream, overrides
├── components/
│   ├── prompt/                     the first screen
│   ├── sheet/                      THE DECISION SHEET
│   │   ├── DecisionGroup.tsx       one collapsible group
│   │   ├── DecisionRow.tsx         what · why · change
│   │   ├── OverrideControl.tsx     resolved from the provider's capabilities
│   │   └── CostHint.tsx            "re-renders in about 4 seconds"
│   ├── progress/                   stage by stage, feeding the sheet as it goes
│   └── player/
└── lib/                            client-side plan helpers
```

**`app/` holds route entry points and nothing else.** The real code lives in `components/` and in packages, so a route can be renamed without dragging logic along.

**`components/sheet/` is where the product lives.** If you are unsure whether a change belongs in this repository, the question to ask is whether it makes the sheet better.

**`OverrideControl` is resolved, never hard-coded.** A provider declares its capabilities and the control is chosen from that declaration. Adding a provider must not mean editing the interface.

## `apps/worker`

```
apps/worker/
├── index.ts        subscribes to the queue
├── run.ts          executes a plan through the stage graph
└── invalidate.ts   given a changed field, decides which stages re-run
```

Small on purpose. The worker orchestrates; the actual work lives in `packages/stages`, so a stage runs in a test without a queue.

**`invalidate.ts` is what makes overrides cheap.** It reads the changed plan path, walks the graph, and returns the stages to re-run. It is pure and exhaustively unit-tested, because a bug here either re-runs too much — an unexpected wait and an unexpected bill — or too little, which silently ships a wrong video.

## `packages/plan`

```
packages/plan/
├── schema.ts       the schema for the plan document
├── graph.ts        stage dependencies, and which plan paths belong to which stage
├── decisions.ts    plan path → a human-readable decision row
└── migrate.ts      planVersion N → N+1
```

**`decisions.ts` is the bridge between the pipeline and the interface.** It maps a plan path such as `footage.b2.assetId` to the row the user reads: the label, the reason, the control, and the cost of changing it.

Keeping that mapping in one file gives the acceptance criterion *every field in the plan appears on the sheet* a single place to be tested, rather than a promise spread across components.

`migrate.ts` exists from the first commit. A plan is stored, exportable and shareable; one written today must still render after the schema moves.

## `packages/stages`

```
packages/stages/
├── script/     prompt → beats, narration, on-screen text, search terms
├── voice/      narration → audio, per line
├── footage/    search terms → chosen clips
├── align/      audio + text → word-level timings
└── compose/    plan + media → MP4
```

Each stage exports one function with the same shape: it takes the plan and the resolved media, and returns a plan patch plus the decisions it made.

**A stage never chooses silently.** A provider returns candidates; the stage picks and records the reason in the patch. A decision without a reason cannot appear on the sheet.

## `packages/providers`

```
packages/providers/
├── types.ts        the interfaces, and the capability declarations
├── script/
├── voice/
├── footage/
├── align/
└── render/         ffmpeg
```

One folder per slot — **and the folder is plural from the first commit**, because a slot with a folder is a slot somebody can add to without asking permission. The footage slot is planned to hold three sources at v1 (stock, generated video, motion graphics written as code), and script and voice a provider-neutral model connection covering hosted and local models.

Three rules, enforced by tests:

1. **A provider imports nothing from `apps/`, `packages/db` or `packages/stages`.** In, out, and a media handle. The moment a provider reaches the database, the second implementation becomes a rewrite.
2. **A provider returns candidates, never a final choice.**
3. **A provider declares its capabilities.**

## `packages/render`

```
packages/render/
├── timeline.ts     plan → an ordered timeline of clips, audio and caption cues
├── filtergraph.ts  timeline → an ffmpeg filter graph
├── captions.ts     word timings → cues, styled from the plan
└── run.ts          spawns ffmpeg, streams progress
```

Separate from `packages/providers/render` on purpose: the provider is the seam, this is the implementation behind it. Replacing the renderer means replacing this package and keeping the interface.

**`timeline.ts` is pure and snapshot-tested.** A plan produces a timeline, and the timeline is asserted without spawning anything — which is what makes the byte-identical re-render criterion testable in CI, where running an encoder on every commit would not be.

## `packages/db`

```
packages/db/
├── schema.ts       projects · plans · renders · media · jobs
├── migrations/
└── queries/
```

A render is a row, not a mutation. `renders` is append-only, which is what gives the sheet its history and its revert.

## `infra`

```
infra/
├── compose.yaml    postgres · web · worker
└── Dockerfile.*
```

Three services. `ffmpeg` is a binary inside the worker image. No Redis — the queue runs on the same PostgreSQL.

## Conventions

1. **The plan is the only shared state between stages.** No side channels.
2. **`app/` holds routes only.**
3. **Every decision carries a reason string.** Not optional, not nullable — a decision without a reason cannot be displayed, and a decision that cannot be displayed violates the product.
4. **Providers never import the database.**
5. **Pure code is tested without `ffmpeg`.** The timeline compiler, the stage graph and the invalidation function are all pure; end-to-end rendering is a separate, slower suite.
6. **`planVersion` goes up whenever the schema changes**, and a migration step is added. A stored plan must always render.
