/**
 * Job status and decision progress route. Thin: the body lives in `lib/jobs.ts`.
 * Surfaces stage-by-stage reported progress and its decisions as they complete,
 * not just a percentage.
 */
import { handleGetJob } from "../../../../lib/jobs.js";

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return handleGetJob(req, id);
}
