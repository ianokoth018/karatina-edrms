"use client";

import { useState, useEffect, useCallback, useRef } from "react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface UserPermissions {
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canShare: boolean;
  canDownload: boolean;
  canManageACL: boolean;
}

interface ACLPanelProps {
  casefolderName: string;
  formTemplateId: string;
  userPermissions: UserPermissions;
}

interface ACLEntry {
  id: string;
  userId: string | null;
  roleId: string | null;
  departmentId: string | null;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canShare: boolean;
  canDownload: boolean;
  canManageACL: boolean;
  grantedById: string;
  grantedAt: string;
  expiresAt: string | null;
  notes: string | null;
  user?: { name: string; displayName: string; email: string; department: string | null };
  role?: { name: string };
}

interface SearchUser {
  id: string;
  name: string;
  displayName: string;
  email: string;
  department: string | null;
  jobTitle?: string | null;
}

interface SearchRole {
  id: string;
  name: string;
}

type GranteeType = "user" | "role" | "department";

const PERM_KEYS = [
  "canView",
  "canCreate",
  "canEdit",
  "canDelete",
  "canShare",
  "canDownload",
  "canManageACL",
] as const;

type PermKey = (typeof PERM_KEYS)[number];

const PERM_LABELS: Record<PermKey, string> = {
  canView: "View",
  canCreate: "Create",
  canEdit: "Edit",
  canDelete: "Delete",
  canShare: "Share",
  canDownload: "Download",
  canManageACL: "Manage ACL",
};

const PERM_COLORS: Record<PermKey, { bg: string; text: string; dot: string }> = {
  canView:      { bg: "bg-emerald-100 dark:bg-emerald-950/50", text: "text-emerald-700 dark:text-emerald-400", dot: "bg-emerald-500" },
  canCreate:    { bg: "bg-blue-100 dark:bg-blue-950/50",       text: "text-blue-700 dark:text-blue-400",       dot: "bg-blue-500" },
  canEdit:      { bg: "bg-amber-100 dark:bg-amber-950/50",     text: "text-amber-700 dark:text-amber-400",     dot: "bg-amber-500" },
  canDelete:    { bg: "bg-red-100 dark:bg-red-950/50",         text: "text-red-700 dark:text-red-400",         dot: "bg-red-500" },
  canShare:     { bg: "bg-purple-100 dark:bg-purple-950/50",   text: "text-purple-700 dark:text-purple-400",   dot: "bg-purple-500" },
  canDownload:  { bg: "bg-teal-100 dark:bg-teal-950/50",       text: "text-teal-700 dark:text-teal-400",       dot: "bg-teal-500" },
  canManageACL: { bg: "bg-gray-200 dark:bg-gray-800",          text: "text-gray-700 dark:text-gray-300",       dot: "bg-gray-500" },
};

/* ------------------------------------------------------------------ */
/*  Inline SVG icons                                                   */
/* ------------------------------------------------------------------ */

function IconLock({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
    </svg>
  );
}

function IconUserCircle({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M17.982 18.725A7.488 7.488 0 0 0 12 15.75a7.488 7.488 0 0 0-5.982 2.975m11.963 0a9 9 0 1 0-11.963 0m11.963 0A8.966 8.966 0 0 1 12 21a8.966 8.966 0 0 1-5.982-2.275M15 9.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  );
}

function IconShield({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
    </svg>
  );
}

function IconBuilding({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
    </svg>
  );
}

function IconPencil({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
    </svg>
  );
}

function IconTrash({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
    </svg>
  );
}

