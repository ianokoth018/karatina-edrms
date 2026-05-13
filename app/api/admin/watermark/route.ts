import { NextRequest, NextResponse } from "next/server";
import type { SecurityClassification } from "@prisma/client";
import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";
import { getWatermarkConfig, setWatermarkConfig } from "@/lib/settings";
import { CLASSIFICATION_ORDER } from "@/lib/document-access";

function isAdmin(perms: string[] | undefined): boolean {
  return !!perms?.includes("admin:manage");
}

function isValidClassification(v: unknown): v is SecurityClassification {
  return typeof v === "string" &&
    (CLASSIFICATION_ORDER as readonly string[]).includes(v);
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
    const cfg = await getWatermarkConfig();
    return NextResponse.json(cfg);
  } catch (error) {
    logger.error("Failed to load watermark settings", error, {
      route: "/api/admin/watermark GET",
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!isAdmin(session.user.permissions as string[] | undefined)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await req.json()) as {
      enabled?: unknown;
      minClassification?: unknown;
      text?: unknown;
    };

    const minClassification = isValidClassification(body.minClassification)
      ? body.minClassification
      : "CONFIDENTIAL";

    await setWatermarkConfig(
      {
        enabled: !!body.enabled,
        minClassification,
        text: typeof body.text === "string" ? body.text : "",
      },
      session.user.id,
    );

    await writeAudit({
      userId: session.user.id,
      action: "admin.watermark_settings_updated",
      resourceType: "AppSetting",
      resourceId: "watermark",
      metadata: {
        enabled: !!body.enabled,
        minClassification,
        hasCustomText:
          typeof body.text === "string" && body.text.trim().length > 0,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to save watermark settings", error, {
      route: "/api/admin/watermark PUT",
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
