import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { sendWhatsAppText, whatsappEnabled } from "@/lib/whatsapp";

// ---------------------------------------------------------------------------
// POST /api/admin/whatsapp/test — admin-only WhatsApp send test.
//
// Body: { phone: string; message?: string; templateName?: string; ... }
// Returns: { ok, id?, error? } — the raw result from the WhatsApp helper.
// ---------------------------------------------------------------------------

interface TestBody {
  phone?: string;
  message?: string;
  templateName?: string;
  templateLang?: string;
  templateVariables?: string[];
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.user.permissions?.includes("admin:manage")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!whatsappEnabled()) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "WhatsApp not configured — set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN.",
        },
        { status: 400 }
      );
    }

    const body = (await req.json().catch(() => null)) as TestBody | null;
    const phone = body?.phone?.trim();
    if (!phone) {
      return NextResponse.json({ ok: false, error: "phone is required" }, { status: 400 });
    }
    if (!body?.message && !body?.templateName) {
      return NextResponse.json(
        { ok: false, error: "Provide either message (24h session) or templateName." },
        { status: 400 }
      );
    }

    const result = await sendWhatsAppText({
      toPhone: phone,
      body: body.message,
      templateName: body.templateName,
      templateLang: body.templateLang,
      templateVariables: body.templateVariables,
    });

    return NextResponse.json(result);
  } catch (error) {
    logger.error("WhatsApp test send failed", error, { route: "/api/admin/whatsapp/test" });
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
