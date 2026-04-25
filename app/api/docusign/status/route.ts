import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDocusignConfig } from "@/lib/settings";

/**
 * GET /api/docusign/status — lightweight probe used by the memo composer
 * to decide whether to surface the "Digital signature (DocuSign)" option.
 * Returns only a boolean — never leaks credentials.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ enabled: false }, { status: 200 });
  }
  try {
    const cfg = await getDocusignConfig();
    return NextResponse.json({ enabled: Boolean(cfg?.enabled) });
  } catch {
    return NextResponse.json({ enabled: false });
  }
}
