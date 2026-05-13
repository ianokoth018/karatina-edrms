"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";

export interface HttpNodeData {
  label: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  /** Header pairs as a key-value list. Values support `{{expr}}`. */
  headers?: { key: string; value: string }[];
  /** Body template. Supports `{{expr}}`. JSON-stringified if needed. */
  body?: string;
  /** "none" | "bearer" | "basic" */
  authType?: "none" | "bearer" | "basic";
  /** Bearer token or basic-auth user:pass (interpolated). */
  authValue?: string;
  /** Key under which the response is stored in workflowData. */
  responseVar?: string;
  /** Continue on non-2xx response; otherwise treat as error. */
  continueOnError?: boolean;
}

const METHOD_COLOR: Record<HttpNodeData["method"], string> = {
  GET: "bg-emerald-100 text-emerald-800 border-emerald-300",
  POST: "bg-blue-100 text-blue-800 border-blue-300",
  PUT: "bg-amber-100 text-amber-800 border-amber-300",
  PATCH: "bg-purple-100 text-purple-800 border-purple-300",
  DELETE: "bg-red-100 text-red-800 border-red-300",
};

function HttpNodeComponent({ data, selected }: NodeProps<HttpNodeData>) {
  const method = data.method ?? "GET";
  const url = data.url || "https://example.com/api";
  return (
    <div
      className={`relative w-44 rounded-lg border-2 bg-white shadow-sm transition-all duration-200 dark:bg-gray-900 ${
        selected
          ? "border-karu-green shadow-[0_0_0_3px_rgba(2,119,59,0.15)]"
          : "border-indigo-300 dark:border-indigo-600 hover:shadow-md"
      }`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-indigo-500 !border-2 !border-white dark:!border-gray-900"
        style={{ top: -6 }}
      />
      <div className="px-2 py-1.5">
        <div className="mb-1 flex items-center gap-1.5">
          <svg
            className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3.75 5.25 9 9 3.75 12.75 9 16.5 3.75 20.25M14.25 5.25h6m-6 5.25h6m-6 5.25h6m-6 5.25h6"
            />
          </svg>
          <span className="truncate text-[11px] font-bold text-gray-900 dark:text-gray-100">
            {data.label || "HTTP Request"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span
            className={`rounded border px-1 py-0.5 text-[9px] font-bold ${METHOD_COLOR[method]}`}
          >
            {method}
          </span>
          <code className="flex-1 truncate font-mono text-[9px] text-gray-500 dark:text-gray-400">
            {url.replace(/^https?:\/\//, "")}
          </code>
        </div>
      </div>
      {/* Success path */}
      <Handle
        type="source"
        id="success"
        position={Position.Bottom}
        className="!w-3 !h-3 !bg-green-500 !border-2 !border-white dark:!border-gray-900"
        style={{ bottom: -6 }}
      />
      {/* Error path */}
      <Handle
        type="source"
        id="error"
        position={Position.Right}
        className="!w-3 !h-3 !bg-red-500 !border-2 !border-white dark:!border-gray-900"
        style={{ right: -6, top: "50%" }}
      />
      <span className="pointer-events-none absolute -right-1 bottom-[-12px] text-[8px] font-bold text-red-500">
        ERR
      </span>
    </div>
  );
}

export const HttpNode = memo(HttpNodeComponent);
