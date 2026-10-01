# Dependency inventory and licence audit

**Every dependency is inherited by everyone who self-hosts this.** A self-hoster should be able to read this page and know exactly what obligation, if any, they are taking on. Nothing here was copied from a note: every licence below was read from the installed package's own `LICENSE` file, or from its `package.json` metadata where the published tarball ships no licence file, on **30 September 2026**, from the tree installed in this repository and resolved by its `package-lock.json`.

## The rule

Two classes, audited differently. The question is never "is it good" — it is **"does a self-hoster inherit an obligation they did not choose"**.

| Class | Rule |
|---|---|
| **Compiled into this code or a user's** | **MIT, Apache or BSD only** |
| **Run as a separate process, or invoked as a binary** | Copyleft is acceptable — it never reaches anyone's source |

Anything reciprocal-for-consumers, revenue-gated or company-size-gated is rejected regardless of quality. **Checking that a project is still maintained is part of the audit, not a separate courtesy** — an archived dependency is rejected too.

## How to re-verify this yourself

The inventory below is generated from the installed tree, not maintained by hand:

```
npm ci
node -e 'const p=require("./node_modules/<name>/package.json"); console.log(p.version, p.license)'
```

Transitive closures were walked from each workspace's `dependencies` (57 third-party packages) and `devDependencies` (102) through `node_modules`, reading each resolved package's `license` field. Nothing was taken from a lockfile comment or a previous audit.

## Shipped: direct dependencies

Every one is **compiled into this code or a user's**, so every one must be MIT, Apache or BSD. All are.

| Package | Version | Licence | Verified from | Used for | Declared in |
|---|---|---|---|---|---|
| `next` | 16.3.6 | MIT | `node_modules/next/license.md` | The web app | `apps/web` |
| `react` | 19.3.0 | MIT | `LICENSE` | The decision sheet's components | `apps/web`, `packages/sheet` |
| `react-dom` | 19.3.0 | MIT | `LICENSE` | React's DOM renderer | `apps/web`, `packages/sheet` |
| `pg-boss` | 12.31.1 | MIT | `LICENSE` | The job queue, on the same Postgres | `apps/web`, `apps/worker` |
| `pg` | 8.23.0 | MIT | `LICENSE` | Postgres client | `packages/db` |
| `drizzle-orm` | 0.45.2 | Apache-2.0 | `package.json` metadata — **the published tarball ships no licence file** | Query builder over `pg` | `packages/db` |
| `zod` | 4.6.4 | MIT | `LICENSE` | The plan schema, and provider response validation | `packages/plan`, `packages/providers` |
| `execa` | 10.0.1 | MIT | `node_modules/execa/license` | Spawning `ffmpeg` and `ffprobe` | `packages/render` |
| `@fontsource/space-grotesk` | 5.3.0 | OFL-1.1 | `node_modules/@fontsource/space-grotesk/LICENSE` | Self-hosted display face for wordmark and titles | `apps/web` |
| `@fontsource/manrope` | 5.3.0 | OFL-1.1 | `node_modules/@fontsource/manrope/LICENSE` | Self-hosted UI face for body, labels, and controls | `apps/web` |
| `lucide-react` | 1.49.0 | ISC | `node_modules/lucide-react/LICENSE` | Interface iconography | `apps/web` |

## Development and build-time dependencies

These do not reach a user's application code, but they *are* installed by `npm ci` — including inside the compose images, which run `npm ci` before building. Audited the same way.

| Package | Version | Licence | Verified from |
|---|---|---|---|
| `typescript` | 7.0.2 | Apache-2.0 | `LICENSE` |
| `vitest` | 5.0.0 | MIT | `LICENSE.md` |
| `vite` | 8.3.0 | MIT | `LICENSE.md` |
| `@vitejs/plugin-react` | 6.1.1 | MIT | `LICENSE` |
| `tsx` | 4.23.15 | MIT | `LICENSE` — this is how the worker runs TypeScript source with no build step |
| `jsdom` | 30.0.1 | MIT | `LICENSE.txt` |
| `@testing-library/react` | 16.3.3 | MIT | `LICENSE` |
| `@testing-library/jest-dom` | 7.0.1 | MIT | `LICENSE` |
| `@testing-library/user-event` | 14.6.7 | MIT | `LICENSE` |
| `@types/node` | 22.20.2 | MIT | `LICENSE` |
| `@types/react` | 19.3.0 | MIT | `LICENSE` |
| `@types/react-dom` | 19.3.0 | MIT | `LICENSE` |
| `@types/pg` | 8.23.1 | MIT | `LICENSE` |

## Transitive dependencies

Walked from the tables above. Full closure, licence as declared by each installed package:

| | Production closure | Development closure |
|---|---|---|
| Third-party packages | **57** | **102** |
| MIT | 44 | 84 |
| Apache-2.0 | 5 | 5 |
| ISC | 4 | 4 |
| BSD-3-Clause | 1 | 2 |
| BSD-2-Clause | 0 | 2 |
| 0BSD | 1 | 0 |
| MIT-0 | 0 | 2 |
| MIT **or** CC0-1.0 (`type-fest`, a dual offer) | 1 | 0 |
| CC0-1.0 | 0 | 1 |
| BlueOak-1.0.0 (`lru-cache`) | 0 | 1 |
| **MPL-2.0 (`lightningcss`)** | **0** | **1** |
| **CC-BY-4.0 (`caniuse-lite`)** | **1** | — |

Two entries in that table are not MIT/Apache/BSD, and both are disclosed rather than rounded off:

