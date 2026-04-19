/**
 * Centralized department code registry for Karatina University EDRMS.
 *
 * Each department has:
 *  - `code`     – short code for document reference numbers (e.g., DOC-2026-FIN-000001)
 *  - `memoCode` – university-style code for memo references (e.g., KarU/Fin/3)
 *  - `office`   – formal office title used in memo headers
 */

export interface DepartmentInfo {
  code: string;
  memoCode: string;
  office: string;
}

/**
 * Maps the department name (as stored in the User model) to its standard codes
 * and office title.  Keep this in sync with `prisma/seed.ts` user departments.
 */
export const DEPARTMENT_REGISTRY: Record<string, DepartmentInfo> = {
  // ── Executive ──────────────────────────────────────────────
  "Vice Chancellor's Office": {
    code: "VC",
    memoCode: "VC",
    office: "OFFICE OF THE VICE CHANCELLOR",
  },
  "DVC (Planning, Finance & Administration)": {
    code: "DVC-PFA",
    memoCode: "DVC.PFA",
    office: "OFFICE OF THE DEPUTY VICE CHANCELLOR (PLANNING, FINANCE & ADMINISTRATION)",
  },
  "DVC (Academic, Research & Student Affairs)": {
    code: "DVC-ARSA",
    memoCode: "DVC.ARSA",
    office: "OFFICE OF THE DEPUTY VICE CHANCELLOR (ACADEMIC, RESEARCH & STUDENT AFFAIRS)",
  },

  // ── Registrar ──────────────────────────────────────────────
  "Registrar (Planning & Administration)": {
    code: "RG-PA",
    memoCode: "Rg.PA",
    office: "OFFICE OF THE REGISTRAR (PLANNING & ADMINISTRATION)",
  },
  "Registrar (Academic & Student Affairs)": {
    code: "RG-ASA",
    memoCode: "Rg.ASA",
    office: "OFFICE OF THE REGISTRAR (ACADEMIC & STUDENT AFFAIRS)",
  },

  // ── Schools ────────────────────────────────────────────────
  "School of Pure and Applied Sciences": {
    code: "SPAS",
    memoCode: "SPAS",
    office: "SCHOOL OF PURE AND APPLIED SCIENCES",
  },
  "School of Business": {
    code: "SB",
    memoCode: "SB",
    office: "SCHOOL OF BUSINESS",
  },
  "School of Education and Social Sciences": {
    code: "SESS",
    memoCode: "SESS",
    office: "SCHOOL OF EDUCATION AND SOCIAL SCIENCES",
  },
  "School of Agriculture and Biotechnology": {
    code: "SAB",
    memoCode: "SAB",
    office: "SCHOOL OF AGRICULTURE AND BIOTECHNOLOGY",
  },
  "School of Natural Resources and Environmental Studies": {
    code: "SNRES",
    memoCode: "SNRES",
    office: "SCHOOL OF NATURAL RESOURCES AND ENVIRONMENTAL STUDIES",
  },
  "School of Nursing and Public Health": {
    code: "SNPH",
    memoCode: "SNPH",
    office: "SCHOOL OF NURSING AND PUBLIC HEALTH",
  },

  // ── Directorates ───────────────────────────────────────────
  "ICT Directorate": {
    code: "ICT",
    memoCode: "ICT",
    office: "DIRECTORATE OF ICT",
  },
  "Directorate of Quality Assurance and ISO": {
    code: "DQAI",
    memoCode: "DQAI",
    office: "DIRECTORATE OF QUALITY ASSURANCE AND ISO",
  },
  "Directorate of Research, Innovation and Extension": {
    code: "DRIE",
    memoCode: "DRIE",
    office: "DIRECTORATE OF RESEARCH, INNOVATION AND EXTENSION",
  },
  "Directorate of Resource Mobilization": {
    code: "DRM",
    memoCode: "DRM",
    office: "DIRECTORATE OF RESOURCE MOBILIZATION",
  },
  "Directorate of Open, Distance and E-Learning": {
    code: "ODEL",
    memoCode: "ODEL",
    office: "DIRECTORATE OF OPEN, DISTANCE AND E-LEARNING",
  },
  "Directorate of Career Services and University-Industry Linkage": {
    code: "DCSL",
    memoCode: "DCSL",
    office: "DIRECTORATE OF CAREER SERVICES AND UNIVERSITY-INDUSTRY LINKAGE",
  },
  "Directorate of Community Outreach": {
    code: "DCO",
    memoCode: "DCO",
    office: "DIRECTORATE OF COMMUNITY OUTREACH",
  },

  // ── Administrative Departments ─────────────────────────────
  "Finance Department": {
    code: "FIN",
    memoCode: "Fin",
    office: "OFFICE OF THE FINANCE OFFICER",
  },
  "Human Resource Department": {
    code: "HR",
    memoCode: "HR",
    office: "DIRECTORATE OF HUMAN RESOURCES",
  },
  "Procurement Department": {
    code: "PROC",
    memoCode: "Proc",
    office: "PROCUREMENT DEPARTMENT",
  },
  "Internal Audit": {
    code: "IA",
    memoCode: "IA",
    office: "INTERNAL AUDIT DEPARTMENT",
  },
  "Legal Office": {
    code: "LEG",
    memoCode: "Leg",
    office: "LEGAL OFFICE",
  },
  "Library Services": {
    code: "LIB",
    memoCode: "Lib",
    office: "LIBRARY SERVICES",
  },
  "Registry (Records)": {
    code: "REG",
    memoCode: "Reg",
    office: "REGISTRY (RECORDS)",
  },
  "Admissions Office": {
    code: "ADM",
    memoCode: "Adm",
    office: "ADMISSIONS OFFICE",
  },
  "Estates Department": {
    code: "EST",
    memoCode: "Est",
    office: "ESTATES DEPARTMENT",
  },
  "Security Services": {
    code: "SEC",
    memoCode: "Sec",
    office: "SECURITY SERVICES",
  },
  "Health Services": {
    code: "HLS",
    memoCode: "Hls",
    office: "HEALTH SERVICES",
  },
  "Planning Office": {
    code: "PLN",
    memoCode: "Pln",
    office: "PLANNING OFFICE",
  },
  "Hostels & Accommodation": {
    code: "HST",
    memoCode: "Hst",
    office: "HOSTELS & ACCOMMODATION",
  },
  Transport: {
    code: "TRN",
    memoCode: "Trn",
    office: "TRANSPORT DEPARTMENT",
  },

  // ── Academic Departments ───────────────────────────────────
  "Department of Computer Science": {
    code: "CS",
    memoCode: "CS",
    office: "DEPARTMENT OF COMPUTER SCIENCE",
  },
  "Department of Business Management": {
    code: "BM",
    memoCode: "BM",
    office: "DEPARTMENT OF BUSINESS MANAGEMENT",
  },
  "Department of Education": {
    code: "EDU",
    memoCode: "Edu",
    office: "DEPARTMENT OF EDUCATION",
  },

  // ── Legacy aliases (from memo page) ────────────────────────
  "Registrar (AA)": {
    code: "RG-ASA",
    memoCode: "Rg.AA",
    office: "OFFICE OF THE REGISTRAR (ACADEMIC AFFAIRS)",
  },
  "Vice Chancellor": {
    code: "VC",
    memoCode: "VC",
    office: "OFFICE OF THE VICE CHANCELLOR",
  },
  "Deputy Vice Chancellor (ARSA)": {
    code: "DVC-ARSA",
    memoCode: "DVC.ARSA",
    office: "OFFICE OF THE DEPUTY VICE CHANCELLOR (ACADEMIC, RESEARCH & STUDENT AFFAIRS)",
  },
  "Deputy Vice Chancellor (AFD)": {
    code: "DVC-PFA",
    memoCode: "DVC.PFA",
    office: "OFFICE OF THE DEPUTY VICE CHANCELLOR (PLANNING, FINANCE & ADMINISTRATION)",
  },
  Finance: {
    code: "FIN",
    memoCode: "Fin",
    office: "OFFICE OF THE FINANCE OFFICER",
  },
  ICT: {
    code: "ICT",
    memoCode: "ICT",
    office: "DIRECTORATE OF ICT",
  },
  "Human Resources": {
    code: "HR",
    memoCode: "HR",
    office: "DIRECTORATE OF HUMAN RESOURCES",
  },
};

