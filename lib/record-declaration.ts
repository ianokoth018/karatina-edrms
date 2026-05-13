import { db } from "@/lib/db";

/**
 * Record-declaration helpers (DoD 5015.2 / ISO 16175 cornerstone).
 *
 * A declared record is immutable: its title, description, metadata, tags,
 * file content (new versions), classification, retention schedule, and
 * delete operations are all rejected at the API layer. ACL changes, legal
 * hold, and the formal disposition flow are still permitted because they
 * are themselves audited records-management actions.
 *
 * Reversal ("undeclare") requires `records:manage` or admin and is
 * always audited. Disposition continues to go through the certificate
 * workflow in /lib/retention-disposition.ts.
 */

export type DeclaredRecordSlice = {
  id: string;
  declaredAsRecordAt: Date | null;
};

export function isDeclaredRecord<T extends DeclaredRecordSlice>(doc: T): boolean {
  return doc.declaredAsRecordAt !== null;
}

export class RecordDeclaredError extends Error {
  readonly statusCode = 423; // Locked
  constructor(readonly documentId: string) {
    super(
      "This document is a declared record and cannot be modified. Reverse the declaration first if you have the records:manage permission.",
    );
    this.name = "RecordDeclaredError";
  }
}

/**
 * Throw {@link RecordDeclaredError} when the document is declared. Used by
 * mutating endpoints to gate edits with a single line.
 */
export function assertNotDeclaredRecord<T extends DeclaredRecordSlice>(doc: T): void {
  if (isDeclaredRecord(doc)) {
    throw new RecordDeclaredError(doc.id);
  }
}

/**
 * DB lookup variant for callers that haven't selected the declaration columns.
 * Returns true when the document exists AND is declared.
 */
export async function isDocumentDeclared(documentId: string): Promise<boolean> {
  const row = await db.document.findUnique({
    where: { id: documentId },
    select: { declaredAsRecordAt: true },
  });
  return row !== null && row.declaredAsRecordAt !== null;
}

/**
 * True when the caller is authorised to declare / undeclare records. Admin
 * users (admin:manage) bypass; otherwise either records:manage or the
 * dedicated records:declare permission is required.
 */
export function canDeclareRecords(permissions: readonly string[]): boolean {
  return (
    permissions.includes("admin:manage") ||
    permissions.includes("records:manage") ||
    permissions.includes("records:declare")
  );
}
