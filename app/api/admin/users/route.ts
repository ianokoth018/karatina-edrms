import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

/** Safely serialise BigInt values that might exist in Prisma results. */
function serialise<T>(data: T): T {
  return JSON.parse(
    JSON.stringify(data, (_, v) => (typeof v === "bigint" ? Number(v) : v))
  );
}

/**
 * GET /api/admin/users
 * List users with optional search and pagination. Includes roles.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.user.permissions.includes("admin:manage")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search") ?? "";
    const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") ?? "20")));
    const skip = (page - 1) * limit;

    const where = search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { email: { contains: search, mode: "insensitive" as const } },
            { displayName: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {};

    const [users, total] = await Promise.all([
      db.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          displayName: true,
          email: true,
          department: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
          roles: {
            include: {
              role: {
                select: { id: true, name: true },
              },
            },
          },
        },
      }),
      db.user.count({ where }),
    ]);

    return NextResponse.json(
      serialise({
        users,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    );
  } catch (error) {
    logger.error("Failed to list users", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/users
 * Create a new user. Hash password with bcrypt. Assign roles. Write audit log.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.user.permissions.includes("admin:manage")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const { name, email, password, department, roleIds } = body as {
      name: string;
      email: string;
      password: string;
      department?: string;
      roleIds?: string[];
    };

    if (!name || !email || !password) {
      return NextResponse.json(
        { error: "Name, email and password are required" },
        { status: 400 }
      );
    }

    // Check for existing user
    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json(
        { error: "A user with this email already exists" },
        { status: 409 }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await db.user.create({
      data: {
        name,
        displayName: name,
        email,
        password: hashedPassword,
        department: department ?? null,
        roles: roleIds?.length
          ? {
              create: roleIds.map((roleId: string) => ({
                role: { connect: { id: roleId } },
              })),
            }
          : undefined,
      },
      select: {
        id: true,
        name: true,
        displayName: true,
        email: true,
        department: true,
        isActive: true,
        createdAt: true,
        roles: {
          include: {
            role: { select: { id: true, name: true } },
          },
        },
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "USER_CREATED",
      resourceType: "user",
      resourceId: user.id,
      metadata: { email, roleIds },
    });

    logger.info("User created", {
      userId: session.user.id,
      action: "USER_CREATED",
    });

    return NextResponse.json(serialise({ user }), { status: 201 });
  } catch (error) {
    logger.error("Failed to create user", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
