import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDefaultCalendar } from "@/lib/business-calendar";

/**
 * GET /api/work-calendar
 * Returns the active work calendar config for any authenticated user.
 * Used by BusinessDayRangePicker and other client components.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const cal = await getDefaultCalendar();
  return NextResponse.json({ calendar: cal });
}
