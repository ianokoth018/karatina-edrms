/**
 * AES-256-GCM Document Encryption — At-rest encryption for all stored files.
 *
 * Every file stored in uploads/ is encrypted with AES-256-GCM using the
 * ENCRYPTION_KEY from environment. The IV and auth tag are stored in the
 * DocumentFile record for decryption.
 *
 * - encrypt(): Encrypts a buffer, returns { encrypted, iv, tag }
 * - decrypt(): Decrypts using stored iv + tag
 * - encryptFile(): Encrypts a file on disk in-place
 * - decryptFileToBuffer(): Reads encrypted file and returns decrypted buffer
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { promises as fs } from "fs";
import { createReadStream, createWriteStream } from "fs";
import { pipeline } from "stream/promises";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16; // 128 bits
const TAG_LENGTH = 16; // 128 bits

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length < 64) {
    throw new Error(
      "ENCRYPTION_KEY is missing or invalid. Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  return Buffer.from(hex, "hex");
}

/**
 * Encrypt a buffer with AES-256-GCM.
 * Returns the encrypted data, IV (hex), and auth tag (hex).
 */
export function encrypt(data: Buffer): {
  encrypted: Buffer;
  iv: string;
  tag: string;
} {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    encrypted,
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
  };
}

/**
 * Decrypt a buffer using AES-256-GCM with the stored IV and tag.
 */
export function decrypt(
  encrypted: Buffer,
  ivHex: string,
  tagHex: string
): Buffer {
  const key = getKey();
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

/**
 * Encrypt a file on disk in-place.
 * Reads the file, encrypts it, writes back the encrypted version.
 * Returns { iv, tag } for storage in the database.
 */
export async function encryptFile(
  filePath: string
): Promise<{ iv: string; tag: string }> {
  const plaintext = await fs.readFile(filePath);
  const { encrypted, iv, tag } = encrypt(plaintext);
  await fs.writeFile(filePath, encrypted);
  return { iv, tag };
}

/**
 * Read an encrypted file and return the decrypted buffer.
 * If iv/tag are null (unencrypted legacy file), returns the raw file contents.
 */
export async function decryptFileToBuffer(
  filePath: string,
  ivHex: string | null,
  tagHex: string | null
): Promise<Buffer> {
  const data = await fs.readFile(filePath);

  // Unencrypted legacy file — return as-is
  if (!ivHex || !tagHex) {
    return data;
  }

  return decrypt(data, ivHex, tagHex);
}

/**
 * Check if encryption is configured.
 */
export function isEncryptionEnabled(): boolean {
  const hex = process.env.ENCRYPTION_KEY;
  return !!hex && hex.length >= 64;
}

/**
 * Encrypt a file on disk in-place using streaming — no full-file RAM buffer.
 * Reads source → encrypts via AES-256-GCM transform → writes to temp file → renames over source.
 * Returns { iv, tag } for storage in the database.
 */
export async function encryptFileStreaming(
  filePath: string
): Promise<{ iv: string; tag: string }> {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const tmpPath = `${filePath}.enc.tmp`;
  const readStream = createReadStream(filePath);
  const writeStream = createWriteStream(tmpPath);

  await pipeline(readStream, cipher, writeStream);
  const tag = cipher.getAuthTag();

  // Atomically replace original with encrypted version
  const { rename } = await import("fs/promises");
  await rename(tmpPath, filePath);

  return { iv: iv.toString("hex"), tag: tag.toString("hex") };
}

/**
 * Encrypt a string secret (IMAP/SFTP/SMB password) with AES-256-GCM.
 * Output format: enc:v1:<iv_hex>:<tag_hex>:<ciphertext_hex>
 */
export function encryptSecret(plaintext: string): string {
  const { encrypted, iv, tag } = encrypt(Buffer.from(plaintext, "utf8"));
  return `enc:v1:${iv}:${tag}:${encrypted.toString("hex")}`;
}

export function decryptSecret(wrapped: string): string {
  if (!wrapped.startsWith("enc:v1:")) {
    throw new Error("Invalid encrypted secret format");
  }
  const [, , iv, tag, ciphertext] = wrapped.split(":");
  return decrypt(Buffer.from(ciphertext, "hex"), iv, tag).toString("utf8");
}

export function isEncryptedSecret(value: string | null | undefined): boolean {
  return !!value && value.startsWith("enc:v1:");
}

/**
 * Create a streaming AES-256-GCM decryption Transform.
 * Call setAuthTag on the returned decipher BEFORE piping data through it.
 * Usage:
 *   const decipher = createDecryptStream(ivHex, tagHex);
 *   readStream.pipe(decipher).pipe(destination);
 */
export function createDecryptStream(
  ivHex: string,
  tagHex: string
): ReturnType<typeof createDecipheriv> {
  const key = getKey();
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher;
}
