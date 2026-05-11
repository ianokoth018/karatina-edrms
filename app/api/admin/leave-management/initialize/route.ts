import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/audit";

function isAdmin(perms: string[] | undefined) {
  return !!perms?.includes("admin:manage");
}

export interface InitializeRequest {
  year: number;
  balancesSlug: string;
  typesSlug: string;
  department?: string;   // optional — restrict to one department
  dryRun?: boolean;
}

export interface InitPreviewRow {
  employeeId: string;
  staffNumber: string;
  displayName: string;
  department: string;
  leaveType: string;
  daysAllocated: number;
}

export interface InitializeResult {
  usersFound: number;
  leaveTypesFound: number;
  genderSkipped: number;   // leave types not assigned in bulk (gender-specific)
  created: number;
  skipped: number;
  errors: number;
  preview?: InitPreviewRow[];
  detail: string[];
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
 * POST /api/admin/leave-management/initialize
 *
 * Bulk-create leave balance records for all active users for a given year.
 * One record per user × leave type (where leave type gender = "Any").
 * Gender-specific leave types (Maternity/Paternity) are skipped in bulk
 * and must be assigned manually — the User model has no gender field.
 *
 * Idempotent: skips any combination that already has a record.
 * Supports dryRun=true to preview without writing.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = (await req.json()) as InitializeRequest;
    const { year, balancesSlug, typesSlug, department, dryRun = false } = body;

    if (!year || !balancesSlug || !typesSlug) {
      return NextResponse.json(
        { error: "year, balancesSlug and typesSlug are required" },
        { status: 400 }
      );
    }

    // ── Load leave types dataset ──────────────────────────────────────────────

    const typesSchema = await db.formDataSchema.findUnique({
      where: { slug: typesSlug },
      include: { records: true },
    });
    if (!typesSchema) {
      return NextResponse.json(
        { error: `Dataset "${typesSlug}" not found` },
        { status: 404 }
      );
    }

    const allLeaveTypes = (typesSchema.records as { id: string; data: unknown }[]).map(
      (r) => r.data as DataRecord
    );

    // Only assign gender-neutral leave types in bulk
    const bulkLeaveTypes = allLeaveTypes.filter((t) => {
      const gender = getStr(t, "gender");
      return !gender || gender === "Any" || gender === "any";
    });
    const genderSkipped = allLeaveTypes.length - bulkLeaveTypes.length;

    if (bulkLeaveTypes.length === 0) {
      return NextResponse.json(
        { error: "No gender-neutral leave types found. Add leave types with Gender = Any first." },
        { status: 400 }
      );
    }

    // ── Load or locate the balances schema ───────────────────────────────────

    const balancesSchema = await db.formDataSchema.findUnique({
      where: { slug: balancesSlug },
      include: { records: true },
    });
    if (!balancesSchema) {
      return NextResponse.json(
        { error: `Dataset "${balancesSlug}" not found` },
        { status: 404 }
      );
    }

    // Build a set of already-existing keys for this year
    const existingKeys = new Set(
      (balancesSchema.records as { id: string; data: unknown }[])
        .map((r) => r.data as DataRecord)
        .filter((d) => getNum(d, "year") === year)
        .map((d) => `${getStr(d, "staff_number")}__${getStr(d, "leave_type")}`)
    );

    // ── Load active users ─────────────────────────────────────────────────────

    const userFilter: Parameters<typeof db.user.findMany>[0] = {
      where: {
        isActive: true,
        ...(department ? { department } : {}),
      },
      select: {
        id: true,
        employeeId: true,
        displayName: true,
        department: true,
      },
      orderBy: { displayName: "asc" },
    };

    const users = await db.user.findMany(userFilter);

    // ── Build output ──────────────────────────────────────────────────────────

    const result: InitializeResult = {
      usersFound: users.length,
      leaveTypesFound: bulkLeaveTypes.length,
      genderSkipped,
      created: 0,
      skipped: 0,
      errors: 0,
      detail: [],
      preview: dryRun ? [] : undefined,
    };

    for (const user of users) {
      // Use employeeId as the staff_number key; fall back to display name slice
      const staffNumber = user.employeeId ?? "";
      const empId = user.employeeId ?? "";

      for (const lt of bulkLeaveTypes) {
        const leaveType = getStr(lt, "leave_type");
        const daysAllocated = getNum(lt, "days_allocated");

        if (!leaveType) continue;

        const uniqueKey = `${staffNumber}__${leaveType}`;

        if (existingKeys.has(uniqueKey)) {
          result.skipped++;
          result.detail.push(
            `${user.displayName} (${staffNumber}) / ${leaveType}: already exists — skipped`
          );
          continue;
        }

        const newRecord: DataRecord = {
          employee_id: empId,
          staff_number: staffNumber,
          leave_type: leaveType,
          days_allocated: daysAllocated,
          days_used: 0,
          days_remaining: daysAllocated,
          year,
          carried_forward: 0,
        };

        if (dryRun) {
          result.preview!.push({
            employeeId: empId,
            staffNumber,
            displayName: user.displayName,
            department: user.department ?? "",
            leaveType,
            daysAllocated,
          });
          result.created++;
          result.detail.push(
            `${user.displayName} (${staffNumber}) / ${leaveType}: ${daysAllocated} days → will create`
          );
          // Add to the in-memory set so duplicates within this run are caught
          existingKeys.add(uniqueKey);
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
            existingKeys.add(uniqueKey);
            result.detail.push(
              `${user.displayName} (${staffNumber}) / ${leaveType}: created (${daysAllocated} days)`
            );
          } catch (err) {
            result.errors++;
            result.detail.push(
              `${user.displayName} (${staffNumber}) / ${leaveType}: error — ${String(err)}`
            );
            logger.error("Leave balance init failed", err, { staffNumber, leaveType });
          }
        }
      }
    }

    if (!dryRun && result.created > 0) {
      await writeAudit({
        userId: session.user.id,
        action: "admin.leave_balances_initialized",
        resourceType: "FormDataSchema",
        resourceId: balancesSchema.id,
        metadata: {
          year,
          department: department ?? "all",
          usersFound: result.usersFound,
          created: result.created,
          skipped: result.skipped,
          errors: result.errors,
        },
      });
    }

    return NextResponse.json({ result });
  } catch (error) {
    logger.error("Leave balance initialization failed", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
