import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// GET /api/records/casefolders — list all active FormTemplates as casefolder
// categories, each annotated with the number of documents filed under it.
// ---------------------------------------------------------------------------
export async function GET(_req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isAdmin = session.user.permissions.includes("admin:manage");

    // For non-admins, resolve the user's role IDs and department upfront
    // so we can filter casefolders by ACL in a single pass.
    let userRoleIds: string[] = [];
    let userDepartment: string | null = null;

    if (!isAdmin) {
      const [userRoles, currentUser] = await Promise.all([
        db.userRole.findMany({ where: { userId: session.user.id }, select: { roleId: true } }),
        db.user.findUnique({ where: { id: session.user.id }, select: { department: true } }),
      ]);
      userRoleIds = userRoles.map((ur) => ur.roleId);
      userDepartment = currentUser?.department ?? null;
    }

    const templates = await db.formTemplate.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
        fields: true,
        isActive: true,
        version: true,
        createdAt: true,
        workflowTemplateId: true,
      },
    });

    // Collect unique workflow template IDs and fetch their names
    const workflowTemplateIds = templates
      .map((t) => t.workflowTemplateId)
      .filter((id): id is string => !!id);

    const workflowTemplates = workflowTemplateIds.length > 0
      ? await db.workflowTemplate.findMany({
          where: { id: { in: workflowTemplateIds } },
          select: { id: true, name: true },
        })
      : [];

    const workflowNameMap = new Map(
      workflowTemplates.map((wt) => [wt.id, wt.name])
    );

    // Fetch all ACL entries for all templates in one query (non-admins only)
    const allAcls = isAdmin
      ? []
      : await db.casefolderACL.findMany({
          where: { formTemplateId: { in: templates.map((t) => t.id) } },
          select: { formTemplateId: true, userId: true, roleId: true, departmentId: true, expiresAt: true, canView: true },
        });

    // Build a set of template IDs the current user can view
    const accessibleIds = isAdmin
      ? new Set(templates.map((t) => t.id))
      : new Set(
          templates
            .map((t) => t.id)
            .filter((tid) => {
              const entries = allAcls.filter((a) => a.formTemplateId === tid);
              // No entries → locked (deny by default)
              if (entries.length === 0) return false;
              return entries.some((acl) => {
                if (acl.expiresAt && new Date(acl.expiresAt) < new Date()) return false;
                if (!acl.canView) return false;
                if (acl.userId === session.user.id) return true;
                if (acl.roleId && userRoleIds.includes(acl.roleId)) return true;
                if (acl.departmentId && userDepartment && acl.departmentId === userDepartment) return true;
                return false;
              });
            })
        );

    // For each accessible template, count documents
    const casefolders = await Promise.all(
      templates
        .filter((t) => accessibleIds.has(t.id))
        .map(async (template) => {
          const documentCount = await db.document.count({
            where: {
              metadata: {
                path: ["formTemplateId"],
                equals: template.id,
              },
            },
          });

          return {
            id: template.id,
            name: template.name,
            description: template.description,
            fields: template.fields,
            isActive: template.isActive,
            version: template.version,
            documentCount,
            createdAt: template.createdAt,
            workflowTemplateId: template.workflowTemplateId,
            workflowTemplateName: template.workflowTemplateId
              ? workflowNameMap.get(template.workflowTemplateId) ?? null
              : null,
          };
        })
    );

    return NextResponse.json({ casefolders });
  } catch (error) {
    logger.error("Failed to list casefolders", error, {
      route: "/api/records/casefolders",
      method: "GET",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