**`caniuse-lite` (CC-BY-4.0), in the production closure.** A browser-support **data** file, pulled in by `next` and read at build time to decide which transforms to apply. It is not code linked into your application, it is not redistributed with it, and CC-BY-4.0 requires only attribution — which this page gives. It cannot be removed without patching Next.js.

**`lightningcss` (MPL-2.0), development only.** A native CSS transformer that `vite` shells out to. MPL-2.0 is file-level weak copyleft: it obliges anyone who *modifies lightningcss's own files* to publish those modifications, and obliges nobody else. It is not in the production closure, is not linked into any application, and does not reach a self-hoster's runtime. It is disclosed here because the rule says MIT/Apache/BSD for anything compiled into code, and an auditor should be able to see this entry and judge it rather than find it later.

`lru-cache` (BlueOak-1.0.0, via `jsdom`) is a permissive licence and is listed only for completeness.

## Spawned binaries and external processes

Copyleft is acceptable in this class, because it never reaches anyone's source: these are separate programs, invoked, not linked.

| | Version verified | Licence | Class | Notes |
|---|---|---|---|---|
| **`ffmpeg`** | 9.0.1 | **LGPL v2.1+ by default; GPL v2+ when built with `--enable-gpl`** | process | Spawned by `execa`. Never linked. The build used for this repository's measurements was a Homebrew `ffmpeg-full` configured `--enable-gpl --enable-version3`, so *that particular binary* is GPL v2+ — which is acceptable here precisely because it is spawned. A self-hoster's own `ffmpeg` may be LGPL; the difference changes nothing about this project |
| **`ffprobe`** | 9.0.1 | as `ffmpeg` | process | Reads back the finished file's real dimensions, duration and codecs |
| **PostgreSQL** | 14.22 verified; compose uses `postgres:16-alpine` | PostgreSQL Licence (permissive, BSD-like) | process | The database, and the queue's storage |
| **Node.js** | 26.8.1 verified; images use `node:22-bookworm-slim` | MIT | process | The runtime |
| **A Whisper-family aligner** | **not installed, not built** | MIT or BSD-2-Clause depending on which | process | **Planned.** Alignment is designed as a local subprocess precisely so a copyleft or model-licence question never reaches this code. The align stage today makes no external call at all |
| **A motion-graphics renderer** | **not installed, not built** | — | process | **Planned.** Not in the production closure |

## Rejected, with the reason recorded so they are not re-proposed

Each of these was re-checked on 30 September 2026. **A rejection is not a judgement that the project is bad** — several are the obvious choice for this job, and that is exactly why the reason is written down.

| Candidate | Verified state | Why it is out |
|---|---|---|
| **Remotion** | Not an OSI licence. Its `LICENSE.md` grants free use to "an individual", "a for-profit organization with **up to 3 employees**", a non-profit, and to anyone still evaluating; everyone else "is required to obtain a Company License", sold per company | The obvious TypeScript renderer for exactly this job, and **every self-hoster above three employees would inherit a company-size-gated commercial obligation they never chose.** Disqualifying regardless of quality |
| **`fluent-ffmpeg`** | MIT. npm metadata: last publish 2025-05-22. The repository did not resolve through the GitHub API during this audit, so its archived flag is carried over from the earlier audit and is **unconfirmed today** | Unmaintained, and nothing is gained by it: `ffmpeg` is spawned through `execa` in about ten lines. Rejected on the maintenance half of the rule, which does not depend on the archive flag |
| **`ffmpeg-static`** | **GPL-3.0-or-later** (npm metadata, re-verified) | The convenient binary downloader is GPL-3.0 *and* a linked-in binary, which is the worst of both classes. Require a system `ffmpeg` and document the install instead |
| **`edge-tts`** | Upstream `LICENSE`: **LGPLv3 for everything except one MIT file** (`srt_composer.py`). The npm package additionally declares `CC BY-NC-SA 4.0` in its metadata — a non-commercial terms set, on its own disqualifying | Copyleft **and** a vendor dependency: it speaks to a third party's undocumented speech endpoint. A self-hosted product whose voice needs someone else's service is not self-hosted, and the non-commercial metadata makes it worse |
| **`piper`** (original) | Repository **archived**; MIT. The npm package of the same name is unrelated, MIT, last publish 2022 | Archived. |
| **`piper` successor (`piper1-gpl`)** | Active; **GPL-3.0** | A maintained local TTS engine, but GPL-3.0. Usable **only** as a separate process under the class rule — which is a fine answer, and is why the voice slot is shaped so a local engine can be one |
| **Coqui TTS** | Not archived, but **last push 2024-08-16** — over two years ago. MPL-2.0 (`LICENSE.txt`, re-read) | Unmaintained. The maintenance half of the rule rejects it on its own |

**The pattern worth naming:** the licence traps sit exactly where the convenience is. The easiest renderer, the easiest `ffmpeg` wrapper, the easiest speech engines and the most convenient TTS model are *all* out — some by licence, some by abandonment, one by both. Every dependency goes through this audit before it is added, and a PR that adds one records the audit in its own description.

## Adding a dependency

1. Pick the class first: does it get compiled into this code or a user's, or does it run as a separate process? The class decides which licences are acceptable.
2. Read the licence from the package itself — `node_modules/<name>/LICENSE`, or the `license` field — not from a package index, a comparison article, or a previous audit.
3. Check the repository: archived means rejected, whatever the licence says.
4. Record the audit in the pull request, and add a row here.
