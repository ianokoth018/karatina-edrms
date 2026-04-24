import { db } from "@/lib/db";

/**
 * Generate a unique reference number in the format: `DOC-2026-REG-000042`
 *
 * @param prefix - The document type prefix (e.g. "DOC", "WF", "FORM", "PHY")
 * @param department - The department abbreviation (e.g. "REG", "FIN", "ICT", "HR")
 * @returns A unique, zero-padded reference number string
 */
export async function generateReference(
  prefix: string,
  department: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx?: any
): Promise<string> {
  const year = new Date().getFullYear();
  const lockKey = `${prefix}-${year}-${department}`;
  const client = tx ?? db;

  if (tx) {
    // Acquire a PostgreSQL advisory lock scoped to this transaction.
    // Serialises concurrent reference generation for the same prefix+year+dept
    // so that COUNT and document.create happen atomically — no duplicates.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}::text))`;
  }

  const count = await client.document.count({
    where: {
      referenceNumber: {
        startsWith: `${lockKey}-`,
      },
    },
  });

  const sequence = (count + 1).toString().padStart(6, "0");
  return `${lockKey}-${sequence}`;
}

/**
 * Generate a memo reference in the university format: `KarU/Rg.AA/1`
 *
 * Format matches the official Karatina University memo template:
 *   KarU/{DeptMemoCode}/{SequenceNumber}
 *
 * @param deptMemoCode - The department memo code (e.g. "Rg.AA", "VC", "Fin")
 * @returns A unique memo reference string
 */
export async function generateMemoReference(
  deptMemoCode: string
): Promise<string> {
  const prefix = `KarU/${deptMemoCode}/`;

  const count = await db.document.count({
    where: {
      referenceNumber: {
        startsWith: prefix,
      },
    },
  });

  const sequence = count + 1;
  return `${prefix}${sequence}`;
}

/**
 * Generate a personal memo reference: `KarU/PF.KU/005/1`
 *
 * Used for personal memos where the reference is tied to the
 * staff member's PF (Personnel File) number.
 *
 * @param pfNumber - The employee/PF number (e.g. "KU/005")
 * @returns A unique personal memo reference string
 */
export async function generatePersonalMemoReference(
  pfNumber: string
): Promise<string> {
  // Sanitise the PF number for use in a reference (replace / with .)
  const sanitised = pfNumber.replace(/\//g, ".");
  const prefix = `KarU/PF.${sanitised}/`;

  const count = await db.document.count({
    where: {
      referenceNumber: {
        startsWith: prefix,
      },
    },
  });

  const sequence = count + 1;
  return `${prefix}${sequence}`;
}

/**
 * Generate a workflow instance reference number: `WF-2026-000042`
 */
export async function generateWorkflowReference(): Promise<string> {
  const year = new Date().getFullYear();

  const count = await db.workflowInstance.count({
    where: {
      referenceNumber: {
        startsWith: `WF-${year}-`,
      },
    },
  });

  const sequence = (count + 1).toString().padStart(6, "0");
  return `WF-${year}-${sequence}`;
}

/**
 * Generate a physical record reference number: `PHY-2026-000042`
 */
export async function generatePhysicalReference(): Promise<string> {
  const year = new Date().getFullYear();

  const count = await db.physicalRecord.count({
    where: {
      referenceNumber: {
        startsWith: `PHY-${year}-`,
      },
    },
  });

  const sequence = (count + 1).toString().padStart(6, "0");
  return `PHY-${year}-${sequence}`;
}
