import { db } from "@/lib/db";

/**
 * Compliance evidence dashboards.
 *
 * Lightweight, read-only summaries of what the EDRMS can show an
 * external auditor against three frameworks:
 *  - ISO 15489 (records management)
 *  - ISO 27001 (information security)
 *  - Kenya Data Protection Act, 2019 (DPA-KE)
 *
 * Each clause defines a small Prisma probe (count / existence check) and
 * returns a status. These are *evidence summaries*, NEVER certifications —
 * the UI must never claim "certified".
 *
 * If a probe throws (e.g. table missing during a partial migration), the
 * runner converts it to status "unknown" rather than crashing the page.
 */

export type ComplianceFramework = "ISO15489" | "ISO27001" | "DPA-KE";

export type ComplianceStatus =
  | "satisfied"
  | "partial"
  | "not_satisfied"
  | "unknown";

export interface ComplianceEvidence {
  status: ComplianceStatus;
  /** Count of supporting artefacts (audit rows, retention schedules, ...). */
  count: number;
  /** One-line summary of what the count means. */
  detail: string;
  /** Optional deep link to the admin page where evidence lives. */
  link?: string;
}

export interface ComplianceClause {
  id: string;
  framework: ComplianceFramework;
  title: string;
  description: string;
  evidenceQuery: () => Promise<ComplianceEvidence>;
}

export interface ResolvedClause {
  id: string;
  framework: ComplianceFramework;
  title: string;
  description: string;
  status: ComplianceStatus;
  count: number;
  detail: string;
  link?: string;
}

// ─── ISO 15489 — Records Management ──────────────────────────────────────────

const iso15489: ComplianceClause[] = [
  {
    id: "ISO15489-4.1",
    framework: "ISO15489",
    title: "Capture of records",
    description:
      "Records of business activities are captured into a managed system.",
    evidenceQuery: async () => {
      const count = await db.document.count();
      return {
        status: count > 0 ? "satisfied" : "not_satisfied",
        count,
        detail:
          count > 0
            ? `${count.toLocaleString()} document records captured.`
            : "No documents captured yet.",
        link: "/documents",
      };
    },
  },
  {
    id: "ISO15489-5.2",
    framework: "ISO15489",
    title: "Classification scheme",
    description:
      "A business classification (file plan) organises records by function.",
    evidenceQuery: async () => {
      const count = await db.classificationNode.count({ where: { isActive: true } });
      return {
        status: count > 0 ? "satisfied" : "partial",
        count,
        detail:
          count > 0
            ? `${count} active classification nodes defined.`
            : "No classification scheme defined.",
        link: "/records/classification",
      };
    },
  },
  {
    id: "ISO15489-5.3",
    framework: "ISO15489",
    title: "Retention schedules",
    description:
      "Records have documented retention periods and disposal actions.",
    evidenceQuery: async () => {
      const count = await db.retentionSchedule.count();
      return {
        status: count > 0 ? "satisfied" : "partial",
        count,
        detail:
          count > 0
            ? `${count} retention schedules in place.`
            : "No retention schedules defined.",
        link: "/records/retention",
      };
    },
  },
  {
    id: "ISO15489-5.4",
    framework: "ISO15489",
    title: "Disposition certificates",
    description:
      "Authorised disposal of records is documented with certificates.",
    evidenceQuery: async () => {
      const count = await db.dispositionCertificate.count();
      return {
        status: count > 0 ? "satisfied" : "partial",
        count,
        detail:
          count > 0
            ? `${count} disposition certificates issued.`
            : "No disposition certificates issued yet.",
        link: "/records/disposition",
      };
    },
  },
  {
    id: "ISO15489-6.1",
    framework: "ISO15489",
    title: "Audit trail of records actions",
    description:
      "All actions on records are recorded in an immutable audit log.",
    evidenceQuery: async () => {
      const count = await db.auditLog.count();
      let status: ComplianceStatus = "not_satisfied";
      if (count > 100) status = "satisfied";
      else if (count > 0) status = "partial";
      return {
        status,
        count,
        detail:
          count > 0
            ? `${count.toLocaleString()} audit log entries recorded.`
            : "Audit log is empty.",
        link: "/admin/audit",
      };
    },
  },
  {
    id: "ISO15489-6.2",
    framework: "ISO15489",
    title: "Version control",
    description:
      "Successive versions of records are retained for evidential value.",
    evidenceQuery: async () => {
      const count = await db.documentVersion.count();
      return {
        status: count > 0 ? "satisfied" : "partial",
        count,
        detail:
          count > 0
            ? `${count.toLocaleString()} document versions tracked.`
            : "No version history captured.",
        link: "/documents",
      };
    },
  },
  {
    id: "ISO15489-7.1",
    framework: "ISO15489",
    title: "Legal holds",
    description:
      "Records subject to litigation/investigation can be placed on hold.",
    evidenceQuery: async () => {
      const count = await db.document.count({ where: { isOnLegalHold: true } });
      return {
        status: "satisfied",
        count,
        detail:
          count > 0
            ? `${count} documents currently on legal hold.`
            : "Legal-hold capability available; none active.",
        link: "/records",
      };
    },
  },
  {
    id: "ISO15489-7.2",
    framework: "ISO15489",
    title: "Vital records identification",
    description:
      "Critical records are flagged as vital for continuity planning.",
    evidenceQuery: async () => {
      const count = await db.document.count({ where: { isVitalRecord: true } });
      return {
        status: count > 0 ? "satisfied" : "partial",
        count,
        detail:
          count > 0
            ? `${count} records flagged as vital.`
            : "No vital records identified yet.",
        link: "/records",
      };
    },
  },
];

