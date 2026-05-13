// One-shot codemod: inject `enforceAdminRateLimit` into every admin route
// handler. Idempotent — skips files that already import the helper.
// Run from project root: node scripts/_inject-admin-rate-limit.mjs
import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const ADMIN_DIR = path.join(ROOT, "app", "api", "admin");

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else if (e.isFile() && e.name === "route.ts") out.push(full);
  }
  return out;
}

const HANDLER_RE =
  /export\s+async\s+function\s+(GET|POST|PUT|DELETE|PATCH)\s*\(([\s\S]*?)\)\s*\{/g;

/**
 * Insert the rate-limit guard immediately after each line containing
 * `Forbidden`. If the next line is a stand-alone `}` (the closing brace
 * of a braced `if { return ... }` block), insert after that `}` instead.
 * This handles all three observed patterns:
 *   - braced:    `if (X) {\n  return ...Forbidden...;\n}`
 *   - braceless: `if (X)\n  return ...Forbidden...;`
 *   - one-line:  `if (X) return ...Forbidden...;`
 *
 * Skips guards inside helper functions (not `export async function`) so
 * we don't double-inject; that case requires manual review.
 */
function injectGuards(source) {
  const lines = source.split("\n");
  const result = [];
  let i = 0;
  let insideExportedHandler = false;
  let handlerEntered = false;
  let handlerBraceDepth = 0;
  while (i < lines.length) {
    const line = lines[i];
    result.push(line);

    // Track when we enter / leave an exported async handler.
    if (/^export\s+async\s+function\s+(GET|POST|PUT|DELETE|PATCH)\b/.test(line)) {
      insideExportedHandler = true;
      handlerEntered = false;
      handlerBraceDepth = 0;
      for (const ch of line) {
        if (ch === "{") handlerBraceDepth++;
        else if (ch === "}") handlerBraceDepth--;
      }
      if (handlerBraceDepth > 0) handlerEntered = true;
      i++;
      continue;
    }
    if (insideExportedHandler) {
      for (const ch of line) {
        if (ch === "{") handlerBraceDepth++;
        else if (ch === "}") handlerBraceDepth--;
      }
      if (handlerBraceDepth > 0) handlerEntered = true;
      if (handlerEntered && handlerBraceDepth <= 0) {
        insideExportedHandler = false;
      }
    }

    if (insideExportedHandler && line.includes("Forbidden")) {
      // Determine the indentation of the line immediately before the
      // Forbidden statement (the `if (...)` line). That sets where the
      // guard should sit.
      // Easiest: use the indent of the Forbidden line if the previous
      // line is `if (...) {`, otherwise use the previous line's indent.
      let prevLine = i > 0 ? lines[i - 1] : "";
      const prevTrimmed = prevLine.trim();
      const isBraceless =
        prevTrimmed.startsWith("if") && !prevTrimmed.endsWith("{");
      const isOneLine =
        line.trim().startsWith("if") && line.includes("Forbidden");
      const forbiddenIndent = (line.match(/^[ \t]*/) || [""])[0];
      const prevIndent = (prevLine.match(/^[ \t]*/) || [""])[0];

      // Indent of the guard:
      // - braced:    one less level than Forbidden indent (= prev `if` indent)
      // - braceless: prev `if` indent
      // - one-line:  Forbidden indent (the `if` IS this line)
      let guardIndent;
      let insertAfterIdx;

      if (isOneLine) {
        guardIndent = forbiddenIndent;
        insertAfterIdx = i;
      } else if (isBraceless) {
        guardIndent = prevIndent;
        insertAfterIdx = i;
      } else {
        // Braced: next non-empty line should be `}`. Skip it.
        guardIndent =
          forbiddenIndent.length >= 2
            ? forbiddenIndent.slice(0, forbiddenIndent.length - 2)
            : forbiddenIndent;
        // Find the matching close brace line (stand-alone `}`).
        let j = i + 1;
        while (j < lines.length && lines[j].trim() === "") {
          result.push(lines[j]);
          j++;
        }
        if (j < lines.length && lines[j].trim() === "}") {
          result.push(lines[j]);
          insertAfterIdx = j;
        } else {
          // Fall back: insert immediately after Forbidden line.
          insertAfterIdx = i;
        }
      }

      result.push(
        `${guardIndent}const __rateLimit = await enforceAdminRateLimit(req, session);`,
      );
      result.push(`${guardIndent}if (__rateLimit) return __rateLimit;`);
      i = insertAfterIdx + 1;
      continue;
    }
    i++;
  }
  return result.join("\n");
}

/**
 * Place the helper import on a fresh line right after the LAST top-level
 * import statement, correctly handling multi-line imports.
 */
function injectImport(source) {
  if (source.includes('from "@/lib/rate-limit-admin"')) return source;
  const lines = source.split("\n");
  let lastImportEnd = -1;
  let braceDepth = 0;
  let inImport = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inImport && /^\s*import\b/.test(line)) {
      inImport = true;
    }
    if (inImport) {
      for (const ch of line) {
        if (ch === "{") braceDepth++;
        else if (ch === "}") braceDepth--;
      }
      if (
        braceDepth === 0 &&
        (/from\s+["']/.test(line) || /^\s*import\s+["']/.test(line))
      ) {
        lastImportEnd = i;
        inImport = false;
      }
    }
  }
  if (lastImportEnd === -1) {
    return (
      'import { enforceAdminRateLimit } from "@/lib/rate-limit-admin";\n' +
      source
    );
  }
  lines.splice(
    lastImportEnd + 1,
    0,
    'import { enforceAdminRateLimit } from "@/lib/rate-limit-admin";',
  );
  return lines.join("\n");
}

/**
 * For handlers that received a guard, ensure the parameter list exposes
 * `req`. Handlers untouched (e.g. GET that doesn't gate) keep their
 * original signature.
 */
function fixSignaturesForGuardedHandlers(source) {
  const handlerRe = new RegExp(HANDLER_RE.source, "g");
  let out = "";
  let cursor = 0;
  let m;
  while ((m = handlerRe.exec(source))) {
    const headerStart = m.index;
    const bodyStart = m.index + m[0].length;
    let depth = 1;
    let i = bodyStart;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      i++;
    }
    const bodyEnd = i;
    const body = source.slice(bodyStart, bodyEnd);
    const hasGuard = body.includes("enforceAdminRateLimit(req, session)");

    out += source.slice(cursor, headerStart);

    if (hasGuard) {
      const params = m[2];
      const fixed = ensureReqParam(params);
      if (fixed !== params) {
        const openIdx = m[0].indexOf("(");
        const closeIdx = m[0].lastIndexOf(")");
        const newHeader =
          m[0].slice(0, openIdx + 1) + fixed + m[0].slice(closeIdx);
        out += newHeader;
      } else {
        out += m[0];
      }
    } else {
      out += m[0];
    }
    out += source.slice(bodyStart, bodyEnd);
    cursor = bodyEnd;
  }
  out += source.slice(cursor);
  return out;
}

