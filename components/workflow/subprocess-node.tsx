"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";

export interface SubprocessNodeData {
  label: string;
  templateId?: string;
  templateName?: string;
  waitForCompletion: boolean;
  passVariables?: string[];
}

function SubprocessNodeComponent({ data, selected }: NodeProps<SubprocessNodeData>) {
  return (
    <div
      className={`min-w-[200px] max-w-[260px] rounded-xl border-2 bg-white dark:bg-gray-900 shadow-sm transition-all duration-200 ${
        selected
          ? "border-karu-green shadow-[0_0_0_3px_rgba(2,119,59,0.15)]"
          : "border-teal-400 dark:border-teal-600 hover:shadow-md"
      }`}
    >
      {/* Double-border inner ring */}
      <div className="m-1 rounded-lg border border-teal-300 dark:border-teal-700">
        <Handle
          type="target"
          position={Position.Top}
          className="!w-3 !h-3 !bg-teal-500 !border-2 !border-white dark:!border-gray-900"
        />

        {/* Header */}
        <div className="px-3 pt-3 pb-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 rounded-md bg-teal-100 dark:bg-teal-900/40 flex items-center justify-center flex-shrink-0">
              <svg
                className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
                />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
              {data.label || "Subprocess"}
            </h3>
          </div>
        </div>

        {/* Body */}
        <div className="px-3 pb-3 space-y-1.5">
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-teal-50 dark:bg-teal-950/30 text-teal-700 dark:text-teal-400">
            <span className="w-1.5 h-1.5 rounded-full bg-teal-500" />
            {data.waitForCompletion ? "Blocking" : "Async"}
          </span>

          {data.templateName && (
            <p className="text-[11px] text-gray-500 dark:text-gray-400 line-clamp-1 leading-relaxed">
              Template: {data.templateName}
            </p>
          )}

          {data.passVariables && data.passVariables.length > 0 && (
            <div className="flex items-center gap-1 text-[10px] text-teal-600 dark:text-teal-400">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
              </svg>
              {data.passVariables.length} variable{data.passVariables.length > 1 ? "s" : ""}
            </div>
          )}
        </div>

        <Handle
          type="source"
          position={Position.Bottom}
          className="!w-3 !h-3 !bg-teal-500 !border-2 !border-white dark:!border-gray-900"
        />
      </div>
    </div>
  );
}

export const SubprocessNode = memo(SubprocessNodeComponent);