// ─── ISO 27001 — Information Security ────────────────────────────────────────

const iso27001: ComplianceClause[] = [
  {
    id: "ISO27001-A.5.15",
    framework: "ISO27001",
    title: "Access control",
    description:
      "Granular role/permission scheme governs what users may do.",
    evidenceQuery: async () => {
      const count = await db.permission.count();
      return {
        status: count > 0 ? "satisfied" : "not_satisfied",
        count,
        detail:
          count > 0
            ? `${count} permissions assigned across roles.`
            : "No permissions defined.",
        link: "/admin/roles",
      };
    },
  },
  {
    id: "ISO27001-A.5.16",
    framework: "ISO27001",
    title: "User session management",
    description:
      "Active user sessions are tracked and can be revoked centrally.",
    evidenceQuery: async () => {
      const count = await db.userSession.count({ where: { revokedAt: null } });
      return {
        status: "satisfied",
        count,
        detail: `${count} active sessions currently tracked.`,
        link: "/admin/users",
      };
    },
  },
  {
    id: "ISO27001-A.5.17",
    framework: "ISO27001",
    title: "Multi-factor authentication",
    description:
      "MFA is available; uptake is measured per user.",
    evidenceQuery: async () => {
      const [enabled, total] = await Promise.all([
        db.user.count({ where: { mfaEnabled: true, isActive: true } }),
        db.user.count({ where: { isActive: true } }),
      ]);
      let status: ComplianceStatus = "not_satisfied";
      if (total === 0) status = "unknown";
      else if (enabled === total) status = "satisfied";
      else if (enabled > 0) status = "partial";
      return {
        status,
        count: enabled,
        detail:
          total > 0
            ? `${enabled} of ${total} active users have MFA enabled.`
            : "No active users to evaluate.",
        link: "/admin/users",
      };
    },
  },
  {
    id: "ISO27001-A.8.24",
    framework: "ISO27001",
    title: "Encryption at rest",
    description:
      "Secrets and sensitive uploads are encrypted with a managed key.",
    evidenceQuery: async () => {
      const hasKey = Boolean(process.env.ENCRYPTION_KEY);
      return {
        status: hasKey ? "satisfied" : "not_satisfied",
        count: hasKey ? 1 : 0,
        detail: hasKey
          ? "ENCRYPTION_KEY is set; AES-256-GCM available."
          : "ENCRYPTION_KEY environment variable is not set.",
      };
    },
  },
  {
    id: "ISO27001-A.8.15",
    framework: "ISO27001",
    title: "Tamper-evident audit log",
    description:
      "Audit log rows carry a hash chain so tampering can be detected.",
    evidenceQuery: async () => {
      const [hashed, total] = await Promise.all([
        db.auditLog.count({ where: { NOT: { hash: null } } }),
        db.auditLog.count(),
      ]);
      let status: ComplianceStatus = "unknown";
      if (total === 0) status = "unknown";
      else if (hashed === total) status = "satisfied";
      else if (hashed > 0) status = "partial";
      else status = "not_satisfied";
      return {
        status,
        count: hashed,
        detail:
          total > 0
            ? `${hashed.toLocaleString()} of ${total.toLocaleString()} audit rows carry a hash.`
            : "No audit rows recorded yet.",
        link: "/admin/audit-integrity",
      };
    },
  },
  {
    id: "ISO27001-A.5.10",
    framework: "ISO27001",
    title: "Failed-login monitoring",
    description:
      "Failed authentication attempts are logged for review.",
    evidenceQuery: async () => {
      const count = await db.loginAttempt.count({ where: { success: false } });
      return {
        status: "satisfied",
        count,
        detail: `${count.toLocaleString()} failed login attempts on record.`,
        link: "/admin/audit",
      };
    },
  },
  {
    id: "ISO27001-A.8.12",
    framework: "ISO27001",
    title: "Data classification",
    description:
      "Documents carry a security classification label (OPEN…TOP_SECRET).",
    evidenceQuery: async () => {
      const classified = await db.document.count({
        where: { NOT: { securityClassification: "OPEN" } },
      });
      const total = await db.document.count();
      let status: ComplianceStatus = "unknown";
      if (total === 0) status = "unknown";
      else if (classified > 0) status = "satisfied";
      else status = "partial";
      return {
        status,
        count: classified,
        detail:
          total > 0
            ? `${classified.toLocaleString()} of ${total.toLocaleString()} documents above OPEN.`
            : "No documents to classify yet.",
      };
    },
  },
  {
    id: "ISO27001-A.5.7",
    framework: "ISO27001",
    title: "API key management",
    description:
      "API keys are issued, scoped, and revocable; revocation is auditable.",
    evidenceQuery: async () => {
      const active = await db.apiKey.count({ where: { revokedAt: null } });
      return {
        status: "satisfied",
        count: active,
        detail: `${active} active API keys (revoked keys excluded).`,
        link: "/admin/api-docs",
      };
    },
  },
];

