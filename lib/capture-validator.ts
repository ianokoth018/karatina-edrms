// -----------------------------------------------------------------------------
// Metadata validation rules engine for capture profiles
// Validates extracted metadata before a captured document is committed.
// -----------------------------------------------------------------------------

import { logger } from "@/lib/logger";
import { PrismaClient } from "@prisma/client";

export type ValidatorRuleType =
  | "required"    // field must be non-empty
  | "regex"       // field must match pattern
  | "minLength"   // string min length
  | "maxLength"   // string max length
  | "oneOf"       // value must be in list
  | "dateFormat"  // must be a valid date in given format
  | "numeric"     // must be a number
  | "range";      // numeric must be in [min, max]

const VALID_RULE_TYPES: ReadonlySet<ValidatorRuleType> = new Set([
  "required",
  "regex",
  "minLength",
  "maxLength",
  "oneOf",
  "dateFormat",
  "numeric",
  "range",
]);

export interface ValidationRule {
  field: string;
  ruleType: ValidatorRuleType;
  value?: string | number | string[];
  errorMessage?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: Array<{ field: string; rule: ValidatorRuleType; message: string }>;
}

// -----------------------------------------------------------------------------
// Default error message builders
// -----------------------------------------------------------------------------

function defaultMessage(field: string, ruleType: ValidatorRuleType): string {
  switch (ruleType) {
    case "required":
      return `Field '${field}' is required`;
    case "regex":
      return `Field '${field}' failed regex validation`;
    case "minLength":
      return `Field '${field}' failed minLength validation`;
    case "maxLength":
      return `Field '${field}' failed maxLength validation`;
    case "oneOf":
      return `Field '${field}' failed oneOf validation`;
    case "dateFormat":
      return `Field '${field}' failed dateFormat validation`;
    case "numeric":
      return `Field '${field}' failed numeric validation`;
    case "range":
      return `Field '${field}' failed range validation`;
  }
}

// -----------------------------------------------------------------------------
// Individual rule checkers — each returns true when the rule passes
// -----------------------------------------------------------------------------

function checkRequired(val: unknown): boolean {
  return String(val ?? "").trim() !== "";
}

function checkRegex(val: unknown, pattern: string): boolean {
  try {
    return new RegExp(pattern).test(String(val));
  } catch {
    return false;
  }
}

function checkMinLength(val: unknown, min: number): boolean {
  return String(val).length >= min;
}

function checkMaxLength(val: unknown, max: number): boolean {
  return String(val).length <= max;
}

function checkOneOf(val: unknown, list: string[]): boolean {
  return list.includes(String(val));
}

function checkDateFormat(val: unknown): boolean {
  return !isNaN(new Date(String(val)).valueOf());
}

function checkNumeric(val: unknown): boolean {
  return !isNaN(Number(val));
}

