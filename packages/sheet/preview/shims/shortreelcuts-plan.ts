/**
 * A browser-safe subset of `@shortreelcuts/plan`, for the dev preview
 * only. That package's public entry point (its `exports` field allows no
 * subpath imports) re-exports `artifact.ts`, which pulls in `node:crypto`
 * for a content-hash function nothing in this preview calls — Vite's
 * browser build still throws the moment that import is evaluated. This
 * preview never needs `artifact.ts` or `migrate.ts`, so it reaches past
 * the package boundary at the filesystem level (this is dev-only preview
 * plumbing, not something the shipped package or its tests use) and
 * re-exports only what `App` actually calls.
 */
export { invalidate, ownerOf, STAGES, type Stage } from "../../../plan/src/graph.js";
export { diffPaths, leavesOf } from "../../../plan/src/paths.js";
export { parsePlan, type Brief, type Plan } from "../../../plan/src/schema.js";
