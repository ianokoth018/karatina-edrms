"use client";

import { useState, useEffect, useRef } from "react";
import { type UserOption } from "./department-user-select";
import { DepartmentUserPicker } from "./department-user-picker";

/* ========================================================================== */
/*  Types                                                                     */
/* ========================================================================== */

export interface DepartmentTag {
  type: "department";
  name: string;
}

export interface UserTag {
  type: "user";
  user: UserOption;
}

export type RecipientTag = DepartmentTag | UserTag;

export interface MultiUserInputProps {
  label: string;
  sublabel?: string;
  users: UserOption[];
  departments?: string[];
  onAdd: (user: UserOption) => void;
  onRemove: (id: string) => void;
  onAddDepartment?: (dept: string) => void;
  onRemoveDepartment?: (dept: string) => void;
  excludeIds: string[];
  tagColor?: "blue" | "gray";
  max?: number;
}

interface DeptInfo {
  name: string;
  userCount: number;
}

/* ========================================================================== */
/*  MultiUserInput                                                            */
/*  Displays selected users AND departments as tags.                          */
/*  Supports adding individual users or entire departments.                   */
/* ========================================================================== */

export function MultiUserInput({
  label,
  sublabel,
  users,
  departments: selectedDepts = [],
  onAdd,
  onRemove,
  onAddDepartment,
  onRemoveDepartment,
  excludeIds,
  tagColor = "blue",
  max,
}: MultiUserInputProps) {
  const colorMap = {
    blue: "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300",
    gray: "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400",
  };
  const tagClass = colorMap[tagColor];

  const [mode, setMode] = useState<"user" | "department">("user");
  const [deptQuery, setDeptQuery] = useState("");
  const [allDepts, setAllDepts] = useState<DeptInfo[]>([]);
  const [isDeptOpen, setIsDeptOpen] = useState(false);
  const deptRef = useRef<HTMLDivElement>(null);

  const atMax = max != null && users.length >= max;
  const supportsDepts = !!onAddDepartment;

  // Fetch departments when mode switches to department
  useEffect(() => {
    if (mode === "department" && allDepts.length === 0) {
      fetch("/api/users/search?departments=true")
        .then((r) => r.ok ? r.json() : null)
        .then((d) => d?.departments && setAllDepts(d.departments))
        .catch(() => {});
    }
  }, [mode, allDepts.length]);

  // Close dept dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (deptRef.current && !deptRef.current.contains(e.target as Node)) {
        setIsDeptOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const filteredDepts = allDepts.filter(
    (d) =>
      !selectedDepts.includes(d.name) &&
      (!deptQuery || d.name.toLowerCase().includes(deptQuery.toLowerCase()))
  );

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {label}
        {sublabel && (
          <span className="ml-1 text-xs font-normal text-gray-400">
            {sublabel}
          </span>
        )}
      </label>

      {/* Tags: departments + users */}
      {(users.length > 0 || selectedDepts.length > 0) && (
        <div className="flex flex-wrap gap-2 mb-2">
          {selectedDepts.map((dept) => (
            <span
              key={`dept-${dept}`}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium bg-[#02773b]/10 text-[#02773b] dark:text-emerald-400"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Z" />
              </svg>
              {dept}
              {onRemoveDepartment && (
                <button
                  type="button"
                  onClick={() => onRemoveDepartment(dept)}
                  className="opacity-60 hover:opacity-100 transition-opacity"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </span>
          ))}
          {users.map((user) => (
            <span
              key={user.id}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${tagClass}`}
            >
              {user.displayName}
              <button
                type="button"
                onClick={() => onRemove(user.id)}
                className="opacity-60 hover:opacity-100 transition-opacity"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Mode toggle + picker */}
      {!atMax && (
        <div className="space-y-2">
          {/* Mode toggle — only show if department support is enabled */}
          {supportsDepts && (
            <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <button
                type="button"
                onClick={() => setMode("user")}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  mode === "user"
                    ? "bg-[#02773b] text-white"
                    : "bg-white dark:bg-gray-900 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
              >
                Person
              </button>
              <button
                type="button"
                onClick={() => setMode("department")}
                className={`px-3 py-1.5 text-xs font-medium border-l border-gray-200 dark:border-gray-700 transition-colors ${
                  mode === "department"
                    ? "bg-[#02773b] text-white"
                    : "bg-white dark:bg-gray-900 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
              >
                Department
              </button>
            </div>
          )}

          {/* User picker */}
          {mode === "user" && (
            <DepartmentUserPicker
              placeholder={`Search to add ${label.toLowerCase()} recipient...`}
              onSelect={(user) => {
                if (!users.some((u) => u.id === user.id)) onAdd(user);
              }}
              excludeIds={excludeIds}
            />
          )}

          {/* Department picker */}
          {mode === "department" && onAddDepartment && (
            <div className="relative" ref={deptRef}>
              <input
                type="text"
                value={deptQuery}
                onChange={(e) => { setDeptQuery(e.target.value); setIsDeptOpen(true); }}
                onFocus={() => setIsDeptOpen(true)}
                placeholder="Search department..."
                className="w-full h-10 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20"
              />
              {isDeptOpen && filteredDepts.length > 0 && (
                <div className="absolute z-20 mt-1 w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                  {filteredDepts.map((dept) => (
                    <button
                      key={dept.name}
                      type="button"
                      onClick={() => {
                        onAddDepartment(dept.name);
                        setDeptQuery("");
                        setIsDeptOpen(false);
                      }}
                      className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex items-center justify-between"
                    >
                      <span className="text-gray-900 dark:text-gray-100">{dept.name}</span>
                      <span className="text-xs text-gray-400">{dept.userCount} staff</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {atMax && (
        <p className="text-sm text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
          Maximum of {max} {label.toLowerCase()} reached.
        </p>
      )}
    </div>
  );
}
