"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";

export interface DecisionNodeData {
  label: string;
  conditionYes?: string;
  conditionNo?: string;
}

function DecisionNodeComponent({ data, selected }: NodeProps<DecisionNodeData>) {
  return (
    <div className="relative flex items-center justify-center" style={{ width: 120, height: 120 }}>
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-yellow-500 !border-2 !border-white dark:!border-gray-900"
        style={{ top: -6 }}
      />

      {/* Diamond shape */}
      <div
        className={`absolute inset-0 border-2 bg-white dark:bg-gray-900 shadow-sm transition-all duration-200 ${
          selected
            ? "border-karu-green shadow-[0_0_0_3px_rgba(2,119,59,0.15)]"
            : "border-yellow-400 dark:border-yellow-600 hover:shadow-md"
        }`}
        style={{
          transform: "rotate(45deg)",
          borderRadius: 8,
          width: 85,
          height: 85,
          position: "absolute",
          top: "50%",
          left: "50%",
          marginTop: -42.5,
          marginLeft: -42.5,
        }}
      />

      {/* Content overlay (not rotated) */}
      <div className="relative z-10 flex flex-col items-center text-center px-2">
        <svg
          className="w-4 h-4 text-yellow-600 dark:text-yellow-400 mb-0.5"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z"
          />
        </svg>
        <span className="text-[10px] font-bold text-gray-900 dark:text-gray-100 leading-tight max-w-[70px] truncate">
          {data.label || "Decision"}
        </span>
      </div>

      {/* Left output: No / Reject path */}
      <Handle
        type="source"
        position={Position.Left}
        id="no"
        className="!w-3 !h-3 !bg-red-500 !border-2 !border-white dark:!border-gray-900"
        style={{ left: -6 }}
      />
      <span className="absolute left-[-2px] top-[68px] text-[8px] font-bold text-red-500 pointer-events-none">
        {data.conditionNo || "NO"}
      </span>

      {/* Right output: Yes / Approve path */}
      <Handle
        type="source"
        position={Position.Right}
        id="yes"
        className="!w-3 !h-3 !bg-green-500 !border-2 !border-white dark:!border-gray-900"
        style={{ right: -6 }}
      />
      <span className="absolute right-[-4px] top-[68px] text-[8px] font-bold text-green-600 pointer-events-none">
        {data.conditionYes || "YES"}
      </span>

      {/* Bottom output (default path) */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="default"
        className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white dark:!border-gray-900"
        style={{ bottom: -6 }}
      />
    </div>
  );
}

export const DecisionNode = memo(DecisionNodeComponent);
