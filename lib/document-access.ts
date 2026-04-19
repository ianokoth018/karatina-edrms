import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export interface SessionLike {
  user: {
    id: string;
    roles?: string[];
    permissions?: string[];
    department?: string | null;
  };
}

/**
 * Build a Prisma `where` clause for `db.document.findMany` (or `count`) that
 * restricts results to documents the user may read.
 *
 * Access rules (ANY of):
 *   1. User has the `admin:manage` permission.
 *   2. User is the creator.
 *   3. User is in the same `department` as the document.
 *   4. A `DocumentAccessControl` row grants `canRead` to the user directly,
 *      or to one of the user's roles.
 *
 * Returns `{}` for admins (no restriction) or a Prisma `AND`-combinable
 * object that can be spread into an existing `where` clause.
 */
export async function buildDocumentAccessWhere(
  session: SessionLike
): Promise<Prisma.DocumentWhereInput> {
  const permissions = session.user.permissions ?? [];
  if (permissions.includes("admin:manage")) return {};

  const userId = session.user.id;
  const department = session.user.department ?? null;
  const roleNames = session.user.roles ?? [];

  // Translate role names to IDs so we can match DocumentAccessControl rows
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

  return { OR: or };
}
