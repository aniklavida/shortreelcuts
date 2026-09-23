import type { GeneratedFootage } from "@shortreelcuts/plan";
import type {
  BeatContext,
  Candidate,
  CostEstimate,
  FootageAdapter,
  FootageCapabilities,
  MaterialiseIO,
} from "../types.js";

export interface GeneratedCandidateData {
  readonly model: string;
  readonly prompt: string;
  readonly seconds: number;
  readonly quotedCost: {
    readonly amount: number;
    readonly currency: string;
    readonly basis: string;
  };
}

export class GeneratedFootageAdapter
  implements FootageAdapter<"generated", GeneratedCandidateData, GeneratedFootage>
{
  readonly source = "generated" as const;
  readonly id: string;
  readonly model: string;
  readonly pricePerSecond: number;

  constructor(options?: { id?: string; model?: string; pricePerSecond?: number }) {
    this.id = options?.id ?? "veo";
    this.model = options?.model ?? "veo-3.1";
    this.pricePerSecond = options?.pricePerSecond ?? 0.1;
  }

  async capabilities(): Promise<FootageCapabilities> {
    return {
      source: "generated",
      maxSeconds: 10,
      aspectRatios: ["9:16"],
      producesAudio: true,
      deterministicOutput: false,
    };
  }

  async propose(
    beat: BeatContext,
    count: number,
    _signal?: AbortSignal,
  ): Promise<Candidate<"generated", GeneratedCandidateData>[]> {
    const candidates: Candidate<"generated", GeneratedCandidateData>[] = [];
    const seconds = Math.min(10, Math.max(1, beat.targetSeconds || 5));
    for (let i = 0; i < count; i++) {
      const prompt = `Cinematic vertical video, 9:16, ${beat.search}: ${beat.narration}`;
      candidates.push({
        id: `${this.id}-${beat.beatId}-${i + 1}`,
        label: `Generated video (${this.model}): ${beat.search}`,
        source: "generated",
        data: {
          model: this.model,
          prompt,
          seconds,
          quotedCost: {
            amount: +(this.pricePerSecond * seconds).toFixed(2),
            currency: "USD",
            basis: `${this.model}, $${this.pricePerSecond.toFixed(2)}/s`,
          },
        },
      });
    }
    return candidates;
  }

  estimate(candidate: Candidate<"generated", GeneratedCandidateData>): CostEstimate {
    return {
      kind: "per-second",
      amount: candidate.data.quotedCost.amount,
      currency: candidate.data.quotedCost.currency,
      requiresConfirmation: true,
      basis: candidate.data.quotedCost.basis,
    };
  }

  async materialise(
    candidate: Candidate<"generated", GeneratedCandidateData>,
    io: MaterialiseIO,
  ): Promise<GeneratedFootage> {
    const syntheticBytes = new TextEncoder().encode(
      `generated-video-bytes:${candidate.data.model}:${candidate.data.prompt}:${candidate.data.seconds}`,
    );
    const mediaKey = await io.media.put(syntheticBytes, "video/mp4");

    return {
      source: "generated",
      provider: this.id,
      model: candidate.data.model,
      prompt: candidate.data.prompt,
      seconds: candidate.data.seconds,
      quotedCost: candidate.data.quotedCost,
      output: {
        mediaKey,
        jobId: `job-${candidate.id}`,
      },
      reason: candidate.label,
    };
  }
}
