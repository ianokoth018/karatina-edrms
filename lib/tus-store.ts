// lib/tus-store.ts
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

const TUS_DIR = path.join(process.cwd(), "uploads", "tus");

export interface TusUpload {
  uploadId: string;
  length: number;       // Upload-Length declared at creation
  offset: number;       // bytes successfully received so far
  metadata: Record<string, string>; // decoded Upload-Metadata header
  createdAt: string;    // ISO timestamp
  complete: boolean;
}

async function ensureDir() {
  await fs.mkdir(TUS_DIR, { recursive: true });
}

function metaPath(uploadId: string) {
  return path.join(TUS_DIR, `${uploadId}.json`);
}

function binPath(uploadId: string) {
  return path.join(TUS_DIR, `${uploadId}.bin`);
}

/** Create a new upload slot and return its id */
export async function createUpload(
  length: number,
  metadata: Record<string, string>
): Promise<TusUpload> {
  await ensureDir();
  const uploadId = randomUUID();
  const upload: TusUpload = {
    uploadId,
    length,
    offset: 0,
    metadata,
    createdAt: new Date().toISOString(),
    complete: false,
  };
  await fs.writeFile(metaPath(uploadId), JSON.stringify(upload), "utf8");
  // Create empty bin file
  await fs.writeFile(binPath(uploadId), Buffer.alloc(0));
  return upload;
}

/** Load upload state. Returns null if not found. */
export async function getUpload(uploadId: string): Promise<TusUpload | null> {
  try {
    const raw = await fs.readFile(metaPath(uploadId), "utf8");
    return JSON.parse(raw) as TusUpload;
  } catch {
    return null;
  }
}

/** Append a chunk to the upload. Returns new offset. */
export async function appendChunk(
  uploadId: string,
  chunk: Buffer,
  expectedOffset: number
): Promise<{ newOffset: number; complete: boolean }> {
  const upload = await getUpload(uploadId);
  if (!upload) throw new Error("Upload not found");
  if (upload.offset !== expectedOffset) {
    throw new Error(`Offset mismatch: expected ${upload.offset}, got ${expectedOffset}`);
  }

  // Append bytes to the bin file
  const fd = await fs.open(binPath(uploadId), "a");
  try {
    await fd.write(chunk);
  } finally {
    await fd.close();
  }

  const newOffset = upload.offset + chunk.length;
  const complete = newOffset >= upload.length;

  const updated: TusUpload = { ...upload, offset: newOffset, complete };
  await fs.writeFile(metaPath(uploadId), JSON.stringify(updated), "utf8");

  return { newOffset, complete };
}

/** Get the path to the assembled file (call only when complete === true) */
export function getAssembledPath(uploadId: string): string {
  return binPath(uploadId);
}

/** Delete upload state + temp file */
export async function deleteUpload(uploadId: string): Promise<void> {
  await fs.unlink(metaPath(uploadId)).catch(() => {});
  await fs.unlink(binPath(uploadId)).catch(() => {});
}

/** Decode TUS Upload-Metadata header: "key base64val,key2 base64val2" */
export function decodeTusMetadata(header: string | null): Record<string, string> {
  if (!header) return {};
  const result: Record<string, string> = {};
  for (const pair of header.split(",")) {
    const [key, b64] = pair.trim().split(" ");
    if (key) {
      result[key.trim()] = b64 ? Buffer.from(b64.trim(), "base64").toString("utf8") : "";
    }
  }
  return result;
}
