import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import * as XLSX from "xlsx";

function isAdmin(perms: string[] | undefined) {
  return !!perms?.includes("admin:manage");
}

type Ctx = { params: Promise<{ id: string }> };

interface FieldDef {
  id: string;
  name: string;
  label: string;
  type: string;
  required?: boolean;
  options?: string[];
}

interface LeaveTypeRecord {
  leave_type?: string;
  days_allocated?: number;
  gender?: string;
}

/** GET /api/admin/form-data/[id]/import
 *  Download a fully pre-filled Excel template.
 *  For leave_balances: one row per user × leave type with all known values filled.
 *  For other schemas with employee fields: one row per user.
 *  For other schemas: blank header row only.
 */
export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const schema = await db.formDataSchema.findUnique({ where: { id } });
    if (!schema) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const fields = (schema.fields as unknown as FieldDef[]) ?? [];
    const fieldNames = fields.map((f) => f.name.toLowerCase());
    const currentYear = new Date().getFullYear();

    const hasEmployeeId = fieldNames.some((n) => n.includes("employee_id") || n.includes("employeeid"));
    const hasStaffNumber = fieldNames.some((n) => n.includes("staff_number") || n.includes("staffnumber") || n.includes("staff_no"));
    const hasLeaveType = fieldNames.some((n) => n.includes("leave_type") || n.includes("leavetype"));

    // Header row for the spreadsheet: "Staff Name" helper col first, then schema fields
    const isLeaveBalances = (hasEmployeeId || hasStaffNumber) && hasLeaveType;
    const extraCol = "Staff Name"; // reference column — not in schema, ignored on import
    const schemaHeaders = fields.map((f) => f.label || f.name);

    type ExcelRow = Record<string, string | number>;
    const rows: ExcelRow[] = [];

    if (isLeaveBalances) {
      // Cross-product: every active user × every leave type
      const [users, leaveTypeEntries] = await Promise.all([
        db.user.findMany({
          where: { isActive: true },
          select: { employeeId: true, displayName: true, name: true, department: true },
          orderBy: { displayName: "asc" },
        }),
        db.formDataEntry.findMany({
          where: { schema: { slug: { in: ["leave_types", "leave-types"] } } },
          select: { data: true },
        }),
      ]);

      const leaveTypes: LeaveTypeRecord[] = leaveTypeEntries.map((e) => e.data as LeaveTypeRecord);

      for (const user of users) {
        for (const lt of leaveTypes) {
          const ltName = lt.leave_type ?? "";
          const daysAllocated = lt.days_allocated ?? 0;

          const row: ExcelRow = { [extraCol]: user.displayName || user.name };

          for (const f of fields) {
            const key = f.name.toLowerCase();
            if (key.includes("employee_id") || key.includes("employeeid")) {
              row[schemaHeaders[fields.indexOf(f)]] = user.employeeId ?? "";
            } else if (key.includes("staff_number") || key.includes("staffnumber") || key.includes("staff_no")) {
              row[schemaHeaders[fields.indexOf(f)]] = user.employeeId ?? "";
            } else if (key.includes("leave_type") || key.includes("leavetype")) {
              row[schemaHeaders[fields.indexOf(f)]] = ltName;
            } else if (key.includes("days_allocated") || key === "allocated") {
              row[schemaHeaders[fields.indexOf(f)]] = daysAllocated;
            } else if (key.includes("days_used") || key === "used") {
              row[schemaHeaders[fields.indexOf(f)]] = 0;
            } else if (key.includes("days_remaining") || key === "remaining") {
              row[schemaHeaders[fields.indexOf(f)]] = daysAllocated;
            } else if (key.includes("year")) {
              row[schemaHeaders[fields.indexOf(f)]] = currentYear;
            } else if (key.includes("carried_forward") || key.includes("carriedforward")) {
              row[schemaHeaders[fields.indexOf(f)]] = 0;
            } else if (key.includes("department") || key.includes("dept")) {
              row[schemaHeaders[fields.indexOf(f)]] = user.department ?? "";
            } else {
              row[schemaHeaders[fields.indexOf(f)]] = "";
            }
          }

          rows.push(row);
        }
      }
    } else if (hasEmployeeId || hasStaffNumber) {
      // Generic: one row per user
      const users = await db.user.findMany({
        where: { isActive: true },
        select: { employeeId: true, displayName: true, name: true, department: true },
        orderBy: { displayName: "asc" },
      });

      for (const user of users) {
        const row: ExcelRow = { [extraCol]: user.displayName || user.name };

        for (const f of fields) {
          const key = f.name.toLowerCase();
          if (key.includes("employee_id") || key.includes("employeeid")) {
            row[schemaHeaders[fields.indexOf(f)]] = user.employeeId ?? "";
          } else if (key.includes("staff_number") || key.includes("staffnumber") || key.includes("staff_no")) {
            row[schemaHeaders[fields.indexOf(f)]] = user.employeeId ?? "";
          } else if (key.includes("department") || key.includes("dept")) {
            row[schemaHeaders[fields.indexOf(f)]] = user.department ?? "";
          } else if (key.includes("year")) {
            row[schemaHeaders[fields.indexOf(f)]] = currentYear;
          } else {
            row[schemaHeaders[fields.indexOf(f)]] = "";
          }
        }
        rows.push(row);
      }
    }

    // Build workbook
    const wb = XLSX.utils.book_new();

    let ws: XLSX.WorkSheet;
    if (rows.length > 0) {
      ws = XLSX.utils.json_to_sheet(rows, {
        header: [extraCol, ...schemaHeaders],
      });
    } else {
      ws = XLSX.utils.aoa_to_sheet([[extraCol, ...schemaHeaders]]);
    }

    // Column widths: Staff Name wide, rest standard
    ws["!cols"] = [{ wch: 28 }, ...schemaHeaders.map(() => ({ wch: 18 }))];

    // Freeze top row
    ws["!freeze"] = { xSplit: 0, ySplit: 1 };

    XLSX.utils.book_append_sheet(wb, ws, schema.name.slice(0, 31));

    // Instructions sheet
    const instructions: (string | number)[][] = [
      ["IMPORT INSTRUCTIONS"],
      [""],
      [`Template generated: ${new Date().toLocaleDateString("en-GB")} — ${rows.length} rows pre-filled`],
      [""],
      ["1. The 'Staff Name' column is for your reference only — it is NOT imported."],
      ["2. Do not rename any other column headers."],
      ["3. You may delete rows you do not want to import."],
      ["4. Adjust the numbers in Days Used / Days Remaining as needed."],
      ["5. Save as .xlsx and use the 'Import Excel' button on this page."],
      [""],
      ["Column guide:"],
      ...fields.map((f) => {
        let hint = "";
        if (f.type === "number") hint = "Number";
        else if (f.type === "date") hint = "Format: YYYY-MM-DD";
        else if (f.type === "select" && f.options?.length) hint = `One of: ${f.options.join(", ")}`;
        else hint = "Text";
        return [`  ${f.label || f.name}`, f.required ? "Required" : "Optional", hint];
      }),
    ];
    const wsInstr = XLSX.utils.aoa_to_sheet(instructions);
    wsInstr["!cols"] = [{ wch: 38 }, { wch: 12 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, wsInstr, "Instructions");

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${schema.slug}_${currentYear}_template.xlsx"`,
      },
    });
  } catch (error) {
    logger.error("Failed to generate import template", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/** POST /api/admin/form-data/[id]/import
 *  Upload an .xlsx file and bulk-insert rows as FormDataEntry records.
 *  The "Staff Name" helper column is silently ignored.
 *  Returns { imported, skipped, errors }.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session.user.permissions as string[] | undefined))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const schema = await db.formDataSchema.findUnique({ where: { id } });
    if (!schema) return NextResponse.json({ error: "Schema not found" }, { status: 404 });

    const fields = (schema.fields as unknown as FieldDef[]) ?? [];

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });

    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: "array" });

    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

    if (rawRows.length === 0) {
      return NextResponse.json({ imported: 0, skipped: 0, errors: ["File has no data rows"] });
    }

    // Map column header → field (ignores "Staff Name" since it won't match any field)
    const fieldByLabel = new Map<string, FieldDef>();
    for (const f of fields) {
      fieldByLabel.set((f.label || f.name).toLowerCase().trim(), f);
      fieldByLabel.set(f.name.toLowerCase().trim(), f);
    }

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];
    const toCreate: { schemaId: string; data: object; createdById: string }[] = [];

    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      const data: Record<string, unknown> = {};
      let rowEmpty = true;

      for (const [colHeader, rawVal] of Object.entries(row)) {
        const field = fieldByLabel.get(colHeader.toLowerCase().trim());
        if (!field) continue; // silently skip "Staff Name" and unknown columns

        let val: unknown = rawVal;

        if (field.type === "number") {
          val = rawVal === "" || rawVal === null ? null : Number(rawVal);
          if (typeof val === "number" && isNaN(val)) val = null;
        } else if (field.type === "boolean") {
          const s = String(rawVal).toLowerCase().trim();
          val = s === "true" || s === "yes" || s === "1";
        } else if (field.type === "date" && rawVal !== "") {
          if (typeof rawVal === "number") {
            const d = XLSX.SSF.parse_date_code(rawVal);
            val = `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
          } else {
            val = String(rawVal).trim();
          }
        } else {
          val = rawVal === null ? "" : String(rawVal).trim();
        }

        if (val !== "" && val !== null && val !== undefined) rowEmpty = false;
        data[field.name] = val;
      }

      if (rowEmpty) { skipped++; continue; }

      const missing = fields.filter((f) => f.required && (data[f.name] === "" || data[f.name] == null));
      if (missing.length > 0) {
        errors.push(`Row ${i + 2}: missing ${missing.map((f) => f.label || f.name).join(", ")}`);
        skipped++;
        continue;
      }

      toCreate.push({ schemaId: id, data: data as object, createdById: session.user.id });
    }

    if (toCreate.length > 0) {
      for (let b = 0; b < toCreate.length; b += 100) {
        await db.formDataEntry.createMany({ data: toCreate.slice(b, b + 100) });
      }
      imported = toCreate.length;
    }

    return NextResponse.json({ imported, skipped, errors: errors.slice(0, 20) });
  } catch (error) {
    logger.error("Failed to import form data", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
