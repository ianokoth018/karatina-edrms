import { NextResponse } from "next/server";
import { aiEnabled } from "@/lib/ai-client";
import { getActiveProvider } from "@/lib/ai/config";
import { getBranding } from "@/lib/branding";
import { ldapEnabled } from "@/lib/ldap";
import { siemEnabled } from "@/lib/siem";
import { logger } from "@/lib/logger";

/**
 * System feature flags — non-sensitive UI hints the client uses to gate
 * features that depend on optional server-side configuration (SSO, AI
 * providers, webhook signing, branding). Each value is derived purely
 * from env / app settings, never user-specific.
 *
 * No auth: the values reveal only which capabilities are wired up, not
 * any secrets. This endpoint must NEVER 500 the UI — if any subsystem
 * throws (e.g. branding DB lookup), we fall closed (feature disabled).
 */

export interface SystemFeatures {
  sso: boolean;
  ldap: boolean;
  aiEnabled: boolean;
  aiProvider: string | null;
  webhookSigning: boolean;
  siem: boolean;
  branding: { orgName: string };
}

function ssoConfigured(): boolean {
  return !!(
    process.env.OIDC_ISSUER &&
    process.env.OIDC_CLIENT_ID &&
    process.env.OIDC_CLIENT_SECRET
  );
}

export async function GET() {
  // Default to "everything off" so a partial failure hides features
  // rather than exposing a broken button.
  let orgName = "";
  try {
    const branding = await getBranding();
    orgName = branding.orgName;
  } catch (error) {
    logger.error("features endpoint: branding lookup failed", error, {
      route: "/api/system/features",
    });
  }

  const payload: SystemFeatures = {
    sso: ssoConfigured(),
    ldap: ldapEnabled(),
    aiEnabled: aiEnabled(),
    aiProvider: getActiveProvider(),
    webhookSigning: !!process.env.WEBHOOK_SIGNING_SECRET,
    siem: siemEnabled(),
    branding: { orgName },
  };

  return NextResponse.json(payload);
}
