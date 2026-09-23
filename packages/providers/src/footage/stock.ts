import type { StockFootage } from "@shortreelcuts/plan";
import type {
  BeatContext,
  Candidate,
  CostEstimate,
  FootageAdapter,
  FootageCapabilities,
  MaterialiseIO,
} from "../types.js";

export interface StockCandidateData {
  readonly assetId: string;
  readonly in: number;
  readonly out: number;
  readonly credit: {
    readonly creator: string;
    readonly pageUrl: string;
  };
}

export class StockFootageAdapter implements FootageAdapter<"stock", StockCandidateData, StockFootage> {
  readonly source = "stock" as const;
  readonly id: string;

  constructor(options?: { id?: string }) {
    this.id = options?.id ?? "pexels";
  }

  async capabilities(): Promise<FootageCapabilities> {
    return {
      source: "stock",
      maxSeconds: 60,
      aspectRatios: ["9:16"],
      producesAudio: false,
      deterministicOutput: true,
      attribution: {
        required: true,
        display: "Creator credit and source link required by library terms",
      },
    };
  }

  async propose(beat: BeatContext, count: number, _signal?: AbortSignal): Promise<Candidate<"stock", StockCandidateData>[]> {
    const candidates: Candidate<"stock", StockCandidateData>[] = [];
    const targetDuration = Math.max(1, beat.targetSeconds || 4);
    for (let i = 0; i < count; i++) {
      const assetId = `${this.id}-${beat.beatId}-${i + 1}`;
      candidates.push({
        id: assetId,
        label: `${beat.search} — shot ${i + 1}`,
        source: "stock",
        data: {
          assetId,
          in: 0,
          out: targetDuration,
          credit: {
            creator: `Stock artist ${i + 1}`,
            pageUrl: `https://${this.id}.com/video/${beat.beatId}-${i + 1}`,
          },
        },
      });
    }
    return candidates;
  }

  estimate(_candidate: Candidate<"stock", StockCandidateData>): CostEstimate {
    return {
      kind: "free",
      requiresConfirmation: false,
      basis: "Stock library standard API access",
    };
  }

  async materialise(
    candidate: Candidate<"stock", StockCandidateData>,
    _io: MaterialiseIO,
  ): Promise<StockFootage> {
    return {
      source: "stock",
      provider: this.id,
      assetId: candidate.data.assetId,
      in: candidate.data.in,
      out: candidate.data.out,
      credit: candidate.data.credit,
      reason: candidate.label,
    };
  }
}
