/**
 * OCR with per-word bounding boxes.
 *
 * Primary backend: `ocrmypdf` invoked with `--sidecar` for plain text AND
 *                  `--keep-text` so the existing text layer is preserved.
 *                  We also request hOCR output via `--redo-ocr` + an hOCR
 *                  sidecar (`--sidecar-hocr`) when available; older
 *                  ocrmypdf releases use `--hocr` on the temp pipeline.
 *                  The simplest reliable path: render the OCR'd PDF with
 *                  pdf-lib to obtain per-page dimensions, then run the
 *                  Tesseract CLI (which ocrmypdf wraps) directly on each
 *                  rasterised page if it's available. For portability we
 *                  fall back to `tesseract.js` when the native CLI is not
 *                  present — this keeps Linux & WSL dev installs working
 *                  without extra system packages.
 *
 * Coordinate scheme: every returned word's (x, y, width, height) is
 * normalised to 0–1 against the page that produced it. Top-left origin
 * (consistent with the rest of the EDRMS canvas overlays). The server
 * multiplies by page size when burning to PDF; the client multiplies by
 * the rendered iframe/canvas size to draw rectangles.
 *
 * Export: `extractOcrWords(filePath)` — returns one entry per page,
 * each with `words: OcrWord[]`.
 */
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { XMLParser } from "fast-xml-parser";
import { PDFDocument } from "pdf-lib";
import { logger } from "@/lib/logger";

const execFileAsync = promisify(execFile);

export interface OcrWord {
  page: number;
  /** Normalised 0–1, top-left origin. */
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  /** 0–1 confidence (parsed from Tesseract's 0–100 wconf or 0–1 word data). */
  confidence: number;
}

export interface OcrPageResult {
  page: number;
  /** Page size in pixels at the rendering DPI (for client coord math). */
  pixelWidth: number;
  pixelHeight: number;
  words: OcrWord[];
}

const HOCR_DPI = 300;

