import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";
import { encryptSecret } from "@/lib/encryption";

function isAdmin(perms: string[] | undefined) {
  return !!perms?.includes("admin:manage");
}

function maskRule<T extends { imapPasswordCipher?: string | null }>(rule: T) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { imapPasswordCipher: _omit, ...safe } = rule;
  return { ...safe, hasPassword: !!_omit };
}

type Ctx = { params: Promise<{ id: string }> };

interface PatchBody {
  name?: string;
  isActive?: boolean;
  imapHost?: string;
  imapPort?: number;
  imapSecure?: boolean;
  imapUser?: string;
  imapPassword?: string; // optional — only set if rotating
  mailbox?: string;
  fromFilter?: string | null;
  subjectFilter?: string | null;
  targetDepartment?: string | null;
  targetDocumentType?: string;
  tagsCsv?: string;
}

/** GET /api/admin/email-ingest/rules/[id] — fetch (password masked). */
export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const session = await auth();
    if (!session?.user?.id)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const rule = await db.emailIngestRule.findUnique({ where: { id } });
    if (!rule) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ rule: maskRule(rule) });
  } catch (error) {
    logger.error("Failed to get email ingest rule", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/** PATCH /api/admin/email-ingest/rules/[id] — toggle/edit. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const session = await auth();
    if (!session?.user?.id)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const body = (await req.json()) as PatchBody;

    if (body.subjectFilter) {
      try {
        new RegExp(body.subjectFilter);
      } catch {
        return NextResponse.json({ error: "subjectFilter is not a valid regex" }, { status: 400 });
      }
    }

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name.trim();
    if (body.isActive !== undefined) data.isActive = body.isActive;
    if (body.imapHost !== undefined) data.imapHost = body.imapHost.trim();
    if (body.imapPort !== undefined) data.imapPort = body.imapPort;
    if (body.imapSecure !== undefined) data.imapSecure = body.imapSecure;
    if (body.imapUser !== undefined) data.imapUser = body.imapUser.trim();
    if (body.mailbox !== undefined) data.mailbox = body.mailbox.trim() || "INBOX";
    if (body.fromFilter !== undefined) data.fromFilter = body.fromFilter?.trim() || null;
    if (body.subjectFilter !== undefined) data.subjectFilter = body.subjectFilter?.trim() || null;
    if (body.targetDepartment !== undefined) data.targetDepartment = body.targetDepartment?.trim() || null;
    if (body.targetDocumentType !== undefined) data.targetDocumentType = body.targetDocumentType.trim() || "EMAIL";
    if (body.tagsCsv !== undefined) data.tagsCsv = body.tagsCsv.trim() || "email,inbound";

    if (body.imapPassword) {
      try {
        data.imapPasswordCipher = encryptSecret(body.imapPassword);
      } catch (err) {
        return NextResponse.json(
          { error: `Encryption unavailable: ${err instanceof Error ? err.message : String(err)}` },
          { status: 500 }
        );
      }
    }

    const rule = await db.emailIngestRule.update({ where: { id }, data });

    await writeAudit({
      userId: session.user.id,
      action: "admin.email_ingest_rule_updated",
      resourceType: "EmailIngestRule",
      resourceId: id,
      metadata: { fields: Object.keys(data), passwordRotated: !!body.imapPassword },
    });

    return NextResponse.json({ rule: maskRule(rule) });
  } catch (error) {
    logger.error("Failed to update email ingest rule", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/** DELETE /api/admin/email-ingest/rules/[id] */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const session = await auth();
    if (!session?.user?.id)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const existing = await db.emailIngestRule.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await db.emailIngestRule.delete({ where: { id } });

    await writeAudit({
      userId: session.user.id,
      action: "admin.email_ingest_rule_deleted",
      resourceType: "EmailIngestRule",
      resourceId: id,
      metadata: { name: existing.name },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to delete email ingest rule", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
