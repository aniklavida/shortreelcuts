# v1.0 release checklist

## Truth

- [ ] Every public claim has working evidence, or is clearly labelled planned.
- [ ] No benchmark, support matrix, hardware requirement or provider result appears anywhere unless a person has actually run it.
- [ ] The specification, the documentation and the implementation agree.

## Product

- [ ] A prompt alone, with no other input, produces a playable 1080 × 1920 MP4 with voiceover and burned-in captions.
- [ ] No setting is reachable before the first render — verified by walking the interface.
- [ ] Every field in the plan document appears on the decision sheet.
- [ ] Every decision shows a reason recorded by the stage that made it.
- [ ] Every override shows its cost before it is applied.
- [ ] The version history lets a person compare and revert a render.
- [ ] The plan editor renders an edited plan.

## Engineering

- [ ] Changing a caption colour re-runs compose only, proved by stage logs.
- [ ] Changing the voice re-runs voice, align and compose only.
- [ ] Swapping a clip re-runs compose only.
- [ ] Re-rendering the same plan twice produces byte-identical output.
- [ ] Caption word timings stay within 150 ms of the spoken word on the fixed test script.
- [ ] A browser refresh mid-render loses nothing; the job continues and reattaches.
- [ ] Invalidation, the stage graph and the timeline compiler are unit-tested without spawning an encoder.
- [ ] A stored plan from an earlier `planVersion` still renders.

## Self-hosting

- [ ] `docker compose up` from a clean checkout renders a video with no manual step beyond filling in `.env`.
- [ ] Missing or invalid environment variables fail at startup with a message that says what to fix.
- [ ] The documentation states exactly which stages make an external call.
- [ ] The documentation states what a video costs to produce.
- [ ] No secret appears in the database, in a plan document, or in a log line.

## Repository

- [ ] Every shipped dependency is listed with its licence and passes the audit.
- [ ] No dependency is archived or unmaintained.
- [ ] README, specification, architecture, structure and troubleshooting are complete.
- [ ] Security policy, code of conduct and contributor instructions are complete.
- [ ] Repository description, topics and homepage are set.
- [ ] CI passes.
- [ ] Working tree is clean and local `HEAD` matches the remote.

## Launch

- [ ] A short demo shows a prompt, a video, and three decisions being changed.
- [ ] Release notes and changelog are accurate.
- [ ] The tag is created only after every box above is ticked.