function checkRange(val: unknown, rangeStr: string): boolean {
  const parts = rangeStr.split(",");
  if (parts.length !== 2) return false;
  const min = Number(parts[0]);
  const max = Number(parts[1]);
  const num = Number(val);
  return !isNaN(num) && !isNaN(min) && !isNaN(max) && num >= min && num <= max;
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

/**
 * Validate extracted metadata against a flat array of ValidationRule entries.
 *
 * This is the legacy rule-array API. The preferred entrypoint is
 * `validateMetadata` below, which accepts the {fields: [...]} container used
 * by CaptureProfile.validationRules.
 *
 * All rules are evaluated — errors are collected, not short-circuited.
 */
export function validateMetadataLegacy(
  metadata: Record<string, unknown>,
  rules: ValidationRule[]
): ValidationResult {
  const errors: ValidationResult["errors"] = [];

  for (const rule of rules) {
    const { field, ruleType, value, errorMessage } = rule;
    const val = metadata[field];

    let passed = true;

    switch (ruleType) {
      case "required":
        passed = checkRequired(val);
        break;

      case "regex":
        if (typeof value !== "string") {
          logger.warn("capture-validator: regex rule missing string pattern", {
            field,
          });
          passed = false;
        } else {
          passed = checkRegex(val, value);
        }
        break;

      case "minLength":
        if (typeof value !== "number") {
          logger.warn(
            "capture-validator: minLength rule missing numeric value",
            { field }
          );
          passed = false;
        } else {
          passed = checkMinLength(val, value);
        }
        break;

      case "maxLength":
        if (typeof value !== "number") {
          logger.warn(
            "capture-validator: maxLength rule missing numeric value",
            { field }
          );
          passed = false;
        } else {
          passed = checkMaxLength(val, value);
        }
        break;

      case "oneOf":
        if (!Array.isArray(value)) {
          logger.warn("capture-validator: oneOf rule missing array value", {
            field,
          });
          passed = false;
        } else {
          passed = checkOneOf(val, value as string[]);
        }
        break;

      case "dateFormat":
        passed = checkDateFormat(val);
        break;

      case "numeric":
        passed = checkNumeric(val);
        break;

      case "range":
        if (typeof value !== "string") {
          logger.warn(
            "capture-validator: range rule value must be 'min,max' string",
            { field }
          );
          passed = false;
        } else {
          passed = checkRange(val, value);
        }
        break;
    }

    if (!passed) {
      errors.push({
        field,
        rule: ruleType,
        message: errorMessage ?? defaultMessage(field, ruleType),
      });
    }
  }

  const result: ValidationResult = { valid: errors.length === 0, errors };

  if (!result.valid) {
    logger.warn("capture-validator: metadata validation failed", {
      errorCount: errors.length,
      fields: errors.map((e) => e.field),
    } as Record<string, unknown>);
  }

  return result;
}

/**
 * Parse a JSON validation rules array (e.g. from CaptureProfile.metadataMapping).
 *
 * Accepts:
 * - A JSON string containing an array
 * - An already-parsed array
 *
 * Returns only entries that have a string `field` and a valid `ruleType`.
 * Returns an empty array on any parse error.
 */
export function parseValidationRules(raw: unknown): ValidationRule[] {
  let parsed: unknown;

  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      logger.warn("capture-validator: failed to JSON.parse validation rules");
      return [];
    }
  } else {
    parsed = raw;
  }

  if (!Array.isArray(parsed)) {
    if (raw !== undefined && raw !== null) {
      logger.warn(
        "capture-validator: validation rules must be a JSON array, got",
        { type: typeof parsed } as Record<string, unknown>
      );
    }
    return [];
  }

  const valid: ValidationRule[] = [];

  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) continue;

    const candidate = entry as Record<string, unknown>;

    if (typeof candidate.field !== "string" || candidate.field.trim() === "") {
      continue;
    }

    if (!VALID_RULE_TYPES.has(candidate.ruleType as ValidatorRuleType)) {
      continue;
    }

    const rule: ValidationRule = {
      field: candidate.field,
      ruleType: candidate.ruleType as ValidatorRuleType,
    };

    if (
      candidate.value !== undefined &&
      (typeof candidate.value === "string" ||
        typeof candidate.value === "number" ||
        Array.isArray(candidate.value))
    ) {
      rule.value = candidate.value as string | number | string[];
    }

    if (typeof candidate.errorMessage === "string") {
      rule.errorMessage = candidate.errorMessage;
    }

    valid.push(rule);
  }

  return valid;
}

// -----------------------------------------------------------------------------
// Field-shaped validation rules (CaptureProfile.validationRules)
//
// Rule container shape:
//   { fields: [ { name, required?, regex?, enum?, lookupTable? } ] }
//
// `lookupTable` is "Model.field" — matched generically against any Prisma
// model, so no assumption is made about which models exist in the schema.
// -----------------------------------------------------------------------------

export interface FieldRule {
  name: string;
  required?: boolean;
  regex?: string;
  enum?: string[];
  lookupTable?: string;
}

export interface FieldValidationRules {
  fields: FieldRule[];
}

export interface FieldValidationError {
  field: string;
  reason: string;
}

