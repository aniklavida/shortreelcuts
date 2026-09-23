import type { MotionFootage, MotionScene } from "@shortreelcuts/plan";
import type {
  BeatContext,
  Candidate,
  CostEstimate,
  FootageAdapter,
  FootageCapabilities,
  MaterialiseIO,
} from "../types.js";

export interface MotionCandidateData {
  readonly scene: MotionScene;
  readonly runtime: "srcuts-motion@1";
  readonly captionsInScene: boolean;
  readonly model: string;
}

export class MotionFootageAdapter implements FootageAdapter<"motion", MotionCandidateData, MotionFootage> {
  readonly source = "motion" as const;
  readonly id: string;
  readonly model: string;

  constructor(options?: { id?: string; model?: string }) {
    this.id = options?.id ?? "motion-code";
    this.model = options?.model ?? "connected-model";
  }

  async capabilities(): Promise<FootageCapabilities> {
    return {
      source: "motion",
      aspectRatios: ["9:16"],
      producesAudio: false,
      deterministicOutput: true,
    };
  }

  async propose(
    beat: BeatContext,
    count: number,
    _signal?: AbortSignal,
  ): Promise<Candidate<"motion", MotionCandidateData>[]> {
    const candidates: Candidate<"motion", MotionCandidateData>[] = [];
    for (let i = 0; i < count; i++) {
      const isCode = i % 2 === 0;
      const scene: MotionScene = isCode
        ? {
            kind: "code",
            html: `<div class="scene"><h1>${beat.onScreen || beat.narration}</h1></div>`,
            css: ".scene { display: flex; align-items: center; justify-content: center; height: 100%; color: #fff; background: #0f172a; font-family: sans-serif; }",
            js: "/* runtime animations */",
          }
        : {
            kind: "template",
            template: "kinetic-headline",
            params: { headline: beat.onScreen || beat.narration },
          };

      candidates.push({
        id: `${this.id}-${beat.beatId}-${i + 1}`,
        label: isCode
          ? `Motion graphics (code): ${beat.onScreen || beat.search}`
          : `Motion graphics (template): ${beat.onScreen || beat.search}`,
        source: "motion",
        data: {
          scene,
          runtime: "srcuts-motion@1",
          captionsInScene: true,
          model: this.model,
        },
      });
    }
    return candidates;
  }

  estimate(_candidate: Candidate<"motion", MotionCandidateData>): CostEstimate {
    return {
      kind: "tokens",
      localRenderSeconds: 4,
      requiresConfirmation: false,
      basis: "Local rendering on CPU",
    };
  }

  async materialise(
    candidate: Candidate<"motion", MotionCandidateData>,
    _io: MaterialiseIO,
  ): Promise<MotionFootage> {
    return {
      source: "motion",
      runtime: candidate.data.runtime,
      scene: candidate.data.scene,
      captionsInScene: candidate.data.captionsInScene,
      model: candidate.data.model,
      reason: candidate.label,
    };
  }
}
