import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { DEFAULT_WIDGETS, parseWidgets } from "@/lib/widgets";

/**
 * GET /api/dashboard/layout
 *
 * Returns the signed-in user's saved dashboard layout, or a default one
 * if they've never customised it. Always 200 unless unauthenticated.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const row = await db.dashboardLayout.findUnique({
      where: { userId: session.user.id },
    });

    const widgets = row ? parseWidgets(row.widgets) : DEFAULT_WIDGETS;
    return NextResponse.json({ widgets });
  } catch (error) {
    logger.error("Load dashboard layout failed", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/dashboard/layout
 * Body: { widgets: Widget[] }
 *
 * Upserts the caller's saved layout. The body is sanitised through
 * `parseWidgets` so the column never contains malformed rows.
 */
export async function PUT(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as
      | { widgets?: unknown }
      | null;
    const widgets = parseWidgets(body?.widgets);

    // Cap to a sensible upper bound so an over-zealous client can't blow
    // up the JSON column. 64 widgets is far past what fits on a screen.
    if (widgets.length > 64) {
      return NextResponse.json(
        { error: "Too many widgets (max 64)" },
        { status: 400 }
      );
    }

    await db.dashboardLayout.upsert({
      where: { userId: session.user.id },
      // Cast through `unknown` — Prisma's `Json` input type rejects our
      // typed Widget[] without it.
      create: { userId: session.user.id, widgets: widgets as unknown as object },
      update: { widgets: widgets as unknown as object },
    });

    return NextResponse.json({ widgets });
  } catch (error) {
    logger.error("Save dashboard layout failed", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