function IconX({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}

function IconPlus({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

function IconWarning({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
    </svg>
  );
}

function IconSearch({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
    </svg>
  );
}

function IconCheck({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  );
}

function Spinner({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4Z" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatDate(iso: string) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "\u2014";
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return "\u2014";
  }
}

function truncate(str: string, len: number) {
  if (str.length <= len) return str;
  return str.slice(0, len) + "\u2026";
}

function entryName(e: ACLEntry): string {
  if (e.user) return e.user.displayName || e.user.name;
  if (e.role) return e.role.name;
  if (e.departmentId) return e.departmentId;
  return "Unknown";
}

function entryType(e: ACLEntry): "user" | "role" | "department" {
  if (e.userId) return "user";
  if (e.roleId) return "role";
  return "department";
}

function entrySubtext(e: ACLEntry): string | null {
  if (e.user) return e.user.email;
  return null;
}

function defaultPerms(): Record<PermKey, boolean> {
  return {
    canView: true,
    canCreate: false,
    canEdit: false,
    canDelete: false,
    canShare: false,
    canDownload: false,
    canManageACL: false,
  };
}

/* ------------------------------------------------------------------ */
/*  Type badge + icon for ACL entries                                  */
/* ------------------------------------------------------------------ */

function TypeBadge({ type }: { type: "user" | "role" | "department" }) {
  const cfg = {
    user: {
      icon: <IconUserCircle className="w-3.5 h-3.5" />,
      label: "User",
      style: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400",
    },
    role: {
      icon: <IconShield className="w-3.5 h-3.5" />,
      label: "Role",
      style: "bg-purple-100 text-purple-700 dark:bg-purple-950/50 dark:text-purple-400",
    },
    department: {
      icon: <IconBuilding className="w-3.5 h-3.5" />,
      label: "Dept",
      style: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400",
    },
  };
  const c = cfg[type];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${c.style}`}>
      {c.icon}
      {c.label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Permission checkbox (table cell)                                   */
/* ------------------------------------------------------------------ */

function PermCheckbox({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  onChange?: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={`w-5 h-5 rounded flex items-center justify-center transition-colors ${
        checked
          ? "bg-[#02773b] text-white"
          : "border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
      } ${disabled ? "opacity-60 cursor-default" : "cursor-pointer hover:ring-2 hover:ring-[#02773b]/30"}`}
      aria-label={checked ? "Permission granted" : "Permission denied"}
    >
      {checked && <IconCheck className="w-3 h-3" />}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Modal backdrop                                                     */
/* ------------------------------------------------------------------ */

function ModalBackdrop({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-800 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Grant / Edit Modal                                                 */
/* ------------------------------------------------------------------ */

function GrantModal({
  mode,
  initial,
  casefolderName,
  onClose,
  onSave,
}: {
  mode: "grant" | "edit";
  initial?: ACLEntry;
  casefolderName: string;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [granteeType, setGranteeType] = useState<GranteeType>(
    initial ? entryType(initial) : "user"
  );
  const [perms, setPerms] = useState<Record<PermKey, boolean>>(() => {
    if (initial) {
      const p = {} as Record<PermKey, boolean>;
      for (const k of PERM_KEYS) p[k] = initial[k];
      return p;
    }
    return defaultPerms();
  });

  // Grantee selection — supports multi-select
  const [selectedUsers, setSelectedUsers] = useState<SearchUser[]>(
    initial?.user
      ? [{ id: initial.userId!, name: initial.user.name, displayName: initial.user.displayName, email: initial.user.email, department: initial.user.department }]
      : []
  );
  const [selectedRoles, setSelectedRoles] = useState<SearchRole[]>(
    initial?.role ? [{ id: initial.roleId!, name: initial.role.name }] : []
  );
  const [selectedDepts, setSelectedDepts] = useState<string[]>(
    initial?.departmentId ? [initial.departmentId] : []
  );
  const [deptSearchInput, setDeptSearchInput] = useState("");
  // Backward compat aliases for edit mode (single item)
  const selectedUser = selectedUsers[0] ?? null;
  const selectedRole = selectedRoles[0] ?? null;
  void selectedUser; void selectedRole;

  // Search state
  const [userQuery, setUserQuery] = useState("");
  const [userResults, setUserResults] = useState<SearchUser[]>([]);
  const [userLoading, setUserLoading] = useState(false);
  const [roleQuery, setRoleQuery] = useState("");
  const [roleResults, setRoleResults] = useState<SearchRole[]>([]);
  const [roleLoading, setRoleLoading] = useState(false);
  const [deptResults, setDeptResults] = useState<string[]>([]);
  const [deptLoading, setDeptLoading] = useState(false);

  // Expiry + notes
  const [expiresAt, setExpiresAt] = useState(initial?.expiresAt ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // User search
  // User search — load on tab switch, filter on query
  useEffect(() => {
    if (granteeType !== "user") return;
    const delay = userQuery ? 300 : 0;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setUserLoading(true);
      try {
        const excludeIds = selectedUsers.map((u) => u.id).join(",");
        const params = new URLSearchParams({ limit: "20" });
        if (userQuery) params.set("q", userQuery);
        if (excludeIds) params.set("exclude", excludeIds);
        const res = await fetch(`/api/users/search?${params}`);
        if (res.ok) {
          const data = await res.json();
          setUserResults(data.users ?? []);
        }
      } catch { /* ignore */ }
      finally { setUserLoading(false); }
    }, delay);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [userQuery, granteeType, selectedUsers]);

  // Role search — load all roles immediately, filter on query
  useEffect(() => {
    if (granteeType !== "role") return;
    const delay = roleQuery ? 300 : 0; // immediate on tab switch, debounced on typing
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setRoleLoading(true);
      try {
        const res = await fetch(`/api/users/search?roles=true${roleQuery ? `&q=${encodeURIComponent(roleQuery)}` : ""}`);
        if (res.ok) {
          const data = await res.json();
          setRoleResults(data.roles ?? []);
        }
      } catch { /* ignore */ }
      finally { setRoleLoading(false); }
    }, delay);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [roleQuery, granteeType]);

  // Department suggestions — load all on tab switch, filter on query
  useEffect(() => {
    if (granteeType !== "department") { setDeptResults([]); return; }
    const delay = deptSearchInput ? 300 : 0;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setDeptLoading(true);
      try {
        const res = await fetch("/api/users/search?departments=true");
        if (res.ok) {
          const data = await res.json();
          const allDepts = (data.departments ?? []).map((d: { name: string }) => d.name);
          const q = deptSearchInput.toLowerCase();
          setDeptResults(q ? allDepts.filter((d: string) => d.toLowerCase().includes(q)) : allDepts);
        }
      } catch { /* ignore */ }
      finally { setDeptLoading(false); }
    }, delay);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [deptSearchInput, granteeType]);

  function togglePerm(key: PermKey) {
    setPerms((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function selectAll() {
    const p = {} as Record<PermKey, boolean>;
    for (const k of PERM_KEYS) p[k] = true;
    setPerms(p);
  }

  function clearAll() {
    setPerms(defaultPerms());
  }

  async function handleSubmit() {
    setError(null);

    if (granteeType === "user" && selectedUsers.length === 0) {
      setError("Please select at least one user.");
      return;
    }
    if (granteeType === "role" && selectedRoles.length === 0) {
      setError("Please select at least one role.");
      return;
    }
    if (granteeType === "department" && selectedDepts.length === 0) {
      setError("Please select at least one department.");
      return;
    }
    if (!PERM_KEYS.some((k) => perms[k])) {
      setError("At least one permission must be granted.");
      return;
    }

    setSaving(true);
    try {
      // Build list of targets to grant
      const targets: { type: string; targetId: string }[] = [];
      if (granteeType === "user") {
        for (const u of selectedUsers) targets.push({ type: "user", targetId: u.id });
      } else if (granteeType === "role") {
        for (const r of selectedRoles) targets.push({ type: "role", targetId: r.id });
      } else {
        for (const d of selectedDepts) targets.push({ type: "department", targetId: d });
      }

      // For edit mode, just update the single entry
      if (mode === "edit" && initial) {
        const payload: Record<string, unknown> = {
          ...perms,
          aclId: initial.id,
          expiresAt: expiresAt || null,
          notes: notes.trim() || null,
        };
        await onSave(payload);
        onClose();
        return;
      }

      // For grant mode, create one ACL entry per target
      for (const t of targets) {
        const payload: Record<string, unknown> = {
          type: t.type,
          targetId: t.targetId,
          ...perms,
          expiresAt: expiresAt || null,
          notes: notes.trim() || null,
        };
        await onSave(payload);
      }

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const tabStyle = (active: boolean) =>
    `flex-1 py-2 text-xs font-semibold uppercase tracking-wide rounded-lg transition-colors ${
      active
        ? "bg-[#02773b] text-white shadow-sm"
        : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
    }`;

  return (
    <ModalBackdrop onClose={onClose}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800">
        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
          {mode === "grant" ? "Grant Access" : "Edit Access"}
        </h3>
        <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
          <IconX className="w-5 h-5 text-gray-400" />
        </button>
      </div>

      <div className="px-6 py-5 space-y-5">
        {/* Casefolder label */}
        <div className="text-xs text-gray-400 dark:text-gray-500">
          Casefolder: <span className="font-medium text-gray-600 dark:text-gray-300">{casefolderName}</span>
        </div>

        {/* Type toggle */}
        {mode === "grant" && (
          <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl">
            {(["user", "role", "department"] as GranteeType[]).map((t) => (
              <button
                key={t}
                type="button"
                className={tabStyle(granteeType === t)}
                onClick={() => setGranteeType(t)}
              >
                {t === "user" ? "User" : t === "role" ? "Role" : "Department"}
              </button>
            ))}
          </div>
        )}

        {/* User picker — multi-select */}
        {granteeType === "user" && (
          <div className="space-y-2">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
              Users {selectedUsers.length > 0 && <span className="text-[#02773b]">({selectedUsers.length})</span>}
            </label>
            {/* Selected users as tags */}
            {selectedUsers.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selectedUsers.map((u) => (
                  <span key={u.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#02773b]/10 text-[#02773b] dark:text-emerald-400 text-xs font-medium">
                    {u.displayName || u.name}
                    <button type="button" onClick={() => setSelectedUsers((prev) => prev.filter((x) => x.id !== u.id))} className="hover:text-red-500">
                      <IconX className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {/* Search input */}
            <div className="relative">
              <div className="relative">
                <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by name, email, or department..."
                  value={userQuery}
                  onChange={(e) => setUserQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#02773b]/40 focus:border-[#02773b]"
                />
                {userLoading && <Spinner className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />}
              </div>
              {userResults.length > 0 && (
                <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                  {userResults.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => {
                        if (!selectedUsers.some((x) => x.id === u.id)) setSelectedUsers((prev) => [...prev, u]);
                        setUserQuery("");
                      }}
                      className="w-full text-left px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors first:rounded-t-xl last:rounded-b-xl flex items-center gap-3"
                    >
                      <div className="w-7 h-7 rounded-full bg-[#02773b]/10 flex items-center justify-center text-xs font-bold text-[#02773b] shrink-0">
                        {(u.displayName || u.name).split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{u.displayName || u.name}</p>
                        <p className="text-xs text-gray-500 truncate">{[u.jobTitle, u.department].filter(Boolean).join(" — ") || u.email}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Role picker — multi-select */}
        {granteeType === "role" && (
          <div className="space-y-2">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
              Roles {selectedRoles.length > 0 && <span className="text-purple-600">({selectedRoles.length})</span>}
            </label>
            {selectedRoles.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selectedRoles.map((r) => (
                  <span key={r.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400 text-xs font-medium">
                    {r.name}
                    <button type="button" onClick={() => setSelectedRoles((prev) => prev.filter((x) => x.id !== r.id))} className="hover:text-red-500">
                      <IconX className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="relative">
              <div className="relative">
                <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search roles..."
                  value={roleQuery}
                  onChange={(e) => setRoleQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#02773b]/40 focus:border-[#02773b]"
                />
                {roleLoading && <Spinner className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />}
              </div>
              {roleResults.filter((r) => !selectedRoles.some((s) => s.id === r.id)).length > 0 && (
                <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                  {roleResults.filter((r) => !selectedRoles.some((s) => s.id === r.id)).map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => { setSelectedRoles((prev) => [...prev, r]); setRoleQuery(""); }}
                      className="w-full text-left px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors first:rounded-t-xl last:rounded-b-xl flex items-center gap-3"
                    >
                      <IconShield className="w-5 h-5 text-purple-500 shrink-0" />
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{r.name}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Department picker — multi-select */}
        {granteeType === "department" && (
          <div className="space-y-2">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
              Departments {selectedDepts.length > 0 && <span className="text-blue-600">({selectedDepts.length})</span>}
            </label>
            {selectedDepts.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selectedDepts.map((d) => (
                  <span key={d} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 text-xs font-medium">
                    {d}
                    <button type="button" onClick={() => setSelectedDepts((prev) => prev.filter((x) => x !== d))} className="hover:text-red-500">
                      <IconX className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="relative">
              <IconBuilding className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search departments..."
                value={deptSearchInput}
                onChange={(e) => setDeptSearchInput(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#02773b]/40 focus:border-[#02773b]"
              />
              {deptLoading && <Spinner className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />}
            </div>
            {deptResults.filter((d) => !selectedDepts.includes(d)).length > 0 && (
              <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg max-h-36 overflow-y-auto">
                {deptResults.filter((d) => !selectedDepts.includes(d)).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => { setSelectedDepts((prev) => [...prev, d]); setDeptSearchInput(""); }}
                    className="w-full text-left px-4 py-2 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800 first:rounded-t-xl last:rounded-b-xl flex items-center gap-2"
                  >
                    <IconBuilding className="w-4 h-4 text-gray-400 shrink-0" />
                    {d}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Permissions */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
              Permissions
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={selectAll} className="text-[10px] font-semibold text-[#02773b] hover:underline uppercase">
                Select All
              </button>
              <span className="text-gray-300 dark:text-gray-600">|</span>
              <button type="button" onClick={clearAll} className="text-[10px] font-semibold text-gray-400 hover:underline uppercase">
                Clear All
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {PERM_KEYS.map((k) => {
              const color = PERM_COLORS[k];
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => togglePerm(k)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all ${
                    perms[k]
                      ? `${color.bg} border-transparent`
                      : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded flex items-center justify-center transition-colors ${
                      perms[k] ? "bg-[#02773b] text-white" : "border border-gray-300 dark:border-gray-600"
                    }`}
                  >
                    {perms[k] && <IconCheck className="w-2.5 h-2.5" />}
                  </div>
                  <span className={`text-xs font-medium ${perms[k] ? color.text : "text-gray-600 dark:text-gray-400"}`}>
                    {PERM_LABELS[k]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Expiry */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
            Expires (optional)
          </label>
          <input
            type="date"
            value={expiresAt ? expiresAt.split("T")[0] : ""}
            onChange={(e) => setExpiresAt(e.target.value ? `${e.target.value}T23:59:59.000Z` : "")}
            className="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[#02773b]/40 focus:border-[#02773b]"
          />
        </div>

        {/* Notes */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
            Notes (optional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Reason for access grant..."
            className="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#02773b]/40 focus:border-[#02773b] resize-none"
          />
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
            <IconWarning className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-800">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={saving}
          className="inline-flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white bg-[#02773b] hover:bg-[#025f2f] disabled:opacity-60 shadow-sm transition-colors"
        >
          {saving && <Spinner className="w-4 h-4" />}
          {mode === "grant" ? "Grant Access" : "Save Changes"}
        </button>
      </div>
    </ModalBackdrop>
  );
}

/* ------------------------------------------------------------------ */
/*  Revoke confirmation dialog                                         */
/* ------------------------------------------------------------------ */

function RevokeDialog({
  entry,
  onClose,
  onConfirm,
}: {
  entry: ACLEntry;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [revoking, setRevoking] = useState(false);

  async function handleConfirm() {
    setRevoking(true);
    try {
      await onConfirm();
      onClose();
    } catch {
      setRevoking(false);
    }
  }

  return (
    <ModalBackdrop onClose={onClose}>
      <div className="px-6 py-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-950/40 flex items-center justify-center shrink-0">
            <IconWarning className="w-5 h-5 text-red-500" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
              Revoke Access
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Are you sure you want to revoke access for{" "}
              <span className="font-semibold text-gray-900 dark:text-gray-100">
                {entryName(entry)}
              </span>
              ? This action cannot be undone. The {entryType(entry)} will immediately
              lose all permissions on this casefolder.
            </p>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-800">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={revoking}
          className="inline-flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 shadow-sm transition-colors"
        >
          {revoking && <Spinner className="w-4 h-4" />}
          Revoke Access
        </button>
      </div>
    </ModalBackdrop>
  );
}

/* ------------------------------------------------------------------ */
/*  Main ACL Panel                                                     */
/* ------------------------------------------------------------------ */

export default function ACLPanel({ casefolderName, formTemplateId, userPermissions }: ACLPanelProps) {
  const [entries, setEntries] = useState<ACLEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingInline, setSavingInline] = useState<string | null>(null);

  // Modal state
  const [grantOpen, setGrantOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<ACLEntry | null>(null);
  const [revokeEntry, setRevokeEntry] = useState<ACLEntry | null>(null);

  const canManage = userPermissions.canManageACL;

  /* ---------- Fetch ACL entries ---------- */

  const fetchACL = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch(`/api/records/casefolders/${formTemplateId}/acl`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to load ACL (${res.status})`);
      }
      const data = await res.json();
      setEntries(data.acls ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load access controls");
    } finally {
      setLoading(false);
    }
  }, [formTemplateId]);

  useEffect(() => {
    fetchACL();
  }, [fetchACL]);

  /* ---------- Grant access ---------- */

  async function handleGrant(payload: Record<string, unknown>) {
    const res = await fetch(`/api/records/casefolders/${formTemplateId}/acl`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Failed to grant access");
    }
    await fetchACL();
  }

  /* ---------- Edit access ---------- */

  async function handleEdit(payload: Record<string, unknown>) {
    const res = await fetch(`/api/records/casefolders/${formTemplateId}/acl`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Failed to update access");
    }
    await fetchACL();
  }

  /* ---------- Revoke access ---------- */

  async function handleRevoke(entry: ACLEntry) {
    const res = await fetch(`/api/records/casefolders/${formTemplateId}/acl`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: entry.id }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Failed to revoke access");
    }
    await fetchACL();
  }

  /* ---------- Inline permission toggle ---------- */

  async function handleInlineToggle(entry: ACLEntry, key: PermKey, value: boolean) {
    if (!canManage) return;
    setSavingInline(entry.id);
    try {
      const payload: Record<string, unknown> = { id: entry.id, [key]: value };
      const res = await fetch(`/api/records/casefolders/${formTemplateId}/acl`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to update");
      }
      // Optimistic update
      setEntries((prev) =>
        prev.map((e) => (e.id === entry.id ? { ...e, [key]: value } : e))
      );
    } catch {
      await fetchACL();
    } finally {
      setSavingInline(null);
    }
  }

  /* ---------- Render ---------- */

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
      {/* ---- Header ---- */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#02773b]/10 flex items-center justify-center">
            <IconLock className="w-5 h-5 text-[#02773b]" />
          </div>
          <div>
            <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">
              Access Control
            </h2>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {entries.length} {entries.length === 1 ? "entry" : "entries"} configured
            </p>
          </div>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setGrantOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-[#02773b] hover:bg-[#025f2f] shadow-sm transition-colors"
          >
            <IconPlus className="w-4 h-4" />
            Grant Access
          </button>
        )}
      </div>

      {/* ---- Current user permissions bar ---- */}
      <div className="px-5 py-3 bg-gray-50 dark:bg-gray-800/30 border-b border-gray-200 dark:border-gray-800">
        <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">
          Your effective permissions
        </p>
        <div className="flex flex-wrap gap-1.5">
          {PERM_KEYS.map((k) => {
            const granted = userPermissions[k];
            const color = PERM_COLORS[k];
            return (
              <span
                key={k}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-opacity ${
                  granted
                    ? `${color.bg} ${color.text}`
                    : "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 opacity-50"
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${granted ? color.dot : "bg-gray-400 dark:bg-gray-600"}`} />
                {PERM_LABELS[k]}
              </span>
            );
          })}
        </div>
      </div>

      {/* ---- Error banner ---- */}
      {error && (
        <div className="mx-5 mt-4 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 p-3 flex items-start gap-2">
          <IconWarning className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-xs font-medium text-red-800 dark:text-red-300">{error}</p>
            <button
              onClick={() => { setLoading(true); fetchACL(); }}
              className="text-xs text-red-600 dark:text-red-400 underline mt-1 hover:no-underline"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {/* ---- Loading ---- */}
      {loading && (
        <div className="px-5 py-12 flex flex-col items-center gap-3">
          <Spinner className="w-6 h-6 text-[#02773b]" />
          <p className="text-xs text-gray-400">Loading access controls...</p>
        </div>
      )}

      {/* ---- Empty state ---- */}
      {!loading && entries.length === 0 && !error && (
        <div className="px-5 py-14 flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-2xl bg-[#dd9f42]/10 flex items-center justify-center mb-4">
            <IconLock className="w-7 h-7 text-[#dd9f42]" />
          </div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            No access controls configured
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-xs">
            All authenticated users can view this casefolder. Grant specific access to restrict visibility.
          </p>
          {canManage && (
            <button
              type="button"
              onClick={() => setGrantOpen(true)}
              className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-[#02773b] hover:bg-[#025f2f] shadow-sm transition-colors"
            >
              <IconPlus className="w-4 h-4" />
              Grant Access
            </button>
          )}
        </div>
      )}

      {/* ---- ACL entries table ---- */}
      {!loading && entries.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800">
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">
                  Type
                </th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">
                  Name
                </th>
                {PERM_KEYS.map((k) => (
                  <th
                    key={k}
                    className="text-center px-2 py-3 text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap"
                  >
                    {PERM_LABELS[k].replace("Manage ACL", "ACL")}
                  </th>
                ))}
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">
                  Expires
                </th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap hidden lg:table-cell">
                  Notes
                </th>
                {canManage && (
                  <th className="text-right px-4 py-3 text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const type = entryType(entry);
                const name = entryName(entry);
                const sub = entrySubtext(entry);
                const isSaving = savingInline === entry.id;
                return (
                  <tr
                    key={entry.id}
                    className={`border-b border-gray-100 dark:border-gray-800/50 hover:bg-gray-50/50 dark:hover:bg-gray-800/20 transition-colors ${
                      isSaving ? "opacity-60" : ""
                    }`}
                  >
                    {/* Type */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <TypeBadge type={type} />
                    </td>

                    {/* Name */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate max-w-[180px]">
                          {name}
                        </p>
                        {sub && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[180px]">
                            {sub}
                          </p>
                        )}
                      </div>
                    </td>

                    {/* Permission checkboxes */}
                    {PERM_KEYS.map((k) => (
                      <td key={k} className="px-2 py-3 text-center">
                        <div className="flex justify-center">
                          <PermCheckbox
                            checked={entry[k]}
                            disabled={!canManage || isSaving}
                            onChange={(v) => handleInlineToggle(entry, k, v)}
                          />
                        </div>
                      </td>
                    ))}

                    {/* Expires */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`text-xs ${
                        entry.expiresAt
                          ? "text-amber-600 dark:text-amber-400 font-medium"
                          : "text-gray-400 dark:text-gray-500"
                      }`}>
                        {entry.expiresAt ? formatDate(entry.expiresAt) : "Never"}
                      </span>
                    </td>

                    {/* Notes */}
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <span className="text-xs text-gray-500 dark:text-gray-400" title={entry.notes ?? undefined}>
                        {entry.notes ? truncate(entry.notes, 30) : "\u2014"}
                      </span>
                    </td>

                    {/* Actions */}
                    {canManage && (
                      <td className="px-4 py-3 whitespace-nowrap text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setEditEntry(entry)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-[#02773b] hover:bg-[#02773b]/10 transition-colors"
                            title="Edit"
                          >
                            <IconPencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setRevokeEntry(entry)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                            title="Revoke"
                          >
                            <IconTrash className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- Modals ---- */}
      {grantOpen && (
        <GrantModal
          mode="grant"
          casefolderName={casefolderName}
          onClose={() => setGrantOpen(false)}
          onSave={handleGrant}
        />
      )}

      {editEntry && (
        <GrantModal
          mode="edit"
          initial={editEntry}
          casefolderName={casefolderName}
          onClose={() => setEditEntry(null)}
          onSave={handleEdit}
        />
      )}

      {revokeEntry && (
        <RevokeDialog
          entry={revokeEntry}
          onClose={() => setRevokeEntry(null)}
          onConfirm={() => handleRevoke(revokeEntry)}
        />
      )}
    </div>
  );
}