// ─── Kenya Data Protection Act, 2019 ─────────────────────────────────────────

const dpaKe: ComplianceClause[] = [
  {
    id: "DPA-KE-26",
    framework: "DPA-KE",
    title: "Data subject access requests (SAR)",
    description:
      "Section 26 — process to respond to data subject access requests.",
    evidenceQuery: async () => {
      return {
        status: "unknown",
        count: 0,
        detail: "No SAR register configured yet. Document the SAR workflow.",
        link: "/admin/dpa-sar",
      };
    },
  },
  {
    id: "DPA-KE-25",
    framework: "DPA-KE",
    title: "Data minimisation",
    description:
      "Section 25 — personal data not kept longer than necessary.",
    evidenceQuery: async () => {
      const overdue = await db.document.count({
        where: { retentionExpiresAt: { lt: new Date() } },
      });
      let status: ComplianceStatus = "satisfied";
      if (overdue > 0) status = "partial";
      return {
        status,
        count: overdue,
        detail:
          overdue > 0
            ? `${overdue} documents past their retention date — review for disposal.`
            : "No documents past retention.",
        link: "/records/disposition",
      };
    },
  },
  {
    id: "DPA-KE-32",
    framework: "DPA-KE",
    title: "Consent records",
    description:
      "Section 32 — explicit consent of data subjects is recorded.",
    evidenceQuery: async () => {
      let count = 0;
      try {
        const schema = await db.formDataSchema.findFirst({
          where: { slug: { in: ["consent", "consent_records", "dpa_consent"] } },
          select: { id: true },
        });
        if (schema) {
          count = await db.formDataEntry.count({ where: { schemaId: schema.id } });
        }
      } catch {
        // form-data table may be absent; fall through to unknown
      }
      return {
        status: count > 0 ? "satisfied" : "unknown",
        count,
        detail:
          count > 0
            ? `${count.toLocaleString()} consent records on file.`
            : "No consent register configured; capture consent via Form Data.",
        link: "/admin/form-data",
      };
    },
  },
  {
    id: "DPA-KE-30",
    framework: "DPA-KE",
    title: "Lawful basis documented",
    description:
      "Section 30 — lawful basis for processing is documented as policy.",
    evidenceQuery: async () => {
      const row = await db.appSetting.findUnique({
        where: { key: "dpa.lawful_basis" },
      });
      return {
        status: row ? "satisfied" : "not_satisfied",
        count: row ? 1 : 0,
        detail: row
          ? "Lawful basis policy recorded in app settings."
          : "Add 'dpa.lawful_basis' to app settings to record the basis.",
        link: "/admin/settings",
      };
    },
  },
  {
    id: "DPA-KE-43",
    framework: "DPA-KE",
    title: "Breach notification process",
    description:
      "Section 43 — process for notifying the ODPC and data subjects of breaches.",
    evidenceQuery: async () => {
      const row = await db.appSetting.findUnique({
        where: { key: "dpa.breach_process" },
      });
      return {
        status: row ? "satisfied" : "unknown",
        count: row ? 1 : 0,
        detail: row
          ? "Breach process documented in app settings."
          : "Document your breach-notification process (72-hour ODPC rule).",
        link: "/admin/settings",
      };
    },
  },
  {
    id: "DPA-KE-31",
    framework: "DPA-KE",
    title: "Restricted access to personal data",
    description:
      "Personal-data records are access-controlled (per-document ACLs).",
    evidenceQuery: async () => {
      const count = await db.documentAccessControl.count();
      return {
        status: count > 0 ? "satisfied" : "partial",
        count,
        detail:
          count > 0
            ? `${count.toLocaleString()} per-document access controls applied.`
            : "No per-document ACLs in place yet.",
      };
    },
  },
  {
    id: "DPA-KE-41",
    framework: "DPA-KE",
    title: "Cross-border transfer log",
    description:
      "Section 49 — record of transfers of personal data outside Kenya.",
    evidenceQuery: async () => {
      let count = 0;
      try {
        const schema = await db.formDataSchema.findFirst({
          where: { slug: { in: ["cross_border_transfers", "dpa_transfers"] } },
          select: { id: true },
        });
        if (schema) {
          count = await db.formDataEntry.count({ where: { schemaId: schema.id } });
        }
      } catch {
        // ignore
      }
      return {
        status: count > 0 ? "satisfied" : "unknown",
        count,
        detail:
          count > 0
            ? `${count} cross-border transfer records logged.`
            : "Create a 'cross_border_transfers' Form Data schema to log transfers.",
        link: "/admin/form-data",
      };
    },
  },
];

