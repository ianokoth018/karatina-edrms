/**
 * seed-users.ts
 *
 * Karatina University — departmental staff population seed.
 * Adds HODs (where missing) and 4 regular staff per department
 * to give a realistic picture for workflow testing (leave requests, etc.)
 *
 * Run: npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/seed-users.ts
 * Or:  npx prisma db seed   (if package.json prisma.seed points here)
 *
 * Safe to run multiple times — all upserts on email.
 * Password for all new users: KarU@2026
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function email(first: string, last: string): string {
  return `${first.toLowerCase()}.${last.toLowerCase().replace(/[^a-z]/g, "")}@karu.ac.ke`;
}

function phone(n: number): string {
  return `+254 7${String(n).padStart(8, "0")}`;
}

// ---------------------------------------------------------------------------
// Department definitions
// Each department lists: one HOD + four staff members.
// HODs already in the main seed (hod.cs, hod.business, hod.education,
// director.ict, hr@karu.ac.ke, librarian@, health@, estates@) are noted
// as `existingHodEmail` — we just add their staff without recreating the HOD.
// ---------------------------------------------------------------------------

interface StaffEntry {
  email: string;
  employeeId: string;
  name: string;
  displayName: string;
  department: string;
  jobTitle: string;
  phone: string;
  role: string; // must match a role name already seeded by seed.ts
}

async function main() {
  console.log("\n=== Karatina University — Departmental Staff Seed ===\n");

  const password = await bcrypt.hash("KarU@2026", 12);

  // Look up roles seeded by the main seed.ts
  const roleNames = [
    "HOD", "STAFF", "HR_OFFICER", "FINANCE_OFFICER",
    "PROCUREMENT_OFFICER", "ICT_OFFICER", "RECORDS_OFFICER",
    "RECORDS_MANAGER", "LIBRARIAN", "MEDICAL_OFFICER", "ESTATES_OFFICER",
    "ADMIN_ASSISTANT", "CLERK",
  ];

  const roles: Record<string, string> = {};
  for (const name of roleNames) {
    const r = await db.role.findUnique({ where: { name } });
    if (!r) throw new Error(`Role "${name}" not found — run seed.ts first`);
    roles[name] = r.id;
  }

  // ---------------------------------------------------------------------------
  // Build the full user list
  // Employee IDs run from KU/100 upward (main seed tops out at KU/060).
  // ---------------------------------------------------------------------------

  let idCounter = 100;
  const nextId = () => `KU/${String(idCounter++).padStart(3, "0")}`;
  let phoneCounter = 10000100;
  const nextPhone = () => phone(phoneCounter++);

  const users: StaffEntry[] = [

    // =========================================================================
    // 1. HUMAN RESOURCE DEPARTMENT
    //    Existing: hr@karu.ac.ke (HR_OFFICER) — promote to HOD + add 4 staff
    // =========================================================================

    // HOD — HR Manager (new, distinct from the existing HR Officer)
    {
      email: "hr.manager@karu.ac.ke",
      employeeId: nextId(),
      name: "Mrs. Joyce Wambua",
      displayName: "Mrs. Joyce Wambua",
      department: "Human Resource Department",
      jobTitle: "HR Manager (HOD)",
      phone: nextPhone(),
      role: "HOD",
    },

    // 4 staff under HR — also HR_OFFICER so they can join HR Leave Pool
    {
      email: email("alice", "kamau"),
      employeeId: nextId(),
      name: "Ms. Alice Kamau",
      displayName: "Ms. Alice Kamau",
      department: "Human Resource Department",
      jobTitle: "HR Officer — Recruitment",
      phone: nextPhone(),
      role: "HR_OFFICER",
    },
    {
      email: email("brian", "odhiambo"),
      employeeId: nextId(),
      name: "Mr. Brian Odhiambo",
      displayName: "Mr. Brian Odhiambo",
      department: "Human Resource Department",
      jobTitle: "HR Officer — Staff Welfare",
      phone: nextPhone(),
      role: "HR_OFFICER",
    },
    {
      email: email("carol", "mutua"),
      employeeId: nextId(),
      name: "Ms. Carol Mutua",
      displayName: "Ms. Carol Mutua",
      department: "Human Resource Department",
      jobTitle: "HR Officer — Leave & Benefits",
      phone: nextPhone(),
      role: "HR_OFFICER",
    },
    {
      email: email("dennis", "wafula"),
      employeeId: nextId(),
      name: "Mr. Dennis Wafula",
      displayName: "Mr. Dennis Wafula",
      department: "Human Resource Department",
      jobTitle: "HR Assistant",
      phone: nextPhone(),
      role: "STAFF",
    },

    // =========================================================================
    // 2. FINANCE DEPARTMENT
    //    Existing: finance@karu.ac.ke (FINANCE_OFFICER) — add HOD + 4 staff
    // =========================================================================

    {
      email: "finance.manager@karu.ac.ke",
      employeeId: nextId(),
      name: "Mr. Charles Njoroge",
      displayName: "Mr. Charles Njoroge",
      department: "Finance Department",
      jobTitle: "Chief Finance Officer (HOD)",
      phone: nextPhone(),
      role: "HOD",
    },
    {
      email: email("esther", "mugo"),
      employeeId: nextId(),
      name: "Ms. Esther Mugo",
      displayName: "Ms. Esther Mugo",
      department: "Finance Department",
      jobTitle: "Senior Accountant",
      phone: nextPhone(),
      role: "FINANCE_OFFICER",
    },
    {
      email: email("felix", "ouma"),
      employeeId: nextId(),
      name: "Mr. Felix Ouma",
      displayName: "Mr. Felix Ouma",
      department: "Finance Department",
      jobTitle: "Accounts Officer",
      phone: nextPhone(),
      role: "FINANCE_OFFICER",
    },
    {
      email: email("grace", "simiyu"),
      employeeId: nextId(),
      name: "Ms. Grace Simiyu",
      displayName: "Ms. Grace Simiyu",
      department: "Finance Department",
      jobTitle: "Payments Clerk",
      phone: nextPhone(),
      role: "STAFF",
    },
    {
      email: email("henry", "karanja"),
      employeeId: nextId(),
      name: "Mr. Henry Karanja",
      displayName: "Mr. Henry Karanja",
      department: "Finance Department",
      jobTitle: "Budget Analyst",
      phone: nextPhone(),
      role: "FINANCE_OFFICER",
    },

    // =========================================================================
    // 3. ICT DIRECTORATE
    //    Existing: director.ict@karu.ac.ke (DIRECTOR) + ict.officer@karu.ac.ke
    //    Add 4 staff — no new HOD needed (Director is the HOD)
    // =========================================================================

    {
      email: email("irene", "wanjiku"),
      employeeId: nextId(),
      name: "Ms. Irene Wanjiku",
      displayName: "Ms. Irene Wanjiku",
      department: "ICT Directorate",
      jobTitle: "Network Engineer",
      phone: nextPhone(),
      role: "ICT_OFFICER",
    },
    {
      email: email("james", "kioko"),
      employeeId: nextId(),
      name: "Mr. James Kioko",
      displayName: "Mr. James Kioko",
      department: "ICT Directorate",
      jobTitle: "Systems Administrator",
      phone: nextPhone(),
      role: "ICT_OFFICER",
    },
    {
      email: email("kevin", "murithi"),
      employeeId: nextId(),
      name: "Mr. Kevin Murithi",
      displayName: "Mr. Kevin Murithi",
      department: "ICT Directorate",
      jobTitle: "Web Developer",
      phone: nextPhone(),
      role: "ICT_OFFICER",
    },
    {
      email: email("linda", "achieng"),
      employeeId: nextId(),
      name: "Ms. Linda Achieng",
      displayName: "Ms. Linda Achieng",
      department: "ICT Directorate",
      jobTitle: "ICT Support Officer",
      phone: nextPhone(),
      role: "ICT_OFFICER",
    },

    // =========================================================================
    // 4. DEPARTMENT OF COMPUTER SCIENCE (School of Pure & Applied Sciences)
    //    Existing HOD: hod.cs@karu.ac.ke — add 4 lecturers
    // =========================================================================

    {
      email: email("martin", "ndung'u"),
      employeeId: nextId(),
      name: "Dr. Martin Ndung'u",
      displayName: "Dr. Martin Ndung'u",
      department: "Department of Computer Science",
      jobTitle: "Lecturer — Software Engineering",
      phone: nextPhone(),
      role: "STAFF",
    },
    {
      email: email("nancy", "gitonga"),
      employeeId: nextId(),
      name: "Ms. Nancy Gitonga",
      displayName: "Ms. Nancy Gitonga",
      department: "Department of Computer Science",
      jobTitle: "Lecturer — Data Science",
      phone: nextPhone(),
      role: "STAFF",
    },
    {
      email: email("oliver", "barasa"),
      employeeId: nextId(),
      name: "Mr. Oliver Barasa",
      displayName: "Mr. Oliver Barasa",
      department: "Department of Computer Science",
      jobTitle: "Lecturer — Networking",
      phone: nextPhone(),
      role: "STAFF",
    },
    {
      email: email("pauline", "mwende"),
      employeeId: nextId(),
      name: "Ms. Pauline Mwende",
      displayName: "Ms. Pauline Mwende",
      department: "Department of Computer Science",
      jobTitle: "Tutorial Fellow",
      phone: nextPhone(),
      role: "STAFF",
    },

    // =========================================================================
    // 5. DEPARTMENT OF BUSINESS MANAGEMENT (School of Business)
    //    Existing HOD: hod.business@karu.ac.ke — add 4 lecturers
    // =========================================================================

    {
      email: email("queen", "njeru"),
      employeeId: nextId(),
      name: "Dr. Queen Njeru",
      displayName: "Dr. Queen Njeru",
      department: "Department of Business Management",
      jobTitle: "Lecturer — Strategic Management",
      phone: nextPhone(),
      role: "STAFF",
    },
    {
      email: email("raymond", "musyoka"),
      employeeId: nextId(),
      name: "Mr. Raymond Musyoka",
      displayName: "Mr. Raymond Musyoka",
      department: "Department of Business Management",
      jobTitle: "Lecturer — Entrepreneurship",
      phone: nextPhone(),
      role: "STAFF",
    },
    {
      email: email("sarah", "wekesa"),
      employeeId: nextId(),
      name: "Ms. Sarah Wekesa",
      displayName: "Ms. Sarah Wekesa",
      department: "Department of Business Management",
      jobTitle: "Lecturer — Finance & Accounting",
      phone: nextPhone(),
      role: "STAFF",
    },
    {
      email: email("thomas", "kinyua"),
      employeeId: nextId(),
      name: "Mr. Thomas Kinyua",
      displayName: "Mr. Thomas Kinyua",
      department: "Department of Business Management",
      jobTitle: "Tutorial Fellow",
      phone: nextPhone(),
      role: "STAFF",
    },

    // =========================================================================
    // 6. DEPARTMENT OF EDUCATION (School of Education & Social Sciences)
    //    Existing HOD: hod.education@karu.ac.ke — add 4 lecturers
    // =========================================================================

    {
      email: email("ursula", "karimi"),
      employeeId: nextId(),
      name: "Dr. Ursula Karimi",
      displayName: "Dr. Ursula Karimi",
      department: "Department of Education",
      jobTitle: "Lecturer — Curriculum Studies",
      phone: nextPhone(),
      role: "STAFF",
    },
    {
      email: email("victor", "nyakundi"),
      employeeId: nextId(),
      name: "Mr. Victor Nyakundi",
      displayName: "Mr. Victor Nyakundi",
      department: "Department of Education",
      jobTitle: "Lecturer — Educational Psychology",
      phone: nextPhone(),
      role: "STAFF",
    },
    {
      email: email("winnie", "muchai"),
      employeeId: nextId(),
      name: "Ms. Winnie Muchai",
      displayName: "Ms. Winnie Muchai",
      department: "Department of Education",
      jobTitle: "Lecturer — Special Needs Education",
      phone: nextPhone(),
      role: "STAFF",
    },
    {
      email: email("xavier", "adhiambo"),
      employeeId: nextId(),
      name: "Ms. Xavier Adhiambo",
      displayName: "Ms. Xavier Adhiambo",
      department: "Department of Education",
      jobTitle: "Tutorial Fellow",
      phone: nextPhone(),
      role: "STAFF",
    },

    // =========================================================================
    // 7. DEPARTMENT OF AGRICULTURAL SCIENCES (School of Agriculture & Biotech)
    //    New HOD + 4 lecturers
    // =========================================================================

    {
      email: "hod.agri@karu.ac.ke",
      employeeId: nextId(),
      name: "Dr. Yvonne Mwiti",
      displayName: "Dr. Yvonne Mwiti",
      department: "Department of Agricultural Sciences",
      jobTitle: "HOD, Agricultural Sciences",
      phone: nextPhone(),
      role: "HOD",
    },
    {
      email: email("zachary", "gichuki"),
      employeeId: nextId(),
      name: "Mr. Zachary Gichuki",
      displayName: "Mr. Zachary Gichuki",
      department: "Department of Agricultural Sciences",
      jobTitle: "Lecturer — Crop Science",
      phone: nextPhone(),
      role: "STAFF",
    },
    {
      email: email("amina", "hassan"),
      employeeId: nextId(),
      name: "Ms. Amina Hassan",
      displayName: "Ms. Amina Hassan",
      department: "Department of Agricultural Sciences",
      jobTitle: "Lecturer — Animal Science",
      phone: nextPhone(),
      role: "STAFF",
    },
    {
      email: email("bonface", "ngunyi"),
      employeeId: nextId(),
      name: "Mr. Bonface Ngunyi",
      displayName: "Mr. Bonface Ngunyi",
      department: "Department of Agricultural Sciences",
      jobTitle: "Lecturer — Agribusiness",
      phone: nextPhone(),
      role: "STAFF",
    },
    {
      email: email("cynthia", "nasimiyu"),
      employeeId: nextId(),
      name: "Ms. Cynthia Nasimiyu",
      displayName: "Ms. Cynthia Nasimiyu",
      department: "Department of Agricultural Sciences",
      jobTitle: "Tutorial Fellow — Soil Science",
      phone: nextPhone(),
      role: "STAFF",
    },

    // =========================================================================
    // 8. DEPARTMENT OF ENVIRONMENTAL STUDIES (School of Natural Resources)
    //    New HOD + 4 lecturers
    // =========================================================================

    {
      email: "hod.environmental@karu.ac.ke",
      employeeId: nextId(),
      name: "Dr. David Njeri",
      displayName: "Dr. David Njeri",
      department: "Department of Environmental Studies",
      jobTitle: "HOD, Environmental Studies",
      phone: nextPhone(),
      role: "HOD",
    },
    {
      email: email("elijah", "nderitu"),
      employeeId: nextId(),
      name: "Mr. Elijah Nderitu",
      displayName: "Mr. Elijah Nderitu",
      department: "Department of Environmental Studies",
      jobTitle: "Lecturer — Climate Science",
      phone: nextPhone(),
      role: "STAFF",
    },
    {
      email: email("faith", "auma"),
      employeeId: nextId(),
      name: "Ms. Faith Auma",
      displayName: "Ms. Faith Auma",
      department: "Department of Environmental Studies",
      jobTitle: "Lecturer — Water Resources",
      phone: nextPhone(),
      role: "STAFF",
    },
    {
      email: email("george", "ndii"),
      employeeId: nextId(),
      name: "Mr. George Ndii",
      displayName: "Mr. George Ndii",
      department: "Department of Environmental Studies",
      jobTitle: "Lecturer — Forestry",
      phone: nextPhone(),
      role: "STAFF",
    },
    {
      email: email("hannah", "khisa"),
      employeeId: nextId(),
      name: "Ms. Hannah Khisa",
      displayName: "Ms. Hannah Khisa",
      department: "Department of Environmental Studies",
      jobTitle: "Tutorial Fellow — Wildlife Management",
      phone: nextPhone(),
      role: "STAFF",
    },

    // =========================================================================
    // 9. DEPARTMENT OF NURSING (School of Nursing & Public Health)
    //    New HOD + 4 lecturers
    // =========================================================================

    {
      email: "hod.nursing@karu.ac.ke",
      employeeId: nextId(),
      name: "Mrs. Irene Gitonga",
      displayName: "Mrs. Irene Gitonga",
      department: "Department of Nursing",
      jobTitle: "HOD, Nursing",
      phone: nextPhone(),
      role: "HOD",
    },
    {
      email: email("julius", "maina"),
      employeeId: nextId(),
      name: "Mr. Julius Maina",
      displayName: "Mr. Julius Maina",
      department: "Department of Nursing",
      jobTitle: "Lecturer — Community Health",
      phone: nextPhone(),
      role: "STAFF",
    },
    {
      email: email("kate", "otieno"),
      employeeId: nextId(),
      name: "Ms. Kate Otieno",
      displayName: "Ms. Kate Otieno",
      department: "Department of Nursing",
      jobTitle: "Lecturer — Midwifery",
      phone: nextPhone(),
      role: "STAFF",
    },
    {
      email: email("lilian", "mwangi"),
      employeeId: nextId(),
      name: "Ms. Lilian Mwangi",
      displayName: "Ms. Lilian Mwangi",
      department: "Department of Nursing",
      jobTitle: "Lecturer — Clinical Nursing",
      phone: nextPhone(),
      role: "STAFF",
    },
    {
      email: email("michael", "kibet"),
      employeeId: nextId(),
      name: "Mr. Michael Kibet",
      displayName: "Mr. Michael Kibet",
      department: "Department of Nursing",
      jobTitle: "Tutorial Fellow",
      phone: nextPhone(),
      role: "STAFF",
    },

    // =========================================================================
    // 10. PROCUREMENT DEPARTMENT
    //     Existing: procurement@karu.ac.ke — add HOD + 4 staff
    // =========================================================================

    {
      email: "head.procurement@karu.ac.ke",
      employeeId: nextId(),
      name: "Mr. Newton Kamau",
      displayName: "Mr. Newton Kamau",
      department: "Procurement Department",
      jobTitle: "Head of Procurement (HOD)",
      phone: nextPhone(),
      role: "HOD",
    },
    {
      email: email("olivia", "muthoni"),
      employeeId: nextId(),
      name: "Ms. Olivia Muthoni",
      displayName: "Ms. Olivia Muthoni",
      department: "Procurement Department",
      jobTitle: "Procurement Officer — Goods",
      phone: nextPhone(),
      role: "PROCUREMENT_OFFICER",
    },
    {
      email: email("peter", "wafula"),
      employeeId: nextId(),
      name: "Mr. Peter Wafula",
      displayName: "Mr. Peter Wafula",
      department: "Procurement Department",
      jobTitle: "Procurement Officer — Services",
      phone: nextPhone(),
      role: "PROCUREMENT_OFFICER",
    },
    {
      email: email("rachel", "njoki"),
      employeeId: nextId(),
      name: "Ms. Rachel Njoki",
      displayName: "Ms. Rachel Njoki",
      department: "Procurement Department",
      jobTitle: "Stores Officer",
      phone: nextPhone(),
      role: "PROCUREMENT_OFFICER",
    },
    {
      email: email("stephen", "ochieng"),
      employeeId: nextId(),
      name: "Mr. Stephen Ochieng",
      displayName: "Mr. Stephen Ochieng",
      department: "Procurement Department",
      jobTitle: "Procurement Clerk",
      phone: nextPhone(),
      role: "STAFF",
    },

    // =========================================================================
    // 11. REGISTRY (RECORDS)
    //     Existing: registry@karu.ac.ke (RECORDS_OFFICER) + clerk.registry@
    //     Add Records Manager as HOD + 4 staff
    // =========================================================================

    {
      email: "records.manager@karu.ac.ke",
      employeeId: nextId(),
      name: "Mr. Tom Ndung'u",
      displayName: "Mr. Tom Ndung'u",
      department: "Registry (Records)",
      jobTitle: "Records Manager (HOD)",
      phone: nextPhone(),
      role: "HOD",
    },
    {
      email: email("una", "omondi"),
      employeeId: nextId(),
      name: "Ms. Una Omondi",
      displayName: "Ms. Una Omondi",
      department: "Registry (Records)",
      jobTitle: "Records Officer — Classification",
      phone: nextPhone(),
      role: "RECORDS_OFFICER",
    },
    {
      email: email("vincent", "mugambi"),
      employeeId: nextId(),
      name: "Mr. Vincent Mugambi",
      displayName: "Mr. Vincent Mugambi",
      department: "Registry (Records)",
      jobTitle: "Records Officer — Custody",
      phone: nextPhone(),
      role: "RECORDS_OFFICER",
    },
    {
      email: email("wanjiru", "gachau"),
      employeeId: nextId(),
      name: "Ms. Wanjiru Gachau",
      displayName: "Ms. Wanjiru Gachau",
      department: "Registry (Records)",
      jobTitle: "Registry Clerk",
      phone: nextPhone(),
      role: "CLERK",
    },
    {
      email: email("xavier", "njiru"),
      employeeId: nextId(),
      name: "Mr. Xavier Njiru",
      displayName: "Mr. Xavier Njiru",
      department: "Registry (Records)",
      jobTitle: "Registry Clerk",
      phone: nextPhone(),
      role: "CLERK",
    },

    // =========================================================================
    // 12. LIBRARY SERVICES
    //     Existing HOD: librarian@karu.ac.ke — add 4 staff
    // =========================================================================

    {
      email: email("yolanda", "kariuki"),
      employeeId: nextId(),
      name: "Ms. Yolanda Kariuki",
      displayName: "Ms. Yolanda Kariuki",
      department: "Library Services",
      jobTitle: "Library Assistant — Circulation",
      phone: nextPhone(),
      role: "STAFF",
    },
    {
      email: email("zack", "mutuku"),
      employeeId: nextId(),
      name: "Mr. Zack Mutuku",
      displayName: "Mr. Zack Mutuku",
      department: "Library Services",
      jobTitle: "Library Assistant — Cataloguing",
      phone: nextPhone(),
      role: "STAFF",
    },
    {
      email: email("abigail", "chebet"),
      employeeId: nextId(),
      name: "Ms. Abigail Chebet",
      displayName: "Ms. Abigail Chebet",
      department: "Library Services",
      jobTitle: "Library Assistant — e-Resources",
      phone: nextPhone(),
      role: "STAFF",
    },
    {
      email: email("benedict", "musau"),
      employeeId: nextId(),
      name: "Mr. Benedict Musau",
      displayName: "Mr. Benedict Musau",
      department: "Library Services",
      jobTitle: "Library Clerk",
      phone: nextPhone(),
      role: "CLERK",
    },

    // =========================================================================
    // 13. HEALTH SERVICES (University Clinic)
    //     Existing: health@karu.ac.ke (MEDICAL_OFFICER) — add 4 staff
    // =========================================================================

    {
      email: email("clara", "rotich"),
      employeeId: nextId(),
      name: "Ms. Clara Rotich",
      displayName: "Ms. Clara Rotich",
      department: "Health Services",
      jobTitle: "Registered Nurse",
      phone: nextPhone(),
      role: "MEDICAL_OFFICER",
    },
    {
      email: email("daniel", "arap"),
      employeeId: nextId(),
      name: "Mr. Daniel Arap",
      displayName: "Mr. Daniel Arap",
      department: "Health Services",
      jobTitle: "Clinical Officer",
      phone: nextPhone(),
      role: "MEDICAL_OFFICER",
    },
    {
      email: email("edna", "njoroge"),
      employeeId: nextId(),
      name: "Ms. Edna Njoroge",
      displayName: "Ms. Edna Njoroge",
      department: "Health Services",
      jobTitle: "Pharmacy Technician",
      phone: nextPhone(),
      role: "MEDICAL_OFFICER",
    },
    {
      email: email("fredrick", "odhiambo"),
      employeeId: nextId(),
      name: "Mr. Fredrick Odhiambo",
      displayName: "Mr. Fredrick Odhiambo",
      department: "Health Services",
      jobTitle: "Health Records Officer",
      phone: nextPhone(),
      role: "STAFF",
    },

    // =========================================================================
    // 14. ESTATES DEPARTMENT
    //     Existing: estates@karu.ac.ke (ESTATES_OFFICER) — add 4 staff
    // =========================================================================

    {
      email: email("gerald", "kimani"),
      employeeId: nextId(),
      name: "Mr. Gerald Kimani",
      displayName: "Mr. Gerald Kimani",
      department: "Estates Department",
      jobTitle: "Maintenance Officer",
      phone: nextPhone(),
      role: "ESTATES_OFFICER",
    },
    {
      email: email("helen", "waweru"),
      employeeId: nextId(),
      name: "Ms. Helen Waweru",
      displayName: "Ms. Helen Waweru",
      department: "Estates Department",
      jobTitle: "Buildings Inspector",
      phone: nextPhone(),
      role: "ESTATES_OFFICER",
    },
    {
      email: email("ibrahim", "njoroge"),
      employeeId: nextId(),
      name: "Mr. Ibrahim Njoroge",
      displayName: "Mr. Ibrahim Njoroge",
      department: "Estates Department",
      jobTitle: "Electrician",
      phone: nextPhone(),
      role: "STAFF",
    },
    {
      email: email("jane", "wambua"),
      employeeId: nextId(),
      name: "Ms. Jane Wambua",
      displayName: "Ms. Jane Wambua",
      department: "Estates Department",
      jobTitle: "Assets Officer",
      phone: nextPhone(),
      role: "ESTATES_OFFICER",
    },

    // =========================================================================
    // 15. INTERNAL AUDIT
    //     Existing: audit@karu.ac.ke — add 4 staff
    // =========================================================================

    {
      email: email("ken", "mwirigi"),
      employeeId: nextId(),
      name: "Mr. Ken Mwirigi",
      displayName: "Mr. Ken Mwirigi",
      department: "Internal Audit",
      jobTitle: "Senior Internal Auditor",
      phone: nextPhone(),
      role: "ADMIN_ASSISTANT",
    },
    {
      email: email("leah", "nyambura"),
      employeeId: nextId(),
      name: "Ms. Leah Nyambura",
      displayName: "Ms. Leah Nyambura",
      department: "Internal Audit",
      jobTitle: "Internal Auditor",
      phone: nextPhone(),
      role: "ADMIN_ASSISTANT",
    },
    {
      email: email("moses", "ndegwa"),
      employeeId: nextId(),
      name: "Mr. Moses Ndegwa",
      displayName: "Mr. Moses Ndegwa",
      department: "Internal Audit",
      jobTitle: "Internal Auditor",
      phone: nextPhone(),
      role: "ADMIN_ASSISTANT",
    },
    {
      email: email("nora", "gitau"),
      employeeId: nextId(),
      name: "Ms. Nora Gitau",
      displayName: "Ms. Nora Gitau",
      department: "Internal Audit",
      jobTitle: "Audit Assistant",
      phone: nextPhone(),
      role: "STAFF",
    },

    // =========================================================================
    // 16. SECURITY SERVICES
    //     Existing: security@karu.ac.ke — add 4 staff
    // =========================================================================

    {
      email: email("oscar", "kirui"),
      employeeId: nextId(),
      name: "Mr. Oscar Kirui",
      displayName: "Mr. Oscar Kirui",
      department: "Security Services",
      jobTitle: "Security Supervisor",
      phone: nextPhone(),
      role: "STAFF",
    },
    {
      email: email("phyllis", "awuor"),
      employeeId: nextId(),
      name: "Ms. Phyllis Awuor",
      displayName: "Ms. Phyllis Awuor",
      department: "Security Services",
      jobTitle: "Security Guard",
      phone: nextPhone(),
      role: "STAFF",
    },
    {
      email: email("quentin", "koech"),
      employeeId: nextId(),
      name: "Mr. Quentin Koech",
      displayName: "Mr. Quentin Koech",
      department: "Security Services",
      jobTitle: "Security Guard",
      phone: nextPhone(),
      role: "STAFF",
    },
    {
      email: email("rose", "cherop"),
      employeeId: nextId(),
      name: "Ms. Rose Cherop",
      displayName: "Ms. Rose Cherop",
      department: "Security Services",
      jobTitle: "Access Control Officer",
      phone: nextPhone(),
      role: "STAFF",
    },

    // =========================================================================
    // 17. ADMISSIONS OFFICE
    //     Existing: admissions@karu.ac.ke — add 4 staff
    // =========================================================================

    {
      email: email("simon", "githae"),
      employeeId: nextId(),
      name: "Mr. Simon Githae",
      displayName: "Mr. Simon Githae",
      department: "Admissions Office",
      jobTitle: "Admissions Clerk",
      phone: nextPhone(),
      role: "CLERK",
    },
    {
      email: email("tabitha", "wanjiku"),
      employeeId: nextId(),
      name: "Ms. Tabitha Wanjiku",
      displayName: "Ms. Tabitha Wanjiku",
      department: "Admissions Office",
      jobTitle: "Admissions Clerk",
      phone: nextPhone(),
      role: "CLERK",
    },
    {
      email: email("ulrich", "mwai"),
      employeeId: nextId(),
      name: "Mr. Ulrich Mwai",
      displayName: "Mr. Ulrich Mwai",
      department: "Admissions Office",
      jobTitle: "Verification Officer",
      phone: nextPhone(),
      role: "ADMIN_ASSISTANT",
    },
    {
      email: email("vera", "nganga"),
      employeeId: nextId(),
      name: "Ms. Vera Nganga",
      displayName: "Ms. Vera Nganga",
      department: "Admissions Office",
      jobTitle: "Admissions Officer",
      phone: nextPhone(),
      role: "ADMIN_ASSISTANT",
    },

    // =========================================================================
    // 18. TRANSPORT UNIT
    //     Existing: transport@karu.ac.ke — add 4 staff
    // =========================================================================

    {
      email: email("william", "mwangi"),
      employeeId: nextId(),
      name: "Mr. William Mwangi",
      displayName: "Mr. William Mwangi",
      department: "Transport",
      jobTitle: "Driver",
      phone: nextPhone(),
      role: "STAFF",
    },
    {
      email: email("xenia", "akinyi"),
      employeeId: nextId(),
      name: "Ms. Xenia Akinyi",
      displayName: "Ms. Xenia Akinyi",
      department: "Transport",
      jobTitle: "Driver",
      phone: nextPhone(),
      role: "STAFF",
    },
    {
      email: email("yusuf", "hassan"),
      employeeId: nextId(),
      name: "Mr. Yusuf Hassan",
      displayName: "Mr. Yusuf Hassan",
      department: "Transport",
      jobTitle: "Fleet Coordinator",
      phone: nextPhone(),
      role: "ADMIN_ASSISTANT",
    },
    {
      email: email("zipporah", "wamburu"),
      employeeId: nextId(),
      name: "Ms. Zipporah Wamburu",
      displayName: "Ms. Zipporah Wamburu",
      department: "Transport",
      jobTitle: "Transport Clerk",
      phone: nextPhone(),
      role: "STAFF",
    },
  ];

  // ---------------------------------------------------------------------------
  // Upsert all users
  // ---------------------------------------------------------------------------

  let created = 0;
  let updated = 0;

  for (const u of users) {
    const roleId = roles[u.role];
    if (!roleId) {
      console.warn(`  ⚠ Role "${u.role}" not found for ${u.email} — skipped`);
      continue;
    }

    const existing = await db.user.findUnique({ where: { email: u.email } });

    const user = await db.user.upsert({
      where: { email: u.email },
      update: {
        name: u.name,
        displayName: u.displayName,
        department: u.department,
        jobTitle: u.jobTitle,
        phone: u.phone,
        employeeId: u.employeeId,
      },
      create: {
        email: u.email,
        employeeId: u.employeeId,
        name: u.name,
        displayName: u.displayName,
        password,
        department: u.department,
        jobTitle: u.jobTitle,
        phone: u.phone,
        isActive: true,
      },
    });

    // Assign role (skip if already has it)
    await db.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId } },
      update: {},
      create: { userId: user.id, roleId },
    });

    if (existing) {
      updated++;
    } else {
      created++;
      console.log(`  + ${u.email.padEnd(45)} [${u.role}] — ${u.department}`);
    }
  }

  console.log(`\n✓ Done. ${created} users created, ${updated} updated.`);
  console.log(`  Password for all new users: KarU@2026\n`);

  // ---------------------------------------------------------------------------
  // Summary table
  // ---------------------------------------------------------------------------

  const deptCounts = users.reduce<Record<string, number>>((acc, u) => {
    acc[u.department] = (acc[u.department] ?? 0) + 1;
    return acc;
  }, {});

  console.log("  Department breakdown:");
  for (const [dept, count] of Object.entries(deptCounts)) {
    console.log(`    ${dept.padEnd(55)} ${count} users`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
