"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";

export interface TaskNodeData {
  label: string;
  taskType: "approval" | "review" | "notification";
  description?: string;
  assigneeRule: "specific_user" | "role_based" | "initiator_manager" | "dynamic";
  assigneeValue?: string;
  escalationDays?: number;
  requiredAction?: "approve" | "reject" | "return";
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

function TaskNodeComponent({ data, selected }: NodeProps<TaskNodeData>) {
  const colors = taskTypeColors[data.taskType] ?? taskTypeColors.approval;

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

        {/* Escalation indicator */}
        {data.escalationDays && data.escalationDays > 0 && (
          <div className="flex items-center gap-1 text-[10px] text-orange-600 dark:text-orange-400">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
            Escalate after {data.escalationDays}d
          </div>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-3 !h-3 !bg-karu-green !border-2 !border-white dark:!border-gray-900"
      />
    </div>
  );
}

export const TaskNode = memo(TaskNodeComponent);
