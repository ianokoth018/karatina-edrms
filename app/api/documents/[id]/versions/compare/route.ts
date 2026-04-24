import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

interface DiffChunk {
  type: "equal" | "insert" | "delete";
  lines: string[];
}

function computeDiff(a: string[], b: string[]): DiffChunk[] {
  const m = a.length;
  const n = b.length;
  const max = m + n;
  const v: Record<number, number> = { 1: 0 };
  const trace: Record<number, number>[] = [];

  for (let d = 0; d <= max; d++) {
    trace.push({ ...v });
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && (v[k - 1] ?? 0) < (v[k + 1] ?? 0))) {
        x = v[k + 1] ?? 0;
      } else {
        x = (v[k - 1] ?? 0) + 1;
      }
      let y = x - k;
      while (x < m && y < n && a[x] === b[y]) {
        x++;
        y++;
      }
      v[k] = x;
      if (x >= m && y >= n) {
        return backtrack(a, b, trace, d);
      }
    }
  }
  return [{ type: "delete", lines: a }, { type: "insert", lines: b }];
}

function backtrack(
  a: string[],
  b: string[],
  trace: Record<number, number>[],
  d: number
): DiffChunk[] {
  const moves: { type: "equal" | "insert" | "delete"; x: number; y: number }[] = [];
  let x = a.length;
  let y = b.length;

  for (let step = d; step > 0; step--) {
    const v = trace[step];
    const k = x - y;
    let prevK: number;
    if (k === -step || (k !== step && (v[k - 1] ?? 0) < (v[k + 1] ?? 0))) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = v[prevK] ?? 0;
    const prevY = prevX - prevK;
    while (x > prevX + 1 && y > prevY + 1) {
      moves.unshift({ type: "equal", x: x - 1, y: y - 1 });
      x--;
      y--;
    }
    if (step > 0) {
      if (x === prevX + 1 && y === prevY) {
        moves.unshift({ type: "delete", x: x - 1, y });
        x = prevX;
        y = prevY;
      } else {
        moves.unshift({ type: "insert", x, y: y - 1 });
        x = prevX;
        y = prevY;
      }
    }
  }
  while (x > 0 && y > 0) {
    moves.unshift({ type: "equal", x: x - 1, y: y - 1 });
    x--;
    y--;
  }

  const chunks: DiffChunk[] = [];
  for (const move of moves) {
    const line = move.type === "delete" ? a[move.x] : b[move.y];
    const last = chunks[chunks.length - 1];
    if (last && last.type === move.type) {
      last.lines.push(line);
    } else {
      chunks.push({ type: move.type, lines: [line] });
    }
  }
  return chunks;
}

function serialiseBigInt(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  if (typeof data === "bigint") return data.toString();
  if (data instanceof Date) return data.toISOString();
  if (Array.isArray(data)) return data.map(serialiseBigInt);
  if (typeof data === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      out[k] = serialiseBigInt(v);
    }
    return out;
  }
  return data;
}

function formatFileSize(bytes: bigint): string {
  const n = Number(bytes);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const v1Id = searchParams.get("v1");
    const v2Id = searchParams.get("v2");

    if (!v1Id || !v2Id) {
      return NextResponse.json(
        { error: "Both v1 and v2 query parameters are required" },
        { status: 400 }
      );
    }

    if (v1Id === v2Id) {
      return NextResponse.json(
        { error: "Cannot compare a version with itself" },
        { status: 400 }
      );
    }

    const document = await db.document.findUnique({
      where: { id },
      select: { id: true, referenceNumber: true },
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const [version1, version2] = await Promise.all([
      db.documentVersion.findFirst({ where: { id: v1Id, documentId: id } }),
      db.documentVersion.findFirst({ where: { id: v2Id, documentId: id } }),
    ]);

    if (!version1) {
      return NextResponse.json({ error: `Version ${v1Id} not found` }, { status: 404 });
    }
    if (!version2) {
      return NextResponse.json({ error: `Version ${v2Id} not found` }, { status: 404 });
    }

    const isPdf =
      (version1.mimeType ?? "").includes("pdf") ||
      (version2.mimeType ?? "").includes("pdf");

    if (isPdf) {
      const [file1, file2] = await Promise.all([
        db.documentFile.findFirst({
          where: { documentId: id, storagePath: version1.storagePath },
          select: { ocrText: true },
        }),
        db.documentFile.findFirst({
          where: { documentId: id, storagePath: version2.storagePath },
          select: { ocrText: true },
        }),
      ]);

      const lines1 = (file1?.ocrText ?? "").split("\n");
      const lines2 = (file2?.ocrText ?? "").split("\n");
      const diff = computeDiff(lines1, lines2);

      return NextResponse.json(
        serialiseBigInt({
          v1: {
            versionNum: version1.versionNum,
            label: version1.label,
            status: version1.status,
            ocrText: file1?.ocrText ?? null,
          },
          v2: {
            versionNum: version2.versionNum,
            label: version2.label,
            status: version2.status,
            ocrText: file2?.ocrText ?? null,
          },
          diff,
        })
      );
    }

    const metaDiff: { field: string; before: unknown; after: unknown }[] = [];

    if (version1.sizeBytes !== version2.sizeBytes) {
      metaDiff.push({
        field: "size",
        before: formatFileSize(version1.sizeBytes),
        after: formatFileSize(version2.sizeBytes),
      });
    }
    if (version1.mimeType !== version2.mimeType) {
      metaDiff.push({ field: "mimeType", before: version1.mimeType, after: version2.mimeType });
    }
    if (version1.changeNote !== version2.changeNote) {
      metaDiff.push({ field: "changeNote", before: version1.changeNote, after: version2.changeNote });
    }
    if (version1.label !== version2.label) {
      metaDiff.push({ field: "label", before: version1.label, after: version2.label });
    }
    if (version1.status !== version2.status) {
      metaDiff.push({ field: "status", before: version1.status, after: version2.status });
    }

    return NextResponse.json(
      serialiseBigInt({
        v1: {
          versionNum: version1.versionNum,
          label: version1.label,
          status: version1.status,
        },
        v2: {
          versionNum: version2.versionNum,
          label: version2.label,
          status: version2.status,
        },
        metaDiff,
      })
    );
  } catch (error) {
    logger.error("Version comparison failed", error, {
      route: "/api/documents/[id]/versions/compare",
      method: "GET",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
