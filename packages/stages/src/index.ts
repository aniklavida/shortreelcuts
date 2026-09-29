export * from "./types.js";
export { STUB_VOICES, type VoiceDescriptor } from "./voice.js";
export { createScriptRunner, runScript, ScriptGenerationError } from "./script.js";
export { createVoiceRunner, runVoice, VoiceGenerationError } from "./voice.js";
export { runFootage, createFootageRunner, FootageSearchError, FOOTAGE_CANDIDATE_COUNT, type FootageRunInput } from "./footage.js";
export { runAlign, createWhisperAlignRunner } from "./align.js";
export {
  AlignmentError,
  alignScriptToTranscription,
  isWhisperAvailable,
  isWhisperBinaryAvailable,
  resolveWhisperBinaryPath,
  resolveWhisperModelPath,
  transcribeWithWhisper,
  type TranscribedWord,
  type WhisperOptions,
} from "./whisper.js";
export { runFrames } from "./frames.js";
export { runCompose, withComposeDefaults } from "./compose.js";
