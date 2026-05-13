/**
 * Widget catalogue for the per-user customisable dashboard. The dashboard
 * stores `Widget[]` JSON on `DashboardLayout.widgets`. Each widget renders
 * a single tile against the shape returned by `/api/dashboard/data`.
 *
 * Adding a new widget type:
 *  1. Append an entry to `WIDGET_CATALOGUE` below.
 *  2. Wire its renderer into `components/widgets/index.tsx`.
 */

export interface WidgetType {
  /** Stable identifier persisted in DashboardLayout.widgets[].type */
  type: string;
  /** Human label shown in the "Add widget" catalogue modal */
  name: string;
  /** One-line description in the catalogue modal */
  description: string;
  /** Default {w,h} in grid cells when newly added. w<=12. */
  defaultSize: { w: number; h: number };
  /**
   * Names of fields on the DashboardData response this widget can render.
   * Used by the configurator to populate the "Source" dropdown.
   */
  dataKeys: string[];
}

/**
 * Live aggregate response shared by every widget. Mirrors the executive
 * /api/admin/reports/overview shape so widgets can use existing patterns.
 */
export interface DashboardData {
  sinceDays: number;
  /** ISO timestamps of the current window's bounds. */
  windowStart: string;
  windowEnd: string;
  totals: {
    documents: number;
    documentsCreatedInWindow: number;
    /** Same metric but for the *previous* window of equal length. */
    documentsCreatedPrevWindow: number;
    workflowsInProgress: number;
    tasksPending: number;
    tasksOverdue: number;
    myMemos: number;
    pendingMemos: number;
  };
  breakdowns: {
    byType: Breakdown[];
    byStatus: Breakdown[];
    byDepartment: Breakdown[];
    byClassification: Breakdown[];
  };
  topCreators: { userId: string; name: string; count: number }[];
  recentDocuments: {
    id: string;
    title: string;
    documentType: string;
    createdAt: string;
  }[];
}

export interface Breakdown {
  key: string;
  count: number;
}

/** Catalogue presented in the "+ Add widget" modal. */
export const WIDGET_CATALOGUE: WidgetType[] = [
  {
    type: "counter",
    name: "Counter",
    description: "A single large number — e.g. total documents.",
    defaultSize: { w: 3, h: 2 },
    dataKeys: [
      "totals.documents",
      "totals.documentsCreatedInWindow",
      "totals.workflowsInProgress",
      "totals.tasksPending",
      "totals.tasksOverdue",
      "totals.myMemos",
      "totals.pendingMemos",
    ],
  },
  {
    type: "kpi",
    name: "KPI with delta",
    description: "Counter plus an arrow comparing to the previous period.",
    defaultSize: { w: 3, h: 2 },
    // Only fields that *also* have a prev-window counterpart make sense.
    dataKeys: ["totals.documentsCreatedInWindow"],
  },
  {
    type: "bar",
    name: "Bar chart",
    description: "Horizontal bars over a breakdown.",
    defaultSize: { w: 6, h: 4 },
    dataKeys: [
      "breakdowns.byType",
      "breakdowns.byStatus",
      "breakdowns.byDepartment",
      "breakdowns.byClassification",
    ],
  },
  {
    type: "pie",
    name: "Pie chart",
    description: "Proportional slices over a breakdown.",
    defaultSize: { w: 4, h: 4 },
    dataKeys: [
      "breakdowns.byType",
      "breakdowns.byStatus",
      "breakdowns.byDepartment",
      "breakdowns.byClassification",
    ],
  },
  {
    type: "list",
    name: "Top-N list",
    description: "Compact table of the top contributors or recent items.",
    defaultSize: { w: 6, h: 4 },
    dataKeys: ["topCreators", "recentDocuments"],
  },
];

/**
 * One row of `DashboardLayout.widgets`. Stored as plain JSON, so keep the
 * shape stable — widening is fine, renaming is not.
 */
