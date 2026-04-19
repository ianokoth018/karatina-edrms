"use client";

import { useState, useEffect, useRef } from "react";

/* ========================================================================== */
/*  Types                                                                     */
/* ========================================================================== */

export interface UserOption {
  id: string;
  name: string;
  displayName: string;
  email: string;
  department: string | null;
  jobTitle: string | null;
  roles?: string[];
}

interface DepartmentInfo {
  name: string;
  userCount: number;
}

export interface DepartmentUserSelectProps {
  onSelect: (user: UserOption) => void;
  excludeIds: string[];
  selectedUser: UserOption | null;
  onClear: () => void;
  label?: string;
  sublabel?: string;
}

/* ========================================================================== */
/*  DepartmentUserSelect                                                      */
/*  Pick a department, then pick a user. Shows the selected user as a card.   */
/* ========================================================================== */

export function DepartmentUserSelect({
  onSelect,
  excludeIds,
  selectedUser,
  onClear,
  label,
  sublabel,
}: DepartmentUserSelectProps) {
  const [departments, setDepartments] = useState<DepartmentInfo[]>([]);
  const [selectedDept, setSelectedDept] = useState("");
  const [deptQuery, setDeptQuery] = useState("");
  const [isDeptOpen, setIsDeptOpen] = useState(false);
  const [deptUsers, setDeptUsers] = useState<UserOption[]>([]);
  const [isLoadingDepts, setIsLoadingDepts] = useState(false);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [userFilter, setUserFilter] = useState("");
  const deptWrapperRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        deptWrapperRef.current &&
        !deptWrapperRef.current.contains(e.target as Node)
      ) {
        setIsDeptOpen(false);
        // Reset query text to selected department name if one is selected
        if (selectedDept) setDeptQuery(selectedDept);
        else setDeptQuery("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [selectedDept]);

  // Fetch departments on mount
  useEffect(() => {
    setIsLoadingDepts(true);
    fetch("/api/users/search?departments=true")
      .then((r) => r.json())
      .then((data) => setDepartments(data.departments ?? []))
      .catch(() => {})
      .finally(() => setIsLoadingDepts(false));
  }, []);

  // Fetch users when department changes
  useEffect(() => {
    if (!selectedDept) {
      setDeptUsers([]);
      return;
    }
    setIsLoadingUsers(true);
    const excludeParam = excludeIds.length
      ? `&exclude=${excludeIds.join(",")}`
      : "";
    fetch(
      `/api/users/search?department=${encodeURIComponent(selectedDept)}&limit=50${excludeParam}`
    )
      .then((r) => r.json())
      .then((data) => setDeptUsers(data.users ?? []))
      .catch(() => {})
      .finally(() => setIsLoadingUsers(false));
  }, [selectedDept, excludeIds]);

  function getInitials(name: string) {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }

  function handleSelectDept(dept: DepartmentInfo) {
    setSelectedDept(dept.name);
    setDeptQuery(dept.name);
    setIsDeptOpen(false);
    setUserFilter("");
  }

  function handleClearDept() {
    setSelectedDept("");
    setDeptQuery("");
    setDeptUsers([]);
    setUserFilter("");
  }

  const filteredDepts = deptQuery && deptQuery !== selectedDept
    ? departments.filter((d) =>
        d.name.toLowerCase().includes(deptQuery.toLowerCase())
      )
    : departments;

  const filteredUsers = userFilter
    ? deptUsers.filter((u) =>
        u.displayName.toLowerCase().includes(userFilter.toLowerCase()) ||
        (u.jobTitle?.toLowerCase().includes(userFilter.toLowerCase()) ?? false)
      )
    : deptUsers;

  const labelEl = label ? (
    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
      {label}
      {sublabel && <span className="ml-1 text-xs font-normal text-gray-400">{sublabel}</span>}
    </label>
  ) : null;

  // Selected user display
  if (selectedUser) {
    return (
      <div>
        {labelEl}
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60">
        <div className="w-9 h-9 rounded-full bg-[#02773b] flex items-center justify-center text-white text-sm font-semibold flex-shrink-0">
          {getInitials(selectedUser.displayName)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
            {selectedUser.displayName}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
            {[selectedUser.jobTitle, selectedUser.department]
              .filter(Boolean)
              .join(" - ") || selectedUser.email}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            onClear();
            handleClearDept();
          }}
          className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
          title="Remove"
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
              d="M6 18 18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
      </div>
    );
  }

  return (
    <div>
      {labelEl}
      <div className="space-y-3">
      {/* Department combobox */}
      <div ref={deptWrapperRef} className="relative">
        <div className="relative">
          <div className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21"
              />
            </svg>
          </div>
          <input
            type="text"
            value={deptQuery}
            onChange={(e) => {
              setDeptQuery(e.target.value);
              setIsDeptOpen(true);
              if (!e.target.value.trim()) {
                setSelectedDept("");
                setDeptUsers([]);
              }
            }}
            onFocus={() => setIsDeptOpen(true)}
            placeholder={isLoadingDepts ? "Loading departments..." : "Type to search departments..."}
            className="w-full h-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 pl-10 pr-10 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 transition-all focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20 outline-none"
          />
          {selectedDept ? (
            <button
              type="button"
              onClick={handleClearDept}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          ) : (
            <div className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400">
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
              </svg>
            </div>
          )}
        </div>

        {/* Department dropdown */}
        {isDeptOpen && (
          <div className="absolute z-50 mt-1.5 w-full max-h-60 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl">
            {filteredDepts.length > 0 ? (
              filteredDepts.map((dept) => (
                <button
                  key={dept.name}
                  type="button"
                  onClick={() => handleSelectDept(dept)}
                  className={`w-full text-left flex items-center justify-between px-4 py-2.5 transition-colors first:rounded-t-xl last:rounded-b-xl ${
                    dept.name === selectedDept
                      ? "bg-[#02773b]/5 dark:bg-[#02773b]/10"
                      : "hover:bg-gray-50 dark:hover:bg-gray-800"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-[#02773b]/10 dark:bg-[#02773b]/20 flex items-center justify-center flex-shrink-0">
                      <svg
                        className="w-4 h-4 text-[#02773b] dark:text-emerald-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={1.5}
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21"
                        />
                      </svg>
                    </div>
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {dept.name}
                    </span>
                  </div>
                  <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0 ml-2">
                    {dept.userCount} {dept.userCount === 1 ? "user" : "users"}
                  </span>
                </button>
              ))
            ) : (
              <div className="px-4 py-3 text-center">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  No departments match &ldquo;{deptQuery}&rdquo;
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* User list for selected department */}
      {selectedDept && !isDeptOpen && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
          {/* Filter within department */}
          {deptUsers.length > 3 && (
            <div className="px-3 pt-3 pb-1">
              <div className="relative">
                <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                  </svg>
                </div>
                <input
                  type="text"
                  value={userFilter}
                  onChange={(e) => setUserFilter(e.target.value)}
                  placeholder="Filter by name or title..."
                  className="w-full h-9 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 pl-9 pr-3 text-xs text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 outline-none focus:border-[#02773b] focus:ring-1 focus:ring-[#02773b]/20"
                />
              </div>
            </div>
          )}

          {isLoadingUsers ? (
            <div className="flex items-center justify-center py-6">
              <div className="w-5 h-5 border-2 border-[#02773b] border-t-transparent rounded-full animate-spin" />
              <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">
                Loading users...
              </span>
            </div>
          ) : deptUsers.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No users in this department
              </p>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No users match &ldquo;{userFilter}&rdquo;
              </p>
            </div>
          ) : (
            <div className="max-h-48 overflow-y-auto">
              {filteredUsers.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => onSelect(user)}
                  className="w-full text-left flex items-center gap-3 px-4 py-2.5 hover:bg-[#02773b]/5 dark:hover:bg-[#02773b]/10 transition-colors border-b border-gray-100 dark:border-gray-800 last:border-b-0"
                >
                  <div className="w-8 h-8 rounded-full bg-[#02773b]/10 dark:bg-[#02773b]/20 flex items-center justify-center text-[#02773b] dark:text-emerald-400 text-xs font-semibold flex-shrink-0">
                    {getInitials(user.displayName)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {user.displayName}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {user.jobTitle || user.email}
                    </p>
                  </div>
                  <svg
                    className="w-4 h-4 text-gray-300 dark:text-gray-600 flex-shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m8.25 4.5 7.5 7.5-7.5 7.5"
                    />
                  </svg>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
    </div>
  );
}
