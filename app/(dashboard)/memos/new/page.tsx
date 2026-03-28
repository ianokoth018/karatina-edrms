"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

/* ---------- types ---------- */

interface UserOption {
  id: string;
  name: string;
  displayName: string;
  email: string;
  department: string | null;
  jobTitle: string | null;
}

/* ---------- constants ---------- */

const STEPS = [
  { num: 1, label: "Compose" },
  { num: 2, label: "Recommenders" },
  { num: 3, label: "Review & Send" },
];

/* ---------- UserSearch component ---------- */

function UserSearch({
  label,
  placeholder,
  onSelect,
  excludeIds,
  selectedUser,
  onClear,
}: {
  label: string;
  placeholder: string;
  onSelect: (user: UserOption) => void;
  excludeIds: string[];
  selectedUser: UserOption | null;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserOption[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleInput(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const excludeParam = excludeIds.length
          ? `&exclude=${excludeIds.join(",")}`
          : "";
        const res = await fetch(
          `/api/users/search?q=${encodeURIComponent(value.trim())}${excludeParam}`
        );
        if (res.ok) {
          const data = await res.json();
          setResults(data.users);
          setIsOpen(true);
        }
      } catch {
        // ignore
      } finally {
        setIsSearching(false);
      }
    }, 300);
  }

  if (selectedUser) {
    return (
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
          {label}
        </label>
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
          <div className="w-9 h-9 rounded-full bg-karu-green flex items-center justify-center text-white text-sm font-semibold flex-shrink-0">
            {selectedUser.displayName
              .split(" ")
              .map((n) => n[0])
              .join("")
              .toUpperCase()
              .slice(0, 2)}
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
            onClick={onClear}
            className="p-1 rounded-lg text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title="Remove"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className="relative">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
        {label}
      </label>
      <div className="relative">
        <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          onFocus={() => { if (results.length > 0) setIsOpen(true); }}
          placeholder={placeholder}
          className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 pl-9 pr-4 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
        />
        {isSearching && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="w-4 h-4 border-2 border-karu-green border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* Dropdown */}
      {isOpen && results.length > 0 && (
        <div className="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg">
          {results.map((user) => (
            <button
              key={user.id}
              type="button"
              onClick={() => {
                onSelect(user);
                setQuery("");
                setResults([]);
                setIsOpen(false);
              }}
              className="w-full text-left flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-600 dark:text-gray-300 text-xs font-semibold flex-shrink-0">
                {user.displayName
                  .split(" ")
                  .map((n) => n[0])
                  .join("")
                  .toUpperCase()
                  .slice(0, 2)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                  {user.displayName}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {[user.jobTitle, user.department].filter(Boolean).join(" - ") ||
                    user.email}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {isOpen && results.length === 0 && query.length >= 2 && !isSearching && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg p-4 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">No users found</p>
        </div>
      )}
    </div>
  );
}

/* ---------- main component ---------- */

export default function NewMemoPage() {
  const { data: session } = useSession();
  const router = useRouter();

  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1: Compose
  const [recipient, setRecipient] = useState<UserOption | null>(null);
  const [subject, setSubject] = useState("");
  const [memoBody, setMemoBody] = useState("");
  const [referencePreview, setReferencePreview] = useState("");

  // Step 2: Recommenders
  const [recommenders, setRecommenders] = useState<UserOption[]>([]);

  // Generate reference preview
  const generateRefPreview = useCallback(() => {
    const dept = session?.user?.department?.replace(/[^A-Z0-9]/gi, "").slice(0, 6).toUpperCase() || "GEN";
    const year = new Date().getFullYear();
    setReferencePreview(`MEMO-${year}-${dept}-XXXXXX`);
  }, [session?.user?.department]);

  useEffect(() => {
    generateRefPreview();
  }, [generateRefPreview]);

  function canProceedStep1(): boolean {
    return !!recipient && !!subject.trim() && !!memoBody.trim();
  }

  function addRecommender(user: UserOption) {
    if (recommenders.length >= 5) return;
    if (recommenders.some((r) => r.id === user.id)) return;
    setRecommenders([...recommenders, user]);
  }

  function removeRecommender(index: number) {
    setRecommenders(recommenders.filter((_, i) => i !== index));
  }

  function moveRecommender(index: number, direction: "up" | "down") {
    const newList = [...recommenders];
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newList.length) return;
    [newList[index], newList[targetIndex]] = [
      newList[targetIndex],
      newList[index],
    ];
    setRecommenders(newList);
  }

  function formatDate(): string {
    return new Date().toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }

  async function handleSubmit() {
    if (!recipient || !subject.trim() || !memoBody.trim()) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/memos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: recipient.id,
          subject: subject.trim(),
          memoBody: memoBody.trim(),
          recommenders: recommenders.map((r) => r.id),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? "Failed to create memo");
      }

      const data = await res.json();
      router.push(`/memos/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setIsSubmitting(false);
    }
  }

  const excludeIds = [
    session?.user?.id ?? "",
    recipient?.id ?? "",
    ...recommenders.map((r) => r.id),
  ].filter(Boolean);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          New Internal Memo
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Compose and route an internal memorandum for approval
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {STEPS.map((s, idx) => (
          <div key={s.num} className="flex items-center gap-2">
            <button
              onClick={() => {
                if (s.num < step) setStep(s.num);
              }}
              disabled={s.num > step}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                s.num === step
                  ? "bg-karu-green text-white"
                  : s.num < step
                  ? "bg-karu-green/10 text-karu-green cursor-pointer hover:bg-karu-green/20"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed"
              }`}
            >
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  s.num === step
                    ? "bg-white/20 text-white"
                    : s.num < step
                    ? "bg-karu-green text-white"
                    : "bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500"
                }`}
              >
                {s.num < step ? (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                ) : (
                  s.num
                )}
              </span>
              <span className="hidden sm:inline">{s.label}</span>
            </button>
            {idx < STEPS.length - 1 && (
              <div className={`w-8 h-0.5 ${idx < step - 1 ? "bg-karu-green" : "bg-gray-200 dark:bg-gray-700"}`} />
            )}
          </div>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <svg className="h-4 w-4 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          </div>
        </div>
      )}

      {/* Step 1: Compose */}
      {step === 1 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-5 animate-slide-up">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Compose Memo
          </h2>

          {/* Reference (read-only) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Reference Number
            </label>
            <input
              type="text"
              value={referencePreview}
              disabled
              className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 px-4 text-sm text-gray-500 dark:text-gray-400 font-mono cursor-not-allowed"
            />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              Auto-generated when memo is sent
            </p>
          </div>

          {/* To (recipient / approver) */}
          <UserSearch
            label="To (Recipient / Final Approver)"
            placeholder="Search by name, email, or department..."
            onSelect={setRecipient}
            excludeIds={[session?.user?.id ?? ""]}
            selectedUser={recipient}
            onClear={() => setRecipient(null)}
          />

          {/* Subject */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Subject
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g., Request for Server Upgrade"
              className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-4 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
            />
          </div>

          {/* Body */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Memo Body
            </label>
            <textarea
              value={memoBody}
              onChange={(e) => setMemoBody(e.target.value)}
              rows={10}
              placeholder="Write the content of your memorandum..."
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-4 py-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none resize-y"
            />
          </div>

          {/* Department (from session, read-only) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Department
            </label>
            <input
              type="text"
              value={session?.user?.department || ""}
              disabled
              className="w-full h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 px-4 text-sm text-gray-500 dark:text-gray-400 cursor-not-allowed"
            />
          </div>

          {/* Navigation */}
          <div className="flex justify-end pt-2">
            <button
              onClick={() => setStep(2)}
              disabled={!canProceedStep1()}
              className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-karu-green text-white font-medium text-sm transition-all hover:bg-karu-green-dark focus:ring-2 focus:ring-karu-green/20 focus:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next: Add Recommenders
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Recommenders */}
      {step === 2 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-5 animate-slide-up">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Add Recommenders
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Optional. Add up to 5 people who must recommend (endorse) the memo
              before it reaches the final approver. They will review in the order
              listed.
            </p>
          </div>

          {/* Recommender list */}
          {recommenders.length > 0 && (
            <div className="space-y-2">
              {recommenders.map((rec, index) => (
                <div
                  key={rec.id}
                  className="flex items-center gap-3 px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800"
                >
                  <span className="w-7 h-7 rounded-full bg-karu-green/10 text-karu-green flex items-center justify-center text-xs font-bold flex-shrink-0">
                    {index + 1}
                  </span>
                  <div className="w-8 h-8 rounded-full bg-karu-green flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
                    {rec.displayName
                      .split(" ")
                      .map((n) => n[0])
                      .join("")
                      .toUpperCase()
                      .slice(0, 2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {rec.displayName}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {[rec.jobTitle, rec.department]
                        .filter(Boolean)
                        .join(" - ") || rec.email}
                    </p>
                  </div>

                  {/* Reorder buttons */}
                  <div className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      onClick={() => moveRecommender(index, "up")}
                      disabled={index === 0}
                      className="p-0.5 rounded text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      title="Move up"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 15.75 7.5-7.5 7.5 7.5" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => moveRecommender(index, "down")}
                      disabled={index === recommenders.length - 1}
                      className="p-0.5 rounded text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      title="Move down"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                      </svg>
                    </button>
                  </div>

                  {/* Remove */}
                  <button
                    type="button"
                    onClick={() => removeRecommender(index)}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    title="Remove"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add recommender search */}
          {recommenders.length < 5 && (
            <UserSearch
              label="Add Recommender"
              placeholder="Search by name, email, or department..."
              onSelect={addRecommender}
              excludeIds={excludeIds}
              selectedUser={null}
              onClear={() => {}}
            />
          )}

          {recommenders.length >= 5 && (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              Maximum of 5 recommenders reached.
            </p>
          )}

          {/* Navigation */}
          <div className="flex justify-between pt-2">
            <button
              onClick={() => setStep(1)}
              className="inline-flex items-center gap-2 h-10 px-5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-medium text-sm transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
              </svg>
              Back
            </button>
            <button
              onClick={() => setStep(3)}
              className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-karu-green text-white font-medium text-sm transition-all hover:bg-karu-green-dark focus:ring-2 focus:ring-karu-green/20 focus:ring-offset-2"
            >
              Next: Review
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Review & Send */}
      {step === 3 && (
        <div className="space-y-6 animate-slide-up">
          {/* Memo preview */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Memo Preview
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                Review the formatted memo before sending
              </p>
            </div>

            {/* Formatted memo */}
            <div className="p-6 sm:p-8">
              <div className="max-w-2xl mx-auto border-2 border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden bg-white dark:bg-gray-950">
                {/* Header bar */}
                <div className="bg-[#02773b] px-6 py-4 text-center">
                  <h3 className="text-white text-lg font-bold tracking-wide">
                    KARATINA UNIVERSITY
                  </h3>
                  <p className="text-white/80 text-sm font-medium tracking-widest mt-0.5">
                    INTERNAL MEMORANDUM
                  </p>
                </div>

                {/* Memo content */}
                <div className="px-6 py-5 space-y-4">
                  {/* Reference and Date */}
                  <div className="flex flex-col sm:flex-row sm:justify-between gap-1 text-sm">
                    <p>
                      <span className="font-semibold text-gray-700 dark:text-gray-300">
                        REF:{" "}
                      </span>
                      <span className="font-mono text-gray-900 dark:text-gray-100">
                        {referencePreview}
                      </span>
                    </p>
                    <p>
                      <span className="font-semibold text-gray-700 dark:text-gray-300">
                        DATE:{" "}
                      </span>
                      <span className="text-gray-900 dark:text-gray-100">
                        {formatDate()}
                      </span>
                    </p>
                  </div>

                  {/* Divider */}
                  <hr className="border-gray-300 dark:border-gray-600" />

                  {/* To / From / Subject */}
                  <div className="space-y-2 text-sm">
                    <p>
                      <span className="font-semibold text-gray-700 dark:text-gray-300 inline-block w-20">
                        TO:
                      </span>
                      <span className="text-gray-900 dark:text-gray-100">
                        {recipient?.displayName}
                        {recipient?.jobTitle && `, ${recipient.jobTitle}`}
                        {recipient?.department && ` - ${recipient.department}`}
                      </span>
                    </p>
                    <p>
                      <span className="font-semibold text-gray-700 dark:text-gray-300 inline-block w-20">
                        FROM:
                      </span>
                      <span className="text-gray-900 dark:text-gray-100">
                        {session?.user?.name}
                        {session?.user?.department &&
                          ` - ${session.user.department}`}
                      </span>
                    </p>
                    <p>
                      <span className="font-semibold text-gray-700 dark:text-gray-300 inline-block w-20">
                        SUBJECT:
                      </span>
                      <span className="text-gray-900 dark:text-gray-100 font-medium">
                        {subject}
                      </span>
                    </p>
                  </div>

                  {/* Divider */}
                  <hr className="border-gray-300 dark:border-gray-600" />

                  {/* Body */}
                  <div className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed min-h-[100px]">
                    {memoBody}
                  </div>

                  {/* Divider */}
                  <hr className="border-gray-300 dark:border-gray-600" />

                  {/* Recommenders section */}
                  {recommenders.length > 0 && (
                    <div className="space-y-4">
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 tracking-wide">
                        RECOMMENDED BY:
                      </p>
                      {recommenders.map((rec, index) => (
                        <div key={rec.id} className="flex items-end gap-4 text-sm">
                          <span className="text-gray-500 dark:text-gray-400 font-medium w-6">
                            {index + 1}.
                          </span>
                          <div className="flex-1">
                            <div className="border-b border-dashed border-gray-400 dark:border-gray-600 pb-1 mb-1 min-w-[200px]" />
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              {rec.displayName}
                              {rec.jobTitle && `, ${rec.jobTitle}`}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-gray-400 dark:text-gray-500">
                              Date: ___________
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Approver section */}
                  <div className="space-y-3">
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 tracking-wide">
                      APPROVED BY:
                    </p>
                    <div className="flex items-end gap-4 text-sm">
                      <div className="flex-1">
                        <div className="border-b border-dashed border-gray-400 dark:border-gray-600 pb-1 mb-1 min-w-[200px]" />
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {recipient?.displayName}
                          {recipient?.jobTitle && `, ${recipient.jobTitle}`}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-gray-400 dark:text-gray-500">
                          Date: ___________
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Footer bar */}
                <div className="bg-[#02773b] h-2" />
              </div>
            </div>
          </div>

          {/* Workflow summary */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
              Approval Chain
            </h3>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="px-3 py-1 rounded-full bg-karu-green/10 text-karu-green font-medium">
                You (Initiator)
              </span>
              {recommenders.map((rec, index) => (
                <span key={rec.id} className="contents">
                  <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                  </svg>
                  <span className="px-3 py-1 rounded-full bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 font-medium">
                    {rec.displayName} (R{index + 1})
                  </span>
                </span>
              ))}
              <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
              <span className="px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 font-medium">
                {recipient?.displayName} (Approver)
              </span>
            </div>
          </div>

          {/* Navigation */}
          <div className="flex justify-between">
            <button
              onClick={() => setStep(2)}
              className="inline-flex items-center gap-2 h-10 px-5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-medium text-sm transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
              </svg>
              Back
            </button>
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 h-10 px-6 rounded-xl bg-karu-green text-white font-medium text-sm transition-all hover:bg-karu-green-dark focus:ring-2 focus:ring-karu-green/20 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
                  </svg>
                  Send Memo
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
