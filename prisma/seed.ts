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
        // Full access to everything
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
    {
      name: "REGISTRY_OFFICER",
      description: "Registry staff who register and manage incoming documents",
      isSystem: false,
      permissions: [
        { resource: "documents", action: "create" },
        { resource: "documents", action: "read" },
        { resource: "documents", action: "update" },
        { resource: "records", action: "create" },
        { resource: "records", action: "read" },
        { resource: "records", action: "update" },
        { resource: "workflows", action: "create" },
        { resource: "workflows", action: "read" },
        { resource: "forms", action: "read" },
        { resource: "reports", action: "read" },
      ],
    },
    {
      name: "RECORDS_MANAGER",
      description:
        "Records management staff overseeing classification and retention",
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
      name: "APPROVER",
      description: "Can approve or reject workflow tasks",
      isSystem: false,
      permissions: [
        { resource: "documents", action: "read" },
        { resource: "workflows", action: "read" },
        { resource: "workflows", action: "approve" },
        { resource: "forms", action: "read" },
      ],
    },
    {
      name: "DEPARTMENT_HEAD",
      description: "Department head with approval and reporting access",
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
    {
      name: "VIEWER",
      description: "Read-only access to documents and records",
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

    console.log(`  Role: ${roleDef.name} (${roleDef.permissions.length} permissions)`);
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
    },
    create: {
      email: "admin@karu.ac.ke",
      name: "System Administrator",
      displayName: "System Administrator",
      password: adminPassword,
      department: "ICT",
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
  // 3. CLASSIFICATION NODES
  // ===================================================================

  // Level 1: Functions
  const admNode = await db.classificationNode.upsert({
    where: { code: "ADM" },
    update: {},
    create: {
      code: "ADM",
      title: "Administration",
      description: "Administrative correspondence and governance records",
      level: 1,
    },
  });

  const finNode = await db.classificationNode.upsert({
    where: { code: "FIN" },
    update: {},
    create: {
      code: "FIN",
      title: "Finance",
      description: "Financial records, payments, and budgets",
      level: 1,
    },
  });

  const stuNode = await db.classificationNode.upsert({
    where: { code: "STU" },
    update: {},
    create: {
      code: "STU",
      title: "Student Records",
      description: "Student academic and administrative records",
      level: 1,
    },
  });

  const hrNode = await db.classificationNode.upsert({
    where: { code: "HR" },
    update: {},
    create: {
      code: "HR",
      title: "Human Resources",
      description: "Staff records and HR management",
      level: 1,
    },
  });

  // Level 2: Activities
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

  const finPay = await db.classificationNode.upsert({
    where: { code: "FIN-001" },
    update: {},
    create: {
      code: "FIN-001",
      title: "Payments",
      description: "Payment processing and vouchers",
      level: 2,
      parentId: finNode.id,
    },
  });

  const stuAdm = await db.classificationNode.upsert({
    where: { code: "STU-001" },
    update: {},
    create: {
      code: "STU-001",
      title: "Admissions",
      description: "Student admissions and applications",
      level: 2,
      parentId: stuNode.id,
    },
  });

  const hrStaff = await db.classificationNode.upsert({
    where: { code: "HR-001" },
    update: {},
    create: {
      code: "HR-001",
      title: "Staff Files",
      description: "Individual staff records and files",
      level: 2,
      parentId: hrNode.id,
    },
  });

  // Level 3: Transactions
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
    where: { code: "FIN-001-001" },
    update: {},
    create: {
      code: "FIN-001-001",
      title: "Payment Vouchers",
      description: "Payment voucher records",
      level: 3,
      parentId: finPay.id,
    },
  });

  await db.classificationNode.upsert({
    where: { code: "STU-001-001" },
    update: {},
    create: {
      code: "STU-001-001",
      title: "Application Files",
      description: "Student application and enrollment files",
      level: 3,
      parentId: stuAdm.id,
    },
  });

  console.log("  Classification nodes created: ADM, FIN, STU, HR (3 levels)");

  // ===================================================================
  // 4. RETENTION SCHEDULES
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
      nodeCode: "FIN-001",
      nodeId: finPay.id,
      activeYears: 5,
      inactiveYears: 5,
      totalYears: 10,
      disposalAction: "DESTROY" as const,
      legalBasis: "Public Finance Management Act, Section 68",
    },
    {
      nodeCode: "STU-001",
      nodeId: stuAdm.id,
      activeYears: 5,
      inactiveYears: 25,
      totalYears: 30,
      disposalAction: "ARCHIVE_PERMANENT" as const,
      legalBasis: "Universities Act, Section 35",
    },
    {
      nodeCode: "HR-001",
      nodeId: hrStaff.id,
      activeYears: 0,
      inactiveYears: 10,
      totalYears: 10,
      disposalAction: "REVIEW" as const,
      legalBasis: "Employment Act, Section 10",
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
      `  Retention: ${ret.nodeCode} — ${ret.activeYears}+${ret.inactiveYears} years → ${ret.disposalAction}`
    );
  }

  // ===================================================================
  // 5. WORKFLOW TEMPLATES
  // ===================================================================

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

  console.log(
    "  Workflow templates: Internal Memo Approval, Document Review"
  );

  // ===================================================================
  // DONE
  // ===================================================================

  console.log("\nSeed complete!");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
