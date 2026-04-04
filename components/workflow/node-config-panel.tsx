"use client";

import { useState, useCallback } from "react";
import type { Node } from "reactflow";
import type { DecisionNodeData } from "./decision-node";
import type { TimerNodeData } from "./timer-node";
import type { EmailNodeData } from "./email-node";

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
    | "least_loaded";
  assigneeValue?: string;
  escalationDays?: number;
  escalationTo?: string;
  slaHours?: number;
  requiredAction?: "approve" | "reject" | "return" | "any";
  parallelApproval?: boolean;
  approvalRule?: "all" | "any" | "majority";
  formTemplateId?: string;
  notifyOnAssign?: boolean;
  notifyOnComplete?: boolean;
  reminderDays?: number;
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
    | "assign_classification";
  actionConfig: Record<string, unknown>;
}

export interface ParallelNodeData {
  label: string;
  gatewayType: "fork" | "join";
  joinRule?: "all" | "any";
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
};

/* ================================================================== */
/*  Main Component                                                     */
/* ================================================================== */

export default function NodeConfigPanel({
  node,
  onUpdate,
  onDelete,
}: NodeConfigPanelProps) {
  const [taskTab, setTaskTab] = useState<
    "general" | "assignment" | "sla" | "notifications"
  >("general");

  const updateField = useCallback(
    (field: string, value: unknown) => {
      onUpdate(node.id, { ...node.data, [field]: value });
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
    return (
      <div className="space-y-4">
        <PanelHeader />
        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          This marks the completion of a workflow path. You can have multiple end
          nodes for different outcomes (e.g., approved path and rejected path).
        </p>
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
        <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl">
          {(
            [
              ["general", "General"],
              ["assignment", "Assignment"],
              ["sla", "SLA"],
              ["notifications", "Notify"],
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
        {taskTab === "general" && (
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
                rows={3}
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
          </div>
        )}

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
        {taskTab === "sla" && (
          <div className="space-y-3">
            <Field>
              <Label>SLA Target (hours)</Label>
              <input
                type="number"
                min={0}
                max={720}
                value={(data.slaHours as number) ?? 0}
                onChange={(e) =>
                  updateField("slaHours", parseInt(e.target.value) || 0)
                }
                className={inputCls}
              />
              <HelpText>
                Expected completion time. Set to 0 for no SLA.
              </HelpText>
            </Field>

            <Divider />

            <CollapsibleSection title="Escalation" defaultOpen={true}>
              <Field>
                <Label>Escalation After (days)</Label>
                <input
                  type="number"
                  min={0}
                  max={90}
                  value={data.escalationDays ?? 0}
                  onChange={(e) =>
                    updateField(
                      "escalationDays",
                      parseInt(e.target.value) || 0
                    )
                  }
                  className={inputCls}
                />
                <HelpText>
                  Auto-escalate if not completed. Set to 0 to disable.
                </HelpText>
              </Field>

              {(data.escalationDays ?? 0) > 0 && (
                <Field>
                  <Label>Escalate To</Label>
                  <input
                    type="text"
                    value={(data.escalationTo as string) ?? ""}
                    onChange={(e) =>
                      updateField("escalationTo", e.target.value)
                    }
                    placeholder="User or role to escalate to..."
                    className={inputCls}
                  />
                </Field>
              )}
            </CollapsibleSection>

            <Divider />

            <Field>
              <Label>Reminder (days before escalation)</Label>
              <input
                type="number"
                min={0}
                max={30}
                value={(data.reminderDays as number) ?? 0}
                onChange={(e) =>
                  updateField("reminderDays", parseInt(e.target.value) || 0)
                }
                className={inputCls}
              />
              <HelpText>
                Send a reminder N days before the escalation deadline.
              </HelpText>
            </Field>
          </div>
        )}

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
          {conditions.length === 0 && (
            <p className="text-xs text-gray-400 dark:text-gray-500 italic">
              No conditions configured. Add a rule to enable expression-based
              routing.
            </p>
          )}

          {conditions.map((cond, idx) => (
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
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6 18 18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>

              <Field>
                <Label>Label</Label>
                <input
                  type="text"
                  value={cond.label}
                  onChange={(e) =>
                    updateCondition(idx, "label", e.target.value)
                  }
                  placeholder="Condition name"
                  className={inputCls}
                />
              </Field>

              <div className="grid grid-cols-2 gap-2">
                <Field>
                  <Label>Field</Label>
                  <input
                    type="text"
                    value={cond.field}
                    onChange={(e) =>
                      updateCondition(idx, "field", e.target.value)
                    }
                    placeholder="e.g. amount"
                    className={inputCls}
                  />
                </Field>
                <Field>
                  <Label>Operator</Label>
                  <select
                    value={cond.operator}
                    onChange={(e) =>
                      updateCondition(idx, "operator", e.target.value)
                    }
                    className={selectCls}
                  >
                    <option value="equals">Equals</option>
                    <option value="not_equals">Not Equals</option>
                    <option value="greater_than">Greater Than</option>
                    <option value="less_than">Less Than</option>
                    <option value="contains">Contains</option>
                    <option value="not_empty">Not Empty</option>
                    <option value="empty">Empty</option>
                    <option value="in_list">In List</option>
                  </select>
                </Field>
              </div>

              {/* Value not needed for empty / not_empty */}
              {cond.operator !== "empty" && cond.operator !== "not_empty" && (
                <Field>
                  <Label>Value</Label>
                  <input
                    type="text"
                    value={cond.value}
                    onChange={(e) =>
                      updateCondition(idx, "value", e.target.value)
                    }
                    placeholder={
                      cond.operator === "in_list"
                        ? "comma,separated,values"
                        : "Comparison value"
                    }
                    className={inputCls}
                  />
                </Field>
              )}

              <Field>
                <Label>Route To Handle</Label>
                <select
                  value={cond.handleId}
                  onChange={(e) =>
                    updateCondition(idx, "handleId", e.target.value)
                  }
                  className={selectCls}
                >
                  <option value="yes">Yes (right)</option>
                  <option value="no">No (left)</option>
                  <option value="default">Default (bottom)</option>
                </select>
              </Field>
            </div>
          ))}

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
              </select>
              <HelpText>
                {data.joinRule === "any"
                  ? "The workflow continues as soon as the first branch finishes. Other branches are cancelled."
                  : "The workflow waits until every incoming branch has completed before proceeding."}
              </HelpText>
            </Field>
          </>
        )}

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
