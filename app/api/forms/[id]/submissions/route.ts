import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// GET /api/forms/[id]/submissions -- List submissions for a form template
// ---------------------------------------------------------------------------
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Verify template exists
    const template = await db.formTemplate.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!template) {
      return NextResponse.json(
        { error: "Form template not found" },
        { status: 404 },
      );
    }

    const { searchParams } = req.nextUrl;
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)),
    );
    const skip = (page - 1) * limit;

    const [submissions, total] = await Promise.all([
      db.formSubmission.findMany({
        where: { templateId: id },
        skip,
        take: limit,
        orderBy: { submittedAt: "desc" },
      }),
      db.formSubmission.count({ where: { templateId: id } }),
    ]);

    // Fetch submitter details for all submissions in one query
    const submitterIds = [
      ...new Set(submissions.map((s) => s.submittedById)),
    ];
    const submitters = await db.user.findMany({
      where: { id: { in: submitterIds } },
      select: { id: true, displayName: true, email: true, department: true },
    });
    const submitterMap = new Map(submitters.map((u) => [u.id, u]));

    return NextResponse.json({
      submissions: submissions.map((s) => {
        const submitter = submitterMap.get(s.submittedById);
        return {
          id: s.id,
          templateId: s.templateId,
          submittedById: s.submittedById,
          submitterName: submitter?.displayName ?? "Unknown",
          submitterEmail: submitter?.email ?? null,
          submitterDepartment: submitter?.department ?? null,
          data: s.data,
          workflowInstanceId: s.workflowInstanceId,
          submittedAt: s.submittedAt,
        };
      }),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error("Failed to list form submissions", error, {
      route: "/api/forms/[id]/submissions",
      method: "GET",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/forms/[id]/submissions -- Submit a form
// ---------------------------------------------------------------------------
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Fetch the template to validate against
    const template = await db.formTemplate.findUnique({ where: { id } });
    if (!template) {
      return NextResponse.json(
        { error: "Form template not found" },
        { status: 404 },
      );
    }

    if (!template.isActive) {
      return NextResponse.json(
        { error: "This form template is no longer active" },
        { status: 400 },
      );
    }

    const body = await req.json();
    const { data, workflowInstanceId } = body as {
      data?: Record<string, unknown>;
      workflowInstanceId?: string;
    };

    if (!data || typeof data !== "object") {
      return NextResponse.json(
        { error: "Submission data is required" },
        { status: 400 },
      );
    }

    // Validate required fields against the template definition
    const fields = template.fields as Array<{
      id: string;
      name: string;
      label: string;
      type: string;
      required?: boolean;
    }>;

    const missingFields: string[] = [];
    for (const field of fields) {
      if (!field.required) continue;
      // Skip non-input field types
      if (field.type === "section") continue;

      const value = data[field.name];
      const isEmpty =
        value === undefined ||
        value === null ||
        value === "" ||
        (Array.isArray(value) && value.length === 0);

      if (isEmpty) {
        missingFields.push(field.label);
      }
    }

    if (missingFields.length > 0) {
      return NextResponse.json(
        {
          error: "Required fields are missing",
          missingFields,
        },
        { status: 400 },
      );
    }

    const submission = await db.formSubmission.create({
      data: {
        templateId: id,
        submittedById: session.user.id,
        data: data as never,
        workflowInstanceId: workflowInstanceId?.trim() || null,
      },
    });

    await writeAudit({
      userId: session.user.id,
      action: "form_submission.create",
      resourceType: "FormSubmission",
      resourceId: submission.id,
      metadata: {
        templateId: id,
        templateName: template.name,
        workflowInstanceId: workflowInstanceId || null,
      },
    });

    return NextResponse.json(submission, { status: 201 });
  } catch (error) {
    logger.error("Failed to create form submission", error, {
      route: "/api/forms/[id]/submissions",
      method: "POST",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
