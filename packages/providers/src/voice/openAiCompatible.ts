/**
 * A `VoiceProvider` against any OpenAI-audio-speech-shaped endpoint — the
 * exact counterpart of `script/openAiCompatible.ts`, and the same proof
 * that `docs/SPEC.md` §5.1's provider-neutral seam holds for voice as for
 * script.
 *
 * Anik's 24 Sep 2026 decision: "this all goes through an API anyway; we're
 * not providing our own model locally; let the user download whatever model
 * they want and connect, or use an API key, whichever they prefer." This
 * package therefore ships **no TTS engine, model, or runtime**. It does not
 * download, install, bundle or recommend one. The user brings a hosted BYOK
 * key, an OAuth-reached subscription (once a vendor application is
 * registered — a human step, tracked separately), or a local server they
 * already run (their own Piper/Coqui/another, behind a compatible API). The
 * provider only speaks the request shape; it cannot tell which one answered.
 *
 * `speak` never touches the filesystem. It hands the returned bytes to the
 * `MediaSink` it was constructed with and returns the opaque key, per
 * `docs/SPEC.md` §7.3 ("In, out, and a `MediaStore` handle if it needs
 * bytes"). A response that is not a usable WAV stream throws
 * `VoiceProviderParseError` rather than storing silence or a wrong
 * duration; a non-2xx response throws `VoiceProviderRequestError`. A
 * decision field either came from real audio or the stage fails loudly,
 * never a third option.
 */
import type {
  AudioTrack,
  MediaSink,
  NarrationLine,
  VoiceChoice,
  VoiceConnection,
  VoiceDescriptor,
  VoiceProvider,
} from "../types.js";

export class VoiceProviderParseError extends Error {
  readonly rawContent: string;

  constructor(rawContent: string, cause: unknown) {
    super("the voice endpoint's response did not carry a parseable WAV audio stream");
    this.name = "VoiceProviderParseError";
    this.rawContent = rawContent;
    this.cause = cause;
  }
}

export class VoiceProviderRequestError extends Error {
  constructor(status: number, statusText: string) {
    super(`voice request failed: ${status} ${statusText}`);
    this.name = "VoiceProviderRequestError";
  }
}

/**
 * Measured from the WAV header rather than assumed, so `AudioTrack.durationSeconds`
 * is what the bytes actually hold. The provider asks for `response_format:
 * "wav"`, so a correctly-shaped endpoint returns exactly this. Not a
 * filesystem probe: it reads the in-memory bytes only.
 */
function wavDurationSeconds(bytes: Uint8Array): number {
  if (bytes.length < 44) throw new Error("too short to be a WAV stream");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number): string =>
    String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));

  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a RIFF/WAVE stream");

  let byteRate: number | undefined;
  let dataSize: number | undefined;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      if (body + 16 > bytes.length) throw new Error("truncated fmt chunk");
      byteRate = view.getUint32(body + 8, true);
    } else if (id === "data") {
      dataSize = Math.min(size, bytes.length - body);
    }
    offset = body + size + (size % 2);
  }

  if (byteRate === undefined || byteRate <= 0) throw new Error("WAV is missing a usable fmt chunk");
  if (dataSize === undefined) throw new Error("WAV is missing a data chunk");
  return dataSize / byteRate;
}

/** A short, human-readable excerpt of a response for the parse error — never more than the first 512 bytes. */
function responseExcerpt(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 512));
}

export function createOpenAiCompatibleVoiceProvider(connection: VoiceConnection, media: MediaSink): VoiceProvider {
  return {
    id: `openai-compatible:${connection.kind}`,
    async voices(): Promise<VoiceDescriptor[]> {
      return connection.voiceIds.map((id) => ({ id, label: id }));
    },
    async speak(lines: readonly NarrationLine[], choice: VoiceChoice): Promise<AudioTrack[]> {
      const tracks: AudioTrack[] = [];
      for (const line of lines) {
        const response = await fetch(`${connection.baseURL}/audio/speech`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(connection.apiKey ? { authorization: `Bearer ${connection.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: connection.model,
            input: line.text,
            voice: choice.voiceId,
            response_format: "wav",
            speed: choice.rate,
          }),
        });

        if (!response.ok) {
          throw new VoiceProviderRequestError(response.status, response.statusText);
        }

        const contentType = response.headers.get("content-type") ?? "audio/wav";
        const bytes = new Uint8Array(await response.arrayBuffer());

        let durationSeconds: number;
        try {
          durationSeconds = wavDurationSeconds(bytes);
        } catch (err) {
          throw new VoiceProviderParseError(responseExcerpt(bytes), err);
        }

        const mediaKey = await media.put(bytes, contentType);
        tracks.push({ lineId: line.id, mediaKey, durationSeconds });
      }
      return tracks;
    },
  };
}
