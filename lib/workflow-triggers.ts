// ---------------------------------------------------------------------------
// Workflow Triggers — evaluate content-aware rules and auto-start workflows
// ---------------------------------------------------------------------------
// Call evaluateTriggers(documentId) from the capture pipeline after OCR /
// metadata extraction completes.
// ---------------------------------------------------------------------------

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { bootstrapWorkflow } from "@/lib/workflow-engine";
import { generateWorkflowReference } from "@/lib/reference";
import { interpolate } from "@/lib/mailer";

interface TriggerCondition {
  field: string;
  operator: string;
  value: string;
}

function testTriggerCondition(
  cond: TriggerCondition,
  data: Record<string, unknown>
): boolean {
  const raw = getField(data, cond.field);

  switch (cond.operator) {
    case "equals":       return String(raw) === cond.value;
    case "not_equals":   return String(raw) !== cond.value;
    case "contains":     return String(raw ?? "").includes(cond.value);
    case "not_empty":    return raw !== null && raw !== undefined && raw !== "";
    case "empty":        return raw === null || raw === undefined || raw === "";
    case "greater_than": return Number(raw) > Number(cond.value);
    case "less_than":    return Number(raw) < Number(cond.value);
    case "in_list":      return cond.value.split(",").map((s) => s.trim()).includes(String(raw));
    case "regex":        try { return new RegExp(cond.value).test(String(raw ?? "")); } catch { return false; }
    default:             return false;
  }
}

function getField(data: Record<string, unknown>, field: string): unknown {
  return field.split(".").reduce<unknown>((cur, part) => {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    return (cur as Record<string, unknown>)[part];
  }, data);
}

/**
 * Evaluate all active WorkflowTriggers against the given document.
 * For each matching trigger, auto-start a workflow instance.
 *
 * Returns an array of created instance IDs.
 */
export async function evaluateTriggers(documentId: string): Promise<string[]> {
  const doc = await db.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      title: true,
      documentType: true,
      department: true,
      metadata: true,
      status: true,
      referenceNumber: true,
      createdById: true,
    },
  });

  if (!doc) {
    logger.warn("evaluateTriggers: document not found", { documentId });
    return [];
  }

  const triggers = await db.workflowTrigger.findMany({
    where: { isActive: true },
    include: { template: { select: { id: true, name: true, version: true, isActive: true } } },
  });

  if (triggers.length === 0) return [];

  // Build evaluation data bag from document fields + metadata
  const dataBag: Record<string, unknown> = {
    title: doc.title,
    documentType: doc.documentType ?? "",
    department: doc.department ?? "",
    status: doc.status,
    referenceNumber: doc.referenceNumber ?? "",
    ...((doc.metadata as Record<string, unknown>) ?? {}),
  };

  const createdInstanceIds: string[] = [];

  for (const trigger of triggers) {
    if (!trigger.template.isActive) continue;

    // Optional pre-filter by documentType and department
    if (trigger.documentType && trigger.documentType !== doc.documentType) continue;
    if (trigger.department && trigger.department !== doc.department) continue;

    const conditions = trigger.conditions as unknown as TriggerCondition[];
    const matched = conditions.every((c) => testTriggerCondition(c, dataBag));

    if (!matched) continue;

    // Build workflow subject from template
    const subjectTemplate = trigger.subjectTemplate ?? `Review: {{title}}`;
    const vars: Record<string, string> = {};
    for (const [k, v] of Object.entries(dataBag)) {
      if (typeof v === "string" || typeof v === "number") vars[k] = String(v);
    }
    const subject = interpolate(subjectTemplate, vars);

    // Check: don't start duplicate workflows for the same trigger+document
    const existing = await db.workflowInstance.findFirst({
      where: {
        documentId: doc.id,
        templateId: trigger.templateId,
        status: { in: ["PENDING", "IN_PROGRESS"] },
      },
    });
    if (existing) {
      logger.info("evaluateTriggers: skipping duplicate — active instance exists", {
        documentId, triggerId: trigger.id, instanceId: existing.id,
      });
      continue;
    }

    try {
      const referenceNumber = await generateWorkflowReference();

      const instance = await db.workflowInstance.create({
        data: {
          referenceNumber,
          templateId: trigger.templateId,
          templateVersion: trigger.template.version,
          documentId: doc.id,
          initiatedById: doc.createdById,
          subject,
          status: "IN_PROGRESS",
          currentStepIndex: 0,
          formData: dataBag as object,
          dueAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          events: {
            create: {
              eventType: "WORKFLOW_STARTED",
              data: {
                triggeredBy: trigger.id,
                triggerName: trigger.name,
                subject,
                templateName: trigger.template.name,
              } as object,
            },
          },
        },
      });

      await bootstrapWorkflow({
        instanceId: instance.id,
        initiatorId: doc.createdById,
        formData: dataBag,
      });

      createdInstanceIds.push(instance.id);

      logger.info("evaluateTriggers: workflow auto-started", {
        documentId, triggerId: trigger.id, instanceId: instance.id,
      });
    } catch (err) {
      logger.error("evaluateTriggers: failed to start triggered workflow", err, {
        documentId, triggerId: trigger.id,
      });
    }
  }

  return createdInstanceIds;
}
