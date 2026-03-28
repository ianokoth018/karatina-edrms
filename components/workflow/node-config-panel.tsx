"use client";

import type { Node } from "reactflow";
import type { TaskNodeData } from "./task-node";
import type { DecisionNodeData } from "./decision-node";

interface NodeConfigPanelProps {
  node: Node;
  onUpdate: (nodeId: string, data: Record<string, unknown>) => void;
  onDelete: (nodeId: string) => void;
}

export default function NodeConfigPanel({ node, onUpdate, onDelete }: NodeConfigPanelProps) {
  function updateField(field: string, value: unknown) {
    onUpdate(node.id, { ...node.data, [field]: value });
  }

  if (node.type === "start") {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-green-100 dark:bg-green-950/40 flex items-center justify-center">
            <svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Start Node</h3>
            <p className="text-[11px] text-gray-400 dark:text-gray-500">Workflow entry point</p>
          </div>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          This is the starting point of your workflow. Every workflow must have exactly one start node. It is automatically placed when you create a new workflow.
        </p>
      </div>
    );
  }

  if (node.type === "end") {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-950/40 flex items-center justify-center">
            <svg className="w-4 h-4 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 7.5A2.25 2.25 0 0 1 7.5 5.25h9a2.25 2.25 0 0 1 2.25 2.25v9a2.25 2.25 0 0 1-2.25 2.25h-9a2.25 2.25 0 0 1-2.25-2.25v-9Z" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">End Node</h3>
            <p className="text-[11px] text-gray-400 dark:text-gray-500">Workflow termination</p>
          </div>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          This marks the completion of a workflow path. You can have multiple end nodes for different outcomes (e.g., approved path and rejected path).
        </p>
        <button
          onClick={() => onDelete(node.id)}
          className="w-full px-3 py-2 rounded-xl border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-xs font-medium hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
        >
          Remove Node
        </button>
      </div>
    );
  }

  if (node.type === "task") {
    const data = node.data as TaskNodeData;
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-karu-green/10 flex items-center justify-center">
            <svg className="w-4 h-4 text-karu-green" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Task Node</h3>
            <p className="text-[11px] text-gray-400 dark:text-gray-500">Configure this step</p>
          </div>
        </div>

        {/* Step Name */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">
            Step Name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={data.label ?? ""}
            onChange={(e) => updateField("label", e.target.value)}
            placeholder="e.g. Department Head Review"
            className="w-full h-9 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
          />
        </div>

        {/* Task Type */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">
            Task Type
          </label>
          <select
            value={data.taskType ?? "approval"}
            onChange={(e) => updateField("taskType", e.target.value)}
            className="w-full h-9 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
          >
            <option value="approval">Approval</option>
            <option value="review">Review</option>
            <option value="notification">Notification</option>
          </select>
        </div>

        {/* Description */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">
            Description
          </label>
          <textarea
            value={data.description ?? ""}
            onChange={(e) => updateField("description", e.target.value)}
            rows={2}
            placeholder="What should the assignee do?"
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none resize-none"
          />
        </div>

        {/* Assignee Rule */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">
            Assignee Rule
          </label>
          <select
            value={data.assigneeRule ?? "dynamic"}
            onChange={(e) => updateField("assigneeRule", e.target.value)}
            className="w-full h-9 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
          >
            <option value="specific_user">Specific User</option>
            <option value="role_based">Role-based</option>
            <option value="initiator_manager">Initiator&apos;s Manager</option>
            <option value="dynamic">Dynamic (chosen at runtime)</option>
          </select>
        </div>

        {/* Assignee Value (conditional) */}
        {(data.assigneeRule === "specific_user" || data.assigneeRule === "role_based") && (
          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">
              {data.assigneeRule === "specific_user" ? "User ID" : "Role Name"}
            </label>
            <input
              type="text"
              value={data.assigneeValue ?? ""}
              onChange={(e) => updateField("assigneeValue", e.target.value)}
              placeholder={data.assigneeRule === "specific_user" ? "Enter user ID" : "e.g. DEPARTMENT_HEAD"}
              className="w-full h-9 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
            />
          </div>
        )}

        {/* Escalation Days */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">
            Auto-escalate after (days)
          </label>
          <input
            type="number"
            min={0}
            max={90}
            value={data.escalationDays ?? 0}
            onChange={(e) => updateField("escalationDays", parseInt(e.target.value) || 0)}
            className="w-full h-9 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
          />
          <p className="text-[10px] text-gray-400 dark:text-gray-500">Set to 0 for no escalation</p>
        </div>

        {/* Required Action */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">
            Required Action
          </label>
          <select
            value={data.requiredAction ?? "approve"}
            onChange={(e) => updateField("requiredAction", e.target.value)}
            className="w-full h-9 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
          >
            <option value="approve">Approve</option>
            <option value="reject">Reject</option>
            <option value="return">Return</option>
          </select>
        </div>

        <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={() => onDelete(node.id)}
            className="w-full px-3 py-2 rounded-xl border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-xs font-medium hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
          >
            Remove Node
          </button>
        </div>
      </div>
    );
  }

  if (node.type === "decision") {
    const data = node.data as DecisionNodeData;
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-yellow-100 dark:bg-yellow-950/40 flex items-center justify-center">
            <svg className="w-4 h-4 text-yellow-600 dark:text-yellow-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Decision Node</h3>
            <p className="text-[11px] text-gray-400 dark:text-gray-500">Conditional branching</p>
          </div>
        </div>

        {/* Decision Label */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">
            Decision Label
          </label>
          <input
            type="text"
            value={data.label ?? ""}
            onChange={(e) => updateField("label", e.target.value)}
            placeholder="e.g. Is Approved?"
            className="w-full h-9 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
          />
        </div>

        {/* Yes Condition Label */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              Yes / Approve path label
            </span>
          </label>
          <input
            type="text"
            value={data.conditionYes ?? ""}
            onChange={(e) => updateField("conditionYes", e.target.value)}
            placeholder="e.g. Approved"
            className="w-full h-9 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
          />
        </div>

        {/* No Condition Label */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-red-500" />
              No / Reject path label
            </span>
          </label>
          <input
            type="text"
            value={data.conditionNo ?? ""}
            onChange={(e) => updateField("conditionNo", e.target.value)}
            placeholder="e.g. Rejected"
            className="w-full h-9 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
          />
        </div>

        <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={() => onDelete(node.id)}
            className="w-full px-3 py-2 rounded-xl border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-xs font-medium hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
          >
            Remove Node
          </button>
        </div>
      </div>
    );
  }

  return (
    <p className="text-xs text-gray-400 dark:text-gray-500">
      Select a node on the canvas to configure it.
    </p>
  );
}
