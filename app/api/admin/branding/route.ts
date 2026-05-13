import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";
import {
  getBranding,
  setBranding,
  isHexColor,
  type Branding,
} from "@/lib/branding";

function isAdmin(perms: string[] | undefined): boolean {
  return !!perms?.includes("admin:manage");
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Branding is non-sensitive — any authenticated user can read it so the
    // sidebar / header can render the org name and logo. Only PUT is gated
    // to admins below.
    const branding = await getBranding();
    return NextResponse.json(branding);
  } catch (error) {
    logger.error("Failed to load branding settings", error, {
      route: "/api/admin/branding GET",
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

    const body = (await req.json()) as Partial<Branding>;

    // Validate hex colours when supplied. Other fields are coerced/trimmed in
    // `setBranding` via the normalise step.
    if (body.primaryColor !== undefined && !isHexColor(body.primaryColor)) {
      return NextResponse.json(
        { error: "primaryColor must be a 6-digit hex (e.g. #02773b)" },
        { status: 400 },
      );
    }
    if (body.accentColor !== undefined && !isHexColor(body.accentColor)) {
      return NextResponse.json(
        { error: "accentColor must be a 6-digit hex (e.g. #dd9f42)" },
        { status: 400 },
      );
    }

    const next = await setBranding(
      {
        orgName:
          typeof body.orgName === "string" ? body.orgName : undefined,
        orgShortName:
          typeof body.orgShortName === "string" ? body.orgShortName : undefined,
        primaryColor:
          typeof body.primaryColor === "string"
            ? body.primaryColor
            : undefined,
        accentColor:
          typeof body.accentColor === "string" ? body.accentColor : undefined,
        logoUrl:
          typeof body.logoUrl === "string" ? body.logoUrl : undefined,
        faviconUrl:
          typeof body.faviconUrl === "string" ? body.faviconUrl : undefined,
        footerText:
          typeof body.footerText === "string" ? body.footerText : undefined,
      },
      session.user.id,
    );

    await writeAudit({
      userId: session.user.id,
      action: "admin.branding_updated",
      resourceType: "AppSetting",
      resourceId: "branding",
      metadata: {
        orgName: next.orgName,
        orgShortName: next.orgShortName,
        primaryColor: next.primaryColor,
        accentColor: next.accentColor,
        hasLogo: !!next.logoUrl,
        hasFavicon: !!next.faviconUrl,
        hasFooterText: !!next.footerText,
      },
    });

    return NextResponse.json(next);
  } catch (error) {
    logger.error("Failed to save branding settings", error, {
      route: "/api/admin/branding PUT",
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
