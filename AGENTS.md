# ShortReelCuts — contributor and agent instructions

The canonical guide for humans and coding agents working in this repository. Tool-neutral: Claude, Codex, Cursor, Gemini CLI and others read this file.

## What this repository is

A self-hosted web app that turns a prompt into a short vertical video, then shows every decision it made and lets the user change any one of them.

**Status: pre-implementation.** The specification, architecture and structure exist. Working code does not.

## The one rule that matters

**The decision sheet is the product.**

Everybody has a pipeline. What makes this project worth existing is that every choice the pipeline made is visible, explained and individually overridable *after* the user has seen the result.

Two consequences, and they are not negotiable:

1. **No control is reachable before the first render.** Not behind an accordion, not under "Advanced". A collapsed settings panel is still a form with a lid on it. Every control is defined as an override of something already chosen, and before the first render nothing has been chosen.
2. **A decision without a recorded reason is a bug.** If the sheet cannot say *why* something was chosen, the stage that chose it is not recording enough. Fix the stage, not the interface.

## The plan is the unit of work

A video is a **plan** — a validated, versioned, seeded JSON document holding every decision — and the renderer is a function of it. The same plan always produces the same video.

```
prompt ──▶ plan ──▶ video
             ▲
             └── every override edits the plan
```

Stages communicate through the plan and nowhere else. No side channels. A stage that needs something an earlier stage produced reads it from the plan.

## The stage graph

```
script ──┬──▶ voice ──▶ align ──┐
         └──▶ footage ──────────┴──▶ compose
```

When a plan field changes, a pure function returns the stages that must re-run — and only those. **That function is the most important code in the repository.** A bug in it either re-runs too much, which surprises a user with a wait and a bill, or too little, which silently ships a wrong video. Change it only with tests.

## Adding anything

1. Does it make the decision sheet better? If not, say why it belongs here.
2. If it adds a decision, add it to the plan schema, to the decision mapping, and to the stage graph. **A plan field with no sheet row fails the acceptance criteria.**
3. If it changes the plan schema, raise `planVersion` and add a migration step. A stored plan must always render.
4. If it adds a provider, implement the interface and declare its capabilities. **Do not edit the interface to accommodate it** — if that is necessary, the capability declaration is the thing that is wrong.
5. Add tests. Pure code is tested without spawning an encoder.

## Structure

```
apps/web/            routes, the decision sheet, the plan editor
apps/worker/         the pipeline runner and the invalidation function
packages/plan/       schema, stage graph, decision mapping, migrations
packages/stages/     script · voice · footage · align · compose
packages/providers/  adapters, one folder per slot
packages/render/     the ffmpeg timeline compiler
packages/db/         schema and migrations
packages/config/     environment schema
```

Rules enforced by tests:

- **A provider imports nothing from `apps/`, `packages/db` or `packages/stages`.** In, out, and a media handle.
- **A provider returns candidates, never a final choice.** Choosing belongs to the stage, because the stage records the reason.
- **`app/` holds route entry points only.** Real code lives in `components/` or a package.
- **Every decision carries a reason string.** Not optional, not nullable.

## Determinism

Every plan carries a seed, and every stage records the result of a non-deterministic call *in the plan* rather than re-deriving it.

Never re-roll silently. Re-rendering a plan must produce the same file — that is what makes "change one decision and see only that change" true, and what makes a bug reproducible from an attached plan.

## Dependencies

**Every dependency is inherited by everyone who self-hosts this.** Audit the licence before adding one, and record the audit in the pull request.

| Class | Rule |
|---|---|
| Compiled into this code or a user's | **MIT, Apache or BSD only** |
| Run as a separate process, or invoked as a binary | Copyleft acceptable — it never reaches anyone's source |

Anything reciprocal-for-consumers, revenue-gated or company-size-gated is rejected regardless of quality. **Check that the repository is maintained, not only that the licence is acceptable** — an archived dependency is rejected too.

Rendering is `ffmpeg`, spawned as a binary and never linked. Do not add a library that links it.

## Secrets

Secrets live in `.env`. Never in the database, never in a plan document, never in a log line. **A plan is exportable and shareable**, so a key inside one would be a leak with legs.

## Truthfulness

Every public claim is exactly one of: **implemented and tested**, **experimental**, **planned**, or **unsupported**.

Never describe a planned capability as working. **Never publish a benchmark, a support matrix, a hardware requirement or a provider result that nobody has actually run** — a table of intended behaviour is labelled a target, not a result. Documentation compatibility is not verified support, and a configured environment variable is not an integration.

## Tests

Unit tests for the pure code — the stage graph, the invalidation function, the timeline compiler, the decision mapping. A separate, slower suite for end-to-end rendering. The fast suite runs on every commit; never make it depend on an encoder.
