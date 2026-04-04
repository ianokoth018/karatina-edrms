"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";

export interface TimerNodeData {
  label: string;
  timerType: "duration" | "date" | "business_hours";
  durationHours?: number;
  durationDays?: number;
  targetDate?: string;
  businessHoursOnly?: boolean;
}

const timerTypeLabels: Record<string, string> = {
  duration: "Duration",
  date: "Target Date",
  business_hours: "Business Hrs",
};

function TimerNodeComponent({ data, selected }: NodeProps<TimerNodeData>) {
  const summaryParts: string[] = [];
  if (data.timerType === "duration") {
    if (data.durationDays) summaryParts.push(`${data.durationDays}d`);
    if (data.durationHours) summaryParts.push(`${data.durationHours}h`);
  } else if (data.timerType === "date" && data.targetDate) {
    summaryParts.push(data.targetDate);
  }
  if (data.businessHoursOnly) {
    summaryParts.push("(biz hrs)");
  }

  return (
    <div
      className={`min-w-[180px] max-w-[240px] rounded-xl border-2 bg-white dark:bg-gray-900 shadow-sm transition-all duration-200 ${
        selected
          ? "border-karu-green shadow-[0_0_0_3px_rgba(2,119,59,0.15)]"
          : "border-slate-400 dark:border-slate-600 hover:shadow-md"
      }`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-slate-500 !border-2 !border-white dark:!border-gray-900"
      />

      {/* Header */}
      <div className="px-3 pt-3 pb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-md bg-slate-100 dark:bg-slate-800 flex items-center justify-center flex-shrink-0">
            <svg
              className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
              />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
            {data.label || "Timer"}
          </h3>
        </div>
      </div>

      {/* Body */}
      <div className="px-3 pb-3 space-y-1.5">
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
          {timerTypeLabels[data.timerType] ?? "Duration"}
        </span>

        {summaryParts.length > 0 && (
          <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
            {summaryParts.join(" ")}
          </p>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-3 !h-3 !bg-slate-500 !border-2 !border-white dark:!border-gray-900"
      />
    </div>
  );
}

export const TimerNode = memo(TimerNodeComponent);
