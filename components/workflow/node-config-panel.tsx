"use client";

import { useState, useCallback, useEffect } from "react";
import type { Node } from "reactflow";
import type { DecisionNodeData } from "./decision-node";
import type { TimerNodeData } from "./timer-node";
import type { EmailNodeData } from "./email-node";
import type { FieldConfig, ActionButton } from "./task-node";

/* ------------------------------------------------------------------ */
/*  Extended task data — superset of the base TaskNodeData export from */
/*  task-node.tsx. The config panel supports all assignment rules.      */
/* ------------------------------------------------------------------ */

interface TaskNodeDataExtended {
  label: string;
  taskType: "approval" | "review" | "notification" | "action";
  description?: string;
  assigneeRule:
    | "specific_user"
    | "role_based"
    | "department"
    | "initiator"
    | "initiator_manager"
    | "round_robin"
    | "least_loaded"
    | "pool";
  assigneeValue?: string;
  poolId?: string;
  /* SLA */
  slaValue?: number;
  slaUnit?: "hours" | "days";
  slaHours?: number; // legacy
  /* Escalation */
  escalationValue?: number;
  escalationUnit?: "hours" | "days";
  escalationDays?: number; // legacy
  escalationTo?: string;
  /* Reminder */
  reminderValue?: number;
  reminderUnit?: "hours" | "days";
  reminderDays?: number; // legacy
  requiredAction?: "approve" | "reject" | "return" | "any";
  parallelApproval?: boolean;
  approvalRule?: "all" | "any" | "majority";
  formTemplateId?: string;
  notifyOnAssign?: boolean;
  notifyOnComplete?: boolean;
  /* Per-step form layout fields */
  fieldConfig?: FieldConfig[];
  actionButtons?: ActionButton[];
  stepLayout?: "full" | "split" | "compact";
  showDocumentViewer?: boolean;
  sectionTitle?: string;
}

/* ------------------------------------------------------------------ */
/*  Data interfaces for nodes that may not have their own file yet     */
/* ------------------------------------------------------------------ */

export interface SubprocessNodeData {
  label: string;
  templateId?: string;
  templateName?: string;
  waitForCompletion: boolean;
  passVariables?: string[];
}

export interface SystemNodeData {
  label: string;
  actionType:
    | "update_document_status"
    | "send_webhook"
    | "update_metadata"
    | "create_notification"
    | "assign_classification"
    | "lookup_form_data"
    | "update_form_data"
    | "create_delegation"
    | "year_end_carry_forward";
  actionConfig: Record<string, unknown>;
}

export interface ParallelNodeData {
  label: string;
  gatewayType: "fork" | "join";
  joinRule?: "all" | "any" | "quorum";
  quorumCount?: number;
}

export interface WaitSignalNodeData {
  label: string;
  signalName: string;
  description?: string;
  timeoutHours?: number;
}

/* ------------------------------------------------------------------ */
/*  Condition item type used by the decision node condition builder     */
/* ------------------------------------------------------------------ */

