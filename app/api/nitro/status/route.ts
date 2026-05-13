import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getNitroConfig } from "@/lib/settings";

/**
 * GET /api/nitro/status — lightweight probe used by the memo composer
 * to decide whether to surface the "Digital signature (Nitro Sign)"
 * option. Returns only a boolean — never leaks credentials.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ enabled: false }, { status: 200 });
  }
  try {
    const cfg = await getNitroConfig();
    return NextResponse.json({ enabled: Boolean(cfg?.enabled) });
  } catch {
    return NextResponse.json({ enabled: false });
  }
}
