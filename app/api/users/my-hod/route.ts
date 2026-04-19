import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { findHodForDepartment, userIsHod } from "@/lib/hod";
import { logger } from "@/lib/logger";

/**
 * GET /api/users/my-hod
 *
 * Returns the HOD of the current user's department, or null when:
 *   - the user has no department, or
 *   - the user already holds the HOD role, or
 *   - no HOD user is configured for that department.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const roles = (session.user.roles as string[] | undefined) ?? [];
    if (userIsHod(roles)) {
      return NextResponse.json({ hod: null, reason: "self_is_hod" });
    }

    const department = session.user.department ?? null;
    if (!department) {
      return NextResponse.json({ hod: null, reason: "no_department" });
    }

    const hod = await findHodForDepartment(department);
    if (!hod) {
      return NextResponse.json({ hod: null, reason: "no_hod_for_department" });
    }

    if (hod.id === session.user.id) {
      return NextResponse.json({ hod: null, reason: "self_is_hod" });
    }

    return NextResponse.json({ hod });
  } catch (error) {
    logger.error("Failed to resolve current user's HOD", error, {
      route: "/api/users/my-hod",
      method: "GET",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
