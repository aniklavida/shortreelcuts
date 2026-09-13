# Roadmap to v1.0

One useful, complete release. Then maintenance driven by real issues and demonstrated demand.

There is no disposable early public release. Nothing below is done.

## 0 · Lock

Positioning, scope, the pipeline shape, the adapter interfaces, the folder structure and the dependency set are agreed and recorded.

The two questions that change what self-hosting costs are answered, and the specification records them: **models** are whichever the user chooses, hosted or on their own hardware, both first-class at v1; **footage** comes per scene from stock clips, AI-generated video or motion graphics written as code, each with the user's own key.

**Done:** no unresolved product contradiction remains, and both questions are answered.

## 1 · The plan, and the graph

The plan schema, its versioning and its migration step. The stage dependency graph. The invalidation function that decides which stages re-run when a field changes.

This comes first because everything else is defined in terms of it, and because it is pure code that can be tested exhaustively before anything slow exists.

**Done:** given any plan path, the invalidation function returns exactly the stages that depend on it, proved by tests.

## 2 · Compose, from a hand-written plan

The timeline compiler, the filter graph, caption rendering, and `ffmpeg` spawned with progress.

No script generation, no voice, no footage search — a plan written by hand and local media files. The last stage is built first because it is the one that can be wrong in ways nothing else can compensate for.

**Done:** a hand-written plan and a folder of clips produce a playable 1080 × 1920 MP4 with burned-in captions, and re-rendering the same plan produces a byte-identical file.

## 3 · The decision sheet, against stubbed stages

The three screens. The sheet, the override controls resolved from capability declarations, the cost hints, the version history.

**The sheet is built before the pipeline is finished, on purpose.** It is the thesis of the product and the thing most likely to be wrong, so it should be in front of real people while the rest is still cheap to change.

**Done:** with stubbed stages, a person unfamiliar with the product can read the sheet, change three decisions and explain what each one did.

## 4 · The five stages, end to end

Script, voice, footage and alignment, each behind its interface — script and voice through the model the user connects, footage from the three sources the specification names. The worker, the queue, resumable jobs, streaming progress.

**Done:** a prompt alone produces a video, and every field of the resulting plan appears on the sheet with a reason recorded by the stage that made it.

## 5 · Overrides, for real

Every decision overridable, with invalidation wired to the live pipeline so a change re-runs its stages and nothing else.

**Done:** changing a caption colour re-runs compose only, changing the voice re-runs voice, align and compose only, and stage logs prove both.

## 6 · Caption accuracy

The hardest stage, given its own step because it is the acceptance criterion most likely to fail. Alignment tuning, cue grouping, measurement against a fixed test script.

**Done:** word timings stay within 150 ms of the spoken word across a full render.

## 7 · Self-hosting and release

`docker compose up` from a clean checkout. Environment validation with useful errors. Documentation of exactly what leaves the machine and what a video costs. A demo. Release automation and clean-install proof.

**Done:** someone who has never seen this repository installs it, renders a video and changes a decision, without help.

## After v1.0

Maintain compatibility. Fix reproducible bugs and security issues. Add a new integration to a slot when a user demonstrates the need — not when one exists.
