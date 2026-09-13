/**
 * Cues → the two caption files compose produces: the `.srt` sidecar
 * SPEC.md §15 requires regardless of player support, and the `.ass` that
 * actually gets burned in — `subtitles=` needs libass-flavoured styling,
 * which SRT alone cannot express (position, colour, outline).
 *
 * Pure text generation. `timeline.ts` already placed every cue in global
 * time; this file only formats and styles them.
 */
import type { CaptionsPlan, FormatPlan } from "@shortreelcuts/plan";
import type { Cue } from "./timeline.js";

function pad(value: number, width: number): string {
  return String(Math.floor(value)).padStart(width, "0");
}

export function formatSrtTimestamp(totalSeconds: number): string {
  const clamped = Math.max(0, totalSeconds);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = Math.floor(clamped % 60);
  const millis = Math.round((clamped - Math.floor(clamped)) * 1000);
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${String(millis).padStart(3, "0")}`;
}

export function formatAssTimestamp(totalSeconds: number): string {
  const clamped = Math.max(0, totalSeconds);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = Math.floor(clamped % 60);
  const centis = Math.round((clamped - Math.floor(clamped)) * 100);
  return `${hours}:${pad(minutes, 2)}:${pad(seconds, 2)}.${String(centis).padStart(2, "0")}`;
}

/** Renders the SPEC.md §15 sidecar — plain, unstyled, for players and editors that read SRT. */
export function renderSrt(cues: readonly Cue[]): string {
  return cues
    .map(
      (cue, index) =>
        `${index + 1}\n${formatSrtTimestamp(cue.startSeconds)} --> ${formatSrtTimestamp(cue.endSeconds)}\n${cue.text}\n`,
    )
    .join("\n");
}

function escapeAssText(text: string): string {
  // `{` and `}` open/close ASS override tags; a literal one in caption text
  // would otherwise be read as styling. `\` and newlines have their own
  // escapes. None of this is expected in narration text, but a stray
  // character here should not be able to break the whole subtitle file.
  return text.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}").replace(/\r?\n/g, "\\N");
}

/**
 * ASS numpad alignment: 7/8/9 top, 4/5/6 middle, 1/2/3 bottom, each row's
 * middle column centred. `captions.position` only chooses vertical band —
 * every position is horizontally centred, which is the one placement that
 * reads correctly on every clip regardless of its content.
 */
const POSITION_ALIGNMENT: Record<CaptionsPlan["position"], number> = {
  "upper-third": 8,
  center: 5,
  "lower-third": 2,
};

/**
 * `captions.style` is a free-form label the script/decision stage picked
 * (e.g. "bold-white-outline") — the schema does not yet define a registry
 * of named visual styles, so every style renders with the same visual
 * treatment today (white text, black outline, bold) and the label is kept
 * only as the ASS style's name for traceability. A style registry is
 * future scope; see this package's commit history for the decision.
 */
export function renderAss(cues: readonly Cue[], captions: CaptionsPlan, format: FormatPlan): string {
  const alignment = POSITION_ALIGNMENT[captions.position];
  const fontSize = Math.round(format.height * 0.045);
  const marginV = captions.position === "center" ? 0 : Math.round(format.height * 0.08);
  const marginLR = Math.round(format.width * 0.06);
  const styleName = captions.style.replace(/[,\s]/g, "_") || "Default";

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${format.width}`,
    `PlayResY: ${format.height}`,
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: ${styleName},Arial,${fontSize},&H00FFFFFF,&H00000000,&H80000000,1,0,1,3,0,${alignment},${marginLR},${marginLR},${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");

  const events = cues
    .map(
      (cue) =>
        `Dialogue: 0,${formatAssTimestamp(cue.startSeconds)},${formatAssTimestamp(cue.endSeconds)},${styleName},,0,0,0,,${escapeAssText(cue.text)}`,
    )
    .join("\n");

  return `${header}\n${events}\n`;
}
