/**
 * Setting a single leaf of a plan by its dot-separated path (the same
 * addressing scheme `@shortreelcuts/plan`'s `leavesOf`/`diffPaths` read),
 * without mutating the plan the sheet is currently showing.
 *
 * This is the write side of the addressing scheme that package's
 * `paths.ts` only reads. An override control never edits a plan in
 * place — see SPEC.md §9 rule 5, "nothing is destroyed" — it produces a
 * new object, which `diffPaths` then compares against the one it came
 * from.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Immutably sets `value` at `path` (e.g. `"footage.b2.assetId"`) inside `root`, cloning only the nodes along the way. */
export function setAtPath<T>(root: T, path: string, value: unknown): T {
  const segments = path.split(".");
  return setAt(root, segments, value) as T;
}

function setAt(node: unknown, segments: readonly string[], value: unknown): unknown {
  const [head, ...rest] = segments;
  if (head === undefined) {
    return value;
  }

  if (Array.isArray(node)) {
    const index = Number(head);
    const next = [...node];
    next[index] = rest.length === 0 ? value : setAt(node[index], rest, value);
    return next;
  }

  const base = isPlainObject(node) ? node : {};
  const next = { ...base };
  next[head] = rest.length === 0 ? value : setAt(base[head], rest, value);
  return next;
}

/** Applies several path/value overrides at once, e.g. a control that changes two fields together. */
export function setAllAtPaths<T>(root: T, entries: ReadonlyArray<readonly [string, unknown]>): T {
  return entries.reduce((acc, [path, value]) => setAtPath(acc, path, value), root);
}

/** Reads the value at `path` (e.g. `"footage.b2.assetId"`), or `undefined` if any segment along the way is missing. */
export function getAtPath(root: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((node, segment) => {
    if (Array.isArray(node)) return node[Number(segment)];
    if (isPlainObject(node)) return node[segment];
    return undefined;
  }, root);
}

/**
 * Walks up from `path` to the nearest ancestor (including `path`'s own
 * parent) that carries a `reason` field in `plan`, and returns that
 * ancestor's `.reason` path — e.g. `"footage.b2.assetId"` →
 * `"footage.b2.reason"`, `"script.beats.0.narration"` → `"script.reason"`
 * (a `Beat` has no `reason` of its own; the enclosing script section
 * does). Returns `null` if nothing on the way up has one (e.g. `format.*`,
 * which is a plain, reason-free record).
 */
export function nearestReasonPath(plan: unknown, path: string): string | null {
  const segments = path.split(".");
  for (let end = segments.length - 1; end >= 1; end--) {
    const ancestor = segments.slice(0, end).join(".");
    if (typeof getAtPath(plan, `${ancestor}.reason`) === "string") {
      return `${ancestor}.reason`;
    }
  }
  return null;
}