function ensureReqParam(signature) {
  const leadingMatch = signature.match(/^[\s]*/);
  const leading = leadingMatch ? leadingMatch[0] : "";
  const rest = signature.slice(leading.length);

  if (rest.trim() === "") return "req: Request";
  if (rest.startsWith("_req")) return leading + "req" + rest.slice(4);
  return signature;
}

function processFile(source) {
  if (source.includes("enforceAdminRateLimit")) return source;
  if (!source.includes("Forbidden")) return source;

  let out = injectGuards(source);
  // If nothing actually got injected (e.g. all Forbidden tokens live in a
  // helper, not in an exported handler), skip — leave manual.
  if (!out.includes("enforceAdminRateLimit(req, session)")) {
    return source;
  }
  out = fixSignaturesForGuardedHandlers(out);
  out = injectImport(out);
  return out;
}

async function main() {
  const files = await walk(ADMIN_DIR);
  let changed = 0;
  const skipped = [];
  for (const f of files) {
    const before = await fs.readFile(f, "utf8");
    const after = processFile(before);
    if (after !== before) {
      await fs.writeFile(f, after, "utf8");
      changed++;
    } else if (!before.includes("enforceAdminRateLimit")) {
      skipped.push(path.relative(ROOT, f));
    }
  }
  console.log(`Rewrote ${changed}/${files.length} admin route files.`);
  if (skipped.length) {
    console.log("Skipped (Forbidden lives in a helper — apply manually):");
    for (const s of skipped) console.log("  " + s);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
