import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";
import { verifyMemoShareToken } from "@/lib/memo-share";
import { generateMemoPdf } from "@/lib/memo-pdf";

/**
 * GET /api/memos/public/[token] — public memo viewer.
 *
 * No auth required: the signed HMAC token IS the authentication. The route
 * verifies the signature + expiry, regenerates the memo PDF on the fly,
 * and streams it inline (or as a download with `?download=1`).
 *
 * Audit: every hit is recorded with IP + user-agent + the memo id.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const verification = verifyMemoShareToken(token);
    if (!verification.ok) {
      return new NextResponse(verification.reason, { status: 410 });
    }

    const memo = await db.workflowInstance.findUnique({
      where: { id: verification.memoId },
      include: {
        document: {
          select: {
            referenceNumber: true,
            title: true,
            description: true,
            metadata: true,
          },
        },
        tasks: {
          orderBy: { stepIndex: "asc" },
          include: {
            assignee: {
              select: { displayName: true, name: true, jobTitle: true },
            },
          },
        },
      },
    });

    if (!memo) {
      return new NextResponse("Memo not found", { status: 404 });
    }

    const formData = (memo.formData as Record<string, unknown>) ?? {};
    const meta = (memo.document?.metadata as Record<string, unknown>) ?? {};

    // Pull fields with sensible fallbacks across formData / metadata
    const memoReference =
      memo.document?.referenceNumber ??
      (formData.memoReference as string) ??
      memo.referenceNumber;
    const subject = memo.subject ?? memo.document?.title ?? "Memorandum";
    const bodyHtml =
      (formData.body as string) ??
      (meta.bodyHtml as string) ??
      (memo.document?.description ?? "");
    const toName = (formData.toName as string) ?? (meta.to as string) ?? "Recipient";
    const fromName = (formData.fromName as string) ?? (meta.from as string) ?? "Sender";
    const fromTitle =
      (formData.fromJobTitle as string) ?? (meta.designation as string) ?? "";
    const fromDept =
      (formData.fromDepartment as string) ??
      (meta.departmentOffice as string) ??
      (meta.department as string) ??
      "";
    const cc = (meta.copy_to as string) ?? "";
    const date = new Date(memo.startedAt).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });

    // Approver (final approval task)
    const approverTask = memo.tasks.find(
      (t) => t.stepName === "Final Approval" && t.action === "APPROVED"
    );

    const pdfBytes = await generateMemoPdf({
      memoReference,
      workflowReference: memo.referenceNumber,
      subject,
      body: bodyHtml,
      to: toName,
      from: fromName,
      fromTitle,
      fromDepartment: fromDept,
      cc,
      date,
      approvedByName: approverTask?.assignee?.displayName ?? approverTask?.assignee?.name,
      approvedByTitle: approverTask?.assignee?.jobTitle ?? undefined,
      approvedAt: approverTask?.completedAt
        ? new Date(approverTask.completedAt).toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })
        : undefined,
    });

    // Audit access (anonymous viewer — userId omitted)
    try {
      await writeAudit({
        action: "memo.public_view",
        resourceType: "workflow_instance",
        resourceId: memo.id,
        ipAddress: req.headers.get("x-forwarded-for") ?? undefined,
        userAgent: req.headers.get("user-agent") ?? undefined,
        metadata: {
          token: req.nextUrl.pathname.split("/").pop() ?? null,
        },
      });
    } catch {
      // audit failures should never block public access
    }

    const wantDownload = req.nextUrl.searchParams.get("download") === "1";
    const filename = `${memoReference.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`;
    const disposition = wantDownload ? "attachment" : "inline";

    return new NextResponse(pdfBytes as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    logger.error("Failed to serve public memo", error, {
      route: "/api/memos/public/[token]",
    });
    return new NextResponse("Internal error", { status: 500 });
  }
}
