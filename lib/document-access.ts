import type { Prisma, SecurityClassification } from "@prisma/client";
import { db } from "@/lib/db";

export interface SessionLike {
  user: {
    id: string;
    roles?: string[];
    permissions?: string[];
    department?: string | null;
    clearanceLevel?: SecurityClassification | null;
  };
}

/** Ordered least → most sensitive. */
export const CLASSIFICATION_ORDER: SecurityClassification[] = [
  "OPEN",
  "CONFIDENTIAL",
  "RESTRICTED",
  "SECRET",
  "TOP_SECRET",
];

export function classificationOrdinal(
  level: SecurityClassification | null | undefined
): number {
  if (!level) return 0;
  const idx = CLASSIFICATION_ORDER.indexOf(level);
  return idx < 0 ? 0 : idx;
}

export function classificationsAtOrBelow(
  level: SecurityClassification | null | undefined
): SecurityClassification[] {
  const idx = level ? CLASSIFICATION_ORDER.indexOf(level) : 0;
  return CLASSIFICATION_ORDER.slice(0, Math.max(idx, 0) + 1);
}

export function canUserReadClassification(
  userLevel: SecurityClassification | null | undefined,
  docLevel: SecurityClassification
): boolean {
  return classificationOrdinal(userLevel) >= classificationOrdinal(docLevel);
}

export async function buildDocumentAccessWhere(
  session: SessionLike
): Promise<Prisma.DocumentWhereInput> {
  const permissions = session.user.permissions ?? [];
  if (permissions.includes("admin:manage")) return {};

  const userId = session.user.id;
  const department = session.user.department ?? null;
  const roleNames = session.user.roles ?? [];
  const clearance = session.user.clearanceLevel ?? "OPEN";

  const roleIds = roleNames.length
    ? (
        await db.role.findMany({
          where: { name: { in: roleNames } },
          select: { id: true },
        })
      ).map((r) => r.id)
    : [];

  const aclOr: Prisma.DocumentAccessControlWhereInput[] = [{ userId }];
  if (roleIds.length) aclOr.push({ roleId: { in: roleIds } });

  const or: Prisma.DocumentWhereInput[] = [
    { createdById: userId },
    { accessControls: { some: { canRead: true, OR: aclOr } } },
  ];
  if (department) or.push({ department });

  return {
    AND: [
      { securityClassification: { in: classificationsAtOrBelow(clearance) } },
      { OR: or },
    ],
  };
}
