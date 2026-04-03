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
