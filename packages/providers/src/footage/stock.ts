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

/**
 * The synthetic stock adapter, and the shape the two real libraries
 * (`pexels.ts`, `pixabay.ts`) are held to.
 *
 * It searches nothing: its candidates are generated from the beat id, so
 * its asset ids do not resolve at any library. That is why its default id
 * is `stock-stub` and not the name of a real library, and why the clip it
 * materialises says so in its reason. A plan must never be able to claim
 * a clip came from Pexels when no Pexels request was ever made.
 */
export class StockFootageAdapter implements FootageAdapter<"stock", StockCandidateData, StockFootage> {
  readonly source = "stock" as const;
  readonly id: string;

  constructor(options?: { id?: string }) {
    this.id = options?.id ?? "stock-stub";
  }

  async capabilities(): Promise<FootageCapabilities> {
    return {
      source: "stock",
      maxSeconds: 60,
      aspectRatios: ["9:16"],
      producesAudio: false,
      deterministicOutput: true,
      // Card 10: neither cleared library requires attribution in the
      // exported video, and no in-video composition is required. Recorded
      // as false rather than left on an earlier guess of true.
      attribution: {
        required: false,
        display: "No attribution required by either cleared library; the source page and creator are still recorded in the plan",
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
      reason:
        `${candidate.label} — synthetic stock stub: no library was searched and this asset id ` +
        "does not resolve at any library",
    };
  }
}
