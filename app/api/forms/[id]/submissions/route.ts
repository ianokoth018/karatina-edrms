import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { generateWorkflowReference } from "@/lib/reference";
import { bootstrapWorkflow } from "@/lib/workflow-engine";

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

    const resolvedWorkflowInstanceId = workflowInstanceId?.trim() || null;

    const submission = await db.formSubmission.create({
      data: {
        templateId: id,
        submittedById: session.user.id,
        data: data as never,
        workflowInstanceId: resolvedWorkflowInstanceId,
      },
    });

    // Auto-start a workflow if this form template is linked to one
    let autoWorkflowInstanceId: string | null = null;
    if (!resolvedWorkflowInstanceId && template.workflowTemplateId) {
      try {
        const wfTemplate = await db.workflowTemplate.findUnique({
          where: { id: template.workflowTemplateId },
        });
        if (wfTemplate?.isActive) {
          const referenceNumber = await generateWorkflowReference();
          const dueAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
          const instance = await db.workflowInstance.create({
            data: {
              referenceNumber,
              templateId: wfTemplate.id,
              templateVersion: wfTemplate.version,
              initiatedById: session.user.id,
              subject: template.name,
              status: "IN_PROGRESS",
              currentStepIndex: 0,
              formData: data as object,
              dueAt,
              events: {
                create: {
                  eventType: "WORKFLOW_STARTED",
                  actorId: session.user.id,
                  data: {
                    subject: template.name,
                    templateName: wfTemplate.name,
                    templateVersion: wfTemplate.version,
                    formSubmissionId: submission.id,
                  } as object,
                },
              },
            },
          });
          await bootstrapWorkflow({
            instanceId: instance.id,
            initiatorId: session.user.id,
            formData: data,
          });
          // Link the submission to the new instance
          await db.formSubmission.update({
            where: { id: submission.id },
            data: { workflowInstanceId: instance.id },
          });
          autoWorkflowInstanceId = instance.id;

          await writeAudit({
            userId: session.user.id,
            action: "WORKFLOW_STARTED",
            resourceType: "workflow_instance",
            resourceId: instance.id,
            metadata: { referenceNumber, templateId: wfTemplate.id, formSubmissionId: submission.id },
          });
        }
      } catch (wfErr) {
        logger.error("Failed to auto-start workflow from form submission", wfErr);
        // Don't fail the submission if workflow start fails
      }
    }

    await writeAudit({
      userId: session.user.id,
      action: "form_submission.create",
      resourceType: "FormSubmission",
      resourceId: submission.id,
      metadata: {
        templateId: id,
        templateName: template.name,
        workflowInstanceId: autoWorkflowInstanceId ?? resolvedWorkflowInstanceId ?? null,
      },
    });

    return NextResponse.json(
      { ...submission, workflowInstanceId: autoWorkflowInstanceId ?? submission.workflowInstanceId },
      { status: 201 },
    );
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
