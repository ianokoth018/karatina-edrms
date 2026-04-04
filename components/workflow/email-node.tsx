"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";

export interface EmailNodeData {
  label: string;
  recipientType: "specific_user" | "role" | "initiator" | "previous_assignee" | "custom_email";
  recipientValue?: string;
  subject?: string;
  bodyTemplate?: string;
  includeDocumentLink?: boolean;
}

const recipientLabels: Record<string, string> = {
  specific_user: "Specific User",
  role: "Role",
  initiator: "Initiator",
  previous_assignee: "Prev. Assignee",
  custom_email: "Custom Email",
};

function EmailNodeComponent({ data, selected }: NodeProps<EmailNodeData>) {
  return (
    <div
      className={`min-w-[200px] max-w-[260px] rounded-xl border-2 bg-white dark:bg-gray-900 shadow-sm transition-all duration-200 ${
        selected
          ? "border-karu-green shadow-[0_0_0_3px_rgba(2,119,59,0.15)]"
          : "border-purple-400 dark:border-purple-600 hover:shadow-md"
      }`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-purple-500 !border-2 !border-white dark:!border-gray-900"
      />

      {/* Header */}
      <div className="px-3 pt-3 pb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-md bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center flex-shrink-0">
            <svg
              className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75"
              />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
            {data.label || "Send Email"}
          </h3>
        </div>
      </div>

      {/* Body */}
      <div className="px-3 pb-3 space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-400">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
            {recipientLabels[data.recipientType] ?? "Recipient"}
          </span>
          {data.includeDocumentLink && (
            <span className="text-[10px] text-gray-400 dark:text-gray-500">
              + doc link
            </span>
          )}
        </div>

        {data.subject && (
          <p className="text-[11px] text-gray-500 dark:text-gray-400 line-clamp-1 leading-relaxed">
            Subj: {data.subject}
          </p>
        )}

        {data.recipientValue && (
          <p className="text-[11px] text-gray-500 dark:text-gray-400 line-clamp-1 leading-relaxed">
            To: {data.recipientValue}
          </p>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-3 !h-3 !bg-purple-500 !border-2 !border-white dark:!border-gray-900"
      />
    </div>
  );
}

export const EmailNode = memo(EmailNodeComponent);