const ALL_CLAUSES: ComplianceClause[] = [...iso15489, ...iso27001, ...dpaKe];

export function getClauses(framework?: ComplianceFramework): ComplianceClause[] {
  if (!framework) return ALL_CLAUSES;
  return ALL_CLAUSES.filter((c) => c.framework === framework);
}

/**
 * Resolve a clause's evidence query. Errors are caught and surfaced as
 * status "unknown" so a missing table or migration mid-flight can't break
 * the dashboard.
 */
export async function resolveClause(
  clause: ComplianceClause,
): Promise<ResolvedClause> {
  try {
    const evidence = await clause.evidenceQuery();
    return {
      id: clause.id,
      framework: clause.framework,
      title: clause.title,
      description: clause.description,
      status: evidence.status,
      count: evidence.count,
      detail: evidence.detail,
      link: evidence.link,
    };
  } catch (err) {
    return {
      id: clause.id,
      framework: clause.framework,
      title: clause.title,
      description: clause.description,
      status: "unknown",
      count: 0,
      detail:
        err instanceof Error
          ? `Evidence query failed: ${err.message}`
          : "Evidence query failed.",
    };
  }
}

export async function resolveFramework(
  framework: ComplianceFramework,
): Promise<ResolvedClause[]> {
  const clauses = getClauses(framework);
  return Promise.all(clauses.map(resolveClause));
}

export async function resolveAll(): Promise<ResolvedClause[]> {
  return Promise.all(ALL_CLAUSES.map(resolveClause));
}

export const FRAMEWORK_LABELS: Record<ComplianceFramework, string> = {
  ISO15489: "ISO 15489",
  ISO27001: "ISO 27001",
  "DPA-KE": "Kenya DPA",
};
