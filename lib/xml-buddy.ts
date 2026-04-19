/**
 * XML buddy-file parser — extracts scanner sidecar metadata.
 *
 * KARU scanners emit an XML alongside each captured document with shape:
 *
 *   <root>
 *     <document>
 *       <field level="batch"    name="Student Name"         value="JOY WANJIRU" />
 *       <field level="batch"    name="Registration Number"  value="E112-3127G-24" />
 *       <field level="document" name="Document Description" value="ADMISSION LETTER" />
 *     </document>
 *   </root>
 *
 * We tolerate several real-world variations:
 *   · attribute order (`value` before `name` etc.)
 *   · single- OR double-quoted attributes (the XML parser handles both)
 *   · child-element form — `<field name="X"><value>Y</value></field>`
 *   · XML entities (`&amp;`, `&lt;`, `&quot;` …) — decoded by the parser
 *   · fields nested arbitrarily deep (we walk the whole tree)
 *   · multiple <document> blocks in one file (all fields are merged)
 *   · <batch-level> / <document-level> wrapper elements that some variants use
 *
 * The returned shape:
 *   {
 *     fields:      Array<{ name, value, level? }>,  // all extracted fields
 *     metadata:    Record<string, string>,          // name → value (camelCased key)
 *     rawByLabel:  Record<string, string>,          // original label → value
 *   }
 *
 * Callers compose this with casefolder-field remapping (xmlFieldName) to
 * land values on the correct form keys.
 */

import { XMLParser } from "fast-xml-parser";
import { promises as fs } from "fs";
import path from "path";

export interface BuddyField {
  name: string;
  value: string;
  level?: string;
}

export interface BuddyParseResult {
  found: boolean;
  xmlPath: string | null;
  fields: BuddyField[];
  metadata: Record<string, string>;
  rawByLabel: Record<string, string>;
  error: string | null;
}

const EMPTY: Omit<BuddyParseResult, "xmlPath"> = {
  found: false,
  fields: [],
  metadata: {},
  rawByLabel: {},
  error: null,
};

function toCamelCaseKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Walk an arbitrary parsed-XML object and yield every node whose tag name is
 * `field` (case-insensitive) regardless of nesting depth or surrounding tags.
 * Works against fast-xml-parser's output (plain objects where arrays represent
 * repeated elements and attributes are prefixed with `@_`).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function* walkFieldNodes(node: any): Generator<any> {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (const item of node) yield* walkFieldNodes(item);
    return;
  }
  if (typeof node !== "object") return;

  for (const [key, value] of Object.entries(node)) {
    if (key.toLowerCase() === "field") {
      if (Array.isArray(value)) {
        for (const f of value) yield f;
      } else {
        yield value;
      }
      continue;
    }
    // Recurse into nested wrappers (root, document, batch-level, etc.)
    yield* walkFieldNodes(value);
  }
}

/**
 * Normalise a single `<field>` node into { name, value, level? }. Handles
 * attribute form `<field name=".." value=".." />` and child-element form
 * `<field name=".."><value>..</value></field>` and the mixed variant where
 * `name` is a child element too.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readFieldNode(node: any): BuddyField | null {
  if (node === null || node === undefined) return null;

  // Attributes populated by fast-xml-parser with `@_` prefix
  const attrs = typeof node === "object" ? node : {};
  const attrName =
    attrs["@_name"] ?? attrs["@_Name"] ?? attrs["@_NAME"] ?? attrs.name;
  const attrValue =
    attrs["@_value"] ?? attrs["@_Value"] ?? attrs["@_VALUE"] ?? attrs.value;
  const attrLevel =
    attrs["@_level"] ?? attrs["@_Level"] ?? attrs["@_LEVEL"] ?? attrs.level;

  // Child-element fallbacks (only when an attribute is missing)
  const childValue =
    attrs.Value ?? attrs.VALUE ?? (typeof attrs === "object" ? attrs.value : undefined);
  const childName = attrs.Name ?? attrs.NAME;

  const name = String(attrName ?? childName ?? "").trim();
  let value: unknown = attrValue;
  if (value === undefined || value === null || value === "") {
    value = childValue;
  }
  // fast-xml-parser may produce a primitive (string/number) directly for
  // <field>Y</field>; take node's own text content as a last resort.
  if ((value === undefined || value === "") && attrs["#text"] !== undefined) {
    value = attrs["#text"];
  }

  if (!name) return null;
  if (value === undefined || value === null) return null;
  const strValue = String(value).trim();
  if (strValue === "") return null;

  return {
    name,
    value: strValue,
    level: attrLevel ? String(attrLevel).trim() : undefined,
  };
}

/**
 * Parse an XML string and return structured field data.
 *
 * Exported for unit testing — production code should prefer
 * `parseXmlBuddyFile()` which handles disk I/O and path derivation.
 */
export function parseXmlContent(xmlContent: string): Omit<BuddyParseResult, "xmlPath"> {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    allowBooleanAttributes: true,
    trimValues: true,
    processEntities: true,
    parseAttributeValue: false,
    parseTagValue: false,
    // Always coerce repeated tags to arrays so we don't have to branch.
    isArray: (tagName) => tagName.toLowerCase() === "field",
  });

  let tree: unknown;
  try {
    tree = parser.parse(xmlContent);
  } catch (err) {
    return {
      ...EMPTY,
      error: `XML parse error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const fields: BuddyField[] = [];
  for (const node of walkFieldNodes(tree)) {
    const f = readFieldNode(node);
    if (f) fields.push(f);
  }

  const metadata: Record<string, string> = {};
  const rawByLabel: Record<string, string> = {};
  for (const f of fields) {
    const key = toCamelCaseKey(f.name);
    if (key) metadata[key] = f.value;
    rawByLabel[f.name] = f.value;
    // Preserve the legacy _raw_<label> convention the rest of the app reads.
    metadata[`_raw_${f.name}`] = f.value;
  }

  return {
    found: fields.length > 0,
    fields,
    metadata,
    rawByLabel,
    error: null,
  };
}

/**
 * Read and parse the XML buddy file for a given document path.
 * Convention: `filename.pdf` has `filename.xml` alongside it.
 */
export async function parseXmlBuddyFile(
  documentFilePath: string
): Promise<BuddyParseResult> {
  const dir = path.dirname(documentFilePath);
  const baseName = path.basename(documentFilePath, path.extname(documentFilePath));
  const xmlPath = path.join(dir, `${baseName}.xml`);

  try {
    await fs.access(xmlPath);
  } catch {
    return { ...EMPTY, xmlPath: null };
  }

  let xmlContent: string;
  try {
    xmlContent = await fs.readFile(xmlPath, "utf-8");
  } catch (err) {
    return {
      ...EMPTY,
      xmlPath,
      error: `Read error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const result = parseXmlContent(xmlContent);
  return { ...result, xmlPath };
}
