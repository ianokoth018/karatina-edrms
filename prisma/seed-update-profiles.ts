/**
 * seed-update-profiles.ts
 *
 * Fills in missing profile details for all existing users:
 *   - employeeId   (P/NO. NNNNN — the single staff identifier)
 *   - phone
 *   - department   (inferred from email pattern, else random)
 *   - jobTitle     (inferred from role, else random)
 *
 * Only overwrites fields that are currently NULL — existing values are kept.
 *
 * Run:
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/seed-update-profiles.ts
 */

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

const DEPARTMENTS = [
  "Human Resource Department",
  "Finance Department",
  "ICT Directorate",
  "Registry (Records)",
  "Procurement Department",
  "Internal Audit",
  "Library Services",
  "Health Services",
  "Estates Department",
  "Security Services",
  "Transport",
  "Admissions Office",
  "Department of Computer Science",
  "Department of Business Management",
  "Department of Education",
  "Department of Agricultural Sciences",
  "Department of Nursing",
  "Department of Environmental Studies",
  "Vice Chancellor's Office",
  "Deputy Vice Chancellor (Academics)",
  "Deputy Vice Chancellor (Finance & Administration)",
];

const JOB_TITLES_BY_DEPARTMENT: Record<string, string[]> = {
  "Human Resource Department": [
    "HR Manager", "HR Officer", "HR Assistant", "Recruitment Officer", "Staff Welfare Officer",
  ],
  "Finance Department": [
    "Chief Finance Officer", "Finance Officer", "Accountant", "Accounts Clerk", "Internal Auditor",
  ],
  "ICT Directorate": [
    "ICT Director", "Systems Administrator", "Network Engineer", "ICT Support Officer", "Software Developer",
  ],
  "Registry (Records)": [
    "Records Manager", "Registry Officer", "Records Assistant", "File Clerk", "Data Entry Clerk",
  ],
  "Procurement Department": [
    "Procurement Officer", "Procurement Assistant", "Stores Officer", "Supply Chain Officer",
  ],
  "Internal Audit": [
    "Internal Auditor", "Senior Auditor", "Audit Assistant",
  ],
  "Library Services": [
    "University Librarian", "Senior Librarian", "Library Assistant", "Cataloguing Officer",
  ],
  "Health Services": [
    "Medical Officer", "Clinical Officer", "Nurse", "Health Records Officer",
  ],
  "Estates Department": [
    "Estates Manager", "Maintenance Officer", "Facilities Officer", "Groundsman Supervisor",
  ],
  "Security Services": [
    "Security Manager", "Security Officer", "Security Supervisor",
  ],
  "Transport": [
    "Transport Officer", "Fleet Manager", "Driver",
  ],
  "Admissions Office": [
    "Admissions Officer", "Student Records Officer", "Registrar",
  ],
};

const GENERIC_JOB_TITLES = [
  "Lecturer", "Senior Lecturer", "Assistant Lecturer", "Tutorial Fellow",
  "Associate Professor", "Professor", "Department Head",
  "Administrative Officer", "Senior Administrative Officer", "Personal Secretary",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomPhone(): string {
  const prefixes = ["700", "701", "710", "711", "712", "720", "721", "722",
                    "723", "724", "725", "726", "727", "728", "729", "740",
                    "741", "742", "743", "745", "746", "748", "757", "758",
                    "759", "768", "769", "770", "771", "772", "790", "791",
                    "792", "793", "794", "795", "796", "797", "798", "799"];
  const prefix = pick(prefixes);
  const suffix = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
  return `+254 ${prefix} ${suffix.slice(0, 3)} ${suffix.slice(3)}`;
}

function randomEmployeeId(seq: number): string {
  return `P/NO. ${String(10000 + seq).padStart(5, "0")}`;
}

function departmentFromEmail(email: string): string | null {
  const local = email.split("@")[0].toLowerCase();
  if (local.includes("hr") || local.includes("human")) return "Human Resource Department";
  if (local.includes("finance") || local.includes("cfo") || local.includes("accounts")) return "Finance Department";
  if (local.includes("ict") || local.includes("it") || local.includes("tech")) return "ICT Directorate";
  if (local.includes("record") || local.includes("registry")) return "Registry (Records)";
  if (local.includes("procure") || local.includes("supply") || local.includes("store")) return "Procurement Department";
  if (local.includes("audit")) return "Internal Audit";
  if (local.includes("librar")) return "Library Services";
  if (local.includes("health") || local.includes("nurse") || local.includes("medical") || local.includes("clinic")) return "Health Services";
  if (local.includes("estate") || local.includes("facilit")) return "Estates Department";
  if (local.includes("security") || local.includes("guard")) return "Security Services";
  if (local.includes("transport") || local.includes("driver") || local.includes("fleet")) return "Transport";
  if (local.includes("admiss")) return "Admissions Office";
  if (local.includes("cs") || local.includes("comput")) return "Department of Computer Science";
  if (local.includes("business") || local.includes("biz")) return "Department of Business Management";
  if (local.includes("educat")) return "Department of Education";
  if (local.includes("agri")) return "Department of Agricultural Sciences";
  if (local.includes("nurs")) return "Department of Nursing";
  if (local.includes("environ")) return "Department of Environmental Studies";
  if (local.includes("vc") || local.includes("chancellor")) return "Vice Chancellor's Office";
  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("\n=== Profile update seed — filling NULL fields for all users ===\n");

  const users = await db.user.findMany({
    select: {
      id: true,
      email: true,
      employeeId: true,
      phone: true,
      department: true,
      jobTitle: true,
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Found ${users.length} users.\n`);

  let updated = 0;

  for (let i = 0; i < users.length; i++) {
    const u = users[i];
    const seq = i + 1;

    const patch: Record<string, string> = {};

    if (!u.employeeId) {
      patch.employeeId = randomEmployeeId(seq);
    }
    if (!u.phone) {
      patch.phone = randomPhone();
    }
    if (!u.department) {
      patch.department = departmentFromEmail(u.email) ?? pick(DEPARTMENTS);
    }
    if (!u.jobTitle) {
      const dept = u.department ?? patch.department ?? "";
      const titles = JOB_TITLES_BY_DEPARTMENT[dept] ?? GENERIC_JOB_TITLES;
      patch.jobTitle = pick(titles);
    }

    if (Object.keys(patch).length > 0) {
      await db.user.update({ where: { id: u.id }, data: patch });
      console.log(`  ✓ ${u.email.padEnd(40)} → ${JSON.stringify(patch)}`);
      updated++;
    } else {
      console.log(`  · ${u.email.padEnd(40)} (all fields already set — skipped)`);
    }
  }

  console.log(`\nDone. Updated ${updated} / ${users.length} users.\n`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
