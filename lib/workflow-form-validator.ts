// ---------------------------------------------------------------------------
// Workflow Form Validator
// ---------------------------------------------------------------------------
// Validates submitted formData against the FormTemplate fields linked to a
// task node before allowing advanceWorkflow() to proceed.
// ---------------------------------------------------------------------------

import { db } from "@/lib/db";

interface FieldDef {
  name: string;
  label?: string;
  type: "text" | "email" | "number" | "date" | "textarea" | "select" | string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string;
  options?: { value: string; label: string }[];
}

export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Validate `formData` against a FormTemplate's field definitions.
 * Returns an array of validation errors (empty = valid).
 */
export function validateAgainstFields(
  fields: FieldDef[],
  formData: Record<string, unknown>
): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const field of fields) {
    const raw = formData[field.name];
    const label = field.label ?? field.name;

    // Required check
    if (field.required) {
      if (raw === null || raw === undefined || String(raw).trim() === "") {
        errors.push({ field: field.name, message: `${label} is required` });
        continue;
      }
    }

    // Skip further validation if value is empty and not required
    if (raw === null || raw === undefined || String(raw).trim() === "") continue;

    const strVal = String(raw);

    // Type-specific validation
    switch (field.type) {
      case "email":
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(strVal)) {
          errors.push({ field: field.name, message: `${label} must be a valid email address` });
        }
        break;

      case "number": {
        const num = Number(raw);
        if (isNaN(num)) {
          errors.push({ field: field.name, message: `${label} must be a number` });
          break;
        }
        if (field.min !== undefined && num < field.min) {
          errors.push({ field: field.name, message: `${label} must be at least ${field.min}` });
        }
        if (field.max !== undefined && num > field.max) {
          errors.push({ field: field.name, message: `${label} must be at most ${field.max}` });
        }
        break;
      }

      case "date":
        if (isNaN(Date.parse(strVal))) {
          errors.push({ field: field.name, message: `${label} must be a valid date` });
        }
        break;

      case "select":
        if (field.options?.length) {
          const valid = field.options.map((o) => o.value);
          if (!valid.includes(strVal)) {
            errors.push({ field: field.name, message: `${label} must be one of: ${valid.join(", ")}` });
          }
        }
        break;
    }

    // String constraints (applies to text, textarea, email, etc.)
    if (typeof raw === "string") {
      if (field.minLength !== undefined && raw.length < field.minLength) {
        errors.push({ field: field.name, message: `${label} must be at least ${field.minLength} characters` });
      }
      if (field.maxLength !== undefined && raw.length > field.maxLength) {
        errors.push({ field: field.name, message: `${label} must be at most ${field.maxLength} characters` });
      }
      if (field.pattern) {
        try {
          if (!new RegExp(field.pattern).test(raw)) {
            errors.push({ field: field.name, message: `${label} format is invalid` });
          }
        } catch {
          // ignore invalid regex in field config
        }
      }
    }
  }

  return errors;
}

/**
 * Given a task and the submitted formData, find the formTemplateId from the
 * task's node in the template definition, fetch the FormTemplate, and validate.
 *
 * Returns null if no FormTemplate is linked (validation passes implicitly).
 * Returns ValidationError[] — empty means valid.
 */
export async function validateTaskFormData(params: {
  taskNodeId: string | null | undefined;
  instanceId: string;
  formData: Record<string, unknown>;
}): Promise<ValidationError[] | null> {
  const { taskNodeId, instanceId, formData } = params;

  if (!taskNodeId || Object.keys(formData).length === 0) return null;

  // Fetch the instance's template definition to find the node's formTemplateId
  const instance = await db.workflowInstance.findUnique({
    where: { id: instanceId },
    include: { template: { select: { definition: true } } },
  });
  if (!instance) return null;

  const definition = instance.template.definition as {
    nodes?: { id: string; data: Record<string, unknown> }[];
  };
  const node = definition.nodes?.find((n) => n.id === taskNodeId);
  const formTemplateId = node?.data?.formTemplateId as string | undefined;

  if (!formTemplateId) return null;

  const formTemplate = await db.formTemplate.findUnique({
    where: { id: formTemplateId },
    select: { fields: true },
  });
  if (!formTemplate) return null;

  const fields = formTemplate.fields as unknown as FieldDef[];
  if (!Array.isArray(fields) || fields.length === 0) return null;

  return validateAgainstFields(fields, formData);
}
