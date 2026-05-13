/**
 * Pure-TypeScript diff helpers used by the document version comparison
 * feature. No external dependencies; both algorithms are O(m*n) in time
 * and memory which is more than adequate for the small text blobs
 * (change notes, labels, file names) we currently feed through them.
 */

export type LineDiffType = "equal" | "add" | "del";

export interface LineDiffChunk {
  type: LineDiffType;
  text: string;
}

export interface MetadataDiffEntry {
  key: string;
  before: unknown;
  after: unknown;
}

/**
 * Line-by-line diff between two text blobs using a classic LCS table.
 *
 *   - `equal` lines are present in both sides (the same logical line)
 *   - `del`   lines are present only in `a` (removed in `b`)
 *   - `add`   lines are present only in `b` (introduced in `b`)
 *
 * The output is interleaved in the order needed to reconstruct either
 * side — callers that want a strict side-by-side view should filter on
 * `type !== "add"` for the left column and `type !== "del"` for the
 * right column.
 *
 * Splitting uses `\n` and keeps trailing empty lines.
 */
export function diffText(a: string, b: string): LineDiffChunk[] {
  const aLines = a.length === 0 ? [] : a.split("\n");
  const bLines = b.length === 0 ? [] : b.split("\n");

  const m = aLines.length;
  const n = bLines.length;

  // Build the LCS length table. lcs[i][j] = length of the longest common
  // subsequence of aLines[0..i] and bLines[0..j].
  const lcs: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0)
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (aLines[i - 1] === bLines[j - 1]) {
        lcs[i][j] = lcs[i - 1][j - 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i - 1][j], lcs[i][j - 1]);
      }
    }
  }

  // Backtrack to produce the diff in forward order.
  const out: LineDiffChunk[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (aLines[i - 1] === bLines[j - 1]) {
      out.push({ type: "equal", text: aLines[i - 1] });
      i--;
      j--;
    } else if (lcs[i - 1][j] >= lcs[i][j - 1]) {
      out.push({ type: "del", text: aLines[i - 1] });
      i--;
    } else {
      out.push({ type: "add", text: bLines[j - 1] });
      j--;
    }
  }
  while (i > 0) {
    out.push({ type: "del", text: aLines[i - 1] });
    i--;
  }
  while (j > 0) {
    out.push({ type: "add", text: bLines[j - 1] });
    j--;
  }
  return out.reverse();
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, idx) => valuesEqual(v, b[idx]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => valuesEqual(a[k], b[k]));
  }
  return false;
}

/**
 * Flat key-by-key comparison of two records. Keys missing on either side
 * are reported with a `null` value on that side. Only keys whose values
 * actually differ are included in the result.
 */
export function diffMetadata(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): MetadataDiffEntry[] {
  const keys = new Set<string>([...Object.keys(a), ...Object.keys(b)]);
  const out: MetadataDiffEntry[] = [];
  for (const key of Array.from(keys).sort()) {
    const before = key in a ? a[key] : null;
    const after = key in b ? b[key] : null;
    if (!valuesEqual(before, after)) {
      out.push({ key, before, after });
    }
  }
  return out;
}
