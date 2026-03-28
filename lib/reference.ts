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
  department: string
): Promise<string> {
  const year = new Date().getFullYear();
  const pattern = `${prefix}-${year}-${department}-%`;

  // Count existing records matching this prefix+year+department pattern
  // to determine the next sequence number.
  const count = await db.document.count({
    where: {
      referenceNumber: {
        startsWith: `${prefix}-${year}-${department}-`,
      },
    },
  });

  const sequence = (count + 1).toString().padStart(6, "0");
  return `${prefix}-${year}-${department}-${sequence}`;
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