/**
 * Resolve the standard department code for a given department name.
 * Falls back to a sanitised abbreviation if the department isn't in the registry.
 */
export function getDepartmentCode(department: string): string {
  const entry = DEPARTMENT_REGISTRY[department];
  if (entry) return entry.code;

  // Fallback: strip non-alphanumeric, take first 6 chars
  return (
    department
      .replace(/[^A-Z0-9]/gi, "")
      .slice(0, 6)
      .toUpperCase() || "GEN"
  );
}

/**
 * Resolve the university-style memo reference code for a department.
 * e.g., "Registrar (AA)" → "Rg.AA"
 */
export function getDepartmentMemoCode(department: string): string {
  const entry = DEPARTMENT_REGISTRY[department];
  if (entry) return entry.memoCode;

  // Fallback: use the standard code
  return getDepartmentCode(department);
}

/**
 * Resolve the formal office title for a given department name.
 * Falls back to "OFFICE OF THE <DEPARTMENT>" if not in the registry.
 */
export function getDepartmentOffice(department: string): string {
  const entry = DEPARTMENT_REGISTRY[department];
  if (entry) return entry.office;

  return `OFFICE OF THE ${department.toUpperCase()}`;
}

/**
 * Directorate → departments mapping. Used to scope analytics and access
 * for users in directorate-level leadership (DVC, Registrar, Director, Dean).
 * Keys are directorate codes; values are the department codes that belong to
 * each directorate.
 */
export const DIRECTORATE_REGISTRY: Record<string, string[]> = {
  DVC_PFA: [
    // Planning, Finance & Administration
    "FINANCE","HR","PROCUREMENT","PLANNING","ESTATES","SECURITY","TRANSPORT","REGISTRY","REGISTRAR_PA","DVC_PFA"
  ],
  DVC_ARSA: [
    // Academic, Research & Student Affairs
    "REGISTRAR_ARSA","ADMISSIONS","LIBRARY","HEALTH","DVC_ARSA",
    "SPAS","SB","SESS","SAB","SNRES","SNPH",
    "RIE","ODEL","CAREER","COMMUNITY_OUTREACH"
  ],
  ICT: ["ICT"],
  QUALITY_ASSURANCE: ["QUALITY_ASSURANCE","ISO"],
  RESOURCE_MOBILIZATION: ["RESOURCE_MOBILIZATION"],
  INTERNAL_AUDIT: ["INTERNAL_AUDIT"],
  LEGAL: ["LEGAL"],
};

/**
 * Return the directorate code a department belongs to, or null if unmapped.
 */
export function getDirectorateForDepartment(dept: string | null | undefined): string | null {
  if (!dept) return null;
  for (const [dir, members] of Object.entries(DIRECTORATE_REGISTRY)) {
    if (members.includes(dept)) return dir;
  }
  return null;
}

/**
 * Return every department code that belongs to a given directorate.
 */
export function getDepartmentsInDirectorate(directorate: string | null | undefined): string[] {
  if (!directorate) return [];
  return DIRECTORATE_REGISTRY[directorate] ?? [];
}
