# Self-hosting

Two ways to run this, both from a clean checkout:

| | What you run | Status |
|---|---|---|
| **[A · Docker Compose](#a--docker-compose)** | `docker compose up` — Postgres, worker and web app in containers | **Documented from the files in this repository. Not run.** No Docker was available on the machine this was written and measured on, so every claim in this section is read off `docker-compose.yml`, `infra/Dockerfile.worker` and `infra/Dockerfile.web` — not from a running container |
| **[B · Plain processes](#b--plain-processes)** | Postgres, the worker and the web app as three processes you start | **Verified end to end**, including a finished MP4. Commands, timings and errors below are what actually happened |

The two paths run the same code. The only differences are where Postgres comes from and where the rendered file lands.

## What you get

Three long-lived processes:

| Process | What it does | Where its state lives |
|---|---|---|
| **Postgres** | Projects, plans, job rows, and the queue itself (`pg-boss` runs on this same database — there is no fourth service) | A volume you own |
| **Worker** (`apps/worker`) | Runs the stage graph. Migrations on boot, resumes anything a previous run left unfinished, then subscribes to the queue | `SHORTREELCUTS_WORKER_WORKDIR` |
| **Web app** (`apps/web`) | Next.js. One prompt box, a job-status page, and the plan as JSON | Postgres |

Nothing else is required. There is no telemetry — not opt-out telemetry, none.

## Requirements

| | Version | Notes |
|---|---|---|
| Node.js | **22 or newer** | `engines.node` in the root `package.json`. Verified here on 26.8.1; the compose images use `node:22-bookworm-slim` |
| PostgreSQL | — | Compose uses the `postgres:16-alpine` image; the plain-process path below was verified against 14.22. **No minimum version is claimed**, because only one has been run |
| `ffmpeg` **with libass** | 9.0.1 verified | A binary you already have or install yourself. It is spawned, never linked. Burned-in captions need the `subtitles` filter, which needs libass — if yours lacks it, the worker fails at `compose` with a message naming the problem, and [troubleshooting](#troubleshooting) has the fix |
| `ffprobe` | ships with `ffmpeg` | Used to read back the finished file's real dimensions and duration |

`ffmpeg` and `ffprobe` are resolved from `PATH` unless you point `SHORTREELCUTS_FFMPEG_PATH` and `SHORTREELCUTS_FFPROBE_PATH` somewhere else. This repository downloads no binaries and links no encoder: `ffmpeg-static` is GPL-3.0 and is rejected for exactly that reason — see [the dependency inventory](DEPENDENCIES.md).

## A · Docker Compose

```
git clone <this repository>
cd shortreelcuts
docker compose up
```

That is the whole procedure. The compose file's defaults work with no editing: `POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB` all default to `shortreelcuts`, and the database URL both containers use is derived from them. Copy `.env.example` to `.env` only to change a credential, to point at a different database, or to connect a model, a voice or a stock-footage library.

The web app is then on **http://localhost:3000**.

What the three services do, read off the files:

- **`postgres`** — `postgres:16-alpine`, data in the `postgres-data` volume, with a `pg_isready` healthcheck. The worker and the web app both wait for it to be healthy.
- **`worker`** — built from `infra/Dockerfile.worker` (`node:22-bookworm-slim`, `apt-get install ffmpeg`, `npm ci`, then `npm run worker`). It gets the database URL, its work directory, and the model, voice and stock-footage variables. It publishes no port; it is reached only through the queue.
- **`web`** — built from `infra/Dockerfile.web` (`next build` then `next start`), port 3000 published to the host, and `NEXT_TELEMETRY_DISABLED=1` set for the build and the running server.

Two things about this path are worth knowing before you rely on it, and neither is visible from the compose file alone:

1. **The finished video is in the worker's volume.** The web container does not mount `work-data`, and there is no HTTP route that serves media yet — the job page prints the file's path as text. With compose, the MP4 is at `/data/work/output.mp4` inside the `work-data` volume. `docker compose cp worker:/data/work/output.mp4 .` gets it out. A download button is [planned, not implemented](../README.md#what-is-and-is-not-built).
2. **`SHORTREELCUTS_FFMPEG_PATH` is not passed through by the compose file.** The worker uses the `ffmpeg` its own image installed. If that build turns out to lack libass, add the variable to the `worker` service's `environment:` block and mount a binary that has it.

## B · Plain processes

Verified on the machine named in [the measurement table](#what-a-change-costs-measured) below, on 30 September 2026.

### 1 · Dependencies and a database

```
npm ci
```

Then point at a Postgres you run yourself. `initdb`, `pg_ctl` and `createdb` are enough:

```
initdb -D ./infra/data/pg -U shortreelcuts --auth=trust
pg_ctl -D ./infra/data/pg -o "-p 5432 -c listen_addresses=127.0.0.1" -l ./infra/data/pg/server.log start
createdb -h 127.0.0.1 -U shortreelcuts shortreelcuts
```

`infra/data/` is gitignored — that is why the paths above point into it. Use any directory you like. If 5432 is already taken, start on a free port instead and use that port in the URL in the next step.

### 2 · The worker

```
export SHORTREELCUTS_DATABASE_URL="postgres://shortreelcuts@127.0.0.1:5432/shortreelcuts"
export SHORTREELCUTS_WORKER_WORKDIR="$PWD/infra/data/work"
npm run worker
```

It runs the migrations itself, then prints:

```
[worker] ready
```

If it printed `[worker] resumed N incomplete job(s) from the last run` first, a previous run was interrupted and it picked the work back up.

### 3 · The web app

In a second terminal:

```
export SHORTREELCUTS_DATABASE_URL="postgres://shortreelcuts@127.0.0.1:5432/shortreelcuts"
npm run build --workspace @shortreelcuts/web
npm run start --workspace @shortreelcuts/web
```

Then open **http://localhost:3000**, type a prompt, press **Generate video**.

`npm run dev --workspace @shortreelcuts/web` works too if you would rather not build.

### 4 · Where the file is

`$SHORTREELCUTS_WORKER_WORKDIR/output.mp4`, next to `output.srt` and `output.ass`. The job page shows that path. In the verified run it was a 10.8-second, 1080×1920, 30 fps H.264/AAC MP4 with captions burned in, and the job was observed `done` no more than about six seconds after it was submitted — the six stages themselves accounted for about 4.1 s of that, with every provider stubbed.

### 5 · Checking your install

```
npm run typecheck
npm test
```

Those two need nothing but Node — no database, no encoder, no network. Two opt-in suites do:

```
npm run test:e2e      # real ffmpeg: renders the hand-written plan fixture
npm run test:worker   # real Postgres: the job queue and resumption
```

`test:e2e` needs an `ffmpeg` with libass, so give it the same paths as the worker. `test:worker` needs `SHORTREELCUTS_DATABASE_URL` pointing at a throwaway database — all three of its files `truncate` the `jobs` table, so use a database you do not mind emptying.

## Every environment variable

Nothing else is read. The worker resolves its connections **once, at boot**, and never from the database, a plan or a log line.

### Database and work directory

| Variable | Default | Meaning |
|---|---|---|
| `SHORTREELCUTS_DATABASE_URL` | **required** | Postgres connection string. Read by the worker and by the web app. Inside compose it is derived from the three `POSTGRES_*` values and you never set it |
| `SHORTREELCUTS_WORKER_WORKDIR` | `./.shortreelcuts/work` | Where the worker writes media, frame clips and `output.mp4`. Inside compose, `/data/work` |
| `POSTGRES_USER` | `shortreelcuts` | Compose only: the database user |
| `POSTGRES_PASSWORD` | `shortreelcuts` | Compose only: the database password |
| `POSTGRES_DB` | `shortreelcuts` | Compose only: the database name |

### Script model — one request per script

| Variable | Default | Meaning |
|---|---|---|
| `SHORTREELCUTS_MODEL_BASE_URL` | unset | Root of any OpenAI-chat-completions endpoint. A hosted provider, or a local runtime such as a self-hosted model server |
| `SHORTREELCUTS_MODEL_NAME` | unset | The model to ask for. Required alongside the base URL |
| `SHORTREELCUTS_MODEL_API_KEY` | unset | **Set it for a hosted key. Leave it unset for a local runtime** — that difference is the whole of the "hosted or local" decision. The key reaches the request and nothing else |

All three unset: the worker falls back to a deterministic script stub whose recorded reason says *"Deterministic script stub — no model was called."*

### Voice — no external call at all today

| Variable | Default | Meaning |
|---|---|---|
| `SHORTREELCUTS_VOICE_BASE_URL` | unset | Root of an OpenAI-audio-speech endpoint |
| `SHORTREELCUTS_VOICE_NAME` | unset | The speech model to ask for. Required alongside the base URL |
| `SHORTREELCUTS_VOICE_API_KEY` | unset | Hosted key. Unset means a local server |
| `SHORTREELCUTS_VOICE_IDS` | unset | Comma-separated voice ids the endpoint offers. When set, this list is what the voice stage offers as candidates — and **no request is made to read it**. Unset, six standard voice names are assumed |

All unset: the deterministic voice stub, whose reason says *"no speech engine was called."*

### Stock footage — one search per beat

| Variable | Default | Meaning |
|---|---|---|
| `SHORTREELCUTS_FOOTAGE_PROVIDER` | **no default** | `pexels` or `pixabay`. You choose; nothing here guesses for you |
| `SHORTREELCUTS_FOOTAGE_API_KEY` | unset | That library's own free-tier key. Required once a provider is named — naming a library without a key is refused at boot rather than silently stubbed |
| `SHORTREELCUTS_FOOTAGE_BASE_URL` | unset | Overrides the library's API root, for a caching proxy or a self-hosted mirror |

Unset: the deterministic footage stub, whose reason says plainly that no library was searched and that its asset ids are synthetic. Set a provider with no key and the worker **refuses to start**:

```
[worker] fatal MissingFootageApiKeyError: SHORTREELCUTS_FOOTAGE_PROVIDER is "pexels"
but SHORTREELCUTS_FOOTAGE_API_KEY is not set. Set it, or unset the provider to use the
deterministic footage stub deliberately.
```

That is deliberate. A self-hoster who named their library must not be handed a video of synthetic clip ids.

### Encoder binaries

| Variable | Default | Meaning |
|---|---|---|
| `SHORTREELCUTS_FFMPEG_PATH` | `ffmpeg` on `PATH` | The encoder to spawn |
| `SHORTREELCUTS_FFPROBE_PATH` | `ffprobe` on `PATH` | The prober used to read the finished file |

### Secrets

A key lives in `.env` and nowhere else — not in the database, not in a plan document, not in a log line. A plan is exportable and shareable, so a key inside one would be a leak with legs. The stock-footage adapters go further and store the library's **asset id only**, re-resolving the media URL at render time; a runtime check rejects any candidate or clip that carries a download URL.

## What a video costs

Every stage that can leave the machine, what leaves it, how many calls it makes, and what it costs. **No dollar figure appears anywhere below, because none has been measured and inventing one would be worse than useless.** Cost is given as a shape: how many calls, and what makes the number grow.

With nothing configured, no stage makes any external call at all. Every stage falls back to its deterministic stub and records in the plan that it did.

| Stage | External call | How many per video | What leaves the machine | What it costs |
|---|---|---|---|---|
| **script** | Your model, at `SHORTREELCUTS_MODEL_BASE_URL` | **1** request per script-stage run — a full run, or any override that re-runs the script. Never more than one | The brief: your prompt, the target length, the tone | **Bring-your-own key: billed by that provider, per token.** A local runtime: no API cost, your CPU and RAM instead. The request asks for JSON at temperature 0.2 and **sends no seed**, so a hosted provider may answer the same brief differently each time — whatever comes back is recorded in the plan and re-used, never silently re-rolled |
| **voice** | Your TTS, at `SHORTREELCUTS_VOICE_BASE_URL` | **0** external calls today | Nothing | **Nothing today.** The voice stage asks the provider for its voice list — and that list comes from `SHORTREELCUTS_VOICE_IDS` or six built-in names, with no request. The provider's `speak()` is implemented but **no stage calls it yet**, so a render's audio is a synthesized tone rather than speech. When speech lands the shape is **one request per narration line**, i.e. one per beat, each carrying that beat's text |
| **footage** | Pexels or Pixabay, your key | **1** search request **per beat**, asking for 4 candidates each. A 2-beat video is 2 requests; a 5-beat video is 5. Re-running the footage stage re-issues them. **Pixabay responses are cached for 24 hours** as its terms require, so a repeat of the same search inside that window costs 0 requests | The beat's search term, and the requested orientation | **Free tier, and these limits are generous: Pexels 200 requests/hour and 20,000/month; Pixabay 100 requests per 60 seconds.** Read from each library's own documentation on 30 September 2026. **Neither library requires attribution in the exported video** (licence terms recorded in SPEC §11), and neither charges per clip |
| **align** | Nothing external | **0** | Nothing | **Nothing.** `whisper-cli` (whisper.cpp), run locally as a separate process against the generated narration — CPU time, no API cost. Needs the `whisper-cli` binary and a model file you supply (`SHORTREELCUTS_WHISPER_MODEL`; `SHORTREELCUTS_WHISPER_PATH` if the binary is not on the usual Homebrew paths). Without them the stage falls back to flat-rate timing and its recorded reason says so |
| **frames** | Nothing external | 0 | Nothing | CPU time. Today it synthesizes one placeholder clip per beat |
| **compose** | Nothing external — `ffmpeg`, spawned | 0 | Nothing | **CPU time and disk.** No API cost at all |

Two consequences worth stating plainly:

- **The cost of a video is set by your model connection, and nothing else.** One script request, plus one search per beat against a free stock library, plus local CPU. There is no per-video fee anywhere in this system and no plan that can put you on a metered tier you did not choose.
- **Re-rendering a stage re-makes its calls.** A caption change re-runs compose and costs nothing external. A new voice re-runs the voice stage, which costs nothing external today and one request per beat when speech lands. Only re-running `script` costs a model call.

## What a change costs, measured

The invalidation function — the pure function that says which stages a plan edit must re-run — is unit-tested against every row of the product's table. Its *wall-clock cost* was not, because until now nobody had run it. It has now been run, once, on one machine.

**These numbers were measured on 30 September 2026 on:**

| | |
|---|---|
| Machine | Apple M4 Mac mini, 10 cores (4 performance, 6 efficiency), 16 GB |
| OS | macOS 26.3 (build 25D125) |
| Node | v26.8.1 |
| `ffmpeg` | 9.0.1, Homebrew `ffmpeg-full`, built `--enable-gpl --enable-libass` |
| PostgreSQL | 14.22 |
| Providers | **All stubbed.** No model, no TTS and no stock library was connected, and no network request of any kind was made |

Milliseconds, 5 runs each, median in bold. The first five rows were measured through the decision sheet's own override path — diff the plan, ask the invalidation function which stages must re-run, run exactly those. The last row went through the worker's job runner instead, which is a different entry point and is listed separately for that reason.

| Change | Stages re-run | Measured (ms) | External cost |
|---|---|---|---|
| Caption words-per-cue | `compose` | 3400, 3360, 3427, 3671, 3495 — **3427** | none |
| A line of script, typed straight into the plan | `voice → align → frames → compose` | 3247, 3224, 3201, 3235, 3243 — **3235** | none with the stub script. Note the invalidation function correctly does **not** re-run `script` for an edit to a line it already produced — re-running it would overwrite the line you just typed |
| Voice speaking rate | `voice → align → frames → compose` | 3805, 3855, 3840, 3734, 3746 — **3805** | none **with the stub voice**. A real speech engine adds one request per narration line |
| One beat's search term | `footage → frames → compose` | 4093, 4056, 4018, 4286, 4136 — **4093** | **1 search request per beat.** The measured figure is 0 requests, because the footage stage was stubbed |
| The prompt itself | all six | 3596, 3611, 3579, 3579, 3627 — **3611** | 1 model request + 1 search per beat |
| A full run from a prompt, through the worker's job runner | all six | 4346, 4114, 4169, 4090, 4121 — **4121** | 1 model request + 1 search per beat |

Supporting measurements, same session:

| | Measured |
|---|---|
| `render()` alone on the 8.2-second, 3-beat hand-written fixture plan | 2362, 2301, 2209, 2368, 2332 — **2332 ms** |
| The `compose` stage runner, same fixture (it also synthesizes the stand-in media) | 3051, 3092, 2996, 3019, 3308 — **3051 ms** |
| Where a full stub run's 4.1 seconds go | `compose` 3320–3472 · `frames` 748–865 · `script`, `voice`, `footage`, `align` **under 1 each** — the stubs do no work |
| What drives the size | 5 s target → 2 beats → 3.6 s · 20 s target → 2 beats → 3.6 s · 40 s target → 3 beats → 5.7 s |

**What drives the cost, stated as a rule rather than a number:**

- `compose` scales with **output seconds × pixels**, not with the number of decisions you changed. It is one `ffmpeg` spawn.
- `frames` costs **one `ffmpeg` spawn per beat, per run**. Today every override re-renders every beat's clip, because the per-beat scoping the runner supports is not yet wired into the override path — that is why the caption row above is ~3.4 s rather than ~2.3 s.
- `footage` costs **one HTTP request per beat**. An override that changes a search term is the only kind that adds an external request to a re-render.
- `script` costs **one model request**, however long the video is — and it is the only stage whose result is not reproducible for free: no seed is sent to the model, so a hosted provider may return a different script for the same brief. What came back is recorded in the plan and re-used rather than silently re-rolled.

**This is not a hardware requirement table, and these numbers are not a benchmark.** They are one machine's wall clock with every provider stubbed. A different machine, a different `ffmpeg` build, a real model and a real stock library will all move them. Nothing here has been measured on other hardware, so no claim is made about what this needs to run.

**Target, not measured** — every row that involves a provider nobody has run here:

| | Cost |
|---|---|
| A script from a hosted model | 1 request, billed by that provider per token. Unmeasured against any real model |
| Speech for a video | 1 request per narration line. The voice stage calls `speak()` once a voice connection is configured; tested against a mock endpoint, and no live hosted endpoint has been called |
| A Pexels or Pixabay search | 1 request per beat. Both adapters are tested against local mock HTTP servers; **neither has been called live** |
| Alignment | 0 external calls by design. Runs `whisper-cli` locally when configured; measured max drift 389 ms, mean 72 ms on an Apple M4 Mac mini (macOS 26.3, whisper.cpp `ggml-base`), 30 Sep 2026 — the 150 ms target is not met yet |

## What was verified, and what was not

| | Status |
|---|---|
| `docker compose up` | **Not run.** No Docker on the machine this was written on. Everything in section A is read off the compose file and the two Dockerfiles |
| `npm run typecheck` | **Verified** — clean, all 8 workspaces |
| `npm test` | **Verified** — 385 passed, 19 skipped, 31 files, under 4 s, no database or encoder needed |
| `npm run test:e2e` | **Verified** — 7 passed, ~16 s, real `ffmpeg` |
| `npm run test:worker` | **Verified** — 9 passed against a real Postgres. The three files each `truncate` the `jobs` table, so the root script now runs them with `--fileParallelism=false`; without that flag they truncate each other's rows mid-run |
| `next build` | **Verified** — compiles, typechecks, prerenders |
| Postgres → worker → web app → a finished MP4 | **Verified end to end.** The job was `done` within about six seconds of submission, 18 decisions each carrying a reason, a 10.8-second 1080×1920 H.264/AAC file with captions burned in |
| A worker with a footage provider named but no key | **Verified** — refuses to boot, with the message quoted above |
| The decision-sheet override UI in a browser | **Not verified, and it does not currently start.** `npm run dev --workspace @shortreelcuts/sheet` fails in Vite's dependency optimizer: `execa` → `npm-run-path@6` imports `toPath` and `traversePathUp` from `unicorn-magic@0.3.0`, whose browser-condition entry point exports neither. Next.js resolves the same package through its `node` condition, which is why the web app builds and the worker runs. The override components themselves are covered by component tests; the app that would host them is not wired into `apps/web` yet |
| Any model, TTS or stock library | **Not called.** No live request has been made to any of them, so no claim is published about what a real response contains |
| Any hardware other than the machine above | **Not measured.** No minimum specification is published, because none has been established |

## Troubleshooting

**`ffmpeg at "..." was not built with libass (no "subtitles" filter)`**

The job fails at `compose` with this. Your `ffmpeg` cannot burn in captions. Homebrew's plain `ffmpeg` formula does not include libass; `ffmpeg-full` does. Install a build with `--enable-libass --enable-libfreetype` and point the worker at it:

```
export SHORTREELCUTS_FFMPEG_PATH=/path/to/ffmpeg-full/bin/ffmpeg
export SHORTREELCUTS_FFPROBE_PATH=/path/to/ffmpeg-full/bin/ffprobe
```

Inside compose, add the same two variables to the `worker` service's `environment:` block, pointing at a real path, and mount that binary into the worker. The compose file passes neither variable through today, and an empty value is not the same as an unset one here — set the path, do not pass an empty string.

**`SHORTREELCUTS_DATABASE_URL is not set`**

The worker reads it before anything else and exits. Export it in the same shell you start the worker in — an `.env` file is read by Docker Compose, not by the worker process.

**The web app starts but every job stays `pending`**

The worker is not running, or is pointed at a different database. Its own log ends with `[worker] ready`; if it printed `[worker] fatal`, that line is the reason.

**A job fails at `footage`**

Read the message. A missing key, an unknown provider name and an unparseable response each fail the stage loudly rather than falling back to a stub, on purpose.

**`npm run dev --workspace @shortreelcuts/sheet` fails to start**

Known, and listed in the verification table above. It does not affect the web app, the worker or any test suite.

## See also

- [Dependency inventory and licence audit](DEPENDENCIES.md) — every shipped dependency, its licence and its class, and the candidates that were rejected
- [Product specification](SPEC.md) — §13 self-hosting and cost, §14 dependency policy
- [Architecture](ARCHITECTURE.md) · [Folder structure](STRUCTURE.md)
