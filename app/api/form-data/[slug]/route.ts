import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * GET /api/form-data/[slug]
 *
 * Fetches records from a FormDataSchema by slug.
 *
 * Filter query params (two styles, both supported):
 *   filter_field / filter_value — legacy single-field filter
 *   filter_FIELDNAME=VALUE      — multi-field filter (e.g. filter_leave_type=Annual+Leave&filter_year=2026)
 *   limit                       — max records (default 100)
 *
 * All filters are case-insensitive string matches applied client-side
 * (Prisma JSON columns don't support server-side equality filtering).
 *
 * Used by the BusinessDayRangePicker, workflow engine, FormRenderer
 * lookupFormData lookups, and any authenticated page that needs reference data.
 */
export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { slug } = await params;
    const url = req.nextUrl;
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? 100)));

    // Collect all active filters.
    // Legacy style: filter_field + filter_value → single entry.
    // Multi style:  any param starting with "filter_" except "filter_field"/"filter_value".
    const filters: Record<string, string> = {};
    const legacyField = url.searchParams.get("filter_field");
    const legacyValue = url.searchParams.get("filter_value");
    if (legacyField && legacyValue !== null) {
      filters[legacyField] = legacyValue;
    }
    for (const [key, value] of url.searchParams.entries()) {
      if (key.startsWith("filter_") && key !== "filter_field" && key !== "filter_value") {
        const fieldName = key.slice("filter_".length); // strip prefix
        filters[fieldName] = value;
      }
    }

    const schema = await db.formDataSchema.findUnique({
      where: { slug, isActive: true },
    });
    if (!schema) return NextResponse.json({ error: "Dataset not found" }, { status: 404 });

    const rawRecords = await db.formDataEntry.findMany({
      where: { schemaId: schema.id },
      orderBy: { createdAt: "asc" },
      take: limit,
    });

    // Apply all filters client-side (case-insensitive string match)
    const filterEntries = Object.entries(filters);
    const records = filterEntries.length > 0
      ? rawRecords.filter((r) => {
          const d = r.data as Record<string, unknown>;
          return filterEntries.every(([field, val]) =>
            String(d[field] ?? "").toLowerCase() === val.toLowerCase()
          );
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
