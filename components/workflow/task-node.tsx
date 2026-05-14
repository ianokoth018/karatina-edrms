"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";

const actionHandleColors: Record<string, string> = {
  APPROVED: "!bg-green-500",
  REJECTED: "!bg-red-500",
  RETURNED: "!bg-amber-500",
};

const pillColorClasses: Record<string, string> = {
  green:  "bg-green-100 text-green-700",
  red:    "bg-red-100 text-red-700",
  amber:  "bg-amber-100 text-amber-700",
  blue:   "bg-blue-100 text-blue-700",
  purple: "bg-purple-100 text-purple-700",
  gray:   "bg-gray-100 text-gray-600",
  orange: "bg-orange-100 text-orange-700",
  teal:   "bg-teal-100 text-teal-700",
  pink:   "bg-pink-100 text-pink-700",
  indigo: "bg-indigo-100 text-indigo-700",
  cyan:   "bg-cyan-100 text-cyan-700",
  yellow: "bg-yellow-100 text-yellow-700",
};

export interface FieldConfig {
  fieldName: string;
  visibility: "visible" | "hidden" | "readonly" | "editable";
}

export interface ActionButton {
  id: string;
  label: string;          // e.g., "Recommend", "Approve", "Circulate"
  action: string;         // APPROVED, REJECTED, RETURNED, DELEGATED, or custom
  color: "green" | "red" | "amber" | "blue" | "purple" | "gray" | "orange" | "teal" | "pink" | "indigo" | "cyan" | "yellow";
  requiresComment: boolean;
  requiresUserSelect: boolean; // e.g., for delegation or circulation
  icon?: string;
}

export interface TaskNodeData {
  label: string;
  taskType: "approval" | "review" | "notification" | "action";
  description?: string;
  assigneeRule: "specific_user" | "role_based" | "initiator_manager" | "department" | "initiator" | "round_robin" | "least_loaded" | "dynamic";
  assigneeValue?: string;
  escalationDays?: number;
  escalateTo?: string;
  slaHours?: number;
  /** Newer SLA shape used by the config panel (value + unit). */
  slaValue?: number;
  slaUnit?: "hours" | "days";
  reminderDays?: number;
  requiredAction?: "approve" | "reject" | "return" | "any";
  parallelApproval?: boolean;
  approvalRule?: "all" | "any" | "majority";
  formTemplateId?: string;
  notifyOnAssign?: boolean;
  notifyOnComplete?: boolean;
  // Per-step form layout
  fieldConfig?: FieldConfig[];        // which fields are visible/editable at this step
  actionButtons?: ActionButton[];     // custom action buttons for this step
  stepLayout?: "full" | "split" | "compact"; // layout mode: full form, split (form+doc viewer), compact
  showDocumentViewer?: boolean;       // show PDF/document viewer alongside the form
  sectionTitle?: string;              // custom section title for this step's form view
  /**
   * Runtime stats injected by the designer when the "Runtime overlay"
   * toggle is on. Kept on `data` (rather than node.style) so it lives
   * inside React Flow's normal re-render cycle.
   */
  __runtime?: NodeRuntimeStats;
}

export interface NodeRuntimeStats {
  total: number;
  completed: number;
  pending: number;
  approved: number;
  rejected: number;
  returned: number;
  breaches: number;
  avgDwellMs: number;
}

const taskTypeColors: Record<string, { bg: string; text: string; dot: string }> = {
  approval: {
    bg: "bg-amber-50 dark:bg-amber-950/30",
    text: "text-amber-700 dark:text-amber-400",
    dot: "bg-amber-500",
  },
  review: {
    bg: "bg-blue-50 dark:bg-blue-950/30",
    text: "text-blue-700 dark:text-blue-400",
    dot: "bg-blue-500",
  },
  notification: {
    bg: "bg-purple-50 dark:bg-purple-950/30",
    text: "text-purple-700 dark:text-purple-400",
    dot: "bg-purple-500",
  },
};

const assigneeLabels: Record<string, string> = {
  specific_user: "Specific User",
  role_based: "Role-based",
  initiator_manager: "Manager",
  dynamic: "Dynamic",
};

