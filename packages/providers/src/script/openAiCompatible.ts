/**
 * A `ScriptProvider` against any OpenAI-chat-completions-shaped endpoint.
 * That shape covers a hosted bring-your-own-key provider and a local
 * runtime such as Ollama behind the exact same request — the proof, in
 * code, of `docs/SPEC.md` §5.1's claim that the pipeline cannot tell how
 * a model was reached. An OAuth-reached subscription would be this same
 * client again with a refreshed token in `connection.apiKey`; nothing
 * here builds that refresh flow (see `../types.ts`).
 *
 * The model is asked for a simple shape (a hook, a list of narration
 * lines, a reason) rather than the full `ScriptPlan` — smaller, more
 * reliable for a small local model to produce, with `onScreen` and
 * `search` derived mechanically from each narration line rather than
 * asked of the model. When even that fails to parse, this throws
 * `ScriptProviderParseError` rather than silently shipping malformed
 * output: a plan field either came from a real decision or the stage
 * fails loudly, never a third option.
 */
import { ScriptSchema, type Beat, type Brief, type ScriptPlan } from "@shortreelcuts/plan";
import { z } from "zod";
import type { ModelConnection, ScriptProvider } from "../types.js";

const SYSTEM_PROMPT =
  "You write short vertical-video scripts. Reply with only a JSON object, no prose, no markdown fences, " +
  'matching exactly this shape: {"hook": string, "beats": [string, string], "reason": string}. ' +
  '"hook" is one sentence that opens the video. "beats" is 2 to 4 short sentences, each one thing spoken ' +
  'aloud. "reason" is one sentence explaining the structure you chose.';

const RawScriptSchema = z
  .object({
    hook: z.string().min(1),
    beats: z.array(z.string().min(1)).min(1),
    reason: z.string().min(1),
  })
  .strict();

export class ScriptProviderParseError extends Error {
  readonly rawContent: string;

  constructor(rawContent: string, cause: unknown) {
    super("the model's response did not parse as the expected script JSON");
    this.name = "ScriptProviderParseError";
    this.rawContent = rawContent;
    this.cause = cause;
  }
}

export class ScriptProviderRequestError extends Error {
  constructor(status: number, statusText: string) {
    super(`model request failed: ${status} ${statusText}`);
    this.name = "ScriptProviderRequestError";
  }
}

function userPrompt(brief: Brief): string {
  return `Topic: ${brief.prompt}\nTone: ${brief.tone}\nTarget length: ${Math.round(brief.targetSeconds)} seconds.`;
}

/** Strips a markdown code fence if the model added one anyway, despite being asked not to. */
function extractJsonText(content: string): string {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced?.[1] ?? content).trim();
}

function slug(text: string, index: number): string {
  return `b${index + 1}`;
}

function onScreenFrom(narration: string): string {
  const words = narration.trim().split(/\s+/).slice(0, 4).join(" ");
  return words.replace(/[.,!?]+$/, "");
}

function toScriptPlan(raw: z.infer<typeof RawScriptSchema>): ScriptPlan {
  const beats: Beat[] = raw.beats.map((narration, i) => ({
    id: slug(narration, i),
    narration,
    onScreen: onScreenFrom(narration),
    search: narration,
  }));
  return ScriptSchema.parse({ hook: raw.hook, beats, reason: raw.reason });
}

interface ChatCompletionResponse {
  readonly choices: ReadonlyArray<{ readonly message: { readonly content: string } }>;
}

export function createOpenAiCompatibleScriptProvider(connection: ModelConnection): ScriptProvider {
  return {
    id: `openai-compatible:${connection.kind}`,
    async generate(brief: Brief, _seed: number): Promise<ScriptPlan> {
      const response = await fetch(`${connection.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(connection.apiKey ? { authorization: `Bearer ${connection.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: connection.model,
          temperature: 0.2,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt(brief) },
          ],
        }),
      });

      if (!response.ok) {
        throw new ScriptProviderRequestError(response.status, response.statusText);
      }

      const body = (await response.json()) as ChatCompletionResponse;
      const content = body.choices[0]?.message.content ?? "";
      const jsonText = extractJsonText(content);

      try {
        const raw = RawScriptSchema.parse(JSON.parse(jsonText));
        return toScriptPlan(raw);
      } catch (err) {
        throw new ScriptProviderParseError(content, err);
      }
    },
  };
}
