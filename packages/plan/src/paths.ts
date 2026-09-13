/**
 * Plan paths: turning a plan document into a flat list of leaf values
 * addressed by a dot-separated path (e.g. `footage.b2.assetId`), and
 * diffing two plans down to the paths that actually changed.
 *
 * This is the addressing scheme both `graph.ts` (which stage owns a path)
 * and `artifact.ts` (which paths feed a stage's content hash) are built on.
 */

export interface Leaf {
  readonly path: string;
  readonly value: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Walks a JSON-like value to its leaves. An empty object or empty array is
 * its own leaf (there is nothing under it to walk into). Object key order
 * does not affect the result — callers that need a stable order should sort
 * by `path`.
 */
export function leavesOf(value: unknown, prefix: readonly string[] = []): Leaf[] {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [{ path: prefix.join("."), value: [] }];
    }
    return value.flatMap((item, index) => leavesOf(item, [...prefix, String(index)]));
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      return [{ path: prefix.join("."), value: {} }];
    }
    return keys.flatMap((key) => leavesOf(value[key], [...prefix, key]));
  }

  return [{ path: prefix.join("."), value }];
}

/**
 * Returns the sorted, de-duplicated list of leaf paths that differ between
 * `before` and `after` — added, removed or changed. Comparison is by value
 * (via JSON.stringify), not by reference, so a field set to an equal but
 * newly-allocated value is not reported as changed.
 */
export function diffPaths(before: unknown, after: unknown): string[] {
  const beforeLeaves = new Map(leavesOf(before).map((leaf) => [leaf.path, JSON.stringify(leaf.value)]));
  const afterLeaves = new Map(leavesOf(after).map((leaf) => [leaf.path, JSON.stringify(leaf.value)]));

  const allPaths = new Set<string>([...beforeLeaves.keys(), ...afterLeaves.keys()]);
  const changed: string[] = [];
  for (const path of allPaths) {
    if (beforeLeaves.get(path) !== afterLeaves.get(path)) {
      changed.push(path);
    }
  }
  return changed.sort();
}
