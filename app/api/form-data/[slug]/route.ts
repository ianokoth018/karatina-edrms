import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * GET /api/form-data/[slug]?filter_field=x&filter_value=y
 *
 * Fetches records from a FormDataSchema by slug.
 * Optional query params:
 *   filter_field  — field name to filter on (e.g. "employee_id")
 *   filter_value  — value to match (e.g. "KU/1234")
 *   limit         — max records (default 100)
 *
 * Used by the BusinessDayRangePicker, workflow engine, and any authenticated
 * page that needs to read reference data.
 */
export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { slug } = await params;
    const url = req.nextUrl;
    const filterField = url.searchParams.get("filter_field");
    const filterValue = url.searchParams.get("filter_value");
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? 100)));

    const schema = await db.formDataSchema.findUnique({
      where: { slug, isActive: true },
    });
    if (!schema) return NextResponse.json({ error: "Dataset not found" }, { status: 404 });

    const rawRecords = await db.formDataEntry.findMany({
      where: { schemaId: schema.id },
      orderBy: { createdAt: "asc" },
      take: limit,
    });

    // Apply filter client-side (JSON column — no DB-level filter)
    const records = filterField && filterValue
      ? rawRecords.filter((r) => {
          const d = r.data as Record<string, unknown>;
          return String(d[filterField] ?? "").toLowerCase() === filterValue.toLowerCase();
        })
      : rawRecords;

    return NextResponse.json({
      schema: { id: schema.id, name: schema.name, slug: schema.slug, fields: schema.fields },
      records: records.map((r) => ({ id: r.id, data: r.data, updatedAt: r.updatedAt })),
    });
  } catch (error) {
    logger.error("Failed to query form data", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
