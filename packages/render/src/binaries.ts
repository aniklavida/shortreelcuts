/**
 * Where `ffmpeg` and `ffprobe` come from, and whether the one we found can
 * do what compose needs.
 *
 * DECISIONS.md: "Rendering is `ffmpeg`, invoked as a binary" — a separate
 * process, spawned by `execa` (MIT, compiled into this package), never
 * linked. That is what keeps ffmpeg's own licence (LGPL by default, GPL
 * only if a build enables it) off this codebase and off a self-hoster's.
 * See `process.ts` for the spawn itself.
 *
 * `ffmpeg-static` (GPL-3.0) and `fluent-ffmpeg` (archived) were both
 * rejected for this reason and this one — see DECISIONS.md. We require a
 * system `ffmpeg`/`ffprobe` instead and document the install.
 */
import { execa } from "execa";

export function resolveFfmpegPath(override?: string): string {
  return override ?? process.env["SHORTREELCUTS_FFMPEG_PATH"] ?? "ffmpeg";
}

export function resolveFfprobePath(override?: string): string {
  return override ?? process.env["SHORTREELCUTS_FFPROBE_PATH"] ?? "ffprobe";
}

const filterListCache = new Map<string, Promise<Set<string>>>();

async function listFilters(ffmpegPath: string): Promise<Set<string>> {
  const cached = filterListCache.get(ffmpegPath);
  if (cached) {
    return cached;
  }
  const promise = execa(ffmpegPath, ["-hide_banner", "-filters"]).then(({ stdout }) => {
    const names = new Set<string>();
    for (const line of stdout.split("\n")) {
      // Lines look like " T.. drawtext          V->V       Draw text ...".
      // The name is always the second whitespace-separated token.
      const match = /^\s*[A-Z.]{2,3}\s+(\S+)\s+\S+->\S+/.exec(line);
      if (match?.[1]) {
        names.add(match[1]);
      }
    }
    return names;
  });
  filterListCache.set(ffmpegPath, promise);
  return promise;
}

/**
 * Burned-in captions need the `subtitles` filter, which needs ffmpeg built
 * with libass (and libfreetype, for the fonts libass rasterises). Some
 * distributions' default `ffmpeg` package omits it — this project's own
 * dev environment initially did (Homebrew's plain `ffmpeg` formula), while
 * `ffmpeg-full` includes it. Fail loudly and specifically rather than
 * letting ffmpeg reject an unresolvable filter name deep in a filtergraph
 * string.
 */
export async function assertCaptionSupport(ffmpegPath: string): Promise<void> {
  const filters = await listFilters(ffmpegPath);
  if (!filters.has("subtitles")) {
    throw new Error(
      `ffmpeg at "${ffmpegPath}" was not built with libass (no "subtitles" filter), so it cannot burn in captions. ` +
        `Install an ffmpeg build with --enable-libass --enable-libfreetype — for example Homebrew's ` +
        `"ffmpeg-full" formula — and point SHORTREELCUTS_FFMPEG_PATH at its "ffmpeg" binary.`,
    );
  }
}

/** Exposed for tests that need to stub a fake ffmpeg's filter list without spawning the real one. */
export function _clearFilterListCache(): void {
  filterListCache.clear();
}