function formatDwell(ms: number): string {
  if (ms <= 0) return "—";
  const minutes = ms / 60_000;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function formatSla(data: TaskNodeData): string | null {
  if (typeof data.slaValue === "number" && data.slaValue > 0 && data.slaUnit) {
    return `${data.slaValue}${data.slaUnit === "hours" ? "h" : "d"}`;
  }
  if (typeof data.slaHours === "number" && data.slaHours > 0) {
    return data.slaHours >= 24
      ? `${(data.slaHours / 24).toFixed(1)}d`
      : `${data.slaHours}h`;
  }
  return null;
}

function dwellHeatColor(ms: number): string {
  // Banded so the chip reads at a glance: <2h cool, 2-24h warm, >1d hot.
  const hours = ms / 3_600_000;
  if (hours < 2) return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400";
  if (hours < 24) return "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400";
  return "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400";
}

function TaskNodeComponent({ data, selected }: NodeProps<TaskNodeData>) {
  const colors = taskTypeColors[data.taskType] ?? taskTypeColors.approval;
  const slaLabel = formatSla(data);
  const stats = data.__runtime;
  const rejectionRate =
    stats && stats.completed > 0
      ? Math.round(((stats.rejected + stats.returned) / stats.completed) * 100)
      : null;

  return (
    <div
      className={`min-w-[200px] max-w-[260px] rounded-xl border-2 bg-white dark:bg-gray-900 shadow-sm transition-all duration-200 ${
        selected
          ? "border-karu-green shadow-[0_0_0_3px_rgba(2,119,59,0.15)]"
          : "border-gray-200 dark:border-gray-700 hover:shadow-md"
      }`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-karu-green !border-2 !border-white dark:!border-gray-900"
      />

      {/* Header */}
      <div className="px-3 pt-3 pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 rounded-md bg-karu-green/10 flex items-center justify-center flex-shrink-0">
              <svg
                className="w-3.5 h-3.5 text-karu-green"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
              {data.label || "Untitled Task"}
            </h3>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="px-3 pb-3 space-y-1.5">
        {/* Type badge */}
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${colors.bg} ${colors.text}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
            {data.taskType}
          </span>
          <span className="text-[10px] text-gray-400 dark:text-gray-500">
            {assigneeLabels[data.assigneeRule] ?? "Dynamic"}
          </span>
        </div>

        {/* Description preview */}
        {data.description && (
          <p className="text-[11px] text-gray-500 dark:text-gray-400 line-clamp-2 leading-relaxed">
            {data.description}
          </p>
        )}

        {/* SLA + escalation chips */}
        {(slaLabel || (data.escalationDays && data.escalationDays > 0)) && (
          <div className="flex items-center gap-1 flex-wrap">
            {slaLabel && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-karu-green/10 text-[#02773b] dark:text-[#60c988]"
                title="Service-level agreement"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
                SLA {slaLabel}
              </span>
            )}
            {data.escalationDays !== undefined && data.escalationDays > 0 && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-50 text-orange-600 dark:bg-orange-950/40 dark:text-orange-400">
                Esc. {data.escalationDays}d
              </span>
            )}
          </div>
        )}

        {/* Runtime overlay chips — only when the designer has injected stats */}
        {stats && stats.total > 0 && (
          <div className="flex items-center gap-1 flex-wrap pt-1 border-t border-gray-100 dark:border-gray-800">
            <span
              className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${dwellHeatColor(stats.avgDwellMs)}`}
              title="Average time tasks spend at this step"
            >
              ⏱ {formatDwell(stats.avgDwellMs)}
            </span>
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
              title={`${stats.completed} of ${stats.total} completed`}
            >
              {stats.total}
            </span>
            {rejectionRate !== null && rejectionRate > 0 && (
              <span
                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400"
                title="Rejected or returned"
              >
                ✗ {rejectionRate}%
              </span>
            )}
            {stats.breaches > 0 && (
              <span
                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300"
                title="SLA breaches"
              >
                ⚠ {stats.breaches}
              </span>
            )}
          </div>
        )}

        {/* Action outcome pills */}
        {data.actionButtons && data.actionButtons.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {data.actionButtons.map((btn) => (
              <span
                key={btn.id}
                className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-medium leading-tight ${pillColorClasses[btn.color] ?? "bg-gray-100 text-gray-600"}`}
              >
                {btn.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Per-action source handles — one per action button, or a single default */}
      {data.actionButtons && data.actionButtons.length > 0 ? (
        data.actionButtons.map((btn, idx, arr) => (
          <Handle
            key={btn.action}
            id={btn.action}
            type="source"
            position={Position.Bottom}
            style={{ left: `${((idx + 1) / (arr.length + 1)) * 100}%` }}
            className={`!w-3 !h-3 !border-2 !border-white dark:!border-gray-900 ${actionHandleColors[btn.action] ?? "!bg-blue-500"}`}
          />
        ))
      ) : (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!w-3 !h-3 !bg-karu-green !border-2 !border-white dark:!border-gray-900"
        />
      )}
    </div>
  );
}

export const TaskNode = memo(TaskNodeComponent);
