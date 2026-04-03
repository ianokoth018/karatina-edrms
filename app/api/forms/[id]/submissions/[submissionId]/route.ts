import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// GET /api/forms/[id]/submissions/[submissionId] -- Get a single submission
// ---------------------------------------------------------------------------
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; submissionId: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id, submissionId } = await params;

    const submission = await db.formSubmission.findUnique({
      where: { id: submissionId },
      include: {
        template: {
          select: {
            id: true,
            name: true,
            description: true,
            fields: true,
            version: true,
          },
        },
      },
    });

    if (!submission) {
      return NextResponse.json(
        { error: "Submission not found" },
        { status: 404 },
      );
    }

    // Ensure the submission belongs to the specified template
    if (submission.templateId !== id) {
      return NextResponse.json(
        { error: "Submission does not belong to this form template" },
        { status: 404 },
      );
    }

    // Fetch submitter details
    const submitter = await db.user.findUnique({
      where: { id: submission.submittedById },
      select: {
        id: true,
        displayName: true,
        email: true,
        department: true,
        jobTitle: true,
      },
    });

    return NextResponse.json({
      id: submission.id,
      templateId: submission.templateId,
      template: submission.template,
      submittedById: submission.submittedById,
      submitter: submitter
        ? {
            id: submitter.id,
            name: submitter.displayName,
            email: submitter.email,
            department: submitter.department,
            jobTitle: submitter.jobTitle,
          }
        : null,
      data: submission.data,
      workflowInstanceId: submission.workflowInstanceId,
      submittedAt: submission.submittedAt,
    });
  } catch (error) {
    logger.error("Failed to fetch form submission", error, {
      route: "/api/forms/[id]/submissions/[submissionId]",
      method: "GET",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
