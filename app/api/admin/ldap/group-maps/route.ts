import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

/**
 * Admin CRUD for LDAP group → role mappings.
 *
 *   GET    — list all mappings, joined with the role record so the UI
 *            can render role names without a second round-trip.
 *   POST   — create a new mapping. Body: { ldapGroup, roleId, autoApply? }.
 *            ldapGroup may be either a bare CN ("Domain Admins") or a
 *            full DN ("CN=Domain Admins,CN=Users,DC=karu,DC=ac,DC=ke")
 *            — the LDAP sign-in flow compares both forms.
 *   DELETE — remove a mapping. Body: { id }.
 */

function isAdmin(perms: string[] | undefined) {
  return !!perms?.includes("admin:manage");
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!isAdmin(session.user.permissions as string[] | undefined)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const maps = await db.ldapGroupRoleMap.findMany({
      orderBy: { createdAt: "asc" },
      include: { role: { select: { id: true, name: true } } },
    });

    return NextResponse.json({ maps });
  } catch (error) {
    logger.error("Failed to list LDAP group maps", error, {
      route: "/api/admin/ldap/group-maps",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!isAdmin(session.user.permissions as string[] | undefined)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await req.json()) as {
      ldapGroup?: string;
      roleId?: string;
      autoApply?: boolean;
    };

    const ldapGroup = body.ldapGroup?.trim();
    const roleId = body.roleId?.trim();
    if (!ldapGroup || !roleId) {
      return NextResponse.json(
        { error: "ldapGroup and roleId are required" },
        { status: 400 },
      );
    }

    // Validate role exists so the FK error doesn't leak through.
    const role = await db.role.findUnique({ where: { id: roleId } });
    if (!role) {
      return NextResponse.json({ error: "Role not found" }, { status: 404 });
    }

    const existing = await db.ldapGroupRoleMap.findUnique({ where: { ldapGroup } });
    if (existing) {
      return NextResponse.json(
        { error: "A mapping for this LDAP group already exists" },
        { status: 409 },
      );
    }

    const map = await db.ldapGroupRoleMap.create({
      data: {
        ldapGroup,
        roleId,
        autoApply: body.autoApply !== false,
      },
      include: { role: { select: { id: true, name: true } } },
    });

    await writeAudit({
      userId: session.user.id,
      action: "admin.ldap_group_map_created",
      resourceType: "LdapGroupRoleMap",
      resourceId: map.id,
      metadata: { ldapGroup, roleId, autoApply: map.autoApply },
    });

    return NextResponse.json({ map }, { status: 201 });
  } catch (error) {
    logger.error("Failed to create LDAP group map", error, {
      route: "/api/admin/ldap/group-maps",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!isAdmin(session.user.permissions as string[] | undefined)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Accept id either via JSON body or ?id= query — the admin UI uses
    // the body, but ad-hoc curl deletes work with the query.
    let id: string | undefined;
    try {
      const body = (await req.json()) as { id?: string };
      id = body.id;
    } catch {
      /* no body */
    }
    if (!id) {
      const { searchParams } = new URL(req.url);
      id = searchParams.get("id") ?? undefined;
    }
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const existing = await db.ldapGroupRoleMap.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Mapping not found" }, { status: 404 });
    }

    await db.ldapGroupRoleMap.delete({ where: { id } });

    await writeAudit({
      userId: session.user.id,
      action: "admin.ldap_group_map_deleted",
      resourceType: "LdapGroupRoleMap",
      resourceId: id,
      metadata: { ldapGroup: existing.ldapGroup },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to delete LDAP group map", error, {
      route: "/api/admin/ldap/group-maps",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
