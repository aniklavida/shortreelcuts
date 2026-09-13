/**
 * The one place this package spawns a child process. Everything else
 * builds arguments; this runs them.
 */
import { execa } from "execa";

export interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
}

function isExecaFailure(error: unknown): error is { stderr?: string; shortMessage?: string; command?: string } {
  return typeof error === "object" && error !== null && "exitCode" in error;
}

/**
 * Runs `ffmpeg` with the given arguments. `-y` (overwrite) and a quiet log
 * level are always applied so callers only ever describe the encode, not
 * ffmpeg's own verbosity — on failure the real stderr is surfaced in the
 * thrown error instead.
 */
export async function runFfmpeg(ffmpegPath: string, args: readonly string[]): Promise<RunResult> {
  try {
    const result = await execa(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", ...args]);
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    if (isExecaFailure(error)) {
      const detail = error.stderr?.trim() || error.shortMessage || String(error);
      throw new Error(`ffmpeg failed:\n${detail}`);
    }
    throw error;
  }
}

/** Runs `ffprobe` and returns its stdout — always JSON, callers parse it. */
export async function runFfprobe(ffprobePath: string, args: readonly string[]): Promise<string> {
  try {
    const result = await execa(ffprobePath, ["-hide_banner", ...args]);
    return result.stdout;
  } catch (error) {
    if (isExecaFailure(error)) {
      const detail = error.stderr?.trim() || error.shortMessage || String(error);
      throw new Error(`ffprobe failed:\n${detail}`);
    }
    throw error;
  }
}