export interface Widget {
  id: string;
  type: string;
  title: string;
  /** Grid cell coords (0-indexed, 12-column grid). */
  x: number;
  y: number;
  w: number;
  h: number;
  config: WidgetConfig;
}

export interface WidgetConfig {
  /** Dot-path into DashboardData (e.g. "totals.documents"). */
  dataKey?: string;
  /** For counter/kpi widgets — the unit suffix (e.g. "docs"). */
  unit?: string;
  /** For lists — how many rows. */
  limit?: number;
}

/** Resolve a dot-path against an unknown payload. Returns `undefined` if
 *  any segment is missing, never throws. */
export function resolveDataKey(
  data: unknown,
  path: string | undefined
): unknown {
  if (!path) return undefined;
  let cur: unknown = data;
  for (const seg of path.split(".")) {
    if (cur === null || cur === undefined || typeof cur !== "object") {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

export function getWidgetType(type: string): WidgetType | undefined {
  return WIDGET_CATALOGUE.find((w) => w.type === type);
}

/** A sensible starter layout for users with no saved dashboard yet. */
export const DEFAULT_WIDGETS: Widget[] = [
  {
    id: "w-total-docs",
    type: "counter",
    title: "Total documents",
    x: 0,
    y: 0,
    w: 3,
    h: 2,
    config: { dataKey: "totals.documents", unit: "docs" },
  },
  {
    id: "w-new-docs",
    type: "kpi",
    title: "New in window",
    x: 3,
    y: 0,
    w: 3,
    h: 2,
    config: { dataKey: "totals.documentsCreatedInWindow", unit: "docs" },
  },
  {
    id: "w-tasks-pending",
    type: "counter",
    title: "Pending tasks",
    x: 6,
    y: 0,
    w: 3,
    h: 2,
    config: { dataKey: "totals.tasksPending" },
  },
  {
    id: "w-tasks-overdue",
    type: "counter",
    title: "Overdue tasks",
    x: 9,
    y: 0,
    w: 3,
    h: 2,
    config: { dataKey: "totals.tasksOverdue" },
  },
  {
    id: "w-by-type",
    type: "bar",
    title: "Documents by type",
    x: 0,
    y: 2,
    w: 6,
    h: 4,
    config: { dataKey: "breakdowns.byType" },
  },
  {
    id: "w-by-dept",
    type: "pie",
    title: "Documents by department",
    x: 6,
    y: 2,
    w: 6,
    h: 4,
    config: { dataKey: "breakdowns.byDepartment" },
  },
  {
    id: "w-top-creators",
    type: "list",
    title: "Top contributors",
    x: 0,
    y: 6,
    w: 6,
    h: 4,
    config: { dataKey: "topCreators", limit: 8 },
  },
  {
    id: "w-recent-docs",
    type: "list",
    title: "Recent documents",
    x: 6,
    y: 6,
    w: 6,
    h: 4,
    config: { dataKey: "recentDocuments", limit: 8 },
  },
];

/** Defensive parser for the JSON column. Drops malformed widgets. */
export function parseWidgets(raw: unknown): Widget[] {
  if (!Array.isArray(raw)) return [];
  const out: Widget[] = [];
  for (const w of raw) {
    if (!w || typeof w !== "object") continue;
    const r = w as Record<string, unknown>;
    if (
      typeof r.id !== "string" ||
      typeof r.type !== "string" ||
      typeof r.title !== "string" ||
      typeof r.x !== "number" ||
      typeof r.y !== "number" ||
      typeof r.w !== "number" ||
      typeof r.h !== "number"
    ) {
      continue;
    }
    const config =
      r.config && typeof r.config === "object"
        ? (r.config as WidgetConfig)
        : {};
    out.push({
      id: r.id,
      type: r.type,
      title: r.title,
      x: Math.max(0, Math.min(11, Math.floor(r.x))),
      y: Math.max(0, Math.floor(r.y)),
      w: Math.max(1, Math.min(12, Math.floor(r.w))),
      h: Math.max(1, Math.floor(r.h)),
      config,
    });
  }
  return out;
}
