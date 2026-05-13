import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { evaluateFormSubmitTriggers } from "@/lib/workflow-triggers";
import { take } from "@/lib/rate-limit";

// ---------------------------------------------------------------------------
// POST /api/public/forms/[id]/submissions
//
// Public, no-auth form submission endpoint. Only accepts submissions for
// FormTemplate rows that have explicitly opted in (isPublic = true). For
// every other case we return a generic 404 so we don't leak the existence
// of the form.
//
// Rate-limited to 5 submissions per IP per minute via lib/rate-limit's
// sliding window. The system-user surrogate is resolved lazily and cached
// in-process — see `getSystemSubmitter` below.
// ---------------------------------------------------------------------------

const PUBLIC_SUBMIT_RATE_LIMIT = { max: 5, windowMs: 60 * 1000 };
const SYSTEM_SUBMITTER_EMAIL = "public-submitter@example.local";

let cachedSystemSubmitterId: string | null = null;

async function getSystemSubmitterId(): Promise<string> {
  if (cachedSystemSubmitterId) return cachedSystemSubmitterId;

  // Prefer any existing Admin so audits stay tied to a real account.
  const admin = await db.user.findFirst({
    where: { roles: { some: { role: { name: "Admin" } } } },
    select: { id: true },
  });
  if (admin) {
    cachedSystemSubmitterId = admin.id;
    return admin.id;
  }

  // Fallback: synthesize a permanent surrogate user.
  const existing = await db.user.findUnique({
    where: { email: SYSTEM_SUBMITTER_EMAIL },
    select: { id: true },
  });
  if (existing) {
    cachedSystemSubmitterId = existing.id;
    return existing.id;
  }

  const created = await db.user.create({
    data: {
      email: SYSTEM_SUBMITTER_EMAIL,
      name: "Public Submitter",
      displayName: "Public Submitter",
      // Password is unusable: this user can never log in (no /login path
      // accepts an empty/sentinel hash). It only exists to satisfy the
      // required `submittedById` FK on FormSubmission.
      password: "!disabled-no-login!",
      isActive: false,
    },
    select: { id: true },
  });
  cachedSystemSubmitterId = created.id;
  return created.id;
}

function getClientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || "unknown";
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const ip = getClientIp(req);

    // ---- rate limit (per IP) ----
    const rl = take(
      `public-form-submit:${ip}`,
      PUBLIC_SUBMIT_RATE_LIMIT.max,
      PUBLIC_SUBMIT_RATE_LIMIT.windowMs,
    );
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many submissions. Please try again shortly." },
        {
          status: 429,
          headers: { "Retry-After": String(rl.retryAfterSeconds) },
        },
      );
    }

    // ---- look up template (must be public AND active) ----
    const template = await db.formTemplate.findUnique({ where: { id } });
    if (!template || !template.isPublic || !template.isActive) {
      // Don't leak existence of non-public forms.
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await req.json().catch(() => null);
    const data =
      body && typeof body === "object"
        ? ((body as { data?: unknown }).data as Record<string, unknown> | undefined)
        : undefined;

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return NextResponse.json(
        { error: "Submission data is required" },
        { status: 400 },
      );
    }

    // ---- validate required fields ----
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
      if (field.type === "section" || field.type === "divider") continue;
      const value = (data as Record<string, unknown>)[field.name];
      const isEmpty =
        value === undefined ||
        value === null ||
        value === "" ||
        (Array.isArray(value) && value.length === 0);
      if (isEmpty) missingFields.push(field.label);
    }
    if (missingFields.length > 0) {
      return NextResponse.json(
        { error: "Required fields are missing", missingFields },
        { status: 400 },
      );
    }

    const submitterId = await getSystemSubmitterId();

    const submission = await db.formSubmission.create({
      data: {
        templateId: id,
        submittedById: submitterId,
        data: data as never,
      },
    });

    // Fire any active form_submit WorkflowTriggers — mirrors the internal
    // endpoint's behaviour so workflows still kick off for public forms.
    try {
      const triggeredIds = await evaluateFormSubmitTriggers({
        formTemplateId: id,
        formData: data,
        submittedById: submitterId,
      });
      if (triggeredIds.length > 0) {
        logger.info("Public form-submit triggers fired", {
          formTemplateId: id,
          instanceCount: triggeredIds.length,
        });
      }
    } catch (trigErr) {
      logger.error("Failed to evaluate form-submit triggers (public)", trigErr);
    }

    await writeAudit({
      userId: submitterId,
      action: "public_form.submitted",
      resourceType: "FormSubmission",
      resourceId: submission.id,
      ipAddress: ip,
      userAgent: req.headers.get("user-agent") ?? undefined,
      metadata: {
        templateId: id,
        templateName: template.name,
      },
    });

    return NextResponse.json(
      { id: submission.id, submittedAt: submission.submittedAt },
      { status: 201 },
    );
  } catch (error) {
    logger.error("Failed to create public form submission", error, {
      route: "/api/public/forms/[id]/submissions",
      method: "POST",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