export interface FieldValidationResult {
  valid: boolean;
  errors: FieldValidationError[];
}

export function parseFieldValidationRules(raw: unknown): FieldValidationRules {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { fields: [] };
    }
  }

  if (!parsed || typeof parsed !== "object") return { fields: [] };

  const obj = parsed as Record<string, unknown>;
  const rawFields = obj.fields;
  if (!Array.isArray(rawFields)) return { fields: [] };

  const fields: FieldRule[] = [];
  for (const entry of rawFields) {
    if (!entry || typeof entry !== "object") continue;
    const c = entry as Record<string, unknown>;
    if (typeof c.name !== "string" || c.name.trim() === "") continue;

    const rule: FieldRule = { name: c.name };
    if (typeof c.required === "boolean") rule.required = c.required;
    if (typeof c.regex === "string" && c.regex.length > 0) rule.regex = c.regex;
    if (Array.isArray(c.enum)) {
      rule.enum = c.enum.filter((v): v is string => typeof v === "string");
    }
    if (typeof c.lookupTable === "string" && c.lookupTable.includes(".")) {
      rule.lookupTable = c.lookupTable;
    }
    fields.push(rule);
  }

  return { fields };
}

function isEmpty(val: unknown): boolean {
  return val === undefined || val === null || String(val).trim() === "";
}

/**
 * Validate metadata against the field-shaped rule container.
 *
 * Evaluates: required, regex, enum, lookupTable. All rules are collected;
 * validation never short-circuits. `prisma` is required only when any rule
 * uses `lookupTable`; pass any PrismaClient instance (worker or singleton).
 */
export async function validateMetadata(
  rules: FieldValidationRules | unknown,
  metadata: Record<string, unknown>,
  prisma?: PrismaClient
): Promise<FieldValidationResult> {
  const parsed = parseFieldValidationRules(rules);
  const errors: FieldValidationError[] = [];

  for (const rule of parsed.fields) {
    const value = metadata[rule.name];
    const empty = isEmpty(value);

    if (rule.required && empty) {
      errors.push({ field: rule.name, reason: "required" });
      continue;
    }

    if (empty) continue;

    const strVal = String(value);

    if (rule.regex) {
      try {
        if (!new RegExp(rule.regex).test(strVal)) {
          errors.push({ field: rule.name, reason: `regex: ${rule.regex}` });
          continue;
        }
      } catch {
        errors.push({ field: rule.name, reason: "invalid regex pattern" });
        continue;
      }
    }

    if (rule.enum && rule.enum.length > 0) {
      if (!rule.enum.includes(strVal)) {
        errors.push({
          field: rule.name,
          reason: `enum: expected one of [${rule.enum.join(", ")}]`,
        });
        continue;
      }
    }

    if (rule.lookupTable) {
      if (!prisma) {
        errors.push({
          field: rule.name,
          reason: `lookupTable configured but no prisma client supplied`,
        });
        continue;
      }
      const [modelName, fieldName] = rule.lookupTable.split(".");
      if (!modelName || !fieldName) {
        errors.push({
          field: rule.name,
          reason: `lookupTable must be "Model.field"`,
        });
        continue;
      }
      const modelKey = modelName.charAt(0).toLowerCase() + modelName.slice(1);
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const delegate = (prisma as any)[modelKey];
        if (!delegate || typeof delegate.findFirst !== "function") {
          errors.push({
            field: rule.name,
            reason: `lookupTable model "${modelName}" not found`,
          });
          continue;
        }
        const row = await delegate.findFirst({
          where: { [fieldName]: strVal },
          select: { id: true },
        });
        if (!row) {
          errors.push({
            field: rule.name,
            reason: `lookupTable: no ${modelName} with ${fieldName}="${strVal}"`,
          });
        }
      } catch (err) {
        logger.warn("capture-validator: lookupTable query failed", {
          field: rule.name,
          lookupTable: rule.lookupTable,
          error: err instanceof Error ? err.message : String(err),
        });
        errors.push({
          field: rule.name,
          reason: `lookupTable query failed`,
        });
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
