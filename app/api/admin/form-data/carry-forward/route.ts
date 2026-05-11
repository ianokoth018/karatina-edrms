import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";

function isAdmin(perms: string[] | undefined) {
  return !!perms?.includes("admin:manage");
}

export interface CarryForwardRule {
  leaveType: string;
  enabled: boolean;
  cap: number;         // max days that can be carried forward (0 = no carry-forward)
}

export interface CarryForwardRequest {
  fromYear: number;
  toYear: number;
  balancesSlug: string;  // e.g. "leave-balances"
  typesSlug: string;     // e.g. "leave-types"
  rules: CarryForwardRule[];
  dryRun?: boolean;      // if true, return preview without writing
}

export interface CarryForwardResult {
  processed: number;
  created: number;
  skipped: number;
  errors: number;
  preview?: PreviewRow[];
  detail: string[];
}

interface PreviewRow {
  staffNumber: string;
  leaveType: string;
  daysRemaining2026: number;
  carryForward: number;
  newAllocation: number;
}

type DataRecord = Record<string, unknown>;

function getStr(record: DataRecord, key: string): string {
  return String(record[key] ?? "");
}

function getNum(record: DataRecord, key: string): number {
  const v = record[key];
  if (typeof v === "number") return v;
  if (typeof v === "string") return parseFloat(v) || 0;
  return 0;
}

/**
 * POST /api/admin/form-data/carry-forward
 *
 * Runs the year-end leave balance carry-forward for all staff.
 * Reads from the `leave-balances` dataset (fromYear records),
 * reads base allocations from `leave-types` dataset,
 * then creates new `leave-balances` records for toYear.
 *
 * Supports dryRun=true for a preview without writing.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = (await req.json()) as CarryForwardRequest;
    const {
      fromYear,
      toYear,
      balancesSlug,
      typesSlug,
      rules,
      dryRun = false,
    } = body;

    if (!fromYear || !toYear || !balancesSlug || !typesSlug) {
      return NextResponse.json({ error: "fromYear, toYear, balancesSlug and typesSlug are required" }, { status: 400 });
    }
    if (toYear <= fromYear) {
      return NextResponse.json({ error: "toYear must be greater than fromYear" }, { status: 400 });
    }

    // ── Load datasets ──────────────────────────────────────────────────────────

    const balancesSchema = await db.formDataSchema.findUnique({
      where: { slug: balancesSlug },
      include: { records: true },
    });
    if (!balancesSchema) {
      return NextResponse.json({ error: `Dataset "${balancesSlug}" not found` }, { status: 404 });
    }

    const typesSchema = await db.formDataSchema.findUnique({
      where: { slug: typesSlug },
      include: { records: true },
    });
    if (!typesSchema) {
      return NextResponse.json({ error: `Dataset "${typesSlug}" not found` }, { status: 404 });
    }

    // ── Parse records ──────────────────────────────────────────────────────────

    const fromYearBalances = (balancesSchema.records as { id: string; data: unknown }[])
      .map((r) => ({ id: r.id, data: r.data as DataRecord }))
      .filter((r) => getNum(r.data, "year") === fromYear);

    const typeRecords = (typesSchema.records as { id: string; data: unknown }[])
      .map((r) => r.data as DataRecord);

    // Build a quick lookup: leaveType → base days_allocated
    const typeAllocations = new Map<string, number>();
    for (const t of typeRecords) {
      const lt = getStr(t, "leave_type");
      const days = getNum(t, "days_allocated");
      if (lt) typeAllocations.set(lt, days);
    }

    // Build a rule lookup
    const ruleMap = new Map<string, CarryForwardRule>();
    for (const r of rules) ruleMap.set(r.leaveType, r);

    // Check which toYear records already exist (for upsert guard)
    const existingToYear = new Set(
      (balancesSchema.records as { id: string; data: unknown }[])
        .map((r) => r.data as DataRecord)
        .filter((d) => getNum(d, "year") === toYear)
        .map((d) => `${getStr(d, "staff_number")}__${getStr(d, "leave_type")}`)
    );

    // ── Process ────────────────────────────────────────────────────────────────

    const result: CarryForwardResult = {
      processed: 0,
      created: 0,
      skipped: 0,
      errors: 0,
      detail: [],
      preview: dryRun ? [] : undefined,
    };

    for (const { data } of fromYearBalances) {
      const staffNumber = getStr(data, "staff_number");
      const employeeId = getStr(data, "employee_id");
      const leaveType = getStr(data, "leave_type");
      const daysRemaining = getNum(data, "days_remaining");

      if (!staffNumber || !leaveType) {
        result.skipped++;
        result.detail.push(`Skipped record — missing staff_number or leave_type`);
        continue;
      }

      result.processed++;

      const uniqueKey = `${staffNumber}__${leaveType}`;
      if (existingToYear.has(uniqueKey)) {
        result.skipped++;
        result.detail.push(`${staffNumber} / ${leaveType}: toYear record already exists — skipped`);
        continue;
      }

      const rule = ruleMap.get(leaveType);
      const baseAllocation = typeAllocations.get(leaveType) ?? getNum(data, "days_allocated");

      // Calculate carry-forward
      let carryForward = 0;
      if (rule?.enabled && rule.cap > 0) {
        carryForward = Math.min(daysRemaining, rule.cap);
      }

      const newDaysAllocated = baseAllocation + carryForward;
      const newRecord: DataRecord = {
        employee_id: employeeId,
        staff_number: staffNumber,
        leave_type: leaveType,
        days_allocated: newDaysAllocated,
        days_used: 0,
        days_remaining: newDaysAllocated,
        year: toYear,
        carried_forward: carryForward,
      };

      if (dryRun) {
        result.preview!.push({
          staffNumber,
          leaveType,
          daysRemaining2026: daysRemaining,
          carryForward,
          newAllocation: newDaysAllocated,
        });
        result.created++;
        result.detail.push(
          `${staffNumber} / ${leaveType}: ${daysRemaining} remaining → carry ${carryForward} → ${newDaysAllocated} days in ${toYear}`
        );
      } else {
        try {
          await db.formDataEntry.create({
            data: {
              schemaId: balancesSchema.id,
              data: newRecord as object,
              createdById: session.user.id,
            },
          });
          result.created++;
          result.detail.push(
            `${staffNumber} / ${leaveType}: created ${toYear} record (${newDaysAllocated} days, ${carryForward} carried)`
          );
        } catch (err) {
          result.errors++;
          result.detail.push(`${staffNumber} / ${leaveType}: error — ${String(err)}`);
          logger.error("Carry-forward record creation failed", err, { staffNumber, leaveType });
        }
      }
    }

    if (!dryRun && result.created > 0) {
      await writeAudit({
        userId: session.user.id,
        action: "admin.leave_carry_forward_executed",
        resourceType: "FormDataSchema",
        resourceId: balancesSchema.id,
        metadata: {
          fromYear,
          toYear,
          processed: result.processed,
          created: result.created,
          skipped: result.skipped,
          errors: result.errors,
        },
      });
    }

    return NextResponse.json({ result });
  } catch (error) {
    logger.error("Carry-forward failed", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
