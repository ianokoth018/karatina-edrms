import { db } from "@/lib/db";
import type { SessionLike } from "@/lib/document-access";

export type { SessionLike } from "@/lib/document-access";

/**
 * Flags describing what the current session user can do on a given document.
 * Mirrors the granularity of CasefolderACL plus a couple of convenience bits
 * (isAdmin, isCreator) so callers can short-circuit ACL-grid / owner-only UI
 * without a second lookup.
 */
export interface EffectiveDocumentPermissions {
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canShare: boolean;
  canDownload: boolean;
  canPrint: boolean;
  /** For the parent casefolder: can file new docs into the folder. */
  canCreate: boolean;
  canManageACL: boolean;
  isAdmin: boolean;
  isCreator: boolean;
}

/**
 * Resolve the effective document permissions for the given session user.
 *
 * Resolution order:
 *   1. `admin:manage` permission → everything true.
 *   2. Creator of the document → view/edit/delete/share/download/create true.
 *      canManageACL stays false unless the user is also admin.
 *   3. CasefolderACL rows (when the document is linked to a casefolder via
 *      `metadata.formTemplateId`). Rows are matched by userId, roleId (via
 *      translation of role names → IDs, same as lib/document-access.ts), or
 *      departmentId (stored as a department NAME string, matched against the
 *      session user's department name). Expired rows are ignored. All matching
 *      rows are OR-ed together (most permissive wins).
 *   4. DocumentAccessControl rows for the same document, matched by userId or
 *      roleId. canRead→canView, canWrite→canEdit, canDelete, canShare. When
 *      canRead is granted canDownload is also granted (sensible default since
 *      DAC predates the richer casefolder ACL).
 *
 * If none of the above applies, every flag is false. Callers that only gate UI
 * (where a user must already have view access to reach the page) can treat
 * that as "view-only".
 */
export async function getEffectiveDocumentPermissions(
  session: SessionLike,
  documentId: string
): Promise<EffectiveDocumentPermissions> {
  const perms = session.user.permissions ?? [];
  const isAdmin = perms.includes("admin:manage");

  if (isAdmin) {
    return {
      canView: true,
      canEdit: true,
      canDelete: true,
      canShare: true,
      canDownload: true,
      canPrint: true,
      canCreate: true,
      canManageACL: true,
      isAdmin: true,
      isCreator: false,
    };
  }

  const userId = session.user.id;
  const department = session.user.department ?? null;
  const roleNames = session.user.roles ?? [];

  // Load the document (metadata carries the optional casefolder link).
  const document = await db.document.findUnique({
    where: { id: documentId },
    select: { id: true, createdById: true, metadata: true },
  });

  // Nothing to reason about — return all-false. Caller decides fallback.
  if (!document) {
    return {
      canView: false,
      canEdit: false,
      canDelete: false,
      canShare: false,
      canDownload: false,
      canPrint: false,
      canCreate: false,
      canManageACL: false,
      isAdmin: false,
      isCreator: false,
    };
  }

  const isCreator = document.createdById === userId;

  // Start from creator defaults (creator always gets full per-doc rights except
  // ACL management, which stays admin-gated).
  const result: EffectiveDocumentPermissions = {
    canView: isCreator,
    canEdit: isCreator,
    canDelete: isCreator,
    canShare: isCreator,
    canDownload: isCreator,
    canPrint: isCreator,
    canCreate: isCreator,
    canManageACL: false,
    isAdmin: false,
    isCreator,
  };

  // Translate role names → IDs once (shared across CasefolderACL and DAC).
  const roleIds = roleNames.length
    ? (
        await db.role.findMany({
          where: { name: { in: roleNames } },
          select: { id: true },
        })
      ).map((r) => r.id)
    : [];

  // --- Casefolder ACLs ---------------------------------------------------
  const metadata =
    (document.metadata as Record<string, unknown> | null) ?? null;
  const formTemplateId =
    metadata && typeof metadata.formTemplateId === "string"
      ? metadata.formTemplateId
      : null;

  if (formTemplateId) {
    const folderAcls = await db.casefolderACL.findMany({
      where: { formTemplateId },
      select: {
        userId: true,
        roleId: true,
        departmentId: true,
        expiresAt: true,
        canView: true,
        canCreate: true,
        canEdit: true,
        canDelete: true,
        canShare: true,
        canDownload: true,
        canPrint: true,
        canManageACL: true,
      },
    });

    const now = Date.now();
    for (const acl of folderAcls) {
      if (acl.expiresAt && new Date(acl.expiresAt).getTime() < now) continue;

      const userMatch = acl.userId && acl.userId === userId;
      const roleMatch = acl.roleId && roleIds.includes(acl.roleId);
      // departmentId in the model stores the department NAME string.
      const deptMatch =
        acl.departmentId && department && acl.departmentId === department;

      if (!userMatch && !roleMatch && !deptMatch) continue;

      result.canView = result.canView || acl.canView;
      result.canCreate = result.canCreate || acl.canCreate;
      result.canEdit = result.canEdit || acl.canEdit;
      result.canDelete = result.canDelete || acl.canDelete;
      result.canShare = result.canShare || acl.canShare;
      result.canDownload = result.canDownload || acl.canDownload;
      result.canPrint = result.canPrint || acl.canPrint;
      result.canManageACL = result.canManageACL || acl.canManageACL;
    }
  }

  // --- DocumentAccessControl (per-document grants) -----------------------
  const dacRows = await db.documentAccessControl.findMany({
    where: {
      documentId: document.id,
      OR: [
        { userId },
        ...(roleIds.length ? [{ roleId: { in: roleIds } }] : []),
      ],
    },
    select: {
      canRead: true,
      canWrite: true,
      canDelete: true,
      canShare: true,
      canPrint: true,
    },
  });

  for (const dac of dacRows) {
    if (dac.canRead) {
      result.canView = true;
      // Sensible default: if they can read, they can download. Casefolder ACL
      // still wins when explicitly set — this only ever flips false → true.
      result.canDownload = true;
    }
    if (dac.canWrite) result.canEdit = true;
    if (dac.canDelete) result.canDelete = true;
    if (dac.canShare) result.canShare = true;
    if (dac.canPrint) result.canPrint = true;
  }

  return result;
}
