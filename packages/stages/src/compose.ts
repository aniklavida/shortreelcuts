/**
 * The compose stage — the one real stage.
 *
 * Everything upstream of this file is a stand-in (`script.ts`, `voice.ts`,
 * `footage.ts`, `align.ts`, `media.ts`). This file is not: it synthesizes
 * stand-in media for the stages that don't exist yet, then calls
 * `@shortreelcuts/render`'s real `render()`, which spawns real `ffmpeg`
 * and produces a real, playable MP4. `packages/render` genuinely stands
 * in as this stage rather than being mocked for it.
 *
 * `captions`/`music`/`format` are owned by `compose` in
 * `@shortreelcuts/plan`'s graph (`graph.ts`'s `NAMESPACE_RULES`) — they
 * are rendering decisions, not upstream ones — so this is also where
 * their v1 defaults are chosen, once, the first time a plan is composed.
 */
import { join } from "node:path";
import { render } from "@shortreelcuts/render";
import { withComposeDefaults } from "./composeDefaults.js";
import { synthesizeStubMedia } from "./media.js";
import type { ComposeRunInput, ComposeRunResult } from "./types.js";

export { withComposeDefaults } from "./composeDefaults.js";

export async function runCompose(input: ComposeRunInput): Promise<ComposeRunResult> {
  const plan = withComposeDefaults(input.plan);
  const stubMedia = await synthesizeStubMedia(plan, join(input.workDir, "media"));
  const media = {
    ...stubMedia,
    footage: {
      ...stubMedia.footage,
      ...(input.media?.footage ?? {}),
    },
    narration: {
      ...stubMedia.narration,
      ...(input.media?.narration ?? {}),
    },
    ...(input.media?.music ? { music: input.media.music } : {}),
  };

  const outputPath = join(input.workDir, "output.mp4");
  const video = await render(plan, media, { outputPath });

  return {
    patch: { captions: plan.captions, music: plan.music, format: plan.format },
    candidates: {},
    video,
  };
}
