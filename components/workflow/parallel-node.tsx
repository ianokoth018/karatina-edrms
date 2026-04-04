"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";

export interface ParallelNodeData {
  label: string;
  gatewayType: "fork" | "join";
  joinRule?: "all" | "any";
}

function ParallelNodeComponent({ data, selected }: NodeProps<ParallelNodeData>) {
  const isFork = data.gatewayType === "fork";

  return (
    <div className="relative flex items-center justify-center" style={{ width: 120, height: 120 }}>
      {/* Inputs */}
      {isFork ? (
        <Handle
          type="target"
          position={Position.Top}
          className="!w-3 !h-3 !bg-blue-500 !border-2 !border-white dark:!border-gray-900"
          style={{ top: -6 }}
        />
      ) : (
        <>
          <Handle
            type="target"
            position={Position.Top}
            id="top"
            className="!w-3 !h-3 !bg-blue-500 !border-2 !border-white dark:!border-gray-900"
            style={{ top: -6 }}
          />
          <Handle
            type="target"
            position={Position.Left}
            id="left"
            className="!w-3 !h-3 !bg-blue-500 !border-2 !border-white dark:!border-gray-900"
            style={{ left: -6 }}
          />
          <Handle
            type="target"
            position={Position.Right}
            id="right"
            className="!w-3 !h-3 !bg-blue-500 !border-2 !border-white dark:!border-gray-900"
            style={{ right: -6 }}
          />
        </>
      )}

      {/* Diamond shape */}
      <div
        className={`absolute border-2 bg-white dark:bg-gray-900 shadow-sm transition-all duration-200 ${
          selected
            ? "border-karu-green shadow-[0_0_0_3px_rgba(2,119,59,0.15)]"
            : "border-blue-400 dark:border-blue-600 hover:shadow-md"
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
        {isFork ? (
          /* Fork icon: diverging arrows */
          <svg
            className="w-5 h-5 text-blue-600 dark:text-blue-400 mb-0.5"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 4.5v15m0 0l-6-6m6 6l6-6"
            />
            <line x1="6" y1="19.5" x2="6" y2="13.5" strokeLinecap="round" />
            <line x1="18" y1="19.5" x2="18" y2="13.5" strokeLinecap="round" />
          </svg>
        ) : (
          /* Join icon: converging arrows */
          <svg
            className="w-5 h-5 text-blue-600 dark:text-blue-400 mb-0.5"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 19.5v-15m0 0l-6 6m6-6l6 6"
            />
            <line x1="6" y1="4.5" x2="6" y2="10.5" strokeLinecap="round" />
            <line x1="18" y1="4.5" x2="18" y2="10.5" strokeLinecap="round" />
          </svg>
        )}

        {/* Plus symbol (BPMN standard for parallel gateway) */}
        <div className="flex items-center justify-center w-4 h-4 rounded-sm bg-blue-100 dark:bg-blue-900/40 mb-0.5">
          <svg
            className="w-3 h-3 text-blue-700 dark:text-blue-300"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={3}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </div>

        <span className="text-[9px] font-bold text-gray-900 dark:text-gray-100 leading-tight max-w-[70px] truncate">
          {data.label || (isFork ? "Fork" : "Join")}
        </span>
        {!isFork && data.joinRule && (
          <span className="text-[8px] font-semibold text-blue-500 dark:text-blue-400 uppercase">
            {data.joinRule === "all" ? "Wait All" : "Wait Any"}
          </span>
        )}
      </div>

      {/* Outputs */}
      {isFork ? (
        <>
          <Handle
            type="source"
            position={Position.Bottom}
            id="bottom"
            className="!w-3 !h-3 !bg-blue-500 !border-2 !border-white dark:!border-gray-900"
            style={{ bottom: -6 }}
          />
          <Handle
            type="source"
            position={Position.Left}
            id="left"
            className="!w-3 !h-3 !bg-blue-500 !border-2 !border-white dark:!border-gray-900"
            style={{ left: -6 }}
          />
          <Handle
            type="source"
            position={Position.Right}
            id="right"
            className="!w-3 !h-3 !bg-blue-500 !border-2 !border-white dark:!border-gray-900"
            style={{ right: -6 }}
          />
        </>
      ) : (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!w-3 !h-3 !bg-blue-500 !border-2 !border-white dark:!border-gray-900"
          style={{ bottom: -6 }}
        />
      )}
    </div>
  );
}

export const ParallelNode = memo(ParallelNodeComponent);