/** Probe binary availability. */
async function binaryAvailable(binary: string, arg = "--version"): Promise<boolean> {
  try {
    await execFileAsync(binary, [arg]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse a Tesseract hOCR document into per-page OcrWord arrays.
 *
 * hOCR words look like:
 *   <span class='ocrx_word' title='bbox 100 200 180 220; x_wconf 91'>Hello</span>
 *
 * Pages are `<div class='ocr_page' title='... bbox 0 0 W H; ppageno N'>...`
 *
 * The L/T/R/B inside `bbox` are pixel coordinates in the rasterised page; we
 * normalise by the page bbox so output is resolution-independent.
 */
function parseHocr(hocrXml: string): OcrPageResult[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    preserveOrder: true,
    trimValues: true,
    allowBooleanAttributes: true,
    parseTagValue: false,
  });

  // preserveOrder gives us a nested array of {tag: [children]} objects.
  // Walking it manually is easier than mapping each hOCR variant.
  const tree = parser.parse(hocrXml) as unknown;
  const pages: OcrPageResult[] = [];
  let currentPage: OcrPageResult | null = null;

  function attrTitle(attrs: Record<string, string> | undefined): string {
    return attrs?.["@_title"] ?? "";
  }
  function attrClass(attrs: Record<string, string> | undefined): string {
    return attrs?.["@_class"] ?? "";
  }
  function parseBbox(title: string): { l: number; t: number; r: number; b: number } | null {
    const m = title.match(/bbox\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)/);
    if (!m) return null;
    return { l: +m[1], t: +m[2], r: +m[3], b: +m[4] };
  }
  function parsePageNo(title: string): number | null {
    const m = title.match(/ppageno\s+(\d+)/);
    return m ? +m[1] : null;
  }
  function parseWconf(title: string): number {
    const m = title.match(/x_wconf\s+(\d+)/);
    return m ? Math.max(0, Math.min(1, +m[1] / 100)) : 0;
  }
  function getText(nodes: unknown): string {
    // nodes is the children array from preserveOrder
    if (!Array.isArray(nodes)) return "";
    const parts: string[] = [];
    for (const n of nodes) {
      if (typeof n !== "object" || n === null) continue;
      const rec = n as Record<string, unknown>;
      if ("#text" in rec && typeof rec["#text"] === "string") parts.push(rec["#text"]);
      // recursively traverse nested spans
      for (const k of Object.keys(rec)) {
        if (k === "#text" || k === ":@") continue;
        const v = rec[k];
        if (Array.isArray(v)) parts.push(getText(v));
      }
    }
    return parts.join("").trim();
  }

  function walk(nodes: unknown): void {
    if (!Array.isArray(nodes)) return;
    for (const n of nodes) {
      if (typeof n !== "object" || n === null) continue;
      const rec = n as Record<string, unknown>;
      const tag = Object.keys(rec).find((k) => k !== ":@" && k !== "#text");
      if (!tag) continue;
      const attrs = (rec[":@"] as Record<string, string> | undefined) ?? undefined;
      const cls = attrClass(attrs);
      const title = attrTitle(attrs);
      const children = rec[tag];

      if (cls === "ocr_page") {
        const bb = parseBbox(title);
        const pageNo = parsePageNo(title) ?? (pages.length + 1);
        const pixelWidth = bb ? bb.r - bb.l : 0;
        const pixelHeight = bb ? bb.b - bb.t : 0;
        currentPage = {
          page: pageNo + 1, // hOCR ppageno is 0-based
          pixelWidth,
          pixelHeight,
          words: [],
        };
        pages.push(currentPage);
        walk(children);
        currentPage = null;
        continue;
      }

      if (cls === "ocrx_word" && currentPage && currentPage.pixelWidth > 0) {
        const bb = parseBbox(title);
        if (bb) {
          const text = getText(children);
          if (text) {
            currentPage.words.push({
              page: currentPage.page,
              x: bb.l / currentPage.pixelWidth,
              y: bb.t / currentPage.pixelHeight,
              width: (bb.r - bb.l) / currentPage.pixelWidth,
              height: (bb.b - bb.t) / currentPage.pixelHeight,
              text,
              confidence: parseWconf(title),
            });
          }
        }
        // ocrx_word can't contain another word, but it can have whitespace children
        continue;
      }

      walk(children);
    }
  }
  walk(tree);
  return pages;
}

/**
 * Strategy 1: ocrmypdf hOCR.
 *
 * Modern ocrmypdf (>=14) emits hOCR per page when you pass `--sidecar-hocr`
 * (a single concatenated hOCR file). Older versions need a roundtrip through
 * Tesseract directly. We try the modern path first and bail out cleanly if
 * the flag is rejected so the caller can fall through to the JS fallback.
 */
