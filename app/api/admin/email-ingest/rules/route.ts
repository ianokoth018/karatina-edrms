import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";
import { encryptSecret } from "@/lib/encryption";

function isAdmin(perms: string[] | undefined) {
  return !!perms?.includes("admin:manage");
}

/** Strip the cipher field — IMAP passwords are never returned in API responses. */
function maskRule<T extends { imapPasswordCipher?: string | null }>(rule: T) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { imapPasswordCipher: _omit, ...safe } = rule;
  return { ...safe, hasPassword: !!_omit };
}

/** GET /api/admin/email-ingest/rules — list all rules (password masked). */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const rules = await db.emailIngestRule.findMany({
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ rules: rules.map(maskRule) });
  } catch (error) {
    logger.error("Failed to list email ingest rules", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

interface CreateBody {
  name?: string;
  isActive?: boolean;
  imapHost?: string;
  imapPort?: number;
  imapSecure?: boolean;
  imapUser?: string;
  imapPassword?: string; // plaintext from client — encrypted before persist
  mailbox?: string;
  fromFilter?: string | null;
  subjectFilter?: string | null;
  targetDepartment?: string | null;
  targetDocumentType?: string;
  tagsCsv?: string;
}

/** POST /api/admin/email-ingest/rules — create a rule. */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = (await req.json()) as CreateBody;

    const name = body.name?.trim();
    const imapHost = body.imapHost?.trim();
    const imapUser = body.imapUser?.trim();
    const imapPassword = body.imapPassword;

    if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
    if (!imapHost) return NextResponse.json({ error: "imapHost is required" }, { status: 400 });
    if (!imapUser) return NextResponse.json({ error: "imapUser is required" }, { status: 400 });
    if (!imapPassword) return NextResponse.json({ error: "imapPassword is required" }, { status: 400 });

    if (body.subjectFilter) {
      try {
        new RegExp(body.subjectFilter);
      } catch {
        return NextResponse.json({ error: "subjectFilter is not a valid regex" }, { status: 400 });
      }
    }

    let cipher: string;
    try {
      cipher = encryptSecret(imapPassword);
    } catch (err) {
      return NextResponse.json(
        { error: `Encryption unavailable: ${err instanceof Error ? err.message : String(err)}` },
        { status: 500 }
      );
    }

    const rule = await db.emailIngestRule.create({
      data: {
        name,
        isActive: body.isActive ?? true,
        imapHost,
        imapPort: typeof body.imapPort === "number" ? body.imapPort : 993,
        imapSecure: body.imapSecure ?? true,
        imapUser,
        imapPasswordCipher: cipher,
        mailbox: body.mailbox?.trim() || "INBOX",
        fromFilter: body.fromFilter?.trim() || null,
        subjectFilter: body.subjectFilter?.trim() || null,
        targetDepartment: body.targetDepartment?.trim() || null,
        targetDocumentType: body.targetDocumentType?.trim() || "EMAIL",
        tagsCsv: body.tagsCsv?.trim() || "email,inbound",
        createdById: session.user.id,
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "admin.email_ingest_rule_created",
      resourceType: "EmailIngestRule",
      resourceId: rule.id,
      metadata: { name, imapHost, imapUser, mailbox: rule.mailbox },
    });

    return NextResponse.json({ rule: maskRule(rule) }, { status: 201 });
  } catch (error) {
    logger.error("Failed to create email ingest rule", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
