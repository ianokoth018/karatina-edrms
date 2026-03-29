import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // ===================================================================
  // 1. ROLES & PERMISSIONS
  // ===================================================================

  const roleDefinitions: {
    name: string;
    description: string;
    isSystem: boolean;
    permissions: { resource: string; action: string }[];
  }[] = [
    {
      name: "ADMIN",
      description: "Full system administrator with all permissions",
      isSystem: true,
      permissions: [
        { resource: "documents", action: "create" },
        { resource: "documents", action: "read" },
        { resource: "documents", action: "update" },
        { resource: "documents", action: "delete" },
        { resource: "documents", action: "approve" },
        { resource: "documents", action: "manage" },
        { resource: "workflows", action: "create" },
        { resource: "workflows", action: "read" },
        { resource: "workflows", action: "update" },
        { resource: "workflows", action: "delete" },
        { resource: "workflows", action: "approve" },
        { resource: "workflows", action: "manage" },
        { resource: "admin", action: "create" },
        { resource: "admin", action: "read" },
        { resource: "admin", action: "update" },
        { resource: "admin", action: "delete" },
        { resource: "admin", action: "manage" },
        { resource: "records", action: "create" },
        { resource: "records", action: "read" },
        { resource: "records", action: "update" },
        { resource: "records", action: "delete" },
        { resource: "records", action: "manage" },
        { resource: "forms", action: "create" },
        { resource: "forms", action: "read" },
        { resource: "forms", action: "update" },
        { resource: "forms", action: "delete" },
        { resource: "forms", action: "manage" },
        { resource: "reports", action: "create" },
        { resource: "reports", action: "read" },
        { resource: "reports", action: "manage" },
      ],
    },

    // --- Top Management ---
    {
      name: "VICE_CHANCELLOR",
      description:
        "University Vice Chancellor — full read access, approve authority across all resources",
      isSystem: true,
      permissions: [
        { resource: "documents", action: "create" },
        { resource: "documents", action: "read" },
        { resource: "documents", action: "update" },
        { resource: "documents", action: "approve" },
        { resource: "documents", action: "manage" },
        { resource: "workflows", action: "create" },
        { resource: "workflows", action: "read" },
        { resource: "workflows", action: "update" },
        { resource: "workflows", action: "approve" },
        { resource: "workflows", action: "manage" },
        { resource: "records", action: "read" },
        { resource: "records", action: "manage" },
        { resource: "forms", action: "create" },
        { resource: "forms", action: "read" },
        { resource: "reports", action: "read" },
        { resource: "reports", action: "create" },
        { resource: "reports", action: "manage" },
        { resource: "admin", action: "read" },
      ],
    },
    {
      name: "DVC_PFA",
      description:
        "Deputy Vice Chancellor (Planning, Finance & Administration) — finance & admin oversight, approve authority",
      isSystem: true,
      permissions: [
        { resource: "documents", action: "create" },
        { resource: "documents", action: "read" },
        { resource: "documents", action: "update" },
        { resource: "documents", action: "approve" },
        { resource: "documents", action: "manage" },
        { resource: "workflows", action: "create" },
        { resource: "workflows", action: "read" },
        { resource: "workflows", action: "update" },
        { resource: "workflows", action: "approve" },
        { resource: "workflows", action: "manage" },
        { resource: "records", action: "read" },
        { resource: "records", action: "manage" },
        { resource: "forms", action: "create" },
        { resource: "forms", action: "read" },
        { resource: "reports", action: "read" },
        { resource: "reports", action: "create" },
        { resource: "reports", action: "manage" },
        { resource: "admin", action: "read" },
      ],
    },
    {
      name: "DVC_ARSA",
      description:
        "Deputy Vice Chancellor (Academic, Research & Student Affairs) — academic oversight, approve authority",
      isSystem: true,
      permissions: [
        { resource: "documents", action: "create" },
        { resource: "documents", action: "read" },
        { resource: "documents", action: "update" },
        { resource: "documents", action: "approve" },
        { resource: "documents", action: "manage" },
        { resource: "workflows", action: "create" },
        { resource: "workflows", action: "read" },
        { resource: "workflows", action: "update" },
        { resource: "workflows", action: "approve" },
        { resource: "workflows", action: "manage" },
        { resource: "records", action: "read" },
        { resource: "records", action: "manage" },
        { resource: "forms", action: "create" },
        { resource: "forms", action: "read" },
        { resource: "reports", action: "read" },
        { resource: "reports", action: "create" },
        { resource: "reports", action: "manage" },
        { resource: "admin", action: "read" },
      ],
    },

    // --- Registrars ---
    {
      name: "REGISTRAR_PA",
      description:
        "Registrar (Planning & Administration) — manage admin records, workflows, approve",
      isSystem: true,
      permissions: [
        { resource: "documents", action: "create" },
        { resource: "documents", action: "read" },
        { resource: "documents", action: "update" },
        { resource: "documents", action: "approve" },
        { resource: "documents", action: "manage" },
        { resource: "workflows", action: "create" },
        { resource: "workflows", action: "read" },
        { resource: "workflows", action: "update" },
        { resource: "workflows", action: "approve" },
        { resource: "workflows", action: "manage" },
        { resource: "records", action: "create" },
        { resource: "records", action: "read" },
        { resource: "records", action: "update" },
        { resource: "records", action: "manage" },
        { resource: "forms", action: "create" },
        { resource: "forms", action: "read" },
        { resource: "forms", action: "update" },
        { resource: "reports", action: "read" },
        { resource: "reports", action: "create" },
      ],
    },
    {
      name: "REGISTRAR_ARSA",
      description:
        "Registrar (Academic & Student Affairs) — manage academic records, student workflows, approve",
      isSystem: true,
      permissions: [
        { resource: "documents", action: "create" },
        { resource: "documents", action: "read" },
        { resource: "documents", action: "update" },
        { resource: "documents", action: "approve" },
        { resource: "documents", action: "manage" },
        { resource: "workflows", action: "create" },
        { resource: "workflows", action: "read" },
        { resource: "workflows", action: "update" },
        { resource: "workflows", action: "approve" },
        { resource: "workflows", action: "manage" },
        { resource: "records", action: "create" },
        { resource: "records", action: "read" },
        { resource: "records", action: "update" },
        { resource: "records", action: "manage" },
        { resource: "forms", action: "create" },
        { resource: "forms", action: "read" },
        { resource: "forms", action: "update" },
        { resource: "reports", action: "read" },
        { resource: "reports", action: "create" },
      ],
    },

    // --- Academic Leadership ---
    {
      name: "DEAN",
      description:
        "Dean of an academic school — documents, workflows, approve within school",
      isSystem: false,
      permissions: [
        { resource: "documents", action: "create" },
        { resource: "documents", action: "read" },
        { resource: "documents", action: "update" },
        { resource: "documents", action: "approve" },
        { resource: "workflows", action: "create" },
        { resource: "workflows", action: "read" },
        { resource: "workflows", action: "update" },
        { resource: "workflows", action: "approve" },
        { resource: "records", action: "read" },
        { resource: "forms", action: "create" },
        { resource: "forms", action: "read" },
        { resource: "reports", action: "read" },
        { resource: "reports", action: "create" },
      ],
    },
    {
      name: "HOD",
      description:
        "Head of Department — documents, workflows within department, first-level approve",
      isSystem: false,
      permissions: [
        { resource: "documents", action: "create" },
        { resource: "documents", action: "read" },
        { resource: "documents", action: "update" },
        { resource: "documents", action: "approve" },
        { resource: "workflows", action: "create" },
        { resource: "workflows", action: "read" },
        { resource: "workflows", action: "approve" },
        { resource: "forms", action: "create" },
        { resource: "forms", action: "read" },
        { resource: "reports", action: "read" },
        { resource: "reports", action: "create" },
      ],
    },

    // --- Directorate ---
    {
      name: "DIRECTOR",
      description:
        "Director of a directorate — documents, workflows, approve within directorate",
      isSystem: false,
      permissions: [
        { resource: "documents", action: "create" },
        { resource: "documents", action: "read" },
        { resource: "documents", action: "update" },
        { resource: "documents", action: "approve" },
        { resource: "workflows", action: "create" },
        { resource: "workflows", action: "read" },
        { resource: "workflows", action: "update" },
        { resource: "workflows", action: "approve" },
        { resource: "records", action: "read" },
        { resource: "forms", action: "create" },
        { resource: "forms", action: "read" },
        { resource: "reports", action: "read" },
        { resource: "reports", action: "create" },
      ],
    },

    // --- Departmental Officers ---
    {
      name: "FINANCE_OFFICER",
      description:
        "Finance department staff — financial documents, payment workflows, budget reports",
      isSystem: false,
      permissions: [
        { resource: "documents", action: "create" },
        { resource: "documents", action: "read" },
        { resource: "documents", action: "update" },
        { resource: "documents", action: "approve" },
        { resource: "workflows", action: "create" },
        { resource: "workflows", action: "read" },
        { resource: "workflows", action: "approve" },
        { resource: "records", action: "read" },
        { resource: "forms", action: "create" },
        { resource: "forms", action: "read" },
        { resource: "reports", action: "read" },
        { resource: "reports", action: "create" },
      ],
    },
    {
      name: "HR_OFFICER",
      description:
        "Human Resources staff — staff files, leave workflows, recruitment records",
      isSystem: false,
      permissions: [
        { resource: "documents", action: "create" },
        { resource: "documents", action: "read" },
        { resource: "documents", action: "update" },
        { resource: "documents", action: "approve" },
        { resource: "workflows", action: "create" },
        { resource: "workflows", action: "read" },
        { resource: "workflows", action: "approve" },
        { resource: "records", action: "create" },
        { resource: "records", action: "read" },
        { resource: "records", action: "update" },
        { resource: "forms", action: "create" },
        { resource: "forms", action: "read" },
        { resource: "reports", action: "read" },
      ],
    },
    {
      name: "PROCUREMENT_OFFICER",
      description:
        "Procurement department staff — tenders, purchase orders, supplier contracts",
      isSystem: false,
      permissions: [
        { resource: "documents", action: "create" },
        { resource: "documents", action: "read" },
        { resource: "documents", action: "update" },
        { resource: "documents", action: "approve" },
        { resource: "workflows", action: "create" },
        { resource: "workflows", action: "read" },
        { resource: "workflows", action: "approve" },
        { resource: "records", action: "read" },
        { resource: "forms", action: "create" },
        { resource: "forms", action: "read" },
        { resource: "reports", action: "read" },
      ],
    },
    {
      name: "ICT_OFFICER",
      description:
        "ICT Directorate staff — system support, infrastructure docs, user requests",
      isSystem: false,
      permissions: [
        { resource: "documents", action: "create" },
        { resource: "documents", action: "read" },
        { resource: "documents", action: "update" },
        { resource: "workflows", action: "create" },
        { resource: "workflows", action: "read" },
        { resource: "workflows", action: "approve" },
        { resource: "records", action: "read" },
        { resource: "forms", action: "create" },
        { resource: "forms", action: "read" },
        { resource: "reports", action: "read" },
      ],
    },
    {
      name: "INTERNAL_AUDITOR",
      description:
        "Internal Audit staff — read-only across all resources for audit; create audit reports",
      isSystem: false,
      permissions: [
        { resource: "documents", action: "read" },
        { resource: "workflows", action: "read" },
        { resource: "records", action: "read" },
        { resource: "forms", action: "read" },
        { resource: "reports", action: "read" },
        { resource: "reports", action: "create" },
        { resource: "admin", action: "read" },
      ],
    },
    {
      name: "LEGAL_OFFICER",
      description:
        "Legal Office staff — contracts, litigation files, compliance records",
      isSystem: false,
      permissions: [
        { resource: "documents", action: "create" },
        { resource: "documents", action: "read" },
        { resource: "documents", action: "update" },
        { resource: "documents", action: "approve" },
        { resource: "workflows", action: "create" },
        { resource: "workflows", action: "read" },
        { resource: "workflows", action: "approve" },
        { resource: "records", action: "read" },
        { resource: "forms", action: "create" },
        { resource: "forms", action: "read" },
        { resource: "reports", action: "read" },
      ],
    },
    {
      name: "LIBRARIAN",
      description:
        "University Library staff — library records, acquisitions, e-resources",
      isSystem: false,
      permissions: [
        { resource: "documents", action: "create" },
        { resource: "documents", action: "read" },
        { resource: "documents", action: "update" },
        { resource: "workflows", action: "create" },
        { resource: "workflows", action: "read" },
        { resource: "records", action: "create" },
        { resource: "records", action: "read" },
        { resource: "records", action: "update" },
        { resource: "forms", action: "create" },
        { resource: "forms", action: "read" },
        { resource: "reports", action: "read" },
      ],
    },
    {
      name: "MEDICAL_OFFICER",
      description:
        "Health Services staff — patient records, pharmacy, insurance claims",
      isSystem: false,
      permissions: [
        { resource: "documents", action: "create" },
        { resource: "documents", action: "read" },
        { resource: "documents", action: "update" },
        { resource: "workflows", action: "create" },
        { resource: "workflows", action: "read" },
        { resource: "records", action: "create" },
        { resource: "records", action: "read" },
        { resource: "records", action: "update" },
        { resource: "forms", action: "create" },
        { resource: "forms", action: "read" },
        { resource: "reports", action: "read" },
      ],
    },
    {
      name: "ESTATES_OFFICER",
      description:
        "Estates Department staff — building maintenance, asset register, construction projects",
      isSystem: false,
      permissions: [
        { resource: "documents", action: "create" },
        { resource: "documents", action: "read" },
        { resource: "documents", action: "update" },
        { resource: "workflows", action: "create" },
        { resource: "workflows", action: "read" },
        { resource: "records", action: "create" },
        { resource: "records", action: "read" },
        { resource: "records", action: "update" },
        { resource: "forms", action: "create" },
        { resource: "forms", action: "read" },
        { resource: "reports", action: "read" },
      ],
    },
    {
      name: "SECURITY_OFFICER",
      description:
        "Security Services staff — incident reports, access control, patrol records",
      isSystem: false,
      permissions: [
        { resource: "documents", action: "create" },
        { resource: "documents", action: "read" },
        { resource: "documents", action: "update" },
        { resource: "workflows", action: "create" },
        { resource: "workflows", action: "read" },
        { resource: "records", action: "create" },
        { resource: "records", action: "read" },
        { resource: "forms", action: "create" },
        { resource: "forms", action: "read" },
        { resource: "reports", action: "read" },
      ],
    },
    {
      name: "RECORDS_OFFICER",
      description:
        "Registry officer — full records management, document tracking, classification",
      isSystem: false,
      permissions: [
        { resource: "documents", action: "create" },
        { resource: "documents", action: "read" },
        { resource: "documents", action: "update" },
        { resource: "records", action: "create" },
        { resource: "records", action: "read" },
        { resource: "records", action: "update" },
        { resource: "records", action: "manage" },
        { resource: "workflows", action: "create" },
        { resource: "workflows", action: "read" },
        { resource: "forms", action: "read" },
        { resource: "reports", action: "read" },
      ],
    },
    {
      name: "RECORDS_MANAGER",
      description:
        "Senior records management — classification oversight, retention, disposal",
      isSystem: false,
      permissions: [
        { resource: "documents", action: "create" },
        { resource: "documents", action: "read" },
        { resource: "documents", action: "update" },
        { resource: "documents", action: "delete" },
        { resource: "documents", action: "manage" },
        { resource: "records", action: "create" },
        { resource: "records", action: "read" },
        { resource: "records", action: "update" },
        { resource: "records", action: "delete" },
        { resource: "records", action: "manage" },
        { resource: "workflows", action: "create" },
        { resource: "workflows", action: "read" },
        { resource: "workflows", action: "update" },
        { resource: "forms", action: "read" },
        { resource: "reports", action: "read" },
        { resource: "reports", action: "create" },
      ],
    },
    {
      name: "ADMIN_ASSISTANT",
      description:
        "Administrative assistant — create and track documents, initiate workflows",
      isSystem: false,
      permissions: [
        { resource: "documents", action: "create" },
        { resource: "documents", action: "read" },
        { resource: "documents", action: "update" },
        { resource: "workflows", action: "create" },
        { resource: "workflows", action: "read" },
        { resource: "records", action: "read" },
        { resource: "forms", action: "create" },
        { resource: "forms", action: "read" },
        { resource: "reports", action: "read" },
      ],
    },
    {
      name: "CLERK",
      description:
        "General clerk — basic document creation, read access, form submission",
      isSystem: false,
      permissions: [
        { resource: "documents", action: "create" },
        { resource: "documents", action: "read" },
        { resource: "workflows", action: "create" },
        { resource: "workflows", action: "read" },
        { resource: "records", action: "read" },
        { resource: "forms", action: "create" },
        { resource: "forms", action: "read" },
        { resource: "reports", action: "read" },
      ],
    },

    // --- Generic roles ---
    {
      name: "STAFF",
      description: "General staff member — basic create and read access",
      isSystem: false,
      permissions: [
        { resource: "documents", action: "create" },
        { resource: "documents", action: "read" },
        { resource: "workflows", action: "create" },
        { resource: "workflows", action: "read" },
        { resource: "forms", action: "create" },
        { resource: "forms", action: "read" },
        { resource: "reports", action: "read" },
      ],
    },
    {
      name: "VIEWER",
      description: "Read-only access to documents, records, and reports",
      isSystem: false,
      permissions: [
        { resource: "documents", action: "read" },
        { resource: "records", action: "read" },
        { resource: "workflows", action: "read" },
        { resource: "forms", action: "read" },
        { resource: "reports", action: "read" },
      ],
    },
  ];

  const createdRoles: Record<string, string> = {};

  for (const roleDef of roleDefinitions) {
    const role = await db.role.upsert({
      where: { name: roleDef.name },
      update: {
        description: roleDef.description,
        isSystem: roleDef.isSystem,
      },
      create: {
        name: roleDef.name,
        description: roleDef.description,
        isSystem: roleDef.isSystem,
      },
    });

    createdRoles[roleDef.name] = role.id;

    // Upsert permissions
    for (const perm of roleDef.permissions) {
      await db.permission.upsert({
        where: {
          roleId_resource_action: {
            roleId: role.id,
            resource: perm.resource,
            action: perm.action,
          },
        },
        update: {},
        create: {
          roleId: role.id,
          resource: perm.resource,
          action: perm.action,
        },
      });
    }

    console.log(
      `  Role: ${roleDef.name} (${roleDef.permissions.length} permissions)`
    );
  }

  // Clean up legacy roles that have been replaced
  const legacyRoles = ["DVC", "REGISTRAR", "AUDITOR"];
  for (const legacyName of legacyRoles) {
    const legacy = await db.role.findUnique({ where: { name: legacyName } });
    if (legacy) {
      // Reassign users on legacy roles if needed (no-op when nobody has them)
      console.log(`  (Legacy role "${legacyName}" still in DB — left as-is)`);
    }
  }

  // ===================================================================
  // 2. ADMIN USER
  // ===================================================================

  const adminPassword = await bcrypt.hash("Admin@2026", 12);

  const adminUser = await db.user.upsert({
    where: { email: "admin@karu.ac.ke" },
    update: {
      password: adminPassword,
      name: "System Administrator",
      displayName: "System Administrator",
      department: "ICT Directorate",
      jobTitle: "System Administrator",
    },
    create: {
      email: "admin@karu.ac.ke",
      name: "System Administrator",
      displayName: "System Administrator",
      password: adminPassword,
      department: "ICT Directorate",
      jobTitle: "System Administrator",
      isActive: true,
    },
  });

  // Assign ADMIN role
  await db.userRole.upsert({
    where: {
      userId_roleId: {
        userId: adminUser.id,
        roleId: createdRoles["ADMIN"],
      },
    },
    update: {},
    create: {
      userId: adminUser.id,
      roleId: createdRoles["ADMIN"],
    },
  });

  console.log(`  Admin user: admin@karu.ac.ke / Admin@2026`);

  // ===================================================================
  // 3. SAMPLE USERS — Karatina University Organizational Structure
  // ===================================================================

  const staffPassword = await bcrypt.hash("KarU@2026", 12);

  const sampleUsers: {
    email: string;
    employeeId?: string;
    name: string;
    displayName: string;
    department: string;
    jobTitle: string;
    phone?: string;
    role: string;
  }[] = [
    // ---------------------------------------------------------------
    // University Top Management
    // ---------------------------------------------------------------
    {
      email: "vc@karu.ac.ke",
      employeeId: "KU/001",
      name: "Prof. John Mwangi",
      displayName: "Prof. John Mwangi",
      department: "Vice Chancellor's Office",
      jobTitle: "Vice Chancellor",
      phone: "+254 700 000 001",
      role: "VICE_CHANCELLOR",
    },
    {
      email: "dvc.pfa@karu.ac.ke",
      employeeId: "KU/002",
      name: "Prof. Mary Wanjiku",
      displayName: "Prof. Mary Wanjiku",
      department: "DVC (Planning, Finance & Administration)",
      jobTitle: "Deputy Vice Chancellor (PFA)",
      phone: "+254 700 000 002",
      role: "DVC_PFA",
    },
    {
      email: "dvc.arsa@karu.ac.ke",
      employeeId: "KU/003",
      name: "Prof. James Kariuki",
      displayName: "Prof. James Kariuki",
      department: "DVC (Academic, Research & Student Affairs)",
      jobTitle: "Deputy Vice Chancellor (ARSA)",
      phone: "+254 700 000 003",
      role: "DVC_ARSA",
    },

    // ---------------------------------------------------------------
    // Registrars
    // ---------------------------------------------------------------
    {
      email: "registrar.pa@karu.ac.ke",
      employeeId: "KU/004",
      name: "Mr. Grey Mausi",
      displayName: "Mr. Grey Mausi",
      department: "Registrar (Planning & Administration)",
      jobTitle: "Registrar (P&A)",
      phone: "+254 700 000 004",
      role: "REGISTRAR_PA",
    },
    {
      email: "registrar.arsa@karu.ac.ke",
      employeeId: "KU/005",
      name: "Dr. Wangari Gathuthi",
      displayName: "Dr. Wangari Gathuthi",
      department: "Registrar (Academic & Student Affairs)",
      jobTitle: "Registrar (Academic & Student Affairs)",
      phone: "+254 700 000 005",
      role: "REGISTRAR_ARSA",
    },

    // ---------------------------------------------------------------
    // Academic Deans (6 Schools)
    // ---------------------------------------------------------------
    {
      email: "dean.spas@karu.ac.ke",
      employeeId: "KU/010",
      name: "Prof. Peter Njoroge",
      displayName: "Prof. Peter Njoroge",
      department: "School of Pure and Applied Sciences",
      jobTitle: "Dean, SPAS",
      phone: "+254 700 000 010",
      role: "DEAN",
    },
    {
      email: "dean.sob@karu.ac.ke",
      employeeId: "KU/011",
      name: "Prof. Jane Wambui",
      displayName: "Prof. Jane Wambui",
      department: "School of Business",
      jobTitle: "Dean, SOB",
      phone: "+254 700 000 011",
      role: "DEAN",
    },
    {
      email: "dean.sess@karu.ac.ke",
      employeeId: "KU/012",
      name: "Prof. David Kimani",
      displayName: "Prof. David Kimani",
      department: "School of Education and Social Sciences",
      jobTitle: "Dean, SESS",
      phone: "+254 700 000 012",
      role: "DEAN",
    },
    {
      email: "dean.sab@karu.ac.ke",
      employeeId: "KU/013",
      name: "Prof. Grace Muthoni",
      displayName: "Prof. Grace Muthoni",
      department: "School of Agriculture and Biotechnology",
      jobTitle: "Dean, SAB",
      phone: "+254 700 000 013",
      role: "DEAN",
    },
    {
      email: "dean.snres@karu.ac.ke",
      employeeId: "KU/014",
      name: "Prof. Bernard Mugambi",
      displayName: "Prof. Bernard Mugambi",
      department: "School of Natural Resources and Environmental Studies",
      jobTitle: "Dean, SNRES",
      phone: "+254 700 000 014",
      role: "DEAN",
    },
    {
      email: "dean.snph@karu.ac.ke",
      employeeId: "KU/015",
      name: "Prof. Esther Wairimu",
      displayName: "Prof. Esther Wairimu",
      department: "School of Nursing and Public Health",
      jobTitle: "Dean, SNPH",
      phone: "+254 700 000 015",
      role: "DEAN",
    },

    // ---------------------------------------------------------------
    // Directors (Directorates)
    // ---------------------------------------------------------------
    {
      email: "director.ict@karu.ac.ke",
      employeeId: "KU/020",
      name: "Dr. Gilbert Mugeni",
      displayName: "Dr. Gilbert Mugeni",
      department: "ICT Directorate",
      jobTitle: "Director, ICT",
      phone: "+254 700 000 020",
      role: "DIRECTOR",
    },
    {
      email: "director.qa@karu.ac.ke",
      employeeId: "KU/021",
      name: "Dr. Catherine Njeri",
      displayName: "Dr. Catherine Njeri",
      department: "Directorate of Quality Assurance and ISO",
      jobTitle: "Director, Quality Assurance & ISO",
      phone: "+254 700 000 021",
      role: "DIRECTOR",
    },
    {
      email: "director.research@karu.ac.ke",
      employeeId: "KU/022",
      name: "Prof. Michael Mutua",
      displayName: "Prof. Michael Mutua",
      department: "Directorate of Research, Innovation and Extension",
      jobTitle: "Director, Research, Innovation & Extension",
      phone: "+254 700 000 022",
      role: "DIRECTOR",
    },
    {
      email: "director.resource@karu.ac.ke",
      employeeId: "KU/023",
      name: "Dr. Patrick Maina",
      displayName: "Dr. Patrick Maina",
      department: "Directorate of Resource Mobilization",
      jobTitle: "Director, Resource Mobilization",
      phone: "+254 700 000 023",
      role: "DIRECTOR",
    },
    {
      email: "director.odel@karu.ac.ke",
      employeeId: "KU/024",
      name: "Dr. Lilian Waweru",
      displayName: "Dr. Lilian Waweru",
      department: "Directorate of Open, Distance and E-Learning",
      jobTitle: "Director, ODeL",
      phone: "+254 700 000 024",
      role: "DIRECTOR",
    },
    {
      email: "director.career@karu.ac.ke",
      employeeId: "KU/025",
      name: "Dr. Stephen Kimotho",
      displayName: "Dr. Stephen Kimotho",
      department: "Directorate of Career Services and University-Industry Linkage",
      jobTitle: "Director, Career Services",
      phone: "+254 700 000 025",
      role: "DIRECTOR",
    },
    {
      email: "director.outreach@karu.ac.ke",
      employeeId: "KU/026",
      name: "Dr. Agnes Wacera",
      displayName: "Dr. Agnes Wacera",
      department: "Directorate of Community Outreach",
      jobTitle: "Director, Community Outreach",
      phone: "+254 700 000 026",
      role: "DIRECTOR",
    },

    // ---------------------------------------------------------------
    // Administrative Officers
    // ---------------------------------------------------------------
    {
      email: "finance@karu.ac.ke",
      employeeId: "KU/030",
      name: "Ms. Marion Macharia",
      displayName: "Ms. Marion Macharia",
      department: "Finance Department",
      jobTitle: "Finance Officer",
      phone: "+254 700 000 030",
      role: "FINANCE_OFFICER",
    },
    {
      email: "hr@karu.ac.ke",
      employeeId: "KU/031",
      name: "Ms. Regina Kanake",
      displayName: "Ms. Regina Kanake",
      department: "Human Resource Department",
      jobTitle: "HR Officer",
      phone: "+254 700 000 031",
      role: "HR_OFFICER",
    },
    {
      email: "procurement@karu.ac.ke",
      employeeId: "KU/032",
      name: "Mr. Timothy Irungu",
      displayName: "Mr. Timothy Irungu",
      department: "Procurement Department",
      jobTitle: "Procurement Officer",
      phone: "+254 700 000 032",
      role: "PROCUREMENT_OFFICER",
    },
    {
      email: "audit@karu.ac.ke",
      employeeId: "KU/033",
      name: "Ms. Cecily Mukami",
      displayName: "Ms. Cecily Mukami",
      department: "Internal Audit",
      jobTitle: "Internal Auditor",
      phone: "+254 700 000 033",
      role: "INTERNAL_AUDITOR",
    },
    {
      email: "legal@karu.ac.ke",
      employeeId: "KU/034",
      name: "Ms. Anne Mumbi",
      displayName: "Ms. Anne Mumbi",
      department: "Legal Office",
      jobTitle: "Legal Officer",
      phone: "+254 700 000 034",
      role: "LEGAL_OFFICER",
    },
    {
      email: "librarian@karu.ac.ke",
      employeeId: "KU/035",
      name: "Dr. Everlyn Anduvare",
      displayName: "Dr. Everlyn Anduvare",
      department: "Library Services",
      jobTitle: "University Librarian",
      phone: "+254 700 000 035",
      role: "LIBRARIAN",
    },
    {
      email: "registry@karu.ac.ke",
      employeeId: "KU/036",
      name: "Ms. Lucy Ng'ang'a",
      displayName: "Ms. Lucy Ng'ang'a",
      department: "Registry (Records)",
      jobTitle: "Records Officer",
      phone: "+254 700 000 036",
      role: "RECORDS_OFFICER",
    },
    {
      email: "ict.officer@karu.ac.ke",
      employeeId: "KU/037",
      name: "George Otieno",
      displayName: "George Otieno",
      department: "ICT Directorate",
      jobTitle: "ICT Officer",
      phone: "+254 700 000 037",
      role: "ICT_OFFICER",
    },

    // ---------------------------------------------------------------
    // Additional departmental staff (for realistic workflow routing)
    // ---------------------------------------------------------------
    {
      email: "admissions@karu.ac.ke",
      employeeId: "KU/040",
      name: "Mr. Joseph Nderitu",
      displayName: "Mr. Joseph Nderitu",
      department: "Admissions Office",
      jobTitle: "Admissions Officer",
      phone: "+254 700 000 040",
      role: "ADMIN_ASSISTANT",
    },
    {
      email: "estates@karu.ac.ke",
      employeeId: "KU/041",
      name: "Mr. Daniel Kinyanjui",
      displayName: "Mr. Daniel Kinyanjui",
      department: "Estates Department",
      jobTitle: "Estates Officer",
      phone: "+254 700 000 041",
      role: "ESTATES_OFFICER",
    },
    {
      email: "security@karu.ac.ke",
      employeeId: "KU/042",
      name: "Mr. Samuel Mwangi",
      displayName: "Mr. Samuel Mwangi",
      department: "Security Services",
      jobTitle: "Chief Security Officer",
      phone: "+254 700 000 042",
      role: "SECURITY_OFFICER",
    },
    {
      email: "health@karu.ac.ke",
      employeeId: "KU/043",
      name: "Dr. Florence Njoki",
      displayName: "Dr. Florence Njoki",
      department: "Health Services",
      jobTitle: "Medical Officer",
      phone: "+254 700 000 043",
      role: "MEDICAL_OFFICER",
    },
    {
      email: "planning@karu.ac.ke",
      employeeId: "KU/044",
      name: "Mr. Robert Kamau",
      displayName: "Mr. Robert Kamau",
      department: "Planning Office",
      jobTitle: "Planning Officer",
      phone: "+254 700 000 044",
      role: "ADMIN_ASSISTANT",
    },
    {
      email: "hostels@karu.ac.ke",
      employeeId: "KU/045",
      name: "Ms. Margaret Waithera",
      displayName: "Ms. Margaret Waithera",
      department: "Hostels & Accommodation",
      jobTitle: "Accommodation Officer",
      phone: "+254 700 000 045",
      role: "ADMIN_ASSISTANT",
    },
    {
      email: "transport@karu.ac.ke",
      employeeId: "KU/046",
      name: "Mr. Peter Macharia",
      displayName: "Mr. Peter Macharia",
      department: "Transport",
      jobTitle: "Transport Officer",
      phone: "+254 700 000 046",
      role: "ADMIN_ASSISTANT",
    },

    // ---------------------------------------------------------------
    // Sample HODs (Department Heads)
    // ---------------------------------------------------------------
    {
      email: "hod.cs@karu.ac.ke",
      employeeId: "KU/050",
      name: "Dr. Sarah Njoroge",
      displayName: "Dr. Sarah Njoroge",
      department: "Department of Computer Science",
      jobTitle: "HOD, Computer Science",
      phone: "+254 700 000 050",
      role: "HOD",
    },
    {
      email: "hod.business@karu.ac.ke",
      employeeId: "KU/051",
      name: "Dr. Michael Ochieng",
      displayName: "Dr. Michael Ochieng",
      department: "Department of Business Management",
      jobTitle: "HOD, Business Management",
      phone: "+254 700 000 051",
      role: "HOD",
    },
    {
      email: "hod.education@karu.ac.ke",
      employeeId: "KU/052",
      name: "Dr. Ruth Mugo",
      displayName: "Dr. Ruth Mugo",
      department: "Department of Education",
      jobTitle: "HOD, Education",
      phone: "+254 700 000 052",
      role: "HOD",
    },

    // ---------------------------------------------------------------
    // Sample Clerk
    // ---------------------------------------------------------------
    {
      email: "clerk.registry@karu.ac.ke",
      employeeId: "KU/060",
      name: "Ms. Faith Wanjiru",
      displayName: "Ms. Faith Wanjiru",
      department: "Registry (Records)",
      jobTitle: "Registry Clerk",
      phone: "+254 700 000 060",
      role: "CLERK",
    },
  ];

  for (const userData of sampleUsers) {
    const user = await db.user.upsert({
      where: { email: userData.email },
      update: {
        name: userData.name,
        displayName: userData.displayName,
        department: userData.department,
        jobTitle: userData.jobTitle,
        phone: userData.phone ?? null,
        employeeId: userData.employeeId ?? null,
      },
      create: {
        email: userData.email,
        employeeId: userData.employeeId ?? null,
        name: userData.name,
        displayName: userData.displayName,
        password: staffPassword,
        department: userData.department,
        jobTitle: userData.jobTitle,
        phone: userData.phone ?? null,
        isActive: true,
      },
    });

    // Assign role
    await db.userRole.upsert({
      where: {
        userId_roleId: {
          userId: user.id,
          roleId: createdRoles[userData.role],
        },
      },
      update: {},
      create: {
        userId: user.id,
        roleId: createdRoles[userData.role],
      },
    });

    console.log(`  User: ${userData.email} — ${userData.role}`);
  }

  console.log(`  All sample users password: KarU@2026`);

  // ===================================================================
  // 4. CLASSIFICATION NODES
  // ===================================================================
  // Three-level hierarchy: Function (L1) > Activity (L2) > Transaction (L3)
  // Codes use the pattern requested in the spec, with numeric sub-codes
  // for the detailed existing nodes and alias codes for the shorthand
  // codes requested (e.g. ADM-VC, FIN-PAY).
  // ===================================================================

  // ------------------------------------------------------------------
  // Level 1: Functions
  // ------------------------------------------------------------------
  const admNode = await db.classificationNode.upsert({
    where: { code: "ADM" },
    update: { title: "Administration", description: "Administrative correspondence and governance records" },
    create: {
      code: "ADM",
      title: "Administration",
      description: "Administrative correspondence and governance records",
      level: 1,
    },
  });

  const finNode = await db.classificationNode.upsert({
    where: { code: "FIN" },
    update: { title: "Finance", description: "Financial records, payments, and budgets" },
    create: {
      code: "FIN",
      title: "Finance",
      description: "Financial records, payments, and budgets",
      level: 1,
    },
  });

  const hrNode = await db.classificationNode.upsert({
    where: { code: "HR" },
    update: { title: "Human Resources", description: "Staff records and HR management" },
    create: {
      code: "HR",
      title: "Human Resources",
      description: "Staff records and HR management",
      level: 1,
    },
  });

  const stuNode = await db.classificationNode.upsert({
    where: { code: "STU" },
    update: { title: "Student Records", description: "Student academic and administrative records" },
    create: {
      code: "STU",
      title: "Student Records",
      description: "Student academic and administrative records",
      level: 1,
    },
  });

  const ictNode = await db.classificationNode.upsert({
    where: { code: "ICT" },
    update: { title: "ICT Directorate", description: "Information and communication technology records" },
    create: {
      code: "ICT",
      title: "ICT Directorate",
      description: "Information and communication technology records",
      level: 1,
    },
  });

  const procNode = await db.classificationNode.upsert({
    where: { code: "PROC" },
    update: { title: "Procurement", description: "Procurement processes, tenders, and contracts" },
    create: {
      code: "PROC",
      title: "Procurement",
      description: "Procurement processes, tenders, and contracts",
      level: 1,
    },
  });

  const audNode = await db.classificationNode.upsert({
    where: { code: "AUD" },
    update: { title: "Internal Audit", description: "Audit reports, findings, and compliance records" },
    create: {
      code: "AUD",
      title: "Internal Audit",
      description: "Audit reports, findings, and compliance records",
      level: 1,
    },
  });

  const legalNode = await db.classificationNode.upsert({
    where: { code: "LEG" },
    update: { title: "Legal", description: "Legal documents, contracts, litigation, and compliance records" },
    create: {
      code: "LEG",
      title: "Legal",
      description: "Legal documents, contracts, litigation, and compliance records",
      level: 1,
    },
  });

  const acadNode = await db.classificationNode.upsert({
    where: { code: "ACAD" },
    update: { title: "Academic", description: "Academic programmes, curriculum, and examination records" },
    create: {
      code: "ACAD",
      title: "Academic",
      description: "Academic programmes, curriculum, and examination records",
      level: 1,
    },
  });

  const libNode = await db.classificationNode.upsert({
    where: { code: "LIB" },
    update: { title: "Library Services", description: "Library operations, acquisitions, and records" },
    create: {
      code: "LIB",
      title: "Library Services",
      description: "Library operations, acquisitions, and records",
      level: 1,
    },
  });

  const planNode = await db.classificationNode.upsert({
    where: { code: "PLAN" },
    update: { title: "Planning Office", description: "Strategic planning, development, and institutional data" },
    create: {
      code: "PLAN",
      title: "Planning Office",
      description: "Strategic planning, development, and institutional data",
      level: 1,
    },
  });

  const estNode = await db.classificationNode.upsert({
    where: { code: "EST" },
    update: { title: "Estates", description: "Estates management, maintenance, and infrastructure records" },
    create: {
      code: "EST",
      title: "Estates",
      description: "Estates management, maintenance, and infrastructure records",
      level: 1,
    },
  });

  const secNode = await db.classificationNode.upsert({
    where: { code: "SEC" },
    update: { title: "Security Services", description: "Security operations, incident reports, and access records" },
    create: {
      code: "SEC",
      title: "Security Services",
      description: "Security operations, incident reports, and access records",
      level: 1,
    },
  });

  const medNode = await db.classificationNode.upsert({
    where: { code: "MED" },
    update: { title: "Health Services", description: "University health centre records and medical services" },
    create: {
      code: "MED",
      title: "Health Services",
      description: "University health centre records and medical services",
      level: 1,
    },
  });

  const hostNode = await db.classificationNode.upsert({
    where: { code: "HOST" },
    update: { title: "Hostels & Accommodation", description: "Student accommodation and hostel management records" },
    create: {
      code: "HOST",
      title: "Hostels & Accommodation",
      description: "Student accommodation and hostel management records",
      level: 1,
    },
  });

  const transNode = await db.classificationNode.upsert({
    where: { code: "TRANS" },
    update: { title: "Transport", description: "Vehicle management, transport logistics, and fleet records" },
    create: {
      code: "TRANS",
      title: "Transport",
      description: "Vehicle management, transport logistics, and fleet records",
      level: 1,
    },
  });

  // ------------------------------------------------------------------
  // Level 2: Activities
  // ------------------------------------------------------------------

  // ADM — Administration
  const admVc = await db.classificationNode.upsert({
    where: { code: "ADM-VC" },
    update: {},
    create: {
      code: "ADM-VC",
      title: "Vice Chancellor's Office",
      description: "VC correspondence, directives, and governance records",
      level: 2,
      parentId: admNode.id,
    },
  });

  const admDvcPfa = await db.classificationNode.upsert({
    where: { code: "ADM-DVC-PFA" },
    update: {},
    create: {
      code: "ADM-DVC-PFA",
      title: "DVC PFA Office",
      description: "DVC (Planning, Finance & Administration) correspondence",
      level: 2,
      parentId: admNode.id,
    },
  });

  const admDvcArsa = await db.classificationNode.upsert({
    where: { code: "ADM-DVC-ARSA" },
    update: {},
    create: {
      code: "ADM-DVC-ARSA",
      title: "DVC ARSA Office",
      description: "DVC (Academic, Research & Student Affairs) correspondence",
      level: 2,
      parentId: admNode.id,
    },
  });

  const admReg = await db.classificationNode.upsert({
    where: { code: "ADM-REG" },
    update: {},
    create: {
      code: "ADM-REG",
      title: "Registry",
      description: "Central registry correspondence and file tracking",
      level: 2,
      parentId: admNode.id,
    },
  });

  const admCorr = await db.classificationNode.upsert({
    where: { code: "ADM-001" },
    update: {},
    create: {
      code: "ADM-001",
      title: "Correspondence",
      description: "General administrative correspondence",
      level: 2,
      parentId: admNode.id,
    },
  });

  const admGov = await db.classificationNode.upsert({
    where: { code: "ADM-002" },
    update: {},
    create: {
      code: "ADM-002",
      title: "Governance",
      description: "Council and Senate minutes, resolutions, and policies",
      level: 2,
      parentId: admNode.id,
    },
  });

  const admComm = await db.classificationNode.upsert({
    where: { code: "ADM-003" },
    update: {},
    create: {
      code: "ADM-003",
      title: "Committee Records",
      description: "Committee meeting minutes and reports",
      level: 2,
      parentId: admNode.id,
    },
  });

  // FIN — Finance
  const finPay = await db.classificationNode.upsert({
    where: { code: "FIN-PAY" },
    update: {},
    create: {
      code: "FIN-PAY",
      title: "Payments & Vouchers",
      description: "Payment processing, vouchers, and imprest",
      level: 2,
      parentId: finNode.id,
    },
  });

  const finBud = await db.classificationNode.upsert({
    where: { code: "FIN-BUD" },
    update: {},
    create: {
      code: "FIN-BUD",
      title: "Budget & Planning",
      description: "Annual budgets, budget allocations, and revisions",
      level: 2,
      parentId: finNode.id,
    },
  });

  const finRevenue = await db.classificationNode.upsert({
    where: { code: "FIN-003" },
    update: {},
    create: {
      code: "FIN-003",
      title: "Revenue Collection",
      description: "Fees, income generation, and revenue records",
      level: 2,
      parentId: finNode.id,
    },
  });

  // Keep legacy numeric codes as aliases that also exist
  const finPay001 = await db.classificationNode.upsert({
    where: { code: "FIN-001" },
    update: { parentId: finNode.id },
    create: {
      code: "FIN-001",
      title: "Payments",
      description: "Payment processing and vouchers",
      level: 2,
      parentId: finNode.id,
    },
  });

  const finBudget002 = await db.classificationNode.upsert({
    where: { code: "FIN-002" },
    update: { parentId: finNode.id },
    create: {
      code: "FIN-002",
      title: "Budgets",
      description: "Annual budgets, budget allocations, and revisions",
      level: 2,
      parentId: finNode.id,
    },
  });

  // HR — Human Resources
  const hrStaff = await db.classificationNode.upsert({
    where: { code: "HR-STAFF" },
    update: {},
    create: {
      code: "HR-STAFF",
      title: "Staff Files",
      description: "Individual staff records and personal files",
      level: 2,
      parentId: hrNode.id,
    },
  });

  const hrRec = await db.classificationNode.upsert({
    where: { code: "HR-REC" },
    update: {},
    create: {
      code: "HR-REC",
      title: "Recruitment",
      description: "Job advertisements, applications, and interview records",
      level: 2,
      parentId: hrNode.id,
    },
  });

  const hrLeave = await db.classificationNode.upsert({
    where: { code: "HR-003" },
    update: {},
    create: {
      code: "HR-003",
      title: "Leave Management",
      description: "Leave applications, approvals, and balances",
      level: 2,
      parentId: hrNode.id,
    },
  });

  // Keep legacy numeric codes
  await db.classificationNode.upsert({
    where: { code: "HR-001" },
    update: { parentId: hrNode.id },
    create: {
      code: "HR-001",
      title: "Staff Files",
      description: "Individual staff records and files",
      level: 2,
      parentId: hrNode.id,
    },
  });

  await db.classificationNode.upsert({
    where: { code: "HR-002" },
    update: { parentId: hrNode.id },
    create: {
      code: "HR-002",
      title: "Recruitment",
      description: "Job advertisements, applications, and interviews",
      level: 2,
      parentId: hrNode.id,
    },
  });

  // STU — Student Records
  const stuAdm = await db.classificationNode.upsert({
    where: { code: "STU-ADM" },
    update: {},
    create: {
      code: "STU-ADM",
      title: "Admissions",
      description: "Student admissions and application records",
      level: 2,
      parentId: stuNode.id,
    },
  });

  const stuReg = await db.classificationNode.upsert({
    where: { code: "STU-REG" },
    update: {},
    create: {
      code: "STU-REG",
      title: "Registration",
      description: "Student registration and enrolment records",
      level: 2,
      parentId: stuNode.id,
    },
  });

  const stuDisc = await db.classificationNode.upsert({
    where: { code: "STU-DISC" },
    update: {},
    create: {
      code: "STU-DISC",
      title: "Disciplinary",
      description: "Student discipline cases and hearing records",
      level: 2,
      parentId: stuNode.id,
    },
  });

  // Legacy numeric STU codes
  const stuAdm001 = await db.classificationNode.upsert({
    where: { code: "STU-001" },
    update: { parentId: stuNode.id },
    create: {
      code: "STU-001",
      title: "Admissions",
      description: "Student admissions and applications",
      level: 2,
      parentId: stuNode.id,
    },
  });

  const stuExam = await db.classificationNode.upsert({
    where: { code: "STU-002" },
    update: { parentId: stuNode.id },
    create: {
      code: "STU-002",
      title: "Examinations",
      description: "Examination records, results, and transcripts",
      level: 2,
      parentId: stuNode.id,
    },
  });

  const stuGrad = await db.classificationNode.upsert({
    where: { code: "STU-003" },
    update: { parentId: stuNode.id },
    create: {
      code: "STU-003",
      title: "Graduation",
      description: "Graduation records, certificates, and convocation",
      level: 2,
      parentId: stuNode.id,
    },
  });

  // ICT — ICT Directorate
  const ictInf = await db.classificationNode.upsert({
    where: { code: "ICT-INF" },
    update: {},
    create: {
      code: "ICT-INF",
      title: "Infrastructure",
      description: "Network, servers, and hardware records",
      level: 2,
      parentId: ictNode.id,
    },
  });

  const ictSys = await db.classificationNode.upsert({
    where: { code: "ICT-SYS" },
    update: {},
    create: {
      code: "ICT-SYS",
      title: "Systems & Software",
      description: "Software licences, systems documentation, and SLAs",
      level: 2,
      parentId: ictNode.id,
    },
  });

  // Legacy numeric ICT codes
  const ictInfra = await db.classificationNode.upsert({
    where: { code: "ICT-001" },
    update: { parentId: ictNode.id },
    create: {
      code: "ICT-001",
      title: "Infrastructure",
      description: "Network, servers, and hardware records",
      level: 2,
      parentId: ictNode.id,
    },
  });

  const ictSystems = await db.classificationNode.upsert({
    where: { code: "ICT-002" },
    update: { parentId: ictNode.id },
    create: {
      code: "ICT-002",
      title: "Systems & Software",
      description: "Software licences, systems documentation, and SLAs",
      level: 2,
      parentId: ictNode.id,
    },
  });

  const ictSupport = await db.classificationNode.upsert({
    where: { code: "ICT-003" },
    update: { parentId: ictNode.id },
    create: {
      code: "ICT-003",
      title: "User Support",
      description: "Helpdesk tickets, user requests, and incident reports",
      level: 2,
      parentId: ictNode.id,
    },
  });

  // PROC — Procurement
  const procTen = await db.classificationNode.upsert({
    where: { code: "PROC-TEN" },
    update: {},
    create: {
      code: "PROC-TEN",
      title: "Tenders",
      description: "Tender documents, bid evaluations, and awards",
      level: 2,
      parentId: procNode.id,
    },
  });

  const procPo = await db.classificationNode.upsert({
    where: { code: "PROC-PO" },
    update: {},
    create: {
      code: "PROC-PO",
      title: "Purchase Orders",
      description: "Local purchase orders and requisitions",
      level: 2,
      parentId: procNode.id,
    },
  });

  // Legacy numeric PROC codes
  const procTender = await db.classificationNode.upsert({
    where: { code: "PROC-001" },
    update: { parentId: procNode.id },
    create: {
      code: "PROC-001",
      title: "Tenders",
      description: "Tender documents, bid evaluations, and awards",
      level: 2,
      parentId: procNode.id,
    },
  });

  const procContract = await db.classificationNode.upsert({
    where: { code: "PROC-002" },
    update: { parentId: procNode.id },
    create: {
      code: "PROC-002",
      title: "Contracts",
      description: "Supplier contracts and service-level agreements",
      level: 2,
      parentId: procNode.id,
    },
  });

  const procLpo = await db.classificationNode.upsert({
    where: { code: "PROC-003" },
    update: { parentId: procNode.id },
    create: {
      code: "PROC-003",
      title: "Purchase Orders",
      description: "Local purchase orders and requisitions",
      level: 2,
      parentId: procNode.id,
    },
  });

  // AUD — Internal Audit
  const audRep = await db.classificationNode.upsert({
    where: { code: "AUD-REP" },
    update: {},
    create: {
      code: "AUD-REP",
      title: "Audit Reports",
      description: "Internal and external audit reports and management letters",
      level: 2,
      parentId: audNode.id,
    },
  });

  // Legacy numeric AUD codes
  const audReports = await db.classificationNode.upsert({
    where: { code: "AUD-001" },
    update: { parentId: audNode.id },
    create: {
      code: "AUD-001",
      title: "Audit Reports",
      description: "Internal and external audit reports",
      level: 2,
      parentId: audNode.id,
    },
  });

  const audFindings = await db.classificationNode.upsert({
    where: { code: "AUD-002" },
    update: { parentId: audNode.id },
    create: {
      code: "AUD-002",
      title: "Audit Findings",
      description: "Audit findings, recommendations, and follow-ups",
      level: 2,
      parentId: audNode.id,
    },
  });

  const audRisk = await db.classificationNode.upsert({
    where: { code: "AUD-003" },
    update: { parentId: audNode.id },
    create: {
      code: "AUD-003",
      title: "Risk Assessment",
      description: "Risk registers and risk assessment records",
      level: 2,
      parentId: audNode.id,
    },
  });

  // LEG — Legal
  const legCon = await db.classificationNode.upsert({
    where: { code: "LEG-CON" },
    update: {},
    create: {
      code: "LEG-CON",
      title: "Contracts",
      description: "Legal contracts, memoranda of understanding, and agreements",
      level: 2,
      parentId: legalNode.id,
    },
  });

  const legLit = await db.classificationNode.upsert({
    where: { code: "LEG-LIT" },
    update: {},
    create: {
      code: "LEG-LIT",
      title: "Litigation",
      description: "Court cases, legal proceedings, and dispute records",
      level: 2,
      parentId: legalNode.id,
    },
  });

  // Legacy LEGAL-xxx codes (use the old L1 code "LEGAL" if it exists)
  const legacyLegalNode = await db.classificationNode.findUnique({
    where: { code: "LEGAL" },
  });
  const legalParentId = legacyLegalNode ? legacyLegalNode.id : legalNode.id;

  const legalContracts = await db.classificationNode.upsert({
    where: { code: "LEGAL-001" },
    update: { parentId: legalParentId },
    create: {
      code: "LEGAL-001",
      title: "Contracts & MOUs",
      description: "Legal contracts, memoranda of understanding, and agreements",
      level: 2,
      parentId: legalParentId,
    },
  });

  const legalLitigation = await db.classificationNode.upsert({
    where: { code: "LEGAL-002" },
    update: { parentId: legalParentId },
    create: {
      code: "LEGAL-002",
      title: "Litigation",
      description: "Court cases, legal proceedings, and dispute records",
      level: 2,
      parentId: legalParentId,
    },
  });

  const legalCompliance = await db.classificationNode.upsert({
    where: { code: "LEGAL-003" },
    update: { parentId: legalParentId },
    create: {
      code: "LEGAL-003",
      title: "Compliance",
      description: "Regulatory compliance, policies, and statutory returns",
      level: 2,
      parentId: legalParentId,
    },
  });

  // ACAD — Academic
  const acadCur = await db.classificationNode.upsert({
    where: { code: "ACAD-CUR" },
    update: {},
    create: {
      code: "ACAD-CUR",
      title: "Curriculum",
      description: "Programme curricula, course outlines, and syllabi",
      level: 2,
      parentId: acadNode.id,
    },
  });

  const acadExam = await db.classificationNode.upsert({
    where: { code: "ACAD-EXAM" },
    update: {},
    create: {
      code: "ACAD-EXAM",
      title: "Examinations",
      description: "Examination papers, moderation, and results processing",
      level: 2,
      parentId: acadNode.id,
    },
  });

  // LIB — Library Services
  const libAcq = await db.classificationNode.upsert({
    where: { code: "LIB-001" },
    update: { parentId: libNode.id },
    create: {
      code: "LIB-001",
      title: "Acquisitions",
      description: "Book and journal acquisitions and subscriptions",
      level: 2,
      parentId: libNode.id,
    },
  });

  const libCirc = await db.classificationNode.upsert({
    where: { code: "LIB-002" },
    update: { parentId: libNode.id },
    create: {
      code: "LIB-002",
      title: "Circulation",
      description: "Borrowing, returns, and overdue records",
      level: 2,
      parentId: libNode.id,
    },
  });

  const libEres = await db.classificationNode.upsert({
    where: { code: "LIB-003" },
    update: { parentId: libNode.id },
    create: {
      code: "LIB-003",
      title: "E-Resources",
      description: "Electronic databases, e-journals, and online resources",
      level: 2,
      parentId: libNode.id,
    },
  });

  // PLAN — Planning Office
  const planStrat = await db.classificationNode.upsert({
    where: { code: "PLAN-001" },
    update: { parentId: planNode.id },
    create: {
      code: "PLAN-001",
      title: "Strategic Plans",
      description: "University strategic plans, vision documents, and reviews",
      level: 2,
      parentId: planNode.id,
    },
  });

  const planData = await db.classificationNode.upsert({
    where: { code: "PLAN-002" },
    update: { parentId: planNode.id },
    create: {
      code: "PLAN-002",
      title: "Institutional Data",
      description: "Statistics, enrolment data, and performance reports",
      level: 2,
      parentId: planNode.id,
    },
  });

  const planDev = await db.classificationNode.upsert({
    where: { code: "PLAN-003" },
    update: { parentId: planNode.id },
    create: {
      code: "PLAN-003",
      title: "Development Projects",
      description: "Capital projects, donor-funded projects, and progress reports",
      level: 2,
      parentId: planNode.id,
    },
  });

  // EST — Estates
  const estMaint = await db.classificationNode.upsert({
    where: { code: "EST-001" },
    update: { parentId: estNode.id },
    create: {
      code: "EST-001",
      title: "Maintenance",
      description: "Building and grounds maintenance records",
      level: 2,
      parentId: estNode.id,
    },
  });

  const estProjects = await db.classificationNode.upsert({
    where: { code: "EST-002" },
    update: { parentId: estNode.id },
    create: {
      code: "EST-002",
      title: "Construction Projects",
      description: "Building projects, plans, and contractor records",
      level: 2,
      parentId: estNode.id,
    },
  });

  const estAssets = await db.classificationNode.upsert({
    where: { code: "EST-003" },
    update: { parentId: estNode.id },
    create: {
      code: "EST-003",
      title: "Asset Register",
      description: "University assets, equipment, and inventory",
      level: 2,
      parentId: estNode.id,
    },
  });

  // SEC — Security Services
  const secIncidents = await db.classificationNode.upsert({
    where: { code: "SEC-001" },
    update: { parentId: secNode.id },
    create: {
      code: "SEC-001",
      title: "Incident Reports",
      description: "Security incident reports and investigations",
      level: 2,
      parentId: secNode.id,
    },
  });

  const secAccess = await db.classificationNode.upsert({
    where: { code: "SEC-002" },
    update: { parentId: secNode.id },
    create: {
      code: "SEC-002",
      title: "Access Control",
      description: "Gate passes, visitor logs, and access records",
      level: 2,
      parentId: secNode.id,
    },
  });

  const secOps = await db.classificationNode.upsert({
    where: { code: "SEC-003" },
    update: { parentId: secNode.id },
    create: {
      code: "SEC-003",
      title: "Operations",
      description: "Patrol reports, duty rosters, and operational records",
      level: 2,
      parentId: secNode.id,
    },
  });

  // MED — Health Services
  const medPatient = await db.classificationNode.upsert({
    where: { code: "MED-001" },
    update: { parentId: medNode.id },
    create: {
      code: "MED-001",
      title: "Patient Records",
      description: "Student and staff medical records",
      level: 2,
      parentId: medNode.id,
    },
  });

  const medPharmacy = await db.classificationNode.upsert({
    where: { code: "MED-002" },
    update: { parentId: medNode.id },
    create: {
      code: "MED-002",
      title: "Pharmacy",
      description: "Drug dispensing records and stock management",
      level: 2,
      parentId: medNode.id,
    },
  });

  const medInsurance = await db.classificationNode.upsert({
    where: { code: "MED-003" },
    update: { parentId: medNode.id },
    create: {
      code: "MED-003",
      title: "Insurance Claims",
      description: "NHIF and insurance claim records",
      level: 2,
      parentId: medNode.id,
    },
  });

  // HOST — Hostels & Accommodation
  const hostAllocation = await db.classificationNode.upsert({
    where: { code: "HOST-001" },
    update: { parentId: hostNode.id },
    create: {
      code: "HOST-001",
      title: "Room Allocation",
      description: "Hostel room allocation and booking records",
      level: 2,
      parentId: hostNode.id,
    },
  });

  const hostMaint = await db.classificationNode.upsert({
    where: { code: "HOST-002" },
    update: { parentId: hostNode.id },
    create: {
      code: "HOST-002",
      title: "Hostel Maintenance",
      description: "Maintenance requests and repair records",
      level: 2,
      parentId: hostNode.id,
    },
  });

  const hostDiscipline = await db.classificationNode.upsert({
    where: { code: "HOST-003" },
    update: { parentId: hostNode.id },
    create: {
      code: "HOST-003",
      title: "Discipline",
      description: "Hostel discipline cases and incident reports",
      level: 2,
      parentId: hostNode.id,
    },
  });

  // TRANS — Transport
  const transFleet = await db.classificationNode.upsert({
    where: { code: "TRANS-001" },
    update: { parentId: transNode.id },
    create: {
      code: "TRANS-001",
      title: "Fleet Management",
      description: "Vehicle registration, insurance, and inspection records",
      level: 2,
      parentId: transNode.id,
    },
  });

  const transLog = await db.classificationNode.upsert({
    where: { code: "TRANS-002" },
    update: { parentId: transNode.id },
    create: {
      code: "TRANS-002",
      title: "Trip Logs",
      description: "Vehicle usage logs, fuel records, and trip authorisations",
      level: 2,
      parentId: transNode.id,
    },
  });

  const transMaint = await db.classificationNode.upsert({
    where: { code: "TRANS-003" },
    update: { parentId: transNode.id },
    create: {
      code: "TRANS-003",
      title: "Vehicle Maintenance",
      description: "Service records, repairs, and spare parts",
      level: 2,
      parentId: transNode.id,
    },
  });

  // ------------------------------------------------------------------
  // Level 3: Transactions
  // ------------------------------------------------------------------

  // ADM Level 3
  await db.classificationNode.upsert({
    where: { code: "ADM-001-001" },
    update: {},
    create: {
      code: "ADM-001-001",
      title: "Internal Memos",
      description: "Internal memoranda between departments",
      level: 3,
      parentId: admCorr.id,
    },
  });

  await db.classificationNode.upsert({
    where: { code: "ADM-001-002" },
    update: {},
    create: {
      code: "ADM-001-002",
      title: "External Letters",
      description: "Incoming and outgoing external correspondence",
      level: 3,
      parentId: admCorr.id,
    },
  });

  await db.classificationNode.upsert({
    where: { code: "ADM-002-001" },
    update: {},
    create: {
      code: "ADM-002-001",
      title: "Council Minutes",
      description: "University Council meeting minutes and resolutions",
      level: 3,
      parentId: admGov.id,
    },
  });

  await db.classificationNode.upsert({
    where: { code: "ADM-002-002" },
    update: {},
    create: {
      code: "ADM-002-002",
      title: "Senate Minutes",
      description: "University Senate meeting minutes and resolutions",
      level: 3,
      parentId: admGov.id,
    },
  });

  await db.classificationNode.upsert({
    where: { code: "ADM-003-001" },
    update: {},
    create: {
      code: "ADM-003-001",
      title: "Committee Minutes",
      description: "Standing and ad-hoc committee meeting minutes",
      level: 3,
      parentId: admComm.id,
    },
  });

  // FIN Level 3
  await db.classificationNode.upsert({
    where: { code: "FIN-001-001" },
    update: {},
    create: {
      code: "FIN-001-001",
      title: "Payment Vouchers",
      description: "Payment voucher records",
      level: 3,
      parentId: finPay001.id,
    },
  });

  await db.classificationNode.upsert({
    where: { code: "FIN-001-002" },
    update: {},
    create: {
      code: "FIN-001-002",
      title: "Imprest Records",
      description: "Imprest applications, surrenders, and tracking",
      level: 3,
      parentId: finPay001.id,
    },
  });

  await db.classificationNode.upsert({
    where: { code: "FIN-002-001" },
    update: {},
    create: {
      code: "FIN-002-001",
      title: "Annual Budget",
      description: "Approved annual budget documents",
      level: 3,
      parentId: finBudget002.id,
    },
  });

  await db.classificationNode.upsert({
    where: { code: "FIN-003-001" },
    update: {},
    create: {
      code: "FIN-003-001",
      title: "Fee Collection",
      description: "Student fee collection and receipt records",
      level: 3,
      parentId: finRevenue.id,
    },
  });

  // STU Level 3
  await db.classificationNode.upsert({
    where: { code: "STU-001-001" },
    update: {},
    create: {
      code: "STU-001-001",
      title: "Application Files",
      description: "Student application and enrollment files",
      level: 3,
      parentId: stuAdm001.id,
    },
  });

  await db.classificationNode.upsert({
    where: { code: "STU-001-002" },
    update: {},
    create: {
      code: "STU-001-002",
      title: "Admission Letters",
      description: "Offer and admission letters",
      level: 3,
      parentId: stuAdm001.id,
    },
  });

  await db.classificationNode.upsert({
    where: { code: "STU-002-001" },
    update: {},
    create: {
      code: "STU-002-001",
      title: "Exam Papers",
      description: "Past and current examination papers",
      level: 3,
      parentId: stuExam.id,
    },
  });

  await db.classificationNode.upsert({
    where: { code: "STU-002-002" },
    update: {},
    create: {
      code: "STU-002-002",
      title: "Result Slips",
      description: "Student examination result slips and transcripts",
      level: 3,
      parentId: stuExam.id,
    },
  });

  await db.classificationNode.upsert({
    where: { code: "STU-003-001" },
    update: {},
    create: {
      code: "STU-003-001",
      title: "Certificates",
      description: "Degree certificates and diploma records",
      level: 3,
      parentId: stuGrad.id,
    },
  });

  // HR Level 3
  await db.classificationNode.upsert({
    where: { code: "HR-001-001" },
    update: {},
    create: {
      code: "HR-001-001",
      title: "Personal Files",
      description: "Individual staff personal files and documents",
      level: 3,
      parentId: hrStaff.id,
    },
  });

  await db.classificationNode.upsert({
    where: { code: "HR-002-001" },
    update: {},
    create: {
      code: "HR-002-001",
      title: "Job Advertisements",
      description: "Vacancy advertisements and job descriptions",
      level: 3,
      parentId: hrRec.id,
    },
  });

  await db.classificationNode.upsert({
    where: { code: "HR-003-001" },
    update: {},
    create: {
      code: "HR-003-001",
      title: "Leave Applications",
      description: "Staff leave application forms and approvals",
      level: 3,
      parentId: hrLeave.id,
    },
  });

  // ICT Level 3
  await db.classificationNode.upsert({
    where: { code: "ICT-001-001" },
    update: {},
    create: {
      code: "ICT-001-001",
      title: "Network Diagrams",
      description: "Network topology and infrastructure diagrams",
      level: 3,
      parentId: ictInfra.id,
    },
  });

  await db.classificationNode.upsert({
    where: { code: "ICT-002-001" },
    update: {},
    create: {
      code: "ICT-002-001",
      title: "Software Licences",
      description: "Software licence certificates and renewal records",
      level: 3,
      parentId: ictSystems.id,
    },
  });

  await db.classificationNode.upsert({
    where: { code: "ICT-003-001" },
    update: {},
    create: {
      code: "ICT-003-001",
      title: "Support Tickets",
      description: "Helpdesk ticket logs and resolution records",
      level: 3,
      parentId: ictSupport.id,
    },
  });

  // LIB Level 3
  await db.classificationNode.upsert({
    where: { code: "LIB-001-001" },
    update: {},
    create: {
      code: "LIB-001-001",
      title: "Purchase Requests",
      description: "Book and journal purchase requests and orders",
      level: 3,
      parentId: libAcq.id,
    },
  });

  await db.classificationNode.upsert({
    where: { code: "LIB-002-001" },
    update: {},
    create: {
      code: "LIB-002-001",
      title: "Borrowing Records",
      description: "Library item borrowing and return records",
      level: 3,
      parentId: libCirc.id,
    },
  });

  await db.classificationNode.upsert({
    where: { code: "LIB-003-001" },
    update: {},
    create: {
      code: "LIB-003-001",
      title: "Database Subscriptions",
      description: "E-resource subscription agreements and usage reports",
      level: 3,
      parentId: libEres.id,
    },
  });

  // PROC Level 3
  await db.classificationNode.upsert({
    where: { code: "PROC-001-001" },
    update: {},
    create: {
      code: "PROC-001-001",
      title: "Tender Documents",
      description: "Tender notices, bid documents, and evaluation reports",
      level: 3,
      parentId: procTender.id,
    },
  });

  await db.classificationNode.upsert({
    where: { code: "PROC-002-001" },
    update: {},
    create: {
      code: "PROC-002-001",
      title: "Supplier Contracts",
      description: "Signed supplier contracts and amendments",
      level: 3,
      parentId: procContract.id,
    },
  });

  await db.classificationNode.upsert({
    where: { code: "PROC-003-001" },
    update: {},
    create: {
      code: "PROC-003-001",
      title: "LPO Records",
      description: "Local purchase order forms and delivery notes",
      level: 3,
      parentId: procLpo.id,
    },
  });

  // LEGAL Level 3
  await db.classificationNode.upsert({
    where: { code: "LEGAL-001-001" },
    update: {},
    create: {
      code: "LEGAL-001-001",
      title: "MOU Records",
      description: "Signed memoranda of understanding with partners",
      level: 3,
      parentId: legalContracts.id,
    },
  });

  await db.classificationNode.upsert({
    where: { code: "LEGAL-002-001" },
    update: {},
    create: {
      code: "LEGAL-002-001",
      title: "Court Files",
      description: "Active and closed court case files",
      level: 3,
      parentId: legalLitigation.id,
    },
  });

  await db.classificationNode.upsert({
    where: { code: "LEGAL-003-001" },
    update: {},
    create: {
      code: "LEGAL-003-001",
      title: "Statutory Returns",
      description: "Regulatory filings and statutory compliance returns",
      level: 3,
      parentId: legalCompliance.id,
    },
  });

  // AUD Level 3
  await db.classificationNode.upsert({
    where: { code: "AUD-001-001" },
    update: {},
    create: {
      code: "AUD-001-001",
      title: "Internal Audit Reports",
      description: "Completed internal audit reports and management letters",
      level: 3,
      parentId: audReports.id,
    },
  });

  await db.classificationNode.upsert({
    where: { code: "AUD-002-001" },
    update: {},
    create: {
      code: "AUD-002-001",
      title: "Action Plans",
      description: "Audit finding action plans and implementation tracking",
      level: 3,
      parentId: audFindings.id,
    },
  });

  await db.classificationNode.upsert({
    where: { code: "AUD-003-001" },
    update: {},
    create: {
      code: "AUD-003-001",
      title: "Risk Registers",
      description: "Departmental and institutional risk registers",
      level: 3,
      parentId: audRisk.id,
    },
  });

  // PLAN Level 3
  await db.classificationNode.upsert({
    where: { code: "PLAN-001-001" },
    update: {},
    create: {
      code: "PLAN-001-001",
      title: "Strategic Plan Documents",
      description: "Approved university strategic plan documents",
      level: 3,
      parentId: planStrat.id,
    },
  });

  await db.classificationNode.upsert({
    where: { code: "PLAN-002-001" },
    update: {},
    create: {
      code: "PLAN-002-001",
      title: "Enrolment Statistics",
      description: "Student enrolment data and trend analysis",
      level: 3,
      parentId: planData.id,
    },
  });

  await db.classificationNode.upsert({
    where: { code: "PLAN-003-001" },
    update: {},
    create: {
      code: "PLAN-003-001",
      title: "Project Reports",
      description: "Capital and donor project progress reports",
      level: 3,
      parentId: planDev.id,
    },
  });

  // EST Level 3
  await db.classificationNode.upsert({
    where: { code: "EST-001-001" },
    update: {},
    create: {
      code: "EST-001-001",
      title: "Work Orders",
      description: "Maintenance work orders and completion reports",
      level: 3,
      parentId: estMaint.id,
    },
  });

  await db.classificationNode.upsert({
    where: { code: "EST-002-001" },
    update: {},
    create: {
      code: "EST-002-001",
      title: "Building Plans",
      description: "Architectural drawings, BOQs, and approval records",
      level: 3,
      parentId: estProjects.id,
    },
  });

  await db.classificationNode.upsert({
    where: { code: "EST-003-001" },
    update: {},
    create: {
      code: "EST-003-001",
      title: "Asset Tags",
      description: "Asset tagging records and verification reports",
      level: 3,
      parentId: estAssets.id,
    },
  });

  // SEC Level 3
  await db.classificationNode.upsert({
    where: { code: "SEC-001-001" },
    update: {},
    create: {
      code: "SEC-001-001",
      title: "Security Incident Files",
      description: "Individual security incident investigation files",
      level: 3,
      parentId: secIncidents.id,
    },
  });

  await db.classificationNode.upsert({
    where: { code: "SEC-002-001" },
    update: {},
    create: {
      code: "SEC-002-001",
      title: "Visitor Logs",
      description: "Daily visitor registration and sign-out records",
      level: 3,
      parentId: secAccess.id,
    },
  });

  await db.classificationNode.upsert({
    where: { code: "SEC-003-001" },
    update: {},
    create: {
      code: "SEC-003-001",
      title: "Patrol Reports",
      description: "Daily and nightly patrol reports",
      level: 3,
      parentId: secOps.id,
    },
  });

  // MED Level 3
  await db.classificationNode.upsert({
    where: { code: "MED-001-001" },
    update: {},
    create: {
      code: "MED-001-001",
      title: "Consultation Records",
      description: "Patient consultation and treatment records",
      level: 3,
      parentId: medPatient.id,
    },
  });

  await db.classificationNode.upsert({
    where: { code: "MED-002-001" },
    update: {},
    create: {
      code: "MED-002-001",
      title: "Drug Dispensing Logs",
      description: "Pharmacy dispensing records and stock movement",
      level: 3,
      parentId: medPharmacy.id,
    },
  });

  await db.classificationNode.upsert({
    where: { code: "MED-003-001" },
    update: {},
    create: {
      code: "MED-003-001",
      title: "NHIF Claims",
      description: "NHIF claim submissions and reimbursement records",
      level: 3,
      parentId: medInsurance.id,
    },
  });

  // HOST Level 3
  await db.classificationNode.upsert({
    where: { code: "HOST-001-001" },
    update: {},
    create: {
      code: "HOST-001-001",
      title: "Booking Records",
      description: "Student hostel booking and allocation records",
      level: 3,
      parentId: hostAllocation.id,
    },
  });

  await db.classificationNode.upsert({
    where: { code: "HOST-002-001" },
    update: {},
    create: {
      code: "HOST-002-001",
      title: "Repair Requests",
      description: "Hostel repair and maintenance request records",
      level: 3,
      parentId: hostMaint.id,
    },
  });

  await db.classificationNode.upsert({
    where: { code: "HOST-003-001" },
    update: {},
    create: {
      code: "HOST-003-001",
      title: "Discipline Cases",
      description: "Student hostel discipline case files",
      level: 3,
      parentId: hostDiscipline.id,
    },
  });

  // TRANS Level 3
  await db.classificationNode.upsert({
    where: { code: "TRANS-001-001" },
    update: {},
    create: {
      code: "TRANS-001-001",
      title: "Vehicle Records",
      description: "Individual vehicle registration and insurance files",
      level: 3,
      parentId: transFleet.id,
    },
  });

  await db.classificationNode.upsert({
    where: { code: "TRANS-002-001" },
    update: {},
    create: {
      code: "TRANS-002-001",
      title: "Trip Authorisations",
      description: "Vehicle trip authorisation forms and fuel requests",
      level: 3,
      parentId: transLog.id,
    },
  });

  await db.classificationNode.upsert({
    where: { code: "TRANS-003-001" },
    update: {},
    create: {
      code: "TRANS-003-001",
      title: "Service Records",
      description: "Vehicle service and repair records",
      level: 3,
      parentId: transMaint.id,
    },
  });

  console.log(
    "  Classification nodes created (16 L1 functions, ~40 L2 activities, ~30 L3 transactions)"
  );

  // ===================================================================
  // 5. RETENTION SCHEDULES
  // ===================================================================

  const retentionData = [
    {
      nodeCode: "ADM-001",
      nodeId: admCorr.id,
      activeYears: 2,
      inactiveYears: 5,
      totalYears: 7,
      disposalAction: "DESTROY" as const,
      legalBasis: "Records Management Act, Section 12",
    },
    {
      nodeCode: "ADM-002",
      nodeId: admGov.id,
      activeYears: 5,
      inactiveYears: 25,
      totalYears: 30,
      disposalAction: "ARCHIVE_PERMANENT" as const,
      legalBasis: "Universities Act, Section 35; Kenya National Archives Act",
    },
    {
      nodeCode: "ADM-003",
      nodeId: admComm.id,
      activeYears: 2,
      inactiveYears: 8,
      totalYears: 10,
      disposalAction: "REVIEW" as const,
      legalBasis: "Records Management Act, Section 12",
    },
    {
      nodeCode: "FIN-001",
      nodeId: finPay001.id,
      activeYears: 5,
      inactiveYears: 5,
      totalYears: 10,
      disposalAction: "DESTROY" as const,
      legalBasis: "Public Finance Management Act, Section 68",
    },
    {
      nodeCode: "FIN-002",
      nodeId: finBudget002.id,
      activeYears: 5,
      inactiveYears: 10,
      totalYears: 15,
      disposalAction: "ARCHIVE_PERMANENT" as const,
      legalBasis: "Public Finance Management Act, Section 68",
    },
    {
      nodeCode: "FIN-003",
      nodeId: finRevenue.id,
      activeYears: 3,
      inactiveYears: 7,
      totalYears: 10,
      disposalAction: "DESTROY" as const,
      legalBasis: "Public Finance Management Act, Section 68",
    },
    {
      nodeCode: "STU-001",
      nodeId: stuAdm001.id,
      activeYears: 5,
      inactiveYears: 25,
      totalYears: 30,
      disposalAction: "ARCHIVE_PERMANENT" as const,
      legalBasis: "Universities Act, Section 35",
    },
    {
      nodeCode: "STU-002",
      nodeId: stuExam.id,
      activeYears: 5,
      inactiveYears: 25,
      totalYears: 30,
      disposalAction: "ARCHIVE_PERMANENT" as const,
      legalBasis: "Universities Act, Section 35",
    },
    {
      nodeCode: "STU-003",
      nodeId: stuGrad.id,
      activeYears: 5,
      inactiveYears: 0,
      totalYears: 5,
      disposalAction: "ARCHIVE_PERMANENT" as const,
      legalBasis: "Universities Act, Section 35; Permanent preservation",
    },
    {
      nodeCode: "HR-STAFF",
      nodeId: hrStaff.id,
      activeYears: 0,
      inactiveYears: 10,
      totalYears: 10,
      disposalAction: "REVIEW" as const,
      legalBasis: "Employment Act, Section 10",
    },
    {
      nodeCode: "HR-REC",
      nodeId: hrRec.id,
      activeYears: 2,
      inactiveYears: 5,
      totalYears: 7,
      disposalAction: "DESTROY" as const,
      legalBasis: "Employment Act, Section 10",
    },
    {
      nodeCode: "HR-003",
      nodeId: hrLeave.id,
      activeYears: 1,
      inactiveYears: 4,
      totalYears: 5,
      disposalAction: "DESTROY" as const,
      legalBasis: "Employment Act, Section 10",
    },
    {
      nodeCode: "ICT-001",
      nodeId: ictInfra.id,
      activeYears: 3,
      inactiveYears: 5,
      totalYears: 8,
      disposalAction: "REVIEW" as const,
      legalBasis: "ICT Authority Guidelines",
    },
    {
      nodeCode: "ICT-002",
      nodeId: ictSystems.id,
      activeYears: 3,
      inactiveYears: 5,
      totalYears: 8,
      disposalAction: "REVIEW" as const,
      legalBasis: "ICT Authority Guidelines; Data Protection Act, 2019",
    },
    {
      nodeCode: "ICT-003",
      nodeId: ictSupport.id,
      activeYears: 1,
      inactiveYears: 2,
      totalYears: 3,
      disposalAction: "DESTROY" as const,
      legalBasis: "ICT Authority Guidelines",
    },
    {
      nodeCode: "LIB-001",
      nodeId: libAcq.id,
      activeYears: 2,
      inactiveYears: 5,
      totalYears: 7,
      disposalAction: "DESTROY" as const,
      legalBasis: "Records Management Act, Section 12",
    },
    {
      nodeCode: "LIB-002",
      nodeId: libCirc.id,
      activeYears: 1,
      inactiveYears: 2,
      totalYears: 3,
      disposalAction: "DESTROY" as const,
      legalBasis: "Records Management Act, Section 12",
    },
    {
      nodeCode: "LIB-003",
      nodeId: libEres.id,
      activeYears: 2,
      inactiveYears: 3,
      totalYears: 5,
      disposalAction: "DESTROY" as const,
      legalBasis: "Records Management Act, Section 12",
    },
    {
      nodeCode: "PROC-001",
      nodeId: procTender.id,
      activeYears: 5,
      inactiveYears: 7,
      totalYears: 12,
      disposalAction: "DESTROY" as const,
      legalBasis: "Public Procurement and Asset Disposal Act, 2015",
    },
    {
      nodeCode: "PROC-002",
      nodeId: procContract.id,
      activeYears: 5,
      inactiveYears: 7,
      totalYears: 12,
      disposalAction: "DESTROY" as const,
      legalBasis: "Public Procurement and Asset Disposal Act, 2015",
    },
    {
      nodeCode: "PROC-003",
      nodeId: procLpo.id,
      activeYears: 3,
      inactiveYears: 5,
      totalYears: 8,
      disposalAction: "DESTROY" as const,
      legalBasis: "Public Procurement and Asset Disposal Act, 2015",
    },
    {
      nodeCode: "LEGAL-001",
      nodeId: legalContracts.id,
      activeYears: 5,
      inactiveYears: 15,
      totalYears: 20,
      disposalAction: "REVIEW" as const,
      legalBasis: "Limitation of Actions Act; Contract Law",
    },
    {
      nodeCode: "LEGAL-002",
      nodeId: legalLitigation.id,
      activeYears: 5,
      inactiveYears: 15,
      totalYears: 20,
      disposalAction: "ARCHIVE_PERMANENT" as const,
      legalBasis: "Limitation of Actions Act; Evidence Act",
    },
    {
      nodeCode: "LEGAL-003",
      nodeId: legalCompliance.id,
      activeYears: 3,
      inactiveYears: 7,
      totalYears: 10,
      disposalAction: "REVIEW" as const,
      legalBasis: "Statutory Instruments Act",
    },
    {
      nodeCode: "AUD-001",
      nodeId: audReports.id,
      activeYears: 5,
      inactiveYears: 10,
      totalYears: 15,
      disposalAction: "ARCHIVE_PERMANENT" as const,
      legalBasis: "Public Audit Act, 2015",
    },
    {
      nodeCode: "AUD-002",
      nodeId: audFindings.id,
      activeYears: 3,
      inactiveYears: 7,
      totalYears: 10,
      disposalAction: "REVIEW" as const,
      legalBasis: "Public Audit Act, 2015",
    },
    {
      nodeCode: "AUD-003",
      nodeId: audRisk.id,
      activeYears: 3,
      inactiveYears: 7,
      totalYears: 10,
      disposalAction: "REVIEW" as const,
      legalBasis: "Public Audit Act, 2015; Risk Management Framework",
    },
    {
      nodeCode: "PLAN-001",
      nodeId: planStrat.id,
      activeYears: 5,
      inactiveYears: 10,
      totalYears: 15,
      disposalAction: "ARCHIVE_PERMANENT" as const,
      legalBasis: "Universities Act, Section 35",
    },
    {
      nodeCode: "PLAN-002",
      nodeId: planData.id,
      activeYears: 3,
      inactiveYears: 7,
      totalYears: 10,
      disposalAction: "REVIEW" as const,
      legalBasis: "Statistics Act; Data Protection Act, 2019",
    },
    {
      nodeCode: "PLAN-003",
      nodeId: planDev.id,
      activeYears: 5,
      inactiveYears: 10,
      totalYears: 15,
      disposalAction: "ARCHIVE_PERMANENT" as const,
      legalBasis: "Public Finance Management Act; Donor Agreements",
    },
    {
      nodeCode: "EST-001",
      nodeId: estMaint.id,
      activeYears: 2,
      inactiveYears: 5,
      totalYears: 7,
      disposalAction: "DESTROY" as const,
      legalBasis: "Records Management Act, Section 12",
    },
    {
      nodeCode: "EST-002",
      nodeId: estProjects.id,
      activeYears: 5,
      inactiveYears: 15,
      totalYears: 20,
      disposalAction: "ARCHIVE_PERMANENT" as const,
      legalBasis: "Physical and Land Planning Act; Building Code",
    },
    {
      nodeCode: "EST-003",
      nodeId: estAssets.id,
      activeYears: 5,
      inactiveYears: 10,
      totalYears: 15,
      disposalAction: "REVIEW" as const,
      legalBasis: "Public Procurement and Asset Disposal Act, 2015",
    },
    {
      nodeCode: "SEC-001",
      nodeId: secIncidents.id,
      activeYears: 2,
      inactiveYears: 5,
      totalYears: 7,
      disposalAction: "REVIEW" as const,
      legalBasis: "Occupational Safety and Health Act",
    },
    {
      nodeCode: "SEC-002",
      nodeId: secAccess.id,
      activeYears: 1,
      inactiveYears: 2,
      totalYears: 3,
      disposalAction: "DESTROY" as const,
      legalBasis: "Data Protection Act, 2019",
    },
    {
      nodeCode: "SEC-003",
      nodeId: secOps.id,
      activeYears: 1,
      inactiveYears: 2,
      totalYears: 3,
      disposalAction: "DESTROY" as const,
      legalBasis: "Records Management Act, Section 12",
    },
    {
      nodeCode: "MED-001",
      nodeId: medPatient.id,
      activeYears: 5,
      inactiveYears: 20,
      totalYears: 25,
      disposalAction: "ARCHIVE_PERMANENT" as const,
      legalBasis: "Health Act, 2017; Data Protection Act, 2019",
    },
    {
      nodeCode: "MED-002",
      nodeId: medPharmacy.id,
      activeYears: 3,
      inactiveYears: 5,
      totalYears: 8,
      disposalAction: "DESTROY" as const,
      legalBasis: "Pharmacy and Poisons Act",
    },
    {
      nodeCode: "MED-003",
      nodeId: medInsurance.id,
      activeYears: 3,
      inactiveYears: 5,
      totalYears: 8,
      disposalAction: "DESTROY" as const,
      legalBasis: "NHIF Act; Insurance Act",
    },
    {
      nodeCode: "HOST-001",
      nodeId: hostAllocation.id,
      activeYears: 1,
      inactiveYears: 2,
      totalYears: 3,
      disposalAction: "DESTROY" as const,
      legalBasis: "Records Management Act, Section 12",
    },
    {
      nodeCode: "HOST-002",
      nodeId: hostMaint.id,
      activeYears: 1,
      inactiveYears: 2,
      totalYears: 3,
      disposalAction: "DESTROY" as const,
      legalBasis: "Records Management Act, Section 12",
    },
    {
      nodeCode: "HOST-003",
      nodeId: hostDiscipline.id,
      activeYears: 2,
      inactiveYears: 5,
      totalYears: 7,
      disposalAction: "REVIEW" as const,
      legalBasis: "Universities Act, Section 35; Student Discipline Policy",
    },
    {
      nodeCode: "TRANS-001",
      nodeId: transFleet.id,
      activeYears: 3,
      inactiveYears: 5,
      totalYears: 8,
      disposalAction: "REVIEW" as const,
      legalBasis: "Traffic Act; Public Procurement and Asset Disposal Act, 2015",
    },
    {
      nodeCode: "TRANS-002",
      nodeId: transLog.id,
      activeYears: 1,
      inactiveYears: 2,
      totalYears: 3,
      disposalAction: "DESTROY" as const,
      legalBasis: "Records Management Act, Section 12",
    },
    {
      nodeCode: "TRANS-003",
      nodeId: transMaint.id,
      activeYears: 2,
      inactiveYears: 3,
      totalYears: 5,
      disposalAction: "DESTROY" as const,
      legalBasis: "Records Management Act, Section 12",
    },
  ];

  for (const ret of retentionData) {
    const existing = await db.retentionSchedule.findFirst({
      where: { classificationNodeId: ret.nodeId },
    });
    if (!existing) {
      await db.retentionSchedule.create({
        data: {
          classificationNodeId: ret.nodeId,
          activeYears: ret.activeYears,
          inactiveYears: ret.inactiveYears,
          totalYears: ret.totalYears,
          disposalAction: ret.disposalAction,
          legalBasis: ret.legalBasis,
        },
      });
    }
    console.log(
      `  Retention: ${ret.nodeCode} — ${ret.activeYears}+${ret.inactiveYears} years -> ${ret.disposalAction}`
    );
  }

  // ===================================================================
  // 6. WORKFLOW TEMPLATES
  // ===================================================================

  // 6a. Internal Memo Approval (existing)
  await db.workflowTemplate.upsert({
    where: { name: "Internal Memo Approval" },
    update: {},
    create: {
      name: "Internal Memo Approval",
      description:
        "Standard two-step approval flow for internal memoranda. The memo goes through a department head review and then final approval.",
      createdById: adminUser.id,
      isActive: true,
      version: 1,
      definition: {
        steps: [
          {
            index: 0,
            name: "Department Head Review",
            type: "approval",
            description: "Review and approve the internal memo",
          },
          {
            index: 1,
            name: "Final Approval",
            type: "approval",
            description: "Final sign-off before distribution",
          },
        ],
      },
    },
  });

  // 6b. Document Review (existing)
  await db.workflowTemplate.upsert({
    where: { name: "Document Review" },
    update: {},
    create: {
      name: "Document Review",
      description:
        "Three-step document review process: initial review, quality assurance, and sign-off.",
      createdById: adminUser.id,
      isActive: true,
      version: 1,
      definition: {
        steps: [
          {
            index: 0,
            name: "Initial Review",
            type: "review",
            description: "Initial content review by a subject matter expert",
          },
          {
            index: 1,
            name: "Quality Assurance",
            type: "review",
            description:
              "Quality and compliance review by the records management team",
          },
          {
            index: 2,
            name: "Sign-Off",
            type: "approval",
            description: "Final sign-off by the authorising officer",
          },
        ],
      },
    },
  });

  // 6c. Leave Application
  await db.workflowTemplate.upsert({
    where: { name: "Leave Application" },
    update: {},
    create: {
      name: "Leave Application",
      description:
        "Staff leave application workflow: HOD recommendation, HR verification, and final approval by the relevant Registrar.",
      createdById: adminUser.id,
      isActive: true,
      version: 1,
      definition: {
        steps: [
          {
            index: 0,
            name: "HOD Recommendation",
            type: "approval",
            assigneeRole: "HOD",
            description:
              "Head of Department reviews and recommends the leave application",
          },
          {
            index: 1,
            name: "HR Verification",
            type: "review",
            assigneeRole: "HR_OFFICER",
            description:
              "HR verifies leave balance, entitlement, and compliance with leave policy",
          },
          {
            index: 2,
            name: "Registrar Approval",
            type: "approval",
            assigneeRole: "REGISTRAR_PA",
            description:
              "Registrar (P&A) grants final approval for the leave",
          },
        ],
        formFields: [
          { name: "leaveType", label: "Leave Type", type: "select", options: ["Annual", "Sick", "Maternity", "Paternity", "Study", "Compassionate", "Sabbatical"], required: true },
          { name: "startDate", label: "Start Date", type: "date", required: true },
          { name: "endDate", label: "End Date", type: "date", required: true },
          { name: "daysRequested", label: "No. of Days", type: "number", required: true },
          { name: "reason", label: "Reason", type: "textarea", required: true },
          { name: "reliefOfficer", label: "Relief Officer", type: "text", required: false },
        ],
      },
    },
  });

  // 6d. Imprest Requisition & Surrender
  await db.workflowTemplate.upsert({
    where: { name: "Imprest Requisition & Surrender" },
    update: {},
    create: {
      name: "Imprest Requisition & Surrender",
      description:
        "Imprest request flow: HOD approval, Finance verification, DVC (PFA) approval for amounts above threshold, and surrender/reconciliation after travel.",
      createdById: adminUser.id,
      isActive: true,
      version: 1,
      definition: {
        steps: [
          {
            index: 0,
            name: "HOD Approval",
            type: "approval",
            assigneeRole: "HOD",
            description:
              "Head of Department verifies the purpose and approves the imprest request",
          },
          {
            index: 1,
            name: "Finance Verification",
            type: "review",
            assigneeRole: "FINANCE_OFFICER",
            description:
              "Finance verifies budget availability and checks outstanding imprest balances",
          },
          {
            index: 2,
            name: "DVC (PFA) Approval",
            type: "approval",
            assigneeRole: "DVC_PFA",
            description:
              "DVC (PFA) approves imprest requests (required for amounts above KES 50,000)",
          },
          {
            index: 3,
            name: "Imprest Surrender",
            type: "review",
            assigneeRole: "FINANCE_OFFICER",
            description:
              "Finance receives and verifies the imprest surrender with receipts within 48 hours of return",
          },
        ],
        formFields: [
          { name: "purpose", label: "Purpose of Imprest", type: "textarea", required: true },
          { name: "amount", label: "Amount (KES)", type: "number", required: true },
          { name: "travelDestination", label: "Destination", type: "text", required: false },
          { name: "departureDate", label: "Departure Date", type: "date", required: true },
          { name: "returnDate", label: "Return Date", type: "date", required: true },
          { name: "budgetLine", label: "Budget Line/Vote", type: "text", required: true },
        ],
      },
    },
  });

  // 6e. E-File Requisition
  await db.workflowTemplate.upsert({
    where: { name: "E-File Requisition" },
    update: {},
    create: {
      name: "E-File Requisition",
      description:
        "Request to open a new electronic file or retrieve an existing physical file. Registry processes and tracks the request.",
      createdById: adminUser.id,
      isActive: true,
      version: 1,
      definition: {
        steps: [
          {
            index: 0,
            name: "Request Submission",
            type: "review",
            assigneeRole: "RECORDS_OFFICER",
            description:
              "Registry receives and reviews the file requisition request",
          },
          {
            index: 1,
            name: "File Retrieval / Creation",
            type: "review",
            assigneeRole: "RECORDS_OFFICER",
            description:
              "Registry locates the physical file or creates a new e-file and updates the tracking system",
          },
          {
            index: 2,
            name: "Dispatch Confirmation",
            type: "approval",
            assigneeRole: "RECORDS_OFFICER",
            description:
              "Registry confirms dispatch of the file to the requesting department",
          },
        ],
        formFields: [
          { name: "requestType", label: "Request Type", type: "select", options: ["New File", "Retrieve Existing File", "File Transfer"], required: true },
          { name: "fileReference", label: "File Reference (if existing)", type: "text", required: false },
          { name: "fileTitle", label: "File Title / Subject", type: "text", required: true },
          { name: "classificationCode", label: "Classification Code", type: "text", required: false },
          { name: "urgency", label: "Urgency", type: "select", options: ["Normal", "Urgent", "Very Urgent"], required: true },
          { name: "reason", label: "Reason for Request", type: "textarea", required: true },
        ],
      },
    },
  });

  // 6f. User & Domain Rights Request
  await db.workflowTemplate.upsert({
    where: { name: "User & Domain Rights Request" },
    update: {},
    create: {
      name: "User & Domain Rights Request",
      description:
        "ICT service request for user account creation, password resets, domain access, email setup, or system access rights changes.",
      createdById: adminUser.id,
      isActive: true,
      version: 1,
      definition: {
        steps: [
          {
            index: 0,
            name: "HOD Authorisation",
            type: "approval",
            assigneeRole: "HOD",
            description:
              "Head of Department authorises the ICT access request for the staff member",
          },
          {
            index: 1,
            name: "ICT Review & Implementation",
            type: "review",
            assigneeRole: "ICT_OFFICER",
            description:
              "ICT officer reviews the request, creates/modifies the account, and configures access rights",
          },
          {
            index: 2,
            name: "ICT Director Sign-Off",
            type: "approval",
            assigneeRole: "DIRECTOR",
            description:
              "Director ICT approves elevated access requests (admin rights, VPN, server access)",
          },
        ],
        formFields: [
          { name: "requestType", label: "Request Type", type: "select", options: ["New Account", "Password Reset", "Access Rights Change", "Email Setup", "VPN Access", "System Deactivation"], required: true },
          { name: "staffName", label: "Staff Name", type: "text", required: true },
          { name: "staffId", label: "Staff/Employee ID", type: "text", required: true },
          { name: "department", label: "Department", type: "text", required: true },
          { name: "systemsRequired", label: "Systems/Services Required", type: "textarea", required: true },
          { name: "justification", label: "Business Justification", type: "textarea", required: true },
          { name: "accessLevel", label: "Access Level", type: "select", options: ["Basic User", "Power User", "Administrator"], required: true },
        ],
      },
    },
  });

  console.log(
    "  Workflow templates: Internal Memo Approval, Document Review, Leave Application, Imprest Requisition & Surrender, E-File Requisition, User & Domain Rights Request"
  );

  // ===================================================================
  // DONE
  // ===================================================================

  console.log("\nSeed complete!");
  console.log("  Roles:          " + Object.keys(createdRoles).length);
  console.log("  Users:          " + (sampleUsers.length + 1) + " (including admin)");
  console.log("  Workflows:      6 templates");
  console.log("  Classifications: 16 L1 + ~40 L2 + ~30 L3 nodes");
  console.log("  Retention:      " + retentionData.length + " schedules");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
