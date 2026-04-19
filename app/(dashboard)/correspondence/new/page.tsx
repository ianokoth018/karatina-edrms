"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

/* ---------- types ---------- */
interface UserOption {
  id: string;
  name: string;
  displayName: string;
  department: string | null;
  jobTitle: string | null;
}

interface DeptInfo {
  name: string;
  userCount: number;
}

/* ---------- steps ---------- */
const INCOMING_STEPS = [
  { num: 1, label: "Capture" },
  { num: 2, label: "Details" },
  { num: 3, label: "Assign & Route" },
  { num: 4, label: "Submit" },
];

const OUTGOING_STEPS = [
  { num: 1, label: "Compose" },
  { num: 2, label: "Details" },
  { num: 3, label: "Submit" },
];

/* ---------- component ---------- */
export default function NewCorrespondencePage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "loading") return;
    const perms = session?.user?.permissions ?? [];
    if (!perms.includes("admin:manage") && !perms.includes("correspondence:create")) {
      router.replace("/correspondence");
    }
  }, [session, status, router]);

  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1: Type & basic info
  const [corrType, setCorrType] = useState<"INCOMING" | "OUTGOING">("INCOMING");
  const [channel, setChannel] = useState("LETTER");
  const [subject, setSubject] = useState("");
  const [fromEntity, setFromEntity] = useState("");
  const [toEntity, setToEntity] = useState("");
  const [description, setDescription] = useState("");

  // Step 2: Details
  const [priority, setPriority] = useState("NORMAL");
  const [dateReceived, setDateReceived] = useState(new Date().toISOString().slice(0, 10));
  const [dateSent, setDateSent] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [dispatchMethod, setDispatchMethod] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [isConfidential, setIsConfidential] = useState(false);

  // Step 3: Assign (incoming only)
  const [department, setDepartment] = useState("");
  const [departments, setDepartments] = useState<DeptInfo[]>([]);
  const [assignUserId, setAssignUserId] = useState("");
  const [deptUsers, setDeptUsers] = useState<UserOption[]>([]);

  const STEPS = corrType === "INCOMING" ? INCOMING_STEPS : OUTGOING_STEPS;

  // Auto-fill from/to based on type
  useEffect(() => {
    if (corrType === "OUTGOING" && !fromEntity && session?.user?.department) {
      setFromEntity(session.user.department);
    }
  }, [corrType, session?.user?.department, fromEntity]);

  // Fetch departments for assignment
  useEffect(() => {
    if (step === 3 && corrType === "INCOMING" && departments.length === 0) {
      fetch("/api/users/search?departments=true")
        .then((r) => r.ok ? r.json() : null)
        .then((d) => d?.departments && setDepartments(d.departments))
        .catch(() => {});
    }
  }, [step, corrType, departments.length]);

  // Fetch users when department selected
  useEffect(() => {
    if (!department) { setDeptUsers([]); return; }
    fetch(`/api/users/search?department=${encodeURIComponent(department)}&limit=50`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => d?.users && setDeptUsers(d.users))
      .catch(() => {});
  }, [department]);

  function canProceedStep1() {
    return subject.trim() && fromEntity.trim() && toEntity.trim();
  }

  async function handleSubmit() {
    if (!canProceedStep1()) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/correspondence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: corrType,
          subject: subject.trim(),
          fromEntity: fromEntity.trim(),
          toEntity: toEntity.trim(),
          description: description.trim() || undefined,
          priority,
          channel,
          isConfidential,
          dateReceived: corrType === "INCOMING" ? dateReceived : undefined,
          dateSent: corrType === "OUTGOING" ? dateSent : undefined,
          dueDate: dueDate || undefined,
          dispatchMethod: dispatchMethod || undefined,
          trackingNumber: trackingNumber.trim() || undefined,
          department: department || undefined,
          assignedToId: assignUserId || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? "Failed to register correspondence");
      }

      const data = await res.json();
      router.push(`/correspondence/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to register");
      setIsSubmitting(false);
    }
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Register New Correspondence
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Capture, classify, and route incoming or outgoing correspondence
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto pb-1">
        {STEPS.map((s, idx) => (
          <div key={s.num} className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
            <button
              onClick={() => { if (s.num < step) setStep(s.num); }}
              disabled={s.num > step}
              className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition-all ${
                s.num === step
                  ? "bg-[#02773b] text-white shadow-md shadow-[#02773b]/20"
                  : s.num < step
                  ? "bg-[#02773b]/10 text-[#02773b] dark:text-emerald-400 cursor-pointer hover:bg-[#02773b]/20"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed"
              }`}
            >
              <span className={`w-5 h-5 sm:w-6 sm:h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                s.num === step ? "bg-white/20 text-white"
                : s.num < step ? "bg-[#02773b] text-white"
                : "bg-gray-200 dark:bg-gray-700 text-gray-400"
              }`}>
                {s.num < step ? (
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                ) : s.num}
              </span>
              <span className="hidden sm:inline">{s.label}</span>
            </button>
            {idx < STEPS.length - 1 && (
              <div className={`w-4 sm:w-8 h-0.5 flex-shrink-0 ${idx < step - 1 ? "bg-[#02773b]" : "bg-gray-200 dark:bg-gray-700"}`} />
            )}
          </div>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-3 flex items-center gap-2">
          <svg className="h-4 w-4 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
          </svg>
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* ================================================================== */}
      {/*  STEP 1: Capture / Compose                                         */}
      {/* ================================================================== */}
      {step === 1 && (
        <div className="space-y-5 animate-slide-up">
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 sm:p-6 space-y-5 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <svg className="w-5 h-5 text-[#02773b]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
              </svg>
              {corrType === "INCOMING" ? "Capture Incoming Correspondence" : "Compose Outgoing Correspondence"}
            </h2>

            {/* Type toggle */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Correspondence Type</label>
              <div className="inline-flex rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                <button type="button" onClick={() => setCorrType("INCOMING")}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${corrType === "INCOMING" ? "bg-[#02773b] text-white" : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>
                  Incoming
                </button>
                <button type="button" onClick={() => setCorrType("OUTGOING")}
                  className={`px-4 py-2 text-sm font-medium border-l border-gray-200 dark:border-gray-700 transition-colors ${corrType === "OUTGOING" ? "bg-[#02773b] text-white" : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>
                  Outgoing
                </button>
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">
                {corrType === "INCOMING" ? "Letter, email, or document received by the university." : "Letter or response being sent from the university."}
              </p>
            </div>

            {/* Channel */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Channel</label>
              <div className="inline-flex rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                {["LETTER", "EMAIL", "SCAN", "SYSTEM_UPLOAD"].map((ch) => (
                  <button key={ch} type="button" onClick={() => setChannel(ch)}
                    className={`px-3 py-2 text-xs font-medium transition-colors border-l first:border-l-0 border-gray-200 dark:border-gray-700 ${channel === ch ? "bg-[#02773b] text-white" : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>
                    {ch === "SYSTEM_UPLOAD" ? "Upload" : ch.charAt(0) + ch.slice(1).toLowerCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* From / To */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  {corrType === "INCOMING" ? "Sender (From)" : "From (Department/Office)"}
                </label>
                <input type="text" value={fromEntity} onChange={(e) => setFromEntity(e.target.value)}
                  placeholder={corrType === "INCOMING" ? "e.g., Ministry of Education" : "e.g., Office of the Registrar"}
                  className="w-full h-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 transition-all focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  {corrType === "INCOMING" ? "Recipient (To)" : "Recipient (To)"}
                </label>
                <input type="text" value={toEntity} onChange={(e) => setToEntity(e.target.value)}
                  placeholder={corrType === "INCOMING" ? "e.g., Registrar (AA)" : "e.g., County Government of Nyeri"}
                  className="w-full h-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 transition-all focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20 outline-none" />
              </div>
            </div>

            {/* Subject */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Subject</label>
              <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g., Request for Enrollment Data — 2025/2026 Academic Year"
                className="w-full h-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 transition-all focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20 outline-none" />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Description / Notes</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
                placeholder="Brief summary of the correspondence content..."
                className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 transition-all focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20 outline-none resize-none" />
            </div>
          </div>

          {/* Next button */}
          <div className="flex justify-end">
            <button onClick={() => setStep(2)} disabled={!canProceedStep1()}
              className="inline-flex items-center gap-2 h-11 px-6 rounded-xl bg-[#02773b] text-white font-medium text-sm transition-all hover:bg-[#014d28] shadow-md shadow-[#02773b]/20 disabled:opacity-40 disabled:cursor-not-allowed">
              Next: Details
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/*  STEP 2: Details                                                    */}
      {/* ================================================================== */}
      {step === 2 && (
        <div className="space-y-5 animate-slide-up">
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 sm:p-6 space-y-5 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <svg className="w-5 h-5 text-[#02773b]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6Z" />
              </svg>
              Classification & Details
            </h2>

            {/* Priority */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Priority</label>
              <div className="inline-flex rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                {["LOW", "NORMAL", "HIGH", "URGENT"].map((p) => (
                  <button key={p} type="button" onClick={() => setPriority(p)}
                    className={`px-4 py-2 text-xs font-medium transition-colors border-l first:border-l-0 border-gray-200 dark:border-gray-700 ${
                      priority === p
                        ? p === "URGENT" ? "bg-red-600 text-white"
                        : p === "HIGH" ? "bg-orange-500 text-white"
                        : p === "LOW" ? "bg-gray-500 text-white"
                        : "bg-[#02773b] text-white"
                        : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                    }`}>
                    {p}
                  </button>
                ))}
              </div>
              {(priority === "HIGH" || priority === "URGENT") && (
                <p className="text-xs text-orange-600 dark:text-orange-400 mt-1.5">
                  High/Urgent priority correspondence requires Director-level approval.
                </p>
              )}
            </div>

            {/* Dates */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  {corrType === "INCOMING" ? "Date Received" : "Date Sent"}
                </label>
                <input type="date" value={corrType === "INCOMING" ? dateReceived : dateSent}
                  onChange={(e) => corrType === "INCOMING" ? setDateReceived(e.target.value) : setDateSent(e.target.value)}
                  className="w-full h-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Response Due Date</label>
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
                  className="w-full h-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20" />
                <p className="text-xs text-gray-400 mt-1">Optional. Used for SLA tracking.</p>
              </div>
            </div>

            {/* Dispatch */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Dispatch Method</label>
                <select value={dispatchMethod} onChange={(e) => setDispatchMethod(e.target.value)}
                  className="w-full h-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20">
                  <option value="">Select method...</option>
                  <option value="POST">Post</option>
                  <option value="COURIER">Courier</option>
                  <option value="EMAIL">Email</option>
                  <option value="HAND_DELIVERY">Hand Delivery</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Tracking Number</label>
                <input type="text" value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)}
                  placeholder="e.g., EMS1234567KE"
                  className="w-full h-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20" />
              </div>
            </div>

            {/* Confidential */}
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setIsConfidential(!isConfidential)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isConfidential ? "bg-red-500" : "bg-gray-300 dark:bg-gray-600"}`}>
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isConfidential ? "translate-x-6" : "translate-x-1"}`} />
              </button>
              <span className="text-sm text-gray-700 dark:text-gray-300">Mark as Confidential</span>
              {isConfidential && <span className="text-xs text-red-500 font-medium">Restricted access</span>}
            </div>
          </div>

          {/* Navigation */}
          <div className="flex justify-between">
            <button onClick={() => setStep(1)}
              className="inline-flex items-center gap-2 h-11 px-5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-medium text-sm hover:bg-gray-50 dark:hover:bg-gray-800">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
              </svg>
              Back
            </button>
            <button onClick={() => setStep(corrType === "INCOMING" ? 3 : 3)}
              className="inline-flex items-center gap-2 h-11 px-6 rounded-xl bg-[#02773b] text-white font-medium text-sm hover:bg-[#014d28] shadow-md shadow-[#02773b]/20">
              {corrType === "INCOMING" ? "Next: Assign & Route" : "Next: Submit"}
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/*  STEP 3 (Incoming): Assign & Route                                  */}
      {/* ================================================================== */}
      {step === 3 && corrType === "INCOMING" && (
        <div className="space-y-5 animate-slide-up">
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 sm:p-6 space-y-5 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <svg className="w-5 h-5 text-[#02773b]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
              </svg>
              Assign to Department
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Route this correspondence to the appropriate department and officer for action.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Department</label>
                <select value={department} onChange={(e) => { setDepartment(e.target.value); setAssignUserId(""); }}
                  className="w-full h-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20">
                  <option value="">Select department...</option>
                  {departments.map((d) => (
                    <option key={d.name} value={d.name}>{d.name} ({d.userCount})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Assign to Officer</label>
                <select value={assignUserId} onChange={(e) => setAssignUserId(e.target.value)}
                  disabled={!department}
                  className="w-full h-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 text-sm outline-none focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20 disabled:opacity-50 disabled:cursor-not-allowed">
                  <option value="">Auto-assign by role</option>
                  {deptUsers.map((u) => (
                    <option key={u.id} value={u.id}>{u.displayName} — {u.jobTitle || u.department}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-400 mt-1">Leave blank to auto-assign based on department role queue.</p>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <div className="flex justify-between">
            <button onClick={() => setStep(2)}
              className="inline-flex items-center gap-2 h-11 px-5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-medium text-sm hover:bg-gray-50 dark:hover:bg-gray-800">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
              </svg>
              Back
            </button>
            <button onClick={() => setStep(4)}
              className="inline-flex items-center gap-2 h-11 px-6 rounded-xl bg-[#02773b] text-white font-medium text-sm hover:bg-[#014d28] shadow-md shadow-[#02773b]/20">
              Next: Review & Submit
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/*  FINAL STEP: Submit                                                 */}
      {/* ================================================================== */}
      {((corrType === "INCOMING" && step === 4) || (corrType === "OUTGOING" && step === 3)) && (
        <div className="space-y-5 animate-slide-up">
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-sm">
            <div className="px-5 sm:px-6 py-4 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <svg className="w-5 h-5 text-[#02773b]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
                Review & Submit
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Confirm the details before registering.</p>
            </div>

            <div className="p-5 sm:p-6 space-y-3">
              {[
                { label: "Type", value: corrType },
                { label: "Channel", value: channel },
                { label: "From", value: fromEntity },
                { label: "To", value: toEntity },
                { label: "Subject", value: subject, bold: true },
                { label: "Priority", value: priority },
                ...(corrType === "INCOMING"
                  ? [{ label: "Date Received", value: dateReceived }]
                  : [{ label: "Date Sent", value: dateSent }]),
                ...(dueDate ? [{ label: "Due Date", value: dueDate }] : []),
                ...(department ? [{ label: "Department", value: department }] : []),
                ...(dispatchMethod ? [{ label: "Dispatch", value: dispatchMethod }] : []),
                ...(isConfidential ? [{ label: "Confidential", value: "Yes" }] : []),
              ].map((row) => (
                <div key={row.label} className="flex items-start gap-3 py-1.5">
                  <span className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider w-28 flex-shrink-0 pt-0.5">
                    {row.label}
                  </span>
                  <span className={`text-sm ${row.bold ? "font-semibold" : ""} text-gray-900 dark:text-gray-100`}>
                    {row.value || "---"}
                  </span>
                </div>
              ))}

              {description && (
                <>
                  <hr className="border-gray-100 dark:border-gray-800" />
                  <div>
                    <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Description</span>
                    <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">{description}</p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Navigation */}
          <div className="flex justify-between">
            <button onClick={() => setStep(corrType === "INCOMING" ? 3 : 2)}
              className="inline-flex items-center gap-2 h-11 px-5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-medium text-sm hover:bg-gray-50 dark:hover:bg-gray-800">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
              </svg>
              Back
            </button>
            <button onClick={handleSubmit} disabled={isSubmitting}
              className="inline-flex items-center gap-2 h-11 px-7 rounded-xl bg-[#02773b] text-white font-semibold text-sm hover:bg-[#014d28] shadow-md shadow-[#02773b]/20 disabled:opacity-60 disabled:cursor-not-allowed">
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Registering...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
                  </svg>
                  Register Correspondence
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
