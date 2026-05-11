/**
 * seed-leave-balances.ts
 *
 * Generates prisma/leave_balances_seed_YYYY.xlsx — a pre-filled Excel that
 * can be imported via Admin > Form Data > leave_balances > Import Excel.
 *
 * Run:
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/seed-leave-balances.ts
 *
 * One row per active user × gender-neutral leave type.
 * Gender-specific types (Maternity, Paternity) must be assigned manually.
 */

import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import * as path from "path";

const db = new PrismaClient();

// Gender-neutral leave types assigned to all staff in bulk.
// Adjust days_allocated to match your HR policy before running.
const LEAVE_TYPES = [
  { leave_type: "Annual Leave",        days_allocated: 21 },
  { leave_type: "Sick Leave",          days_allocated: 14 },
  { leave_type: "Compassionate Leave", days_allocated: 3  },
  { leave_type: "Study Leave",         days_allocated: 10 },
  { leave_type: "Emergency Leave",     days_allocated: 5  },
];

const YEAR = new Date().getFullYear();

type Row = Record<string, string | number>;

async function main() {
  const users = await db.user.findMany({
    where: { isActive: true },
    select: {
      employeeId: true,
      displayName: true,
      name: true,
      department: true,
    },
    orderBy: { displayName: "asc" },
  });

  console.log(`\nFound ${users.length} active users — generating ${users.length * LEAVE_TYPES.length} rows\n`);

  const HEADERS = [
    "Staff Name",
    "employee_id",
    "staff_number",
    "leave_type",
    "days_allocated",
    "days_used",
    "days_remaining",
    "year",
    "carried_forward",
  ];

  const rows: Row[] = [];

  for (const user of users) {
    const staffNumber = user.employeeId ?? "";
    const displayName = user.displayName || user.name;

    for (const lt of LEAVE_TYPES) {
      rows.push({
        "Staff Name":      displayName,
        "employee_id":     staffNumber,
        "staff_number":    staffNumber,
        "leave_type":      lt.leave_type,
        "days_allocated":  lt.days_allocated,
        "days_used":       0,
        "days_remaining":  lt.days_allocated,
        "year":            YEAR,
        "carried_forward": 0,
      });
    }
  }

  // ── Build workbook ──────────────────────────────────────────────────────────

  const wb = XLSX.utils.book_new();

  const ws = XLSX.utils.json_to_sheet(rows, { header: HEADERS });

  ws["!cols"] = [
    { wch: 30 }, // Staff Name
    { wch: 14 }, // employee_id
    { wch: 14 }, // staff_number
    { wch: 24 }, // leave_type
    { wch: 16 }, // days_allocated
    { wch: 12 }, // days_used
    { wch: 16 }, // days_remaining
    { wch: 8  }, // year
    { wch: 16 }, // carried_forward
  ];

  (ws as Record<string, unknown>)["!freeze"] = { xSplit: 0, ySplit: 1 };

  XLSX.utils.book_append_sheet(wb, ws, `Leave Balances ${YEAR}`);

  // ── Instructions sheet ──────────────────────────────────────────────────────

  const instructions: (string | number)[][] = [
    ["LEAVE BALANCES SEED — IMPORT INSTRUCTIONS"],
    [""],
    [
      `Generated: ${new Date().toLocaleDateString("en-GB")}`,
      `${rows.length} rows`,
      `${users.length} users × ${LEAVE_TYPES.length} leave types`,
    ],
    [""],
    ["Step 1", "Go to: Admin → Form Data → leave_balances"],
    ["Step 2", "Click 'Import Excel' and upload this file."],
    ["Step 3", "Verify the counts (imported / skipped / errors)."],
    ["Step 4", "Assign Maternity / Paternity leave manually per eligible staff."],
    [""],
    ["NOTES"],
    ["• 'Staff Name' column is for reference only — it is NOT imported."],
    ["• Do not rename any other column headers."],
    ["• Adjust days before import if HR policy differs."],
    ["• The import is idempotent only if leave_balances schema enforces uniqueness."],
    ["  Otherwise, running import twice will create duplicates — use Initialize instead."],
    [""],
    ["Leave types included (gender-neutral, assigned to all staff):"],
    ...LEAVE_TYPES.map((lt) => [`  ${lt.leave_type}`, `${lt.days_allocated} days`]),
    [""],
    ["Gender-specific types (NOT in this file — assign manually):"],
    ["  Maternity Leave", "90 days", "Female staff only"],
    ["  Paternity Leave", "14 days", "Male staff only"],
  ];

  const wsInstr = XLSX.utils.aoa_to_sheet(instructions);
  wsInstr["!cols"] = [{ wch: 52 }, { wch: 14 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, wsInstr, "Instructions");

  // ── Write file ──────────────────────────────────────────────────────────────

  const outPath = path.join(__dirname, `leave_balances_seed_${YEAR}.xlsx`);
  XLSX.writeFile(wb, outPath);

  console.log(`✓ Written: ${outPath}`);
  console.log(`  ${rows.length} rows (${users.length} users × ${LEAVE_TYPES.length} leave types)`);
  console.log(`  Year: ${YEAR}`);
  console.log("\nImport via: Admin → Form Data → leave_balances → Import Excel\n");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