async function tryOcrMyPdfHocr(filePath: string): Promise<OcrPageResult[] | null> {
  if (!(await binaryAvailable("ocrmypdf"))) return null;

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ocr-hocr-"));
  const outPdf = path.join(tmpDir, "out.pdf");
  const sidecarHocr = path.join(tmpDir, "out.hocr");

  // First attempt: --sidecar-hocr (newer ocrmypdf). If it fails for any
  // reason (unsupported flag, encrypted PDF, etc.) we clean up + return null.
  try {
    await execFileAsync(
      "ocrmypdf",
      [
        "--skip-text",
        "--sidecar-hocr",
        sidecarHocr,
        "--quiet",
        filePath,
        outPdf,
      ],
      { maxBuffer: 64 * 1024 * 1024 },
    );

    const hocrXml = await fs.readFile(sidecarHocr, "utf8");
    const pages = parseHocr(hocrXml);
    if (pages.length > 0) return pages;
  } catch (err) {
    logger.info("ocrmypdf hOCR sidecar unavailable — falling back", {
      err: err instanceof Error ? err.message : String(err),
    });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
  return null;
}

/**
 * Strategy 2: tesseract.js. Rasterise each PDF page to a PNG via pdf-lib +
 * an off-the-shelf renderer would normally be needed, but tesseract.js can
 * read most image formats directly. For PDFs we render them to images on the
 * fly using `pdftoppm` if available; otherwise we ask tesseract.js to read
 * the original file and accept that page-level dimensions come from pdf-lib.
 *
 * Implementation kept minimal: we shell out to `pdftoppm` (part of poppler,
 * a hard-dependency of ocrmypdf anyway) to produce one PNG per page at
 * `HOCR_DPI`, OCR each PNG with tesseract.js, then normalise.
 */
async function tryTesseractJs(filePath: string): Promise<OcrPageResult[] | null> {
  // Dynamic require so missing packages don't break the build.
  let createWorker: (lang?: string) => Promise<{
    recognize: (image: Buffer) => Promise<{
      data: {
        words?: Array<{
          text: string;
          confidence: number;
          bbox: { x0: number; y0: number; x1: number; y1: number };
        }>;
      };
    }>;
    terminate: () => Promise<void>;
  }>;
  try {
    // tesseract.js is an optional dependency — install it only when ocrmypdf
    // can't be used. The dynamic specifier (built from a non-literal) keeps
    // TypeScript happy without an @types entry, and silently skips when the
    // package isn't installed.
    const specifier: string = "tesseract" + ".js";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = (await (Function("s", "return import(s)") as (s: string) => Promise<any>)(specifier)) as any;
    createWorker = mod.createWorker;
    if (typeof createWorker !== "function") return null;
  } catch {
    return null;
  }

  if (!(await binaryAvailable("pdftoppm", "-v"))) {
    // We need a rasteriser; without it we'd have to ship a JS renderer too.
    return null;
  }

  // Probe page sizes via pdf-lib so we can return them alongside results.
  const pdfBytes = await fs.readFile(filePath);
  let pageSizes: { width: number; height: number }[];
  try {
    const probe = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    pageSizes = probe.getPages().map((p) => ({ width: p.getWidth(), height: p.getHeight() }));
  } catch {
    return null;
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ocr-tess-"));
  try {
    // Rasterise: pdftoppm -png -r 300 input.pdf out → out-1.png, out-2.png, …
    await execFileAsync("pdftoppm", [
      "-png",
      "-r", String(HOCR_DPI),
      filePath,
      path.join(tmpDir, "p"),
    ]);
    const files = (await fs.readdir(tmpDir))
      .filter((f) => f.endsWith(".png"))
      .sort();

    const worker = await createWorker("eng");
    try {
      const out: OcrPageResult[] = [];
      for (let i = 0; i < files.length; i++) {
        const img = await fs.readFile(path.join(tmpDir, files[i]));
        const res = await worker.recognize(img);
        const words = res.data.words ?? [];
        const pixelWidth = Math.round(pageSizes[i]?.width ?? 0) * (HOCR_DPI / 72);
        const pixelHeight = Math.round(pageSizes[i]?.height ?? 0) * (HOCR_DPI / 72);
        if (pixelWidth === 0 || pixelHeight === 0) continue;
        out.push({
          page: i + 1,
          pixelWidth,
          pixelHeight,
          words: words
            .filter((w) => w.text && w.text.trim().length > 0)
            .map((w) => ({
              page: i + 1,
              x: w.bbox.x0 / pixelWidth,
              y: w.bbox.y0 / pixelHeight,
              width: (w.bbox.x1 - w.bbox.x0) / pixelWidth,
              height: (w.bbox.y1 - w.bbox.y0) / pixelHeight,
              text: w.text,
              confidence: Math.max(0, Math.min(1, w.confidence / 100)),
            })),
        });
      }
      return out;
    } finally {
      await worker.terminate().catch(() => {});
    }
  } catch (err) {
    logger.info("tesseract.js OCR failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Public entry point — produce per-word bounding boxes for the file at
 * `filePath`. Returns an empty array if both backends are unavailable.
 *
 * Resolution: tries ocrmypdf+hOCR first, then tesseract.js. We always
 * normalise to 0–1 coordinates so the renderer doesn't care which one ran.
 */
export async function extractOcrWords(filePath: string): Promise<OcrPageResult[]> {
  const hocr = await tryOcrMyPdfHocr(filePath);
  if (hocr && hocr.length > 0) return hocr;

  const tess = await tryTesseractJs(filePath);
  if (tess && tess.length > 0) return tess;

  return [];
}
