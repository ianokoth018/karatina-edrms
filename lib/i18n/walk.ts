/**
 * Helpers for enumerating dotted keys / values inside a nested dictionary
 * object. Shared by the admin "missing translations" API and any other
 * tooling that wants to diff dictionaries.
 */

type Nested = { [key: string]: string | Nested };

export function flattenDictionary(
  dict: unknown,
  prefix = ""
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!dict || typeof dict !== "object") return out;

  for (const [k, v] of Object.entries(dict as Nested)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") {
      out[path] = v;
    } else if (v && typeof v === "object") {
      Object.assign(out, flattenDictionary(v, path));
    }
  }
  return out;
}