interface ConditionItem {
  id: string;
  label: string;
  field: string;
  operator: string;
  value: string;
  handleId: string;
}

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface NodeConfigPanelProps {
  node: Node;
  nodes?: Node[];
  onUpdate: (nodeId: string, data: Record<string, unknown>) => void;
  onDelete: (nodeId: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Shared style constants                                             */
/* ------------------------------------------------------------------ */

const inputCls =
  "w-full h-9 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none";

const selectCls = inputCls;

const textareaCls =
  "w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none resize-none";

const labelCls = "block text-xs font-medium text-gray-600 dark:text-gray-300";

const checkboxCls =
  "h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-karu-green focus:ring-karu-green/30 accent-[#02773b]";

const deleteBtnCls =
  "w-full px-3 py-2 rounded-xl border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-xs font-medium hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors";

const tabCls = (active: boolean) =>
  `px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
    active
      ? "bg-karu-green text-white shadow-sm"
      : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
  }`;

const sectionHeaderCls =
  "flex items-center justify-between cursor-pointer select-none group";

const sectionTitleCls =
  "text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-colors";

/* ------------------------------------------------------------------ */
/*  Tiny reusable helpers                                              */
/* ------------------------------------------------------------------ */

function Label({
  children,
  required,
}: {
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label className={labelCls}>
      {children}
      {required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
  );
}

function Field({ children }: { children: React.ReactNode }) {
  return <div className="space-y-1">{children}</div>;
}

function HelpText({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] text-gray-400 dark:text-gray-500">{children}</p>
  );
}

function Divider() {
  return <div className="border-t border-gray-200 dark:border-gray-700" />;
}

/** Collapsible section with a header that toggles open/closed */
function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={sectionHeaderCls}
      >
        <span className={sectionTitleCls}>{title}</span>
        <svg
          className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m19.5 8.25-7.5 7.5-7.5-7.5"
          />
        </svg>
      </button>
      {open && <div className="space-y-3">{children}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SVG Icons by node type                                             */
/* ------------------------------------------------------------------ */

const icons = {
  start: (
    <svg
      className="w-4 h-4 text-green-600 dark:text-green-400"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z"
      />
    </svg>
  ),
  end: (
    <svg
      className="w-4 h-4 text-red-600 dark:text-red-400"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5.25 7.5A2.25 2.25 0 0 1 7.5 5.25h9a2.25 2.25 0 0 1 2.25 2.25v9a2.25 2.25 0 0 1-2.25 2.25h-9a2.25 2.25 0 0 1-2.25-2.25v-9Z"
      />
    </svg>
  ),
  task: (
    <svg
      className="w-4 h-4 text-karu-green"
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
  ),
  decision: (
    <svg
      className="w-4 h-4 text-yellow-600 dark:text-yellow-400"
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
  ),
  timer: (
    <svg
      className="w-4 h-4 text-slate-600 dark:text-slate-300"
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
  ),
  email: (
    <svg
      className="w-4 h-4 text-purple-600 dark:text-purple-400"
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
  ),
  subprocess: (
    <svg
      className="w-4 h-4 text-cyan-600 dark:text-cyan-400"
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
  ),
  system: (
    <svg
      className="w-4 h-4 text-indigo-600 dark:text-indigo-400"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
      />
    </svg>
  ),
  parallel: (
    <svg
      className="w-4 h-4 text-teal-600 dark:text-teal-400"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
      />
    </svg>
  ),
  wait_signal: (
    <svg
      className="w-4 h-4 text-orange-600 dark:text-orange-400"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
      />
    </svg>
  ),
};

const iconBgByType: Record<string, string> = {
  start: "bg-green-100 dark:bg-green-950/40",
  end: "bg-red-100 dark:bg-red-950/40",
  task: "bg-karu-green/10",
  decision: "bg-yellow-100 dark:bg-yellow-950/40",
  timer: "bg-slate-100 dark:bg-slate-800",
  email: "bg-purple-100 dark:bg-purple-900/40",
  subprocess: "bg-cyan-100 dark:bg-cyan-900/40",
  system: "bg-indigo-100 dark:bg-indigo-900/40",
  parallel: "bg-teal-100 dark:bg-teal-900/40",
  wait_signal: "bg-orange-100 dark:bg-orange-900/40",
};

const nodeLabels: Record<string, { name: string; subtitle: string }> = {
  start: { name: "Start Node", subtitle: "Workflow entry point" },
  end: { name: "End Node", subtitle: "Workflow termination" },
  task: { name: "Task Node", subtitle: "Configure this step" },
  decision: { name: "Decision Node", subtitle: "Conditional branching" },
  timer: { name: "Timer Node", subtitle: "Wait / delay step" },
  email: { name: "Email Node", subtitle: "Send notification" },
  subprocess: { name: "Subprocess Node", subtitle: "Nested workflow" },
  system: { name: "System Node", subtitle: "Automated action" },
  parallel: { name: "Parallel Gateway", subtitle: "Fork or join paths" },
  wait_signal: { name: "Wait for Signal", subtitle: "Pause until external trigger" },
};

/* ================================================================== */
/*  Action-button presets                                              */
/* ================================================================== */

const ACTION_PRESETS: Record<string, { label: string; description: string; buttons: ActionButton[] }> = {
  approve_return_reject: {
    label: "Approve · Return · Reject",
    description: "3-button: approve, send back for changes, or decline",
    buttons: [
      { id: "approve", label: "Approve", action: "APPROVED", color: "green", requiresComment: false, requiresUserSelect: false },
      { id: "return", label: "Return for Amendments", action: "RETURNED", color: "amber", requiresComment: true, requiresUserSelect: false },
      { id: "reject", label: "Reject", action: "REJECTED", color: "red", requiresComment: true, requiresUserSelect: false },
    ],
  },
  approve_reject: {
    label: "Approve · Reject",
    description: "2-button: approve or decline",
    buttons: [
      { id: "approve", label: "Approve", action: "APPROVED", color: "green", requiresComment: false, requiresUserSelect: false },
      { id: "reject", label: "Reject", action: "REJECTED", color: "red", requiresComment: true, requiresUserSelect: false },
    ],
  },
  submit_withdraw: {
    label: "Resubmit · Withdraw",
    description: "2-button: resubmit amended request or cancel",
    buttons: [
      { id: "resubmit", label: "Resubmit", action: "APPROVED", color: "green", requiresComment: false, requiresUserSelect: false },
      { id: "withdraw", label: "Withdraw", action: "REJECTED", color: "red", requiresComment: false, requiresUserSelect: false },
    ],
  },
  acknowledge: {
    label: "Acknowledge",
    description: "1-button: confirm receipt or review",
    buttons: [
      { id: "acknowledge", label: "Acknowledge", action: "APPROVED", color: "blue", requiresComment: false, requiresUserSelect: false },
    ],
  },
  circulate: {
    label: "Circulate",
    description: "1-button: route to another user",
    buttons: [
      { id: "circulate", label: "Circulate", action: "DELEGATED", color: "purple", requiresComment: false, requiresUserSelect: true },
    ],
  },
};

const BUTTON_COLORS: ActionButton["color"][] = [
  "green", "red", "amber", "blue", "purple", "gray",
  "orange", "teal", "pink", "indigo", "cyan", "yellow",
];

const colorChipCls: Record<ActionButton["color"], string> = {
  green:  "bg-green-500",
  red:    "bg-red-500",
  amber:  "bg-amber-500",
  blue:   "bg-blue-500",
  purple: "bg-purple-500",
  gray:   "bg-gray-500",
  orange: "bg-orange-500",
  teal:   "bg-teal-500",
  pink:   "bg-pink-500",
  indigo: "bg-indigo-500",
  cyan:   "bg-cyan-500",
  yellow: "bg-yellow-400",
};

/* ------------------------------------------------------------------ */
/*  Form field fetched from the form template API                      */
/* ------------------------------------------------------------------ */

interface FormTemplateField {
  id: string;
  name: string;
  label: string;
  type: string;
}

/* ================================================================== */
/*  Custom Fields Tab Component                                        */
/* ================================================================== */

interface CustomField {
  id: string;
  label: string;
  type: "text" | "textarea" | "number" | "select" | "checkbox" | "date" | "file";
  required: boolean;
  placeholder?: string;
  options?: string;
}

const FIELD_TYPES: { value: CustomField["type"]; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "textarea", label: "Long Text" },
  { value: "number", label: "Number" },
  { value: "select", label: "Dropdown" },
  { value: "checkbox", label: "Checkbox" },
  { value: "date", label: "Date" },
  { value: "file", label: "File Upload" },
];

function CustomFieldsTab({
  data,
  onUpdate,
  nodeId,
}: {
  data: TaskNodeDataExtended & Record<string, unknown>;
  onUpdate: (nodeId: string, data: Record<string, unknown>) => void;
  nodeId: string;
}) {
  const fields: CustomField[] = (data.customFields as CustomField[]) ?? [];

  function save(next: CustomField[]) {
    onUpdate(nodeId, { ...data, customFields: next });
  }

  function addField() {
    save([
      ...fields,
      { id: `cf_${Date.now()}`, label: "New Field", type: "text", required: false, placeholder: "" },
    ]);
  }

  function updateField(id: string, patch: Partial<CustomField>) {
    save(fields.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  function removeField(id: string) {
    save(fields.filter((f) => f.id !== id));
  }

  function moveField(idx: number, dir: "up" | "down") {
    if (dir === "up" && idx === 0) return;
    if (dir === "down" && idx === fields.length - 1) return;
    const next = [...fields];
    const swap = dir === "up" ? idx - 1 : idx + 1;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    save(next);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
          Define custom form fields that assignees fill when completing this step.
        </p>
        {fields.length > 0 && (
          <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">
            {fields.length}
          </span>
        )}
      </div>

      {fields.length === 0 ? (
        <div className="py-6 text-center rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700">
          <svg className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h7.5M8.25 12h7.5m-7.5 5.25h7.5M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
          </svg>
          <p className="text-xs text-gray-400 dark:text-gray-500">No custom fields yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {fields.map((field, idx) => (
            <div
              key={field.id}
              className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700 space-y-2"
            >
              {/* Field header */}
              <div className="flex items-center justify-between gap-1">
                <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 truncate flex-1">
                  {field.label || "Untitled Field"}
                </span>
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <button type="button" onClick={() => moveField(idx, "up")} disabled={idx === 0}
                    className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-30 transition-colors" title="Move up">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" /></svg>
                  </button>
                  <button type="button" onClick={() => moveField(idx, "down")} disabled={idx === fields.length - 1}
                    className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-30 transition-colors" title="Move down">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
                  </button>
                  <button type="button" onClick={() => removeField(field.id)}
                    className="p-1 rounded text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors" title="Remove">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              </div>

              {/* Label + Type */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className={labelCls}>Label</label>
                  <input
                    type="text"
                    value={field.label}
                    onChange={(e) => updateField(field.id, { label: e.target.value })}
                    placeholder="Field label"
                    className={inputCls}
                  />
                </div>
                <div className="space-y-1">
                  <label className={labelCls}>Type</label>
                  <select
                    value={field.type}
                    onChange={(e) => updateField(field.id, { type: e.target.value as CustomField["type"] })}
                    className={selectCls}
                  >
                    {FIELD_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Placeholder (not for checkbox/file) */}
              {field.type !== "checkbox" && field.type !== "file" && (
                <div className="space-y-1">
                  <label className={labelCls}>Placeholder</label>
                  <input
                    type="text"
                    value={field.placeholder ?? ""}
                    onChange={(e) => updateField(field.id, { placeholder: e.target.value })}
                    placeholder="e.g. Enter value..."
                    className={inputCls}
                  />
                </div>
              )}

              {/* Options (select only) */}
              {field.type === "select" && (
                <div className="space-y-1">
                  <label className={labelCls}>Options <span className="text-gray-400 font-normal">(comma-separated)</span></label>
                  <input
                    type="text"
                    value={field.options ?? ""}
                    onChange={(e) => updateField(field.id, { options: e.target.value })}
                    placeholder="Option 1, Option 2, Option 3"
                    className={inputCls}
                  />
                </div>
              )}

              {/* Required toggle */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id={`req_${field.id}`}
                  checked={field.required}
                  onChange={(e) => updateField(field.id, { required: e.target.checked })}
                  className={checkboxCls}
                />
                <label htmlFor={`req_${field.id}`} className="text-xs text-gray-600 dark:text-gray-400">
                  Required field
                </label>
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={addField}
        className="w-full px-3 py-2 rounded-xl border border-dashed border-gray-300 dark:border-gray-600 text-xs font-medium text-gray-500 dark:text-gray-400 hover:border-karu-green hover:text-karu-green dark:hover:border-karu-green dark:hover:text-karu-green transition-colors flex items-center justify-center gap-1.5"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        Add Field
      </button>
    </div>
  );
}

/* ================================================================== */
/*  Form Layout Tab Component                                          */
/* ================================================================== */

function FormLayoutTab({
  data,
  updateField,
  onUpdate,
  nodeId,
}: {
  data: TaskNodeDataExtended & Record<string, unknown>;
  updateField: (field: string, value: unknown) => void;
  onUpdate: (nodeId: string, data: Record<string, unknown>) => void;
  nodeId: string;
}) {
  const [formFields, setFormFields] = useState<FormTemplateField[]>([]);
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [fieldsError, setFieldsError] = useState<string | null>(null);

  const fieldConfig: FieldConfig[] = (data.fieldConfig as FieldConfig[]) ?? [];

  /* Fetch form template fields when formTemplateId changes */
  useEffect(() => {
    const templateId = data.formTemplateId;
    if (!templateId) {
      setFormFields([]);
      setFieldsError(null);
      return;
    }

    let cancelled = false;
    setFieldsLoading(true);
    setFieldsError(null);

    fetch(`/api/forms/${templateId}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load form template");
        return res.json();
      })
      .then((json) => {
        if (cancelled) return;
        const fields: FormTemplateField[] = (json.fields ?? [])
          .filter((f: Record<string, unknown>) => f.type !== "section" && f.type !== "divider")
          .map((f: Record<string, unknown>) => ({
            id: f.id as string,
            name: f.name as string,
            label: f.label as string,
            type: f.type as string,
          }));
        setFormFields(fields);
      })
      .catch((err) => {
        if (cancelled) return;
        setFieldsError(err.message ?? "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setFieldsLoading(false);
      });

    return () => { cancelled = true; };
  }, [data.formTemplateId]);

  /* ---- Helper: update a single field's visibility ---- */
  function setFieldVisibility(fieldName: string, visibility: FieldConfig["visibility"]) {
    const existing = fieldConfig.find((f) => f.fieldName === fieldName);
    let next: FieldConfig[];
    if (existing) {
      next = fieldConfig.map((f) => f.fieldName === fieldName ? { ...f, visibility } : f);
    } else {
      next = [...fieldConfig, { fieldName, visibility }];
    }
    onUpdate(nodeId, { ...data, fieldConfig: next });
  }

  /* ---- Helper: bulk set all fields ---- */
  function setAllFieldsVisibility(visibility: FieldConfig["visibility"]) {
    const next: FieldConfig[] = formFields.map((f) => ({
      fieldName: f.name,
      visibility,
    }));
    onUpdate(nodeId, { ...data, fieldConfig: next });
  }

  /* ---- Helper: get current visibility for a field ---- */
  function getFieldVisibility(fieldName: string): FieldConfig["visibility"] {
    return fieldConfig.find((f) => f.fieldName === fieldName)?.visibility ?? "visible";
  }

  return (
    <div className="space-y-3">
      {/* ---- Step Layout ---- */}
      <CollapsibleSection title="Step Layout" defaultOpen={true}>
        <Field>
          <Label>Layout Mode</Label>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ["full", "Full Form", "M4 5h16v14H4z"],
                ["split", "Split View", "M4 5h7v14H4zM13 5h7v14h-7z"],
                ["compact", "Compact", "M4 9h16v6H4z"],
              ] as const
            ).map(([value, label, pathD]) => (
              <button
                key={value}
                type="button"
                onClick={() => updateField("stepLayout", value)}
                className={`flex flex-col items-center gap-1 p-2 rounded-lg border-2 transition-all ${
                  (data.stepLayout ?? "full") === value
                    ? "border-karu-green bg-karu-green/5 dark:bg-karu-green/10"
                    : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                }`}
              >
                <svg
                  className={`w-5 h-5 ${
                    (data.stepLayout ?? "full") === value
                      ? "text-karu-green"
                      : "text-gray-400"
                  }`}
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <rect x="3" y="4" width="18" height="16" rx="2" strokeWidth={1.5} />
                  <path strokeLinecap="round" strokeLinejoin="round" d={pathD} strokeWidth={0.5} fill="currentColor" opacity={0.15} />
                </svg>
                <span
                  className={`text-[10px] font-semibold ${
                    (data.stepLayout ?? "full") === value
                      ? "text-karu-green"
                      : "text-gray-500 dark:text-gray-400"
                  }`}
                >
                  {label}
                </span>
              </button>
            ))}
          </div>
          <HelpText>
            {(data.stepLayout ?? "full") === "full"
              ? "Form fields take the full width of the view."
              : (data.stepLayout ?? "full") === "split"
                ? "Form on the left, document viewer on the right."
                : "Minimal view showing only action buttons."}
          </HelpText>
        </Field>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="showDocumentViewer"
            checked={!!data.showDocumentViewer}
            onChange={(e) => updateField("showDocumentViewer", e.target.checked)}
            className={checkboxCls}
          />
          <label
            htmlFor="showDocumentViewer"
            className="text-xs text-gray-700 dark:text-gray-300"
          >
            Show document viewer alongside form
          </label>
        </div>

        <Field>
          <Label>Section Title</Label>
          <input
            type="text"
            value={(data.sectionTitle as string) ?? ""}
            onChange={(e) => updateField("sectionTitle", e.target.value)}
            placeholder='e.g. "Recommendation", "Final Approval"'
            className={inputCls}
          />
          <HelpText>Custom heading displayed above this step&apos;s form.</HelpText>
        </Field>
      </CollapsibleSection>

      <Divider />

      {/* ---- Field Configuration ---- */}
      <CollapsibleSection title="Field Configuration" defaultOpen={true}>
        {!data.formTemplateId ? (
          <div className="p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-200 dark:border-amber-800">
            <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
              Link a form template in the Assignment tab to configure field layout.
            </p>
          </div>
        ) : fieldsLoading ? (
          <div className="flex items-center gap-2 py-3">
            <svg className="animate-spin h-4 w-4 text-karu-green" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-xs text-gray-500 dark:text-gray-400">Loading form fields...</span>
          </div>
        ) : fieldsError ? (
          <div className="p-3 bg-red-50 dark:bg-red-950/20 rounded-lg border border-red-200 dark:border-red-800">
            <p className="text-xs text-red-700 dark:text-red-400">
              {fieldsError}
            </p>
          </div>
        ) : formFields.length === 0 ? (
          <p className="text-xs text-gray-400 dark:text-gray-500 italic">
            No configurable fields found in this form template.
          </p>
        ) : (
          <>
            {/* Quick actions */}
            <div className="flex gap-1.5 flex-wrap">
              {(
                [
                  ["visible", "All Visible"],
                  ["readonly", "All Read-only"],
                  ["hidden", "All Hidden"],
                ] as const
              ).map(([vis, label]) => (
                <button
                  key={vis}
                  type="button"
                  onClick={() => setAllFieldsVisibility(vis)}
                  className="px-2 py-1 rounded-md text-[10px] font-medium border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-karu-green hover:text-karu-green dark:hover:border-karu-green dark:hover:text-karu-green transition-colors"
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Field table */}
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
                    <th className="px-2.5 py-1.5 text-left text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Field
                    </th>
                    <th className="px-2.5 py-1.5 text-left text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Visibility
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {formFields.map((field) => (
                    <tr key={field.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors">
                      <td className="px-2.5 py-1.5">
                        <span className="text-gray-700 dark:text-gray-300">{field.label}</span>
                        <span className="ml-1 text-[10px] text-gray-400 dark:text-gray-600">
                          ({field.type})
                        </span>
                      </td>
                      <td className="px-2.5 py-1.5">
                        <select
                          value={getFieldVisibility(field.name)}
                          onChange={(e) =>
                            setFieldVisibility(field.name, e.target.value as FieldConfig["visibility"])
                          }
                          className="h-7 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-1.5 text-[11px] text-gray-900 dark:text-gray-100 focus:border-karu-green focus:ring-1 focus:ring-karu-green/20 outline-none"
                        >
                          <option value="visible">Visible</option>
                          <option value="editable">Editable</option>
                          <option value="readonly">Read-only</option>
                          <option value="hidden">Hidden</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CollapsibleSection>

    </div>
  );
}

/* ================================================================== */
/*  Main Component                                                     */
/* ================================================================== */

export default function NodeConfigPanel({
  node,
  nodes = [],
  onUpdate,
  onDelete,
}: NodeConfigPanelProps) {
  const [taskTab, setTaskTab] = useState<
    "general" | "assignment" | "sla" | "notifications" | "form_layout" | "custom_fields"
  >("general");

  /* ── Workflow pools ── */
  const [pools, setPools] = useState<{ id: string; name: string; _count?: { members: number } }[]>([]);

  useEffect(() => {
    fetch("/api/workflows/pools")
      .then((r) => r.ok ? r.json() : { pools: [] })
      .then((d) => setPools(d.pools ?? []));
  }, []);

  /* ── System roles (for Escalate To) ── */
  const [systemRoles, setSystemRoles] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    fetch("/api/admin/roles")
      .then((r) => r.ok ? r.json() : { roles: [] })
      .then((d) => setSystemRoles(d.roles ?? []));
  }, []);

  /* ── Form templates (for condition field pickers + create_delegation) ── */
  const [formTemplates, setFormTemplates] = useState<{
    id: string;
    name: string;
    fields: { name: string; label: string; type: string; options?: string[] }[];
  }[]>([]);

  useEffect(() => {
    fetch("/api/forms?active=true")
      .then((r) => r.ok ? r.json() : { templates: [] })
      .then((d) => setFormTemplates(
        (d.templates ?? []).map((t: { id: string; name: string; fields: unknown }) => ({
          id: t.id,
          name: t.name,
          fields: Array.isArray(t.fields)
            ? (t.fields as { name: string; label: string; type: string; options?: string[] }[]).filter(
                (f) => f.type !== "section" && f.type !== "divider"
              )
            : [],
        }))
      ));
  }, []);

  /* ── Form Data datasets (for lookup/update system nodes + condition field picker) ── */
  const [fdDatasets, setFdDatasets] = useState<{
    id: string; name: string; slug: string;
    fields: { name: string; label: string; type: string; options?: string[] }[];
  }[]>([]);
  const [fdFields, setFdFields] = useState<Record<string, string[]>>({});

  useEffect(() => {
    fetch("/api/admin/form-data")
      .then((r) => r.ok ? r.json() : { schemas: [] })
      .then((d) => setFdDatasets(
        (d.schemas ?? []).map((s: {
          id: string; name: string; slug: string;
          fields?: { name: string; label: string; type: string; options?: string[] }[];
        }) => ({
          id: s.id,
          name: s.name,
          slug: s.slug,
          fields: Array.isArray(s.fields)
            ? (s.fields as { name: string; label: string; type: string; options?: string[] }[])
            : [],
        }))
      ));
  }, []);

  const loadFieldsForSlug = useCallback((slug: string) => {
    if (!slug || fdFields[slug]) return;
    const ds = fdDatasets.find((d) => d.slug === slug);
    if (!ds) return;
    fetch(`/api/admin/form-data/${ds.id}`)
      .then((r) => r.ok ? r.json() : { schema: null })
      .then((d) => {
        const fields = (d.schema?.fields ?? []).map((f: { name: string }) => f.name) as string[];
        setFdFields((prev) => ({ ...prev, [slug]: fields }));
      });
  }, [fdDatasets, fdFields]);

  const updateField = useCallback(
    (field: string, value: unknown) => {
      onUpdate(node.id, { ...node.data, [field]: value });
    },
    [node.id, node.data, onUpdate]
  );

  const updateFields = useCallback(
    (updates: Record<string, unknown>) => {
      onUpdate(node.id, { ...node.data, ...updates });
    },
    [node.id, node.data, onUpdate]
  );

  const nodeType = node.type ?? "unknown";
  const meta = nodeLabels[nodeType];
  const icon = icons[nodeType as keyof typeof icons];
  const iconBg = iconBgByType[nodeType] ?? "bg-gray-100 dark:bg-gray-800";

  /* ---------------------------------------------------------------- */
  /*  Panel header (shared across all types)                           */
  /* ---------------------------------------------------------------- */
  function PanelHeader() {
    const canDelete = nodeType !== "start";
    return (
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={`w-8 h-8 rounded-lg ${iconBg} flex items-center justify-center flex-shrink-0`}
          >
            {icon}
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">
              {meta?.name ?? "Node"}
            </h3>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
              {meta?.subtitle ?? ""}
            </p>
          </div>
        </div>
        {canDelete && (
          <button
            type="button"
            onClick={() => onDelete(node.id)}
            className="flex-shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
            title="Delete node"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
              />
            </svg>
          </button>
        )}
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /*  Delete footer (shared)                                           */
  /* ---------------------------------------------------------------- */
  function DeleteFooter() {
    if (nodeType === "start") return null;
    return (
      <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
        <button type="button" onClick={() => onDelete(node.id)} className={deleteBtnCls}>
          Remove Node
        </button>
      </div>
    );
  }

  /* ================================================================ */
  /*  START NODE                                                       */
  /* ================================================================ */
  if (nodeType === "start") {
    return (
      <div className="space-y-4">
        <PanelHeader />
        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          This is the starting point of your workflow. Every workflow must have
          exactly one start node. It is automatically placed when you create a
          new workflow.
        </p>
      </div>
    );
  }

  /* ================================================================ */
  /*  END NODE                                                         */
  /* ================================================================ */
  if (nodeType === "end") {
    const data = node.data as { label?: string; outcome?: string } & Record<string, unknown>;

    const OUTCOME_PRESETS: { outcome: string; label: string; dot: string }[] = [
      { outcome: "approved",  label: "✓ End: Approved",       dot: "bg-green-500" },
      { outcome: "rejected",  label: "✗ End: Rejected",       dot: "bg-red-500" },
      { outcome: "withdrawn", label: "End: Withdrawn",        dot: "bg-gray-400" },
      { outcome: "cancelled", label: "End: Cancelled",        dot: "bg-gray-400" },
      { outcome: "error",     label: "End: Not Processed",    dot: "bg-orange-500" },
    ];

    return (
      <div className="space-y-4">
        <PanelHeader />

        {/* Presets */}
        <div className="space-y-1.5">
          <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Quick Presets
          </span>
          <div className="grid grid-cols-1 gap-1">
            {OUTCOME_PRESETS.map((p) => (
              <button
                key={p.outcome}
                type="button"
                onClick={() => onUpdate(node.id, { ...data, label: p.label, outcome: p.outcome })}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-all group ${
                  data.outcome === p.outcome
                    ? "border-karu-green bg-karu-green/5 dark:bg-karu-green/10"
                    : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-karu-green hover:bg-karu-green/5 dark:hover:bg-karu-green/10"
                }`}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${p.dot}`} />
                <span className={`text-[11px] font-semibold ${
                  data.outcome === p.outcome
                    ? "text-karu-green"
                    : "text-gray-700 dark:text-gray-200 group-hover:text-karu-green"
                }`}>
                  {p.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        <Divider />

        <Field>
          <Label>Label</Label>
          <input
            type="text"
            value={(data.label as string) ?? ""}
            onChange={(e) => updateField("label", e.target.value)}
            placeholder="e.g. ✓ End: Approved"
            className={inputCls}
          />
          <HelpText>Shown below the node on the canvas.</HelpText>
        </Field>

        <Field>
          <Label>Outcome Type</Label>
          <select
            value={(data.outcome as string) ?? "rejected"}
            onChange={(e) => updateField("outcome", e.target.value)}
            className={selectCls}
          >
            <option value="approved">Approved — green</option>
            <option value="rejected">Rejected — red</option>
            <option value="withdrawn">Withdrawn — gray</option>
            <option value="cancelled">Cancelled — gray</option>
            <option value="error">Not Processed / Error — orange</option>
          </select>
          <HelpText>Controls the node colour on the canvas.</HelpText>
        </Field>

        <DeleteFooter />
      </div>
    );
  }

  /* ================================================================ */
  /*  TASK NODE                                                        */
  /* ================================================================ */
  if (nodeType === "task") {
    const data = node.data as TaskNodeDataExtended & Record<string, unknown>;

    return (
      <div className="space-y-4">
        <PanelHeader />

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl flex-wrap">
          {(
            [
              ["general", "General"],
              ["assignment", "Assignment"],
              ["sla", "SLA"],
              ["notifications", "Notify"],
              ["custom_fields", "Fields"],
              ["form_layout", "Layout"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTaskTab(key)}
              className={tabCls(taskTab === key)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ---- General Tab ---- */}
        {taskTab === "general" && (() => {
          const actionButtons: ActionButton[] = (data.actionButtons as ActionButton[]) ?? [];

          function addActionButton() {
            const id = `btn_${Date.now()}`;
            onUpdate(node.id, { ...data, actionButtons: [...actionButtons, { id, label: "New Action", action: "APPROVED", color: "green", requiresComment: false, requiresUserSelect: false }] });
          }
          function removeActionButton(id: string) {
            onUpdate(node.id, { ...data, actionButtons: actionButtons.filter((b) => b.id !== id) });
          }
          function updateActionButton(id: string, patch: Partial<ActionButton>) {
            onUpdate(node.id, { ...data, actionButtons: actionButtons.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
          }
          function moveActionButton(idx: number, dir: "up" | "down") {
            if (dir === "up" && idx === 0) return;
            if (dir === "down" && idx === actionButtons.length - 1) return;
            const next = [...actionButtons];
            const swap = dir === "up" ? idx - 1 : idx + 1;
            [next[idx], next[swap]] = [next[swap], next[idx]];
            onUpdate(node.id, { ...data, actionButtons: next });
          }
          function applyPreset(presetKey: string) {
            const preset = ACTION_PRESETS[presetKey];
            if (preset) {
              const stamped = preset.buttons.map((b) => ({ ...b, id: `${b.id}_${Date.now()}` }));
              onUpdate(node.id, { ...data, actionButtons: stamped });
            }
          }

          return (
          <div className="space-y-3">
            <Field>
              <Label required>Step Name</Label>
              <input
                type="text"
                value={data.label ?? ""}
                onChange={(e) => updateField("label", e.target.value)}
                placeholder="e.g. Department Head Review"
                className={inputCls}
              />
            </Field>

            <Field>
              <Label>Task Type</Label>
              <select
                value={data.taskType ?? "approval"}
                onChange={(e) => updateField("taskType", e.target.value)}
                className={selectCls}
              >
                <option value="approval">Approval</option>
                <option value="review">Review</option>
                <option value="notification">Notification</option>
                <option value="action">Action</option>
              </select>
            </Field>

            <Field>
              <Label>Description</Label>
              <textarea
                value={data.description ?? ""}
                onChange={(e) => updateField("description", e.target.value)}
                rows={2}
                placeholder="What should the assignee do?"
                className={textareaCls}
              />
            </Field>

            <Field>
              <Label>Required Action</Label>
              <select
                value={(data.requiredAction as string) ?? "any"}
                onChange={(e) => updateField("requiredAction", e.target.value)}
                className={selectCls}
              >
                <option value="approve">Approve</option>
                <option value="reject">Reject</option>
                <option value="return">Return</option>
                <option value="any">Any</option>
              </select>
            </Field>

            <Divider />

            {/* ---- Action Buttons ---- */}
            <CollapsibleSection title="Action Buttons" defaultOpen={true}>
              {/* Presets */}
              <div className="space-y-1.5">
                <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Quick Presets
                </span>
                <div className="grid grid-cols-1 gap-1">
                  {Object.entries(ACTION_PRESETS).map(([key, preset]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => applyPreset(key)}
                      className="flex items-center justify-between px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-karu-green hover:bg-karu-green/5 dark:hover:border-karu-green dark:hover:bg-karu-green/10 transition-all group text-left"
                    >
                      <div>
                        <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-200 group-hover:text-karu-green block">
                          {preset.label}
                        </span>
                        <span className="text-[10px] text-gray-400 dark:text-gray-500">
                          {preset.description}
                        </span>
                      </div>
                      <div className="flex gap-1 ml-2 shrink-0">
                        {preset.buttons.map((b) => (
                          <span key={b.id} className={`w-2 h-2 rounded-full ${colorChipCls[b.color]}`} />
                        ))}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Button list */}
              {actionButtons.length === 0 && (
                <p className="text-xs text-gray-400 dark:text-gray-500 italic">
                  No buttons yet. Click a preset above or add manually.
                </p>
              )}

              {actionButtons.map((btn, idx) => (
                <div
                  key={btn.id}
                  className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2.5 h-2.5 rounded-full ${colorChipCls[btn.color]}`} />
                      <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">
                        {btn.label || "Button"}
                      </span>
                    </div>
                    <div className="flex items-center gap-0.5">
                      <button type="button" onClick={() => moveActionButton(idx, "up")} disabled={idx === 0}
                        className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-30 transition-colors" title="Move up">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                        </svg>
                      </button>
                      <button type="button" onClick={() => moveActionButton(idx, "down")} disabled={idx === actionButtons.length - 1}
                        className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-30 transition-colors" title="Move down">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                        </svg>
                      </button>
                      <button type="button" onClick={() => removeActionButton(btn.id)}
                        className="p-1 rounded text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors" title="Remove button">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Field>
                      <Label>Label</Label>
                      <input type="text" value={btn.label}
                        onChange={(e) => updateActionButton(btn.id, { label: e.target.value })}
                        placeholder="Button text" className={inputCls} />
                    </Field>
                    <Field>
                      <Label>Action</Label>
                      <select value={btn.action}
                        onChange={(e) => updateActionButton(btn.id, { action: e.target.value })}
                        className={selectCls}>
                        <option value="APPROVED">APPROVED</option>
                        <option value="REJECTED">REJECTED</option>
                        <option value="RETURNED">RETURNED</option>
                        <option value="DELEGATED">DELEGATED</option>
                        <option value="CUSTOM">Custom...</option>
                      </select>
                    </Field>
                  </div>

                  <Field>
                    <Label>Color</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {BUTTON_COLORS.map((c) => (
                        <button key={c} type="button"
                          onClick={() => updateActionButton(btn.id, { color: c })}
                          className={`w-5 h-5 rounded-full border-2 transition-all ${colorChipCls[c]} ${
                            btn.color === c
                              ? "border-gray-900 dark:border-white scale-110 ring-2 ring-offset-1 ring-gray-400 dark:ring-gray-500 dark:ring-offset-gray-900"
                              : "border-transparent opacity-60 hover:opacity-100"
                          }`}
                          title={c}
                        />
                      ))}
                    </div>
                  </Field>

                  <div className="flex gap-4">
                    <div className="flex items-center gap-1.5">
                      <input type="checkbox" id={`reqComment_${btn.id}`} checked={btn.requiresComment}
                        onChange={(e) => updateActionButton(btn.id, { requiresComment: e.target.checked })}
                        className={checkboxCls} />
                      <label htmlFor={`reqComment_${btn.id}`} className="text-[11px] text-gray-600 dark:text-gray-400">
                        Require comment
                      </label>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input type="checkbox" id={`reqUser_${btn.id}`} checked={btn.requiresUserSelect}
                        onChange={(e) => updateActionButton(btn.id, { requiresUserSelect: e.target.checked })}
                        className={checkboxCls} />
                      <label htmlFor={`reqUser_${btn.id}`} className="text-[11px] text-gray-600 dark:text-gray-400">
                        Require user select
                      </label>
                    </div>
                  </div>
                </div>
              ))}

              <button type="button" onClick={addActionButton}
                className="w-full px-3 py-2 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 text-xs font-medium text-gray-500 dark:text-gray-400 hover:border-karu-green hover:text-karu-green dark:hover:border-karu-green dark:hover:text-karu-green transition-colors">
                + Add Action Button
              </button>
            </CollapsibleSection>
          </div>
          );
        })()}

        {/* ---- Assignment Tab ---- */}
        {taskTab === "assignment" && (
          <div className="space-y-3">
            <Field>
              <Label>Assignee Rule</Label>
              <select
                value={data.assigneeRule ?? "specific_user"}
                onChange={(e) => updateField("assigneeRule", e.target.value)}
                className={selectCls}
              >
                <option value="specific_user">Specific User</option>
                <option value="role_based">Role-based</option>
                <option value="department">Department</option>
                <option value="initiator">Initiator</option>
                <option value="initiator_manager">
                  Initiator&apos;s Manager
                </option>
                <option value="round_robin">Round Robin</option>
                <option value="least_loaded">Least Loaded</option>
                <option value="pool">Pool / Shared Queue</option>
              </select>
              <HelpText>
                Determines how the task is assigned at runtime.
              </HelpText>
            </Field>

            {/* Show value input for rules that need one */}
            {(data.assigneeRule === "specific_user" ||
              data.assigneeRule === "role_based" ||
              data.assigneeRule === "department") && (
              <Field>
                <Label>
                  {data.assigneeRule === "specific_user"
                    ? "User"
                    : data.assigneeRule === "role_based"
                      ? "Role"
                      : "Department"}
                </Label>
                <input
                  type="text"
                  value={data.assigneeValue ?? ""}
                  onChange={(e) =>
                    updateField("assigneeValue", e.target.value)
                  }
                  placeholder={
                    data.assigneeRule === "specific_user"
                      ? "Search for a user..."
                      : data.assigneeRule === "role_based"
                        ? "e.g. DEPARTMENT_HEAD"
                        : "e.g. Finance"
                  }
                  className={inputCls}
                />
              </Field>
            )}

            {data.assigneeRule === "pool" && (
              <Field>
                <Label>Pool</Label>
                {pools.length === 0 ? (
                  <div className="flex items-center gap-2 h-9 px-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                    <svg className="animate-spin w-3.5 h-3.5 text-gray-400 shrink-0" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                    <span className="text-xs text-gray-400">Loading pools…</span>
                  </div>
                ) : (
                  <select
                    value={(data.assigneeValue as string) ?? ""}
                    onChange={(e) => updateField("assigneeValue", e.target.value)}
                    className={selectCls}
                  >
                    <option value="">— select a pool —</option>
                    {pools.map((p) => (
                      <option key={p.id} value={p.name}>
                        {p.name}{p._count?.members ? ` (${p._count.members} members)` : ""}
                      </option>
                    ))}
                  </select>
                )}
                <HelpText>Tasks land in this shared queue — any pool member can claim and complete them.</HelpText>
              </Field>
            )}

            <Divider />

            <CollapsibleSection title="Parallel Approval" defaultOpen={false}>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="parallelApproval"
                  checked={!!data.parallelApproval}
                  onChange={(e) =>
                    updateField("parallelApproval", e.target.checked)
                  }
                  className={checkboxCls}
                />
                <label
                  htmlFor="parallelApproval"
                  className="text-xs text-gray-700 dark:text-gray-300"
                >
                  Enable parallel approval
                </label>
              </div>

              {!!data.parallelApproval && (
                <Field>
                  <Label>Consensus Rule</Label>
                  <select
                    value={(data.approvalRule as string) ?? "all"}
                    onChange={(e) =>
                      updateField("approvalRule", e.target.value)
                    }
                    className={selectCls}
                  >
                    <option value="all">
                      All must approve
                    </option>
                    <option value="any">
                      Any one approves
                    </option>
                    <option value="majority">Majority approves</option>
                  </select>
                  <HelpText>
                    How many approvers must agree to move forward.
                  </HelpText>
                </Field>
              )}
            </CollapsibleSection>

            <Divider />

            <Field>
              <Label>Linked Form Template</Label>
              <input
                type="text"
                value={(data.formTemplateId as string) ?? ""}
                onChange={(e) =>
                  updateField("formTemplateId", e.target.value)
                }
                placeholder="Select or enter form template ID..."
                className={inputCls}
              />
              <HelpText>
                Attach a form for data capture during this task.
              </HelpText>
            </Field>
          </div>
        )}

        {/* ---- SLA Tab ---- */}
        {taskTab === "sla" && (() => {
          // slaValue is the user-facing number; never fall back to slaHours (which is in hours, not days)
          const slaUnit = (data.slaUnit as "hours" | "days") ?? "hours";
          const slaValue = data.slaValue != null ? (data.slaValue as number) : (data.slaHours as number) ?? 0;
          const escalationUnit = (data.escalationUnit as "hours" | "days") ?? "days";
          const escalationValue = data.escalationValue != null ? (data.escalationValue as number) : (data.escalationDays as number) ?? 0;
          const reminderUnit = (data.reminderUnit as "hours" | "days") ?? "days";
          const reminderValue = data.reminderValue != null ? (data.reminderValue as number) : (data.reminderDays as number) ?? 0;

          const unitSelectCls = "h-9 flex-shrink-0 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 transition-colors";

          return (
            <div className="space-y-3">
              <Field>
                <Label>SLA Target</Label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={slaValue || ""}
                    onChange={(e) => {
                      const v = parseInt(e.target.value) || 0;
                      updateFields({
                        slaValue: v,
                        slaUnit,
                        slaHours: slaUnit === "hours" ? v : v * 8,
                      });
                    }}
                    placeholder="e.g. 2"
                    className={inputCls}
                  />
                  <select
                    value={slaUnit}
                    onChange={(e) => {
                      const u = e.target.value as "hours" | "days";
                      updateFields({
                        slaUnit: u,
                        slaValue,
                        slaHours: u === "hours" ? slaValue : slaValue * 8,
                      });
                    }}
                    className={unitSelectCls}
                  >
                    <option value="hours">Business Hours</option>
                    <option value="days">Business Days</option>
                  </select>
                </div>
                <HelpText>
                  Expected completion time in business {slaUnit}. Leave empty for no SLA.
                </HelpText>
              </Field>

              <Divider />

              <CollapsibleSection title="Escalation" defaultOpen={escalationValue > 0}>
                <Field>
                  <Label>Escalation After</Label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={escalationValue || ""}
                      onChange={(e) => {
                        const v = parseInt(e.target.value) || 0;
                        updateFields({
                          escalationValue: v,
                          escalationUnit,
                          escalationDays: escalationUnit === "days" ? v : Math.ceil(v / 8),
                        });
                      }}
                      placeholder="e.g. 2"
                      className={inputCls}
                    />
                    <select
                      value={escalationUnit}
                      onChange={(e) => {
                        const u = e.target.value as "hours" | "days";
                        updateFields({
                          escalationUnit: u,
                          escalationValue,
                          escalationDays: u === "days" ? escalationValue : Math.ceil(escalationValue / 8),
                        });
                      }}
                      className={unitSelectCls}
                    >
                      <option value="hours">Business Hours</option>
                      <option value="days">Business Days</option>
                    </select>
                  </div>
                  <HelpText>
                    Auto-escalate if not completed within this time. Leave empty to disable.
                  </HelpText>
                </Field>

                {escalationValue > 0 && (
                  <Field>
                    <Label>Escalate To</Label>
                    <select
                      value={(data.escalationTo as string) ?? ""}
                      onChange={(e) => updateField("escalationTo", e.target.value)}
                      className={selectCls}
                    >
                      <option value="">— select a role —</option>
                      {systemRoles.map((r) => (
                        <option key={r.id} value={r.name}>{r.name}</option>
                      ))}
                    </select>
                    <HelpText>
                      Tasks will be escalated to any user holding this role.
                    </HelpText>
                  </Field>
                )}

                {escalationValue > 0 && (
                  <Field>
                    <Label>Reminder Before Escalation</Label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={reminderValue || ""}
                        onChange={(e) => {
                          const v = parseInt(e.target.value) || 0;
                          updateFields({
                            reminderValue: v,
                            reminderUnit,
                            reminderDays: reminderUnit === "days" ? v : Math.ceil(v / 8),
                          });
                        }}
                        placeholder="e.g. 1"
                        className={inputCls}
                      />
                      <select
                        value={reminderUnit}
                        onChange={(e) => {
                          const u = e.target.value as "hours" | "days";
                          updateFields({
                            reminderUnit: u,
                            reminderValue,
                            reminderDays: u === "days" ? reminderValue : Math.ceil(reminderValue / 8),
                          });
                        }}
                        className={unitSelectCls}
                      >
                        <option value="hours">Business Hours</option>
                        <option value="days">Business Days</option>
                      </select>
                    </div>
                    <HelpText>
                      Send a reminder this many business {reminderUnit} before the escalation deadline.
                    </HelpText>
                  </Field>
                )}
              </CollapsibleSection>

              <Divider />

              {/* ── Deadline ── */}
              {(() => {
                const deadlineType = (data.deadlineType as string) ?? "none";
                const deadlineRelativeValue = (data.deadlineRelativeValue as number) ?? 0;
                const deadlineRelativeUnit = (data.deadlineRelativeUnit as "hours" | "days") ?? "days";
                const deadlineFromField = (data.deadlineFromField as string) ?? "";
                const deadlineOffsetValue = (data.deadlineOffsetValue as number) ?? 0;
                const deadlineOffsetUnit = (data.deadlineOffsetUnit as "hours" | "days") ?? "days";
                const deadlineNotifyBefore = !!(data.deadlineNotifyBefore);
                const deadlineNotifyBeforeValue = (data.deadlineNotifyBeforeValue as number) ?? 1;
                const deadlineNotifyBeforeUnit = (data.deadlineNotifyBeforeUnit as "hours" | "days") ?? "days";
                const deadlineNotifyOverdue = !!(data.deadlineNotifyOverdue);
                const deadlineNotifyOverdueRole = (data.deadlineNotifyOverdueRole as string) ?? "";

                return (
                  <CollapsibleSection title="Deadline" defaultOpen={deadlineType !== "none"}>
                    <Field>
                      <Label>Deadline Type</Label>
                      <select
                        value={deadlineType}
                        onChange={(e) => updateField("deadlineType", e.target.value)}
                        className={selectCls}
                      >
                        <option value="none">No hard deadline</option>
                        <option value="relative">Relative — X hours/days after assignment</option>
                        <option value="from_field">From form field — dynamic date</option>
                      </select>
                      <HelpText>
                        SLA Target is a soft benchmark. A deadline is a hard cutoff tied to a real date (e.g. employee departure, contract expiry).
                      </HelpText>
                    </Field>

                    {deadlineType === "relative" && (
                      <Field>
                        <Label>Deadline After Assignment</Label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            inputMode="numeric"
                            value={deadlineRelativeValue || ""}
                            onChange={(e) => updateFields({
                              deadlineRelativeValue: parseInt(e.target.value) || 0,
                              deadlineRelativeUnit,
                            })}
                            placeholder="e.g. 3"
                            className={inputCls}
                          />
                          <select
                            value={deadlineRelativeUnit}
                            onChange={(e) => updateFields({
                              deadlineRelativeUnit: e.target.value as "hours" | "days",
                              deadlineRelativeValue,
                            })}
                            className="h-9 flex-shrink-0 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 transition-colors"
                          >
                            <option value="hours">Business Hours</option>
                            <option value="days">Business Days</option>
                          </select>
                        </div>
                        <HelpText>Task must be completed within this time from when it was assigned.</HelpText>
                      </Field>
                    )}

                    {deadlineType === "from_field" && (
                      <>
                        <Field>
                          <Label>Date Field</Label>
                          <input
                            type="text"
                            value={deadlineFromField}
                            onChange={(e) => updateField("deadlineFromField", e.target.value)}
                            placeholder="e.g. formData.departure_date"
                            className={inputCls}
                          />
                          <HelpText>Workflow variable holding the deadline date, e.g. <code>formData.travel_date</code> or <code>formData.contract_expiry</code>.</HelpText>
                        </Field>
                        <Field>
                          <Label>Offset Before Field Date</Label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              inputMode="numeric"
                              value={deadlineOffsetValue || ""}
                              onChange={(e) => updateFields({
                                deadlineOffsetValue: parseInt(e.target.value) || 0,
                                deadlineOffsetUnit,
                              })}
                              placeholder="0"
                              className={inputCls}
                            />
                            <select
                              value={deadlineOffsetUnit}
                              onChange={(e) => updateFields({
                                deadlineOffsetUnit: e.target.value as "hours" | "days",
                                deadlineOffsetValue,
                              })}
                              className="h-9 flex-shrink-0 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 transition-colors"
                            >
                              <option value="hours">Hours Before</option>
                              <option value="days">Days Before</option>
                            </select>
                          </div>
                          <HelpText>Deadline = field date minus this offset. Set to 0 to use the field date directly.</HelpText>
                        </Field>
                      </>
                    )}

                    {deadlineType !== "none" && (
                      <>
                        <Divider />
                        <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Deadline Notifications</p>

                        <div className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            id="deadlineNotifyBefore"
                            checked={deadlineNotifyBefore}
                            onChange={(e) => updateField("deadlineNotifyBefore", e.target.checked)}
                            className={checkboxCls}
                          />
                          <div className="flex-1">
                            <label htmlFor="deadlineNotifyBefore" className="text-xs text-gray-700 dark:text-gray-300 cursor-pointer">
                              Remind assignee before deadline
                            </label>
                            {deadlineNotifyBefore && (
                              <div className="flex gap-2 mt-1.5">
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={deadlineNotifyBeforeValue || ""}
                                  onChange={(e) => updateFields({
                                    deadlineNotifyBeforeValue: parseInt(e.target.value) || 1,
                                    deadlineNotifyBeforeUnit,
                                  })}
                                  placeholder="1"
                                  className="flex-1 h-8 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 text-xs text-gray-900 dark:text-gray-100 outline-none focus:border-karu-green"
                                />
                                <select
                                  value={deadlineNotifyBeforeUnit}
                                  onChange={(e) => updateFields({
                                    deadlineNotifyBeforeUnit: e.target.value as "hours" | "days",
                                    deadlineNotifyBeforeValue,
                                  })}
                                  className="h-8 flex-shrink-0 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 text-xs text-gray-900 dark:text-gray-100 outline-none focus:border-karu-green"
                                >
                                  <option value="hours">Hours Before</option>
                                  <option value="days">Days Before</option>
                                </select>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            id="deadlineNotifyOverdue"
                            checked={deadlineNotifyOverdue}
                            onChange={(e) => updateField("deadlineNotifyOverdue", e.target.checked)}
                            className={checkboxCls}
                          />
                          <div className="flex-1">
                            <label htmlFor="deadlineNotifyOverdue" className="text-xs text-gray-700 dark:text-gray-300 cursor-pointer">
                              Notify when deadline is missed
                            </label>
                            {deadlineNotifyOverdue && (
                              <div className="mt-1.5">
                                <select
                                  value={deadlineNotifyOverdueRole}
                                  onChange={(e) => updateField("deadlineNotifyOverdueRole", e.target.value)}
                                  className="w-full h-8 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 text-xs text-gray-900 dark:text-gray-100 outline-none focus:border-karu-green"
                                >
                                  <option value="">— notify assignee only —</option>
                                  {systemRoles.map((r) => (
                                    <option key={r.id} value={r.name}>{r.name}</option>
                                  ))}
                                </select>
                                <p className="text-[10px] text-gray-400 mt-0.5">Also notify this role when the deadline passes without completion.</p>
                              </div>
                            )}
                          </div>
                        </div>
                      </>
                    )}
                  </CollapsibleSection>
                );
              })()}
            </div>
          );
        })()}

        {/* ---- Notifications Tab ---- */}
        {taskTab === "notifications" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="notifyOnAssign"
                checked={!!data.notifyOnAssign}
                onChange={(e) =>
                  updateField("notifyOnAssign", e.target.checked)
                }
                className={checkboxCls}
              />
              <label
                htmlFor="notifyOnAssign"
                className="text-xs text-gray-700 dark:text-gray-300"
              >
                Notify assignee when task is assigned
              </label>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="notifyOnComplete"
                checked={!!data.notifyOnComplete}
                onChange={(e) =>
                  updateField("notifyOnComplete", e.target.checked)
                }
                className={checkboxCls}
              />
              <label
                htmlFor="notifyOnComplete"
                className="text-xs text-gray-700 dark:text-gray-300"
              >
                Notify initiator when task is completed
              </label>
            </div>

            <Divider />

            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
              Notifications are sent via the built-in notification system. Email
              notifications can be added using an Email node connected after this
              task.
            </p>
          </div>
        )}

        {/* ---- Form Layout Tab ---- */}
        {taskTab === "form_layout" && (
          <FormLayoutTab data={data} updateField={updateField} onUpdate={onUpdate} nodeId={node.id} />
        )}

        {taskTab === "custom_fields" && (
          <CustomFieldsTab data={data} onUpdate={onUpdate} nodeId={node.id} />
        )}

        <DeleteFooter />
      </div>
    );
  }

  /* ================================================================ */
  /*  DECISION NODE                                                    */
  /* ================================================================ */
  if (nodeType === "decision") {
    const data = node.data as DecisionNodeData & Record<string, unknown>;
    const conditions: ConditionItem[] = (data.conditions as ConditionItem[]) ?? [];

    function addCondition() {
      const id = `cond_${Date.now()}`;
      const next: ConditionItem[] = [
        ...conditions,
        {
          id,
          label: `Condition ${conditions.length + 1}`,
          field: "",
          operator: "equals",
          value: "",
          handleId: "yes",
        },
      ];
      onUpdate(node.id, { ...node.data, conditions: next });
    }

    function updateCondition(
      idx: number,
      key: keyof ConditionItem,
      value: string
    ) {
      const next = conditions.map((c, i) =>
        i === idx ? { ...c, [key]: value } : c
      );
      onUpdate(node.id, { ...node.data, conditions: next });
    }

    function removeCondition(idx: number) {
      const next = conditions.filter((_, i) => i !== idx);
      onUpdate(node.id, { ...node.data, conditions: next });
    }

    return (
      <div className="space-y-4">
        <PanelHeader />

        <Field>
          <Label required>Decision Label</Label>
          <input
            type="text"
            value={data.label ?? ""}
            onChange={(e) => updateField("label", e.target.value)}
            placeholder="e.g. Is Amount > 10000?"
            className={inputCls}
          />
        </Field>

        <Divider />

        {/* Legacy simple labels (still supported) */}
        <CollapsibleSection title="Path Labels" defaultOpen={true}>
          <Field>
            <Label>
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                Yes / Approve path label
              </span>
            </Label>
            <input
              type="text"
              value={(data.conditionYes as string) ?? ""}
              onChange={(e) => updateField("conditionYes", e.target.value)}
              placeholder="e.g. Approved"
              className={inputCls}
            />
          </Field>

          <Field>
            <Label>
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-red-500" />
                No / Reject path label
              </span>
            </Label>
            <input
              type="text"
              value={(data.conditionNo as string) ?? ""}
              onChange={(e) => updateField("conditionNo", e.target.value)}
              placeholder="e.g. Rejected"
              className={inputCls}
            />
          </Field>

          <Field>
            <Label>
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-gray-400" />
                Default path handle
              </span>
            </Label>
            <select
              value={(data.defaultHandle as string) ?? "default"}
              onChange={(e) => updateField("defaultHandle", e.target.value)}
              className={selectCls}
            >
              <option value="default">Default (bottom)</option>
              <option value="yes">Yes (right)</option>
              <option value="no">No (left)</option>
            </select>
            <HelpText>Fallback if no conditions match.</HelpText>
          </Field>
        </CollapsibleSection>

        <Divider />

        {/* Condition builder */}
        <CollapsibleSection title="Condition Rules" defaultOpen={conditions.length > 0}>
          {/* Source form template picker */}
          <Field>
            <Label>Condition Source</Label>
            <select
              value={(data.sourceFormTemplateId as string) ?? ""}
              onChange={(e) => updateField("sourceFormTemplateId", e.target.value)}
              className={selectCls}
            >
              <option value="">— select source to populate field list —</option>
              {formTemplates.length > 0 && (
                <optgroup label="Form Templates / Casefolders">
                  {formTemplates.map((t) => (
                    <option key={t.id} value={`ft:${t.id}`}>{t.name}</option>
                  ))}
                </optgroup>
              )}
              {fdDatasets.length > 0 && (
                <optgroup label="Data Registry">
                  {fdDatasets.map((d) => (
                    <option key={d.id} value={`fd:${d.slug}`}>{d.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
            <HelpText>Fields from this source will appear in the Field dropdown below.</HelpText>
          </Field>

          {conditions.length === 0 && (
            <p className="text-xs text-gray-400 dark:text-gray-500 italic">
              No conditions yet. Add a rule to enable expression-based routing.
            </p>
          )}

          {(() => {
            const srcRaw = (data.sourceFormTemplateId as string) ?? "";
            const isFd = srcRaw.startsWith("fd:");
            const isFt = srcRaw.startsWith("ft:");

            let templateFields: { name: string; label: string; type: string; options?: string[] }[] = [];
            let fieldGroupLabel = "Form Fields";

            if (isFt) {
              const ftId = srcRaw.slice(3);
              const srcTemplate = formTemplates.find((t) => t.id === ftId);
              templateFields = srcTemplate?.fields ?? [];
            } else if (isFd) {
              const slug = srcRaw.slice(3);
              const ds = fdDatasets.find((d) => d.slug === slug);
              if (ds) {
                templateFields = ds.fields.map((f) => ({
                  ...f,
                  name: `_lookup_${slug}.${f.name}`,
                }));
                fieldGroupLabel = `Data Registry: ${ds.name}`;
              }
            } else if (srcRaw && !isFt && !isFd) {
              // legacy bare id — treat as form template
              const srcTemplate = formTemplates.find((t) => t.id === srcRaw);
              templateFields = srcTemplate?.fields ?? [];
            }

            // Derive _lookup_* vars from lookup_form_data actions in other nodes
            const lookupVars: { name: string; label: string; type: string }[] = [];
            for (const n of nodes) {
              const actions = Array.isArray(n.data?.systemActions) ? n.data.systemActions as { type?: string; config?: Record<string, unknown> }[] : [];
              for (const a of actions) {
                if (a.type !== "lookup_form_data") continue;
                const prefix = (a.config?.resultPrefix as string) ?? "";
                const slug = (a.config?.slug as string) ?? "";
                if (!prefix || !slug) continue;
                const ds = fdDatasets.find((d) => d.slug === slug);
                for (const f of (ds?.fields ?? [])) {
                  lookupVars.push({
                    name: `_lookup_${prefix}.${f.name}`,
                    label: `${prefix} · ${f.label}`,
                    type: f.type,
                  });
                }
              }
            }

            const CONTEXT_VARS: { name: string; label: string; type: string }[] = [
              ...lookupVars,
              { name: "_action", label: "Last Action (APPROVED / RETURNED …)", type: "text" },
              { name: "instance.status", label: "Workflow Status", type: "text" },
            ];

            const allFields = [
              ...templateFields.map((f) => ({ ...f, group: "form" as const })),
              ...CONTEXT_VARS.map((v) => ({ ...v, group: "ctx" as const, options: undefined })),
            ];

            function operatorsFor(fieldName: string) {
              const f = allFields.find((x) => x.name === fieldName);
              const t = f?.type ?? "text";
              if (t === "number") return [
                ["equals", "="],
                ["not_equals", "≠"],
                ["greater_than", ">"],
                ["greater_than_or_equal", "≥"],
                ["less_than", "<"],
                ["less_than_or_equal", "≤"],
                ["not_empty", "is set"],
                ["empty", "is empty"],
              ];
              if (t === "date" || t === "datetime") return [
                ["equals", "Equals"],
                ["not_equals", "Not equals"],
                ["greater_than", "After"],
                ["less_than", "Before"],
                ["not_empty", "Is set"],
                ["empty", "Is empty"],
              ];
              if (t === "select" || t === "radio") return [
                ["equals", "Equals"],
                ["not_equals", "Not equals"],
                ["in_list", "In list"],
                ["not_empty", "Is set"],
                ["empty", "Is empty"],
              ];
              return [
                ["equals", "Equals"],
                ["not_equals", "Not equals"],
                ["contains", "Contains"],
                ["not_contains", "Does not contain"],
                ["not_empty", "Is set"],
                ["empty", "Is empty"],
                ["in_list", "In list"],
              ];
            }

            function valueOptionsFor(fieldName: string): string[] {
              const f = allFields.find((x) => x.name === fieldName);
              return (f as { options?: string[] })?.options ?? [];
            }

            return conditions.map((cond, idx) => {
              const ops = operatorsFor(cond.field);
              const valueOptions = valueOptionsFor(cond.field);
              const needsValue = cond.operator !== "empty" && cond.operator !== "not_empty";

              return (
                <div
                  key={cond.id}
                  className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase">
                      Rule {idx + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeCondition(idx)}
                      className="text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                      title="Remove rule"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  <Field>
                    <Label>Label</Label>
                    <input
                      type="text"
                      value={cond.label}
                      onChange={(e) => updateCondition(idx, "label", e.target.value)}
                      placeholder="Condition name"
                      className={inputCls}
                    />
                  </Field>

                  <Field>
                    <Label>Field</Label>
                    {allFields.length > 0 ? (
                      <select
                        value={cond.field}
                        onChange={(e) => updateCondition(idx, "field", e.target.value)}
                        className={selectCls}
                      >
                        <option value="">— select a field —</option>
                        {templateFields.length > 0 && (
                          <optgroup label={fieldGroupLabel}>
                            {templateFields.map((f) => (
                              <option key={f.name} value={f.name}>
                                {f.label} ({f.type})
                              </option>
                            ))}
                          </optgroup>
                        )}
                        <optgroup label="Workflow Context">
                          {CONTEXT_VARS.map((v) => (
                            <option key={v.name} value={v.name}>{v.label}</option>
                          ))}
                        </optgroup>
                        {/* keep manual value if it doesn't match any known field */}
                        {cond.field && !allFields.find((f) => f.name === cond.field) && (
                          <option value={cond.field}>{cond.field} (manual)</option>
                        )}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={cond.field}
                        onChange={(e) => updateCondition(idx, "field", e.target.value)}
                        placeholder="e.g. leave_days"
                        className={inputCls}
                      />
                    )}
                    {allFields.length === 0 && (
                      <HelpText>Select a Condition Source above to pick from a list, or type a field name manually.</HelpText>
                    )}
                  </Field>

                  <div className="grid grid-cols-2 gap-2">
                    <Field>
                      <Label>Operator</Label>
                      <select
                        value={cond.operator}
                        onChange={(e) => updateCondition(idx, "operator", e.target.value)}
                        className={selectCls}
                      >
                        {ops.map(([val, lbl]) => (
                          <option key={val} value={val}>{lbl}</option>
                        ))}
                      </select>
                    </Field>

                    {needsValue && (
                      <Field>
                        <Label>Value</Label>
                        {valueOptions.length > 0 ? (
                          <select
                            value={cond.value}
                            onChange={(e) => updateCondition(idx, "value", e.target.value)}
                            className={selectCls}
                          >
                            <option value="">— select —</option>
                            {valueOptions.map((o) => (
                              <option key={o} value={o}>{o}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            value={cond.value}
                            onChange={(e) => updateCondition(idx, "value", e.target.value)}
                            placeholder={cond.operator === "in_list" ? "val1,val2,val3" : "e.g. 5 or {{formData.leave_days}}"}
                            className={inputCls}
                          />
                        )}
                      </Field>
                    )}
                  </div>

                  <Field>
                    <Label>Route To Handle</Label>
                    <select
                      value={cond.handleId}
                      onChange={(e) => updateCondition(idx, "handleId", e.target.value)}
                      className={selectCls}
                    >
                      <option value="yes">Yes (right)</option>
                      <option value="no">No (left)</option>
                      <option value="default">Default (bottom)</option>
                    </select>
                  </Field>
                </div>
              );
            });
          })()}

          <button
            type="button"
            onClick={addCondition}
            className="w-full px-3 py-2 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 text-xs font-medium text-gray-500 dark:text-gray-400 hover:border-karu-green hover:text-karu-green dark:hover:border-karu-green dark:hover:text-karu-green transition-colors"
          >
            + Add Condition Rule
          </button>
        </CollapsibleSection>

        <DeleteFooter />
      </div>
    );
  }

  /* ================================================================ */
  /*  TIMER NODE                                                       */
  /* ================================================================ */
  if (nodeType === "timer") {
    const data = node.data as TimerNodeData;

    return (
      <div className="space-y-4">
        <PanelHeader />

        <Field>
          <Label required>Label</Label>
          <input
            type="text"
            value={data.label ?? ""}
            onChange={(e) => updateField("label", e.target.value)}
            placeholder="e.g. Wait 2 Business Days"
            className={inputCls}
          />
        </Field>

        <Divider />

        <Field>
          <Label>Timer Type</Label>
          <select
            value={data.timerType ?? "duration"}
            onChange={(e) => updateField("timerType", e.target.value)}
            className={selectCls}
          >
            <option value="duration">Duration</option>
            <option value="date">Target Date</option>
            <option value="business_hours">Business Hours</option>
          </select>
        </Field>

        {/* Duration fields */}
        {(data.timerType === "duration" || data.timerType === "business_hours") && (
          <div className="grid grid-cols-2 gap-2">
            <Field>
              <Label>Days</Label>
              <input
                type="number"
                min={0}
                max={365}
                value={data.durationDays ?? 0}
                onChange={(e) =>
                  updateField("durationDays", parseInt(e.target.value) || 0)
                }
                className={inputCls}
              />
            </Field>
            <Field>
              <Label>Hours</Label>
              <input
                type="number"
                min={0}
                max={23}
                value={data.durationHours ?? 0}
                onChange={(e) =>
                  updateField("durationHours", parseInt(e.target.value) || 0)
                }
                className={inputCls}
              />
            </Field>
          </div>
        )}

        {/* Date picker */}
        {data.timerType === "date" && (
          <Field>
            <Label>Target Date</Label>
            <input
              type="datetime-local"
              value={data.targetDate ?? ""}
              onChange={(e) => updateField("targetDate", e.target.value)}
              className={inputCls}
            />
          </Field>
        )}

        <Divider />

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="businessHoursOnly"
            checked={!!data.businessHoursOnly}
            onChange={(e) =>
              updateField("businessHoursOnly", e.target.checked)
            }
            className={checkboxCls}
          />
          <label
            htmlFor="businessHoursOnly"
            className="text-xs text-gray-700 dark:text-gray-300"
          >
            Count business hours only
          </label>
        </div>
        <HelpText>
          When enabled, weekends and holidays are excluded from the wait
          calculation.
        </HelpText>

        <DeleteFooter />
      </div>
    );
  }

  /* ================================================================ */
  /*  EMAIL NODE                                                       */
  /* ================================================================ */
  if (nodeType === "email") {
    const data = node.data as EmailNodeData;

    return (
      <div className="space-y-4">
        <PanelHeader />

        <Field>
          <Label required>Label</Label>
          <input
            type="text"
            value={data.label ?? ""}
            onChange={(e) => updateField("label", e.target.value)}
            placeholder="e.g. Notify Applicant"
            className={inputCls}
          />
        </Field>

        <Divider />

        <CollapsibleSection title="Recipient" defaultOpen={true}>
          <Field>
            <Label>Recipient Type</Label>
            <select
              value={data.recipientType ?? "initiator"}
              onChange={(e) => updateField("recipientType", e.target.value)}
              className={selectCls}
            >
              <option value="specific_user">Specific User</option>
              <option value="role">Role</option>
              <option value="initiator">Initiator</option>
              <option value="previous_assignee">Previous Assignee</option>
              <option value="custom_email">Custom Email</option>
            </select>
          </Field>

          {(data.recipientType === "specific_user" ||
            data.recipientType === "role" ||
            data.recipientType === "custom_email") && (
            <Field>
              <Label>
                {data.recipientType === "specific_user"
                  ? "User"
                  : data.recipientType === "role"
                    ? "Role"
                    : "Email Address"}
              </Label>
              <input
                type={data.recipientType === "custom_email" ? "email" : "text"}
                value={data.recipientValue ?? ""}
                onChange={(e) =>
                  updateField("recipientValue", e.target.value)
                }
                placeholder={
                  data.recipientType === "custom_email"
                    ? "user@example.com"
                    : data.recipientType === "role"
                      ? "e.g. REGISTRAR"
                      : "Search for a user..."
                }
                className={inputCls}
              />
            </Field>
          )}
        </CollapsibleSection>

        <Divider />

        <CollapsibleSection title="Email Content" defaultOpen={true}>
          <Field>
            <Label>Subject</Label>
            <input
              type="text"
              value={data.subject ?? ""}
              onChange={(e) => updateField("subject", e.target.value)}
              placeholder="Email subject line..."
              className={inputCls}
            />
            <HelpText>
              Use &#123;&#123;variable&#125;&#125; for dynamic values, e.g.
              &#123;&#123;document.title&#125;&#125;
            </HelpText>
          </Field>

          <Field>
            <Label>Body Template</Label>
            <textarea
              value={data.bodyTemplate ?? ""}
              onChange={(e) => updateField("bodyTemplate", e.target.value)}
              rows={5}
              placeholder="Compose your email body here. Use {{variable}} for dynamic content..."
              className={textareaCls}
            />
          </Field>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="includeDocumentLink"
              checked={!!data.includeDocumentLink}
              onChange={(e) =>
                updateField("includeDocumentLink", e.target.checked)
              }
              className={checkboxCls}
            />
            <label
              htmlFor="includeDocumentLink"
              className="text-xs text-gray-700 dark:text-gray-300"
            >
              Include document link in email
            </label>
          </div>
        </CollapsibleSection>

        <Divider />

        <CollapsibleSection title="CTA Button" defaultOpen={false}>
          <Field>
            <Label>Button Label</Label>
            <input
              type="text"
              value={(data.ctaLabel as string) ?? ""}
              onChange={(e) => updateField("ctaLabel", e.target.value)}
              placeholder="View Workflow (default)"
              className={inputCls}
            />
          </Field>
          <Field>
            <Label>Button URL</Label>
            <input
              type="text"
              value={(data.ctaUrl as string) ?? ""}
              onChange={(e) => updateField("ctaUrl", e.target.value)}
              placeholder="{{instance.url}} (default)"
              className={inputCls}
            />
            <HelpText>
              Leave blank to auto-link to the workflow instance. Available variables: &#123;&#123;instance.url&#125;&#125;, &#123;&#123;instance.referenceNumber&#125;&#125;, &#123;&#123;appUrl&#125;&#125;, &#123;&#123;formData.fieldName&#125;&#125;.
            </HelpText>
          </Field>
        </CollapsibleSection>

        <DeleteFooter />
      </div>
    );
  }

  /* ================================================================ */
  /*  SUBPROCESS NODE                                                  */
  /* ================================================================ */
  if (nodeType === "subprocess") {
    const data = node.data as SubprocessNodeData;

    function updatePassVariables(raw: string) {
      const vars = raw
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
      onUpdate(node.id, { ...node.data, passVariables: vars });
    }

    return (
      <div className="space-y-4">
        <PanelHeader />

        <Field>
          <Label required>Label</Label>
          <input
            type="text"
            value={data.label ?? ""}
            onChange={(e) => updateField("label", e.target.value)}
            placeholder="e.g. Run Background Check"
            className={inputCls}
          />
        </Field>

        <Divider />

        <CollapsibleSection title="Workflow Template" defaultOpen={true}>
          <Field>
            <Label>Template ID</Label>
            <input
              type="text"
              value={data.templateId ?? ""}
              onChange={(e) => updateField("templateId", e.target.value)}
              placeholder="Select or enter workflow template ID..."
              className={inputCls}
            />
          </Field>

          <Field>
            <Label>Template Name</Label>
            <input
              type="text"
              value={data.templateName ?? ""}
              onChange={(e) => updateField("templateName", e.target.value)}
              placeholder="Human-readable name (optional)"
              className={inputCls}
            />
            <HelpText>
              Display name of the linked workflow template.
            </HelpText>
          </Field>
        </CollapsibleSection>

        <Divider />

        <CollapsibleSection title="Execution" defaultOpen={true}>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="waitForCompletion"
              checked={data.waitForCompletion ?? true}
              onChange={(e) =>
                updateField("waitForCompletion", e.target.checked)
              }
              className={checkboxCls}
            />
            <label
              htmlFor="waitForCompletion"
              className="text-xs text-gray-700 dark:text-gray-300"
            >
              Wait for subprocess to complete
            </label>
          </div>
          <HelpText>
            When enabled, the parent workflow pauses until the subprocess
            finishes. When disabled, the subprocess runs in parallel.
          </HelpText>
        </CollapsibleSection>

        <Divider />

        <CollapsibleSection title="Variable Passing" defaultOpen={false}>
          <Field>
            <Label>Pass Variables</Label>
            <input
              type="text"
              value={(data.passVariables ?? []).join(", ")}
              onChange={(e) => updatePassVariables(e.target.value)}
              placeholder="e.g. document_id, applicant_name, amount"
              className={inputCls}
            />
            <HelpText>
              Comma-separated list of variable names to pass into the
              subprocess.
            </HelpText>
          </Field>

          {(data.passVariables ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1">
              {data.passVariables!.map((v) => (
                <span
                  key={v}
                  className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-cyan-50 dark:bg-cyan-950/30 text-cyan-700 dark:text-cyan-400 border border-cyan-200 dark:border-cyan-800"
                >
                  {v}
                </span>
              ))}
            </div>
          )}
        </CollapsibleSection>

        <DeleteFooter />
      </div>
    );
  }

  /* ================================================================ */
  /*  SYSTEM NODE                                                      */
  /* ================================================================ */
  if (nodeType === "system") {
    const data = node.data as SystemNodeData;
    const actionType = data.actionType ?? "update_document_status";
    const config = data.actionConfig ?? {};

    function updateConfig(key: string, value: unknown) {
      onUpdate(node.id, {
        ...node.data,
        actionConfig: { ...config, [key]: value },
      });
    }

    return (
      <div className="space-y-4">
        <PanelHeader />

        <Field>
          <Label required>Label</Label>
          <input
            type="text"
            value={data.label ?? ""}
            onChange={(e) => updateField("label", e.target.value)}
            placeholder="e.g. Update Status to Active"
            className={inputCls}
          />
        </Field>

        <Divider />

        <Field>
          <Label>Action Type</Label>
          <select
            value={actionType}
            onChange={(e) => updateField("actionType", e.target.value)}
            className={selectCls}
          >
            <option value="update_document_status">
              Update Document Status
            </option>
            <option value="send_webhook">Send Webhook</option>
            <option value="update_metadata">Update Metadata</option>
            <option value="create_notification">Create Notification</option>
            <option value="assign_classification">
              Assign Classification
            </option>
            <option value="lookup_form_data">Lookup Form Data</option>
            <option value="update_form_data">Update Form Data</option>
            <option value="create_delegation">Create Delegation</option>
            <option value="year_end_carry_forward">Year-End Leave Carry-Forward</option>
          </select>
        </Field>

        <Divider />

        {/* Dynamic config fields per action type */}
        <CollapsibleSection title="Action Configuration" defaultOpen={true}>
          {actionType === "update_document_status" && (
            <>
              <Field>
                <Label>New Status</Label>
                <select
                  value={(config.status as string) ?? ""}
                  onChange={(e) => updateConfig("status", e.target.value)}
                  className={selectCls}
                >
                  <option value="">-- Select status --</option>
                  <option value="draft">Draft</option>
                  <option value="pending">Pending</option>
                  <option value="active">Active</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                  <option value="archived">Archived</option>
                  <option value="closed">Closed</option>
                </select>
              </Field>
              <Field>
                <Label>Status Reason (optional)</Label>
                <input
                  type="text"
                  value={(config.reason as string) ?? ""}
                  onChange={(e) => updateConfig("reason", e.target.value)}
                  placeholder="e.g. Approved by workflow"
                  className={inputCls}
                />
              </Field>
            </>
          )}

          {actionType === "send_webhook" && (
            <>
              <Field>
                <Label required>Webhook URL</Label>
                <input
                  type="url"
                  value={(config.url as string) ?? ""}
                  onChange={(e) => updateConfig("url", e.target.value)}
                  placeholder="https://api.example.com/webhook"
                  className={inputCls}
                />
              </Field>
              <Field>
                <Label>HTTP Method</Label>
                <select
                  value={(config.method as string) ?? "POST"}
                  onChange={(e) => updateConfig("method", e.target.value)}
                  className={selectCls}
                >
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="PATCH">PATCH</option>
                </select>
              </Field>
              <Field>
                <Label>Headers (JSON)</Label>
                <textarea
                  value={(config.headers as string) ?? ""}
                  onChange={(e) => updateConfig("headers", e.target.value)}
                  rows={3}
                  placeholder={'{"Authorization": "Bearer ..."}'}
                  className={textareaCls}
                />
              </Field>
              <Field>
                <Label>Body Template (JSON)</Label>
                <textarea
                  value={(config.body as string) ?? ""}
                  onChange={(e) => updateConfig("body", e.target.value)}
                  rows={4}
                  placeholder={'{"event": "workflow_step", "data": {...}}'}
                  className={textareaCls}
                />
                <HelpText>
                  Use &#123;&#123;variable&#125;&#125; syntax for dynamic
                  values.
                </HelpText>
              </Field>
            </>
          )}

          {actionType === "update_metadata" && (
            <>
              <Field>
                <Label>Metadata Key</Label>
                <input
                  type="text"
                  value={(config.key as string) ?? ""}
                  onChange={(e) => updateConfig("key", e.target.value)}
                  placeholder="e.g. review_date"
                  className={inputCls}
                />
              </Field>
              <Field>
                <Label>Metadata Value</Label>
                <input
                  type="text"
                  value={(config.value as string) ?? ""}
                  onChange={(e) => updateConfig("value", e.target.value)}
                  placeholder="e.g. {{today}} or a static value"
                  className={inputCls}
                />
                <HelpText>
                  Supports &#123;&#123;variable&#125;&#125; placeholders.
                </HelpText>
              </Field>
            </>
          )}

          {actionType === "create_notification" && (
            <>
              <Field>
                <Label>Notification Title</Label>
                <input
                  type="text"
                  value={(config.title as string) ?? ""}
                  onChange={(e) => updateConfig("title", e.target.value)}
                  placeholder="e.g. Document Approved"
                  className={inputCls}
                />
              </Field>
              <Field>
                <Label>Message</Label>
                <textarea
                  value={(config.message as string) ?? ""}
                  onChange={(e) => updateConfig("message", e.target.value)}
                  rows={3}
                  placeholder="Notification message body..."
                  className={textareaCls}
                />
              </Field>
              <Field>
                <Label>Target</Label>
                <select
                  value={(config.target as string) ?? "initiator"}
                  onChange={(e) => updateConfig("target", e.target.value)}
                  className={selectCls}
                >
                  <option value="initiator">Workflow Initiator</option>
                  <option value="assignee">Current Assignee</option>
                  <option value="role">Role</option>
                  <option value="all_participants">All Participants</option>
                </select>
              </Field>
              {(config.target as string) === "role" && (
                <Field>
                  <Label>Role Name</Label>
                  <input
                    type="text"
                    value={(config.targetRole as string) ?? ""}
                    onChange={(e) =>
                      updateConfig("targetRole", e.target.value)
                    }
                    placeholder="e.g. ADMIN"
                    className={inputCls}
                  />
                </Field>
              )}
            </>
          )}

          {actionType === "assign_classification" && (
            <>
              <Field>
                <Label>Classification Code</Label>
                <input
                  type="text"
                  value={(config.classificationCode as string) ?? ""}
                  onChange={(e) =>
                    updateConfig("classificationCode", e.target.value)
                  }
                  placeholder="e.g. FIN-001"
                  className={inputCls}
                />
              </Field>
              <Field>
                <Label>Retention Category</Label>
                <select
                  value={(config.retentionCategory as string) ?? ""}
                  onChange={(e) =>
                    updateConfig("retentionCategory", e.target.value)
                  }
                  className={selectCls}
                >
                  <option value="">-- Select --</option>
                  <option value="permanent">Permanent</option>
                  <option value="10_years">10 Years</option>
                  <option value="7_years">7 Years</option>
                  <option value="5_years">5 Years</option>
                  <option value="3_years">3 Years</option>
                  <option value="1_year">1 Year</option>
                </select>
              </Field>
              <Field>
                <Label>Security Level</Label>
                <select
                  value={(config.securityLevel as string) ?? "internal"}
                  onChange={(e) =>
                    updateConfig("securityLevel", e.target.value)
                  }
                  className={selectCls}
                >
                  <option value="public">Public</option>
                  <option value="internal">Internal</option>
                  <option value="confidential">Confidential</option>
                  <option value="restricted">Restricted</option>
                </select>
              </Field>
            </>
          )}

          {actionType === "lookup_form_data" && (() => {
            const slug = (config.slug as string) ?? "";
            const dsDataset = fdDatasets.find((d) => d.slug === slug);
            const dsFields = dsDataset?.fields ?? [];
            const filters: { field: string; value: string }[] =
              Array.isArray(config.filters) ? config.filters as { field: string; value: string }[] : [];

            return (
              <>
                <Field>
                  <Label required>Dataset</Label>
                  <select
                    value={slug}
                    onChange={(e) => updateConfig("slug", e.target.value)}
                    className={selectCls}
                  >
                    <option value="">— select a dataset —</option>
                    {fdDatasets.map((d) => (
                      <option key={d.id} value={d.slug}>{d.name}</option>
                    ))}
                  </select>
                  <HelpText>Datasets are managed in Admin → Form Data.</HelpText>
                </Field>

                <Field>
                  <div className="flex items-center justify-between mb-1">
                    <Label>Filter Conditions</Label>
                    <button
                      type="button"
                      onClick={() => updateConfig("filters", [...filters, { field: "", value: "" }])}
                      className="text-xs text-[#02773b] hover:underline"
                    >
                      + Add Filter
                    </button>
                  </div>
                  {filters.length === 0 && (
                    <p className="text-xs text-gray-400 italic">No filters — returns first record. Add filters to match specific rows.</p>
                  )}
                  <div className="space-y-2">
                    {filters.map((f, i) => (
                      <div key={i} className="flex gap-1 items-center">
                        {dsFields.length > 0 ? (
                          <select
                            value={f.field}
                            onChange={(e) => {
                              const updated = filters.map((r, j) => j === i ? { ...r, field: e.target.value } : r);
                              updateConfig("filters", updated);
                            }}
                            className="flex-1 h-8 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 text-xs text-gray-900 dark:text-gray-100 outline-none focus:border-[#02773b]"
                          >
                            <option value="">— field —</option>
                            {dsFields.map((df) => (
                              <option key={df.name} value={df.name}>{df.label} ({df.name})</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            value={f.field}
                            onChange={(e) => {
                              const updated = filters.map((r, j) => j === i ? { ...r, field: e.target.value } : r);
                              updateConfig("filters", updated);
                            }}
                            placeholder="field name"
                            className="flex-1 h-8 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 text-xs text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:border-[#02773b]"
                          />
                        )}
                        <input
                          type="text"
                          value={f.value}
                          onChange={(e) => {
                            const updated = filters.map((r, j) => j === i ? { ...r, value: e.target.value } : r);
                            updateConfig("filters", updated);
                          }}
                          placeholder="{{formData.field}} or literal"
                          className="flex-1 h-8 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 text-xs text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:border-[#02773b]"
                        />
                        <button
                          type="button"
                          onClick={() => updateConfig("filters", filters.filter((_, j) => j !== i))}
                          className="text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                    ))}
                  </div>
                  <HelpText>Use &#123;&#123;formData.fieldName&#125;&#125; to match submitted values. All conditions must match (AND).</HelpText>
                </Field>

                <Field>
                  <Label>Result Variable Prefix</Label>
                  <input
                    type="text"
                    value={(config.resultPrefix as string) ?? ""}
                    onChange={(e) => updateConfig("resultPrefix", e.target.value)}
                    placeholder="e.g. balance"
                    className={inputCls}
                  />
                  <HelpText>
                    Fields inject as <code>_lookup_&#123;prefix&#125;.fieldName</code> — e.g. <code>_lookup_balance.days_remaining</code>
                  </HelpText>
                </Field>
              </>
            );
          })()}

          {actionType === "update_form_data" && (() => {
            const slug = (config.slug as string) ?? "";
            const fields = fdFields[slug] ?? [];
            const matchConditions: { field: string; value: string }[] =
              Array.isArray(config.matchConditions) ? config.matchConditions as { field: string; value: string }[] : [];

            return (
              <>
                <Field>
                  <Label required>Dataset</Label>
                  <select
                    value={slug}
                    onChange={(e) => {
                      updateConfig("slug", e.target.value);
                      loadFieldsForSlug(e.target.value);
                    }}
                    onFocus={() => loadFieldsForSlug(slug)}
                    className={selectCls}
                  >
                    <option value="">— select a dataset —</option>
                    {fdDatasets.map((d) => (
                      <option key={d.id} value={d.slug}>{d.name} ({d.slug})</option>
                    ))}
                  </select>
                </Field>

                <Field>
                  <div className="flex items-center justify-between mb-1">
                    <Label>Match Conditions</Label>
                    <button
                      type="button"
                      onClick={() => updateConfig("matchConditions", [...matchConditions, { field: "", value: "" }])}
                      className="text-xs text-[#02773b] hover:underline"
                    >
                      + Add Condition
                    </button>
                  </div>
                  {matchConditions.length === 0 && (
                    <p className="text-xs text-gray-400 italic">No conditions — will update the first record. Add conditions to target a specific row.</p>
                  )}
                  <div className="space-y-2">
                    {matchConditions.map((c, i) => (
                      <div key={i} className="flex gap-1 items-center">
                        <select
                          value={c.field}
                          onChange={(e) => {
                            const updated = matchConditions.map((r, j) => j === i ? { ...r, field: e.target.value } : r);
                            updateConfig("matchConditions", updated);
                          }}
                          className="flex-1 h-8 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 text-xs text-gray-900 dark:text-gray-100 outline-none focus:border-[#02773b]"
                        >
                          <option value="">— field —</option>
                          {fields.map((fn) => <option key={fn} value={fn}>{fn}</option>)}
                        </select>
                        <input
                          type="text"
                          value={c.value}
                          onChange={(e) => {
                            const updated = matchConditions.map((r, j) => j === i ? { ...r, value: e.target.value } : r);
                            updateConfig("matchConditions", updated);
                          }}
                          placeholder="{{formData.field}} or value"
                          className="flex-1 h-8 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 text-xs text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:border-[#02773b]"
                        />
                        <button
                          type="button"
                          onClick={() => updateConfig("matchConditions", matchConditions.filter((_, j) => j !== i))}
                          className="text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                    ))}
                  </div>
                  <HelpText>All conditions must match the same record (AND). Use &#123;&#123;formData.field&#125;&#125; for dynamic values.</HelpText>
                </Field>

                <Field>
                  <Label>Fields to Update (JSON)</Label>
                  <textarea
                    value={(config.updates as string) ?? ""}
                    onChange={(e) => updateConfig("updates", e.target.value)}
                    rows={4}
                    placeholder={'{"days_remaining": "{{_lookup_balance.days_remaining - formData.days_requested}}"}'}
                    className={textareaCls}
                  />
                  <HelpText>
                    JSON object of field names → new values. Supports &#123;&#123;variable&#125;&#125; syntax.
                  </HelpText>
                </Field>
              </>
            );
          })()}

          {actionType === "create_delegation" && (() => {
            const srcRaw = (config.sourceFormTemplateId as string) ?? "";
            const isFd = srcRaw.startsWith("fd:");
            const isFt = srcRaw.startsWith("ft:");

            // Derive all fields from whatever source is selected
            let allFields: { name: string; label: string; type: string }[] = [];
            if (isFt) {
              const ft = formTemplates.find((t) => t.id === srcRaw.slice(3));
              allFields = ft?.fields ?? [];
            } else if (isFd) {
              const slug = srcRaw.slice(3);
              const ds = fdDatasets.find((d) => d.slug === slug);
              allFields = (ds?.fields ?? []).map((f) => ({
                ...f,
                name: `_lookup_${slug}.${f.name}`,
              }));
            } else if (srcRaw) {
              // legacy bare id
              const ft = formTemplates.find((t) => t.id === srcRaw);
              allFields = ft?.fields ?? [];
            }

            const hasSource = !!srcRaw;

            function FieldSelect({
              configKey,
              placeholder,
              hint,
            }: {
              configKey: string;
              placeholder: string;
              hint?: string;
            }) {
              const val = (config[configKey] as string) ?? "";
              return hasSource ? (
                <select
                  value={val}
                  onChange={(e) => updateConfig(configKey, e.target.value)}
                  className={selectCls}
                >
                  <option value="">— select field —</option>
                  {allFields.map((f) => (
                    <option key={f.name} value={f.name}>
                      {f.label} ({f.type})
                    </option>
                  ))}
                  {val && !allFields.find((f) => f.name === val) && (
                    <option value={val}>{val} (manual)</option>
                  )}
                </select>
              ) : (
                <input
                  type="text"
                  value={val}
                  onChange={(e) => updateConfig(configKey, e.target.value)}
                  placeholder={placeholder}
                  className={inputCls}
                />
              );
            }

            return (
              <>
                <Field>
                  <Label>Data Source</Label>
                  <select
                    value={srcRaw}
                    onChange={(e) => updateConfig("sourceFormTemplateId", e.target.value)}
                    className={selectCls}
                  >
                    <option value="">— pick a source to load fields —</option>
                    {formTemplates.length > 0 && (
                      <optgroup label="Forms / Casefolders">
                        {formTemplates.map((t) => (
                          <option key={t.id} value={`ft:${t.id}`}>{t.name}</option>
                        ))}
                      </optgroup>
                    )}
                    {fdDatasets.length > 0 && (
                      <optgroup label="Data Registry">
                        {fdDatasets.map((d) => (
                          <option key={d.id} value={`fd:${d.slug}`}>{d.name}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  <HelpText>Fields from this source will populate the dropdowns below.</HelpText>
                </Field>

                <Field>
                  <Label required>Acting Officer Field</Label>
                  <FieldSelect configKey="delegateField" placeholder="e.g. acting_officer_id" />
                  <HelpText>Field containing the acting officer&apos;s user ID.</HelpText>
                </Field>

                <Field>
                  <Label required>Start Date Field</Label>
                  <FieldSelect configKey="startDateField" placeholder="e.g. leave_start_date" />
                </Field>

                <Field>
                  <Label required>End Date Field</Label>
                  <FieldSelect configKey="endDateField" placeholder="e.g. leave_end_date" />
                </Field>

                <Field>
                  <Label>Delegation Reason</Label>
                  <input
                    type="text"
                    value={(config.reason as string) ?? ""}
                    onChange={(e) => updateConfig("reason", e.target.value)}
                    placeholder="e.g. Annual Leave Delegation"
                    className={inputCls}
                  />
                  <HelpText>Use {"{{formData.field_name}}"} to pull values from submitted data.</HelpText>
                </Field>

                {hasSource && allFields.length === 0 && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 italic">
                    No fields found in this source.
                  </p>
                )}

                <div className="rounded-lg bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 p-3 space-y-1">
                  <p className="text-[10px] font-semibold text-indigo-700 dark:text-indigo-300 uppercase tracking-wide">How it works</p>
                  <p className="text-[10px] text-indigo-600 dark:text-indigo-400 leading-relaxed">
                    At runtime the system reads the selected fields, deactivates any overlapping delegations for the initiator, then creates a Delegation routing their tasks to the acting officer for the specified period.
                  </p>
                </div>
              </>
            );
          })()}

          {actionType === "year_end_carry_forward" && (
            <>
              <Field>
                <Label>From Year (field name or static)</Label>
                <input
                  type="text"
                  value={(config.fromYear as string) ?? ""}
                  onChange={(e) => updateConfig("fromYear", e.target.value)}
                  placeholder="e.g. 2026 or form field name"
                  className={inputCls}
                />
                <HelpText>Enter a static year (e.g. 2026) or a form field name that holds the year.</HelpText>
              </Field>
              <Field>
                <Label>To Year (field name or static)</Label>
                <input
                  type="text"
                  value={(config.toYear as string) ?? ""}
                  onChange={(e) => updateConfig("toYear", e.target.value)}
                  placeholder="e.g. 2027 or form field name"
                  className={inputCls}
                />
              </Field>
              <Field>
                <Label>Balances Dataset Slug</Label>
                <input
                  type="text"
                  value={(config.balancesSlug as string) ?? "leave-balances"}
                  onChange={(e) => updateConfig("balancesSlug", e.target.value)}
                  placeholder="leave-balances"
                  className={inputCls}
                />
              </Field>
              <Field>
                <Label>Leave Types Dataset Slug</Label>
                <input
                  type="text"
                  value={(config.typesSlug as string) ?? "leave-types"}
                  onChange={(e) => updateConfig("typesSlug", e.target.value)}
                  placeholder="leave-types"
                  className={inputCls}
                />
              </Field>
              <Field>
                <Label>Carry-Forward Rules (JSON)</Label>
                <textarea
                  value={(config.rules as string) ?? ""}
                  onChange={(e) => updateConfig("rules", e.target.value)}
                  rows={6}
                  placeholder={`[
  {"leaveType":"Annual Leave","enabled":true,"cap":10},
  {"leaveType":"Sick Leave","enabled":false,"cap":0}
]`}
                  className={textareaCls}
                />
                <HelpText>
                  JSON array — one object per leave type. <code>enabled</code>: whether this type carries forward. <code>cap</code>: maximum days that can carry over.
                </HelpText>
              </Field>
              <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 space-y-1">
                <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-300 uppercase tracking-wide">Tip</p>
                <p className="text-[10px] text-amber-600 dark:text-amber-400 leading-relaxed">
                  Use this node after an &quot;HR Director Approves&quot; task to automate the year-end rollover. The engine skips employees who already have a toYear balance record, so the action is safe to re-run. Use <strong>Admin → Leave Management</strong> for a preview before running.
                </p>
              </div>
            </>
          )}
        </CollapsibleSection>

        <DeleteFooter />
      </div>
    );
  }

  /* ================================================================ */
  /*  PARALLEL NODE                                                    */
  /* ================================================================ */
  if (nodeType === "parallel") {
    const data = node.data as ParallelNodeData;

    return (
      <div className="space-y-4">
        <PanelHeader />

        <Field>
          <Label required>Label</Label>
          <input
            type="text"
            value={data.label ?? ""}
            onChange={(e) => updateField("label", e.target.value)}
            placeholder={
              data.gatewayType === "fork"
                ? "e.g. Split to Parallel Paths"
                : "e.g. Wait for All Paths"
            }
            className={inputCls}
          />
        </Field>

        <Divider />

        <Field>
          <Label>Gateway Type</Label>
          <div className="grid grid-cols-2 gap-2">
            {(["fork", "join"] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => updateField("gatewayType", type)}
                className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 transition-all ${
                  data.gatewayType === type
                    ? "border-karu-green bg-karu-green/5 dark:bg-karu-green/10"
                    : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                }`}
              >
                {type === "fork" ? (
                  <svg
                    className={`w-5 h-5 ${
                      data.gatewayType === type
                        ? "text-karu-green"
                        : "text-gray-400"
                    }`}
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"
                    />
                  </svg>
                ) : (
                  <svg
                    className={`w-5 h-5 ${
                      data.gatewayType === type
                        ? "text-karu-green"
                        : "text-gray-400"
                    }`}
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9 9V4.5M9 9H4.5M9 9 3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5 5.25 5.25"
                    />
                  </svg>
                )}
                <span
                  className={`text-xs font-semibold capitalize ${
                    data.gatewayType === type
                      ? "text-karu-green"
                      : "text-gray-500 dark:text-gray-400"
                  }`}
                >
                  {type}
                </span>
              </button>
            ))}
          </div>
        </Field>

        {data.gatewayType === "fork" && (
          <div className="p-3 bg-teal-50 dark:bg-teal-950/20 rounded-lg border border-teal-200 dark:border-teal-800">
            <p className="text-xs text-teal-700 dark:text-teal-400 leading-relaxed">
              <span className="font-semibold">Fork:</span> Splits the workflow
              into multiple parallel branches. Connect each output to a
              different path. All paths run simultaneously.
            </p>
          </div>
        )}

        {data.gatewayType === "join" && (
          <>
            <div className="p-3 bg-teal-50 dark:bg-teal-950/20 rounded-lg border border-teal-200 dark:border-teal-800">
              <p className="text-xs text-teal-700 dark:text-teal-400 leading-relaxed">
                <span className="font-semibold">Join:</span> Merges parallel
                branches back into a single path. The join rule determines when
                the workflow proceeds.
              </p>
            </div>

            <Field>
              <Label>Join Rule</Label>
              <select
                value={data.joinRule ?? "all"}
                onChange={(e) => updateField("joinRule", e.target.value)}
                className={selectCls}
              >
                <option value="all">
                  Wait for all branches to complete
                </option>
                <option value="any">
                  Proceed when any branch completes
                </option>
                <option value="quorum">
                  Quorum — N of M branches must complete
                </option>
              </select>
              <HelpText>
                {data.joinRule === "any"
                  ? "The workflow continues as soon as the first branch finishes. Other branches are cancelled."
                  : data.joinRule === "quorum"
                    ? "The workflow proceeds once the required number of branches have completed."
                    : "The workflow waits until every incoming branch has completed before proceeding."}
              </HelpText>
            </Field>

            {data.joinRule === "quorum" && (
              <Field>
                <Label>Quorum Count (N)</Label>
                <input
                  type="number"
                  min={1}
                  value={(data.quorumCount as number) ?? 2}
                  onChange={(e) =>
                    updateField("quorumCount", Math.max(1, Number(e.target.value)))
                  }
                  className={inputCls}
                />
                <HelpText>
                  How many branches must complete before the workflow proceeds. Must be ≤ the number of incoming branches.
                </HelpText>
              </Field>
            )}
          </>
        )}

        <DeleteFooter />
      </div>
    );
  }

  /* ================================================================ */
  /*  WAIT_SIGNAL NODE                                                 */
  /* ================================================================ */
  if (nodeType === "wait_signal") {
    const data = node.data as WaitSignalNodeData & Record<string, unknown>;
    return (
      <div className="space-y-4">
        <PanelHeader />

        <div className="p-3 bg-orange-50 dark:bg-orange-950/20 rounded-lg border border-orange-200 dark:border-orange-800">
          <p className="text-xs text-orange-700 dark:text-orange-400 leading-relaxed">
            <span className="font-semibold">Wait for Signal:</span> The workflow pauses here until an external system (or API call) sends the named signal. Use for integrations, approvals from external portals, or webhook callbacks.
          </p>
        </div>

        <Field>
          <Label>Label</Label>
          <input
            type="text"
            value={(data.label as string) ?? ""}
            onChange={(e) => updateField("label", e.target.value)}
            placeholder="e.g. Await Payment Confirmation"
            className={inputCls}
          />
        </Field>

        <Field>
          <Label>Signal Name</Label>
          <input
            type="text"
            value={(data.signalName as string) ?? ""}
            onChange={(e) => updateField("signalName", e.target.value.trim())}
            placeholder="e.g. payment_confirmed"
            className={inputCls}
          />
          <HelpText>
            Snake_case identifier for the signal. External systems POST to{" "}
            <code className="text-[11px] bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">
              /api/workflows/signals/&#123;instanceId&#125;:&#123;nodeId&#125;
            </code>{" "}
            to fire it.
          </HelpText>
        </Field>

        <Field>
          <Label>Description</Label>
          <textarea
            rows={2}
            value={(data.description as string) ?? ""}
            onChange={(e) => updateField("description", e.target.value)}
            placeholder="Describe what this signal represents..."
            className={`${inputCls} resize-none`}
          />
        </Field>

        <Field>
          <Label>Timeout (hours)</Label>
          <input
            type="number"
            min={0}
            value={(data.timeoutHours as number) ?? ""}
            onChange={(e) =>
              updateField(
                "timeoutHours",
                e.target.value === "" ? undefined : Math.max(0, Number(e.target.value))
              )
            }
            placeholder="Leave blank for no timeout"
            className={inputCls}
          />
          <HelpText>
            If set, the workflow will auto-advance (or fail) after this many hours without receiving the signal. Leave blank to wait indefinitely.
          </HelpText>
        </Field>

        <DeleteFooter />
      </div>
    );
  }

  /* ================================================================ */
  /*  FALLBACK (unknown node type)                                     */
  /* ================================================================ */
  return (
    <div className="space-y-4">
      <PanelHeader />
      <p className="text-xs text-gray-400 dark:text-gray-500">
        This node type (<code className="text-[11px] bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">{nodeType}</code>) does not have a configuration panel yet.
      </p>
      <DeleteFooter />
    </div>
  );
}
