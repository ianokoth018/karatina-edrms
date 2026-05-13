import { NextResponse } from "next/server";
import { getSpMetadataXml, samlEnabled } from "@/lib/saml";
import { logger } from "@/lib/logger";

/**
 * GET /api/auth/saml/metadata — Service Provider metadata XML.
 *
 * Operators hand this URL (or the downloaded XML) to their IdP admin
 * console so the IdP can register us as a trusted SP. We auto-generate
 * the XML from samlify based on the configured env vars, so the entity
 * ID and ACS URL stay in lockstep with the live config.
 */
export async function GET() {
  if (!samlEnabled()) {
    return NextResponse.json(
      { error: "SAML is not configured on this server" },
      { status: 503 },
    );
  }
  try {
    const xml = getSpMetadataXml();
    return new NextResponse(xml, {
      status: 200,
      headers: {
        "Content-Type": "application/samlmetadata+xml; charset=utf-8",
        "Content-Disposition":
          'attachment; filename="edrms-sp-metadata.xml"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    logger.error("Failed to render SP metadata", error, {
      route: "/api/auth/saml/metadata",
    });
    return NextResponse.json(
      { error: "Failed to generate SP metadata" },
      { status: 500 },
    );
  }
}
