/**
 * Job creation and enqueue route. Thin: the body lives in `lib/jobs.ts` and the
 * only work here is the HTTP method. Never runs a stage or touches the
 * database directly — it calls the `@shortreelcuts/worker` seam.
 */
import { handleCreateJob } from "../../../lib/jobs.js";

export async function POST(req: Request): Promise<Response> {
  return handleCreateJob(req);
}
