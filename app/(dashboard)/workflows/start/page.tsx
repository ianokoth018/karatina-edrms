"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

interface TemplateStep {
  index: number;
  name: string;
  type: "approval" | "review";
}

interface Template {
  id: string;
  name: string;
  description: string | null;
  definition: { steps: TemplateStep[] };
  version: number;
}

interface UserOption {
  id: string;
  name: string;
  displayName: string;
  email: string;
  department: string | null;
}

interface DocumentOption {
  id: string;
  title: string;
  referenceNumber: string;
}

type WizardStep = 1 | 2 | 3 | 4;

export default function StartWorkflowPage() {
  const router = useRouter();

  // Wizard state
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);

  // Step 1: Template selection
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);

  // Step 2: Details
  const [subject, setSubject] = useState("");
  const [documentSearch, setDocumentSearch] = useState("");
  const [documents, setDocuments] = useState<DocumentOption[]>([]);
  const [selectedDocument, setSelectedDocument] = useState<DocumentOption | null>(null);
  const [documentsLoading, setDocumentsLoading] = useState(false);

  // Step 3: Assignees
  const [assignees, setAssignees] = useState<Record<number, UserOption | null>>({});
  const [userSearches, setUserSearches] = useState<Record<number, string>>({});
  const [userResults, setUserResults] = useState<Record<number, UserOption[]>>({});
  const [userSearchLoading, setUserSearchLoading] = useState<Record<number, boolean>>({});
  const [focusedStep, setFocusedStep] = useState<number | null>(null);

  // Submit state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  // Fetch templates on mount
  useEffect(() => {
    async function fetchTemplates() {
      try {
        const res = await fetch("/api/workflows/templates");
        if (res.ok) {
          const data = await res.json();
          setTemplates(data.templates);
        }
      } catch {
        // silently fail
      } finally {
        setTemplatesLoading(false);
      }
    }
    fetchTemplates();
  }, []);

  // Search documents
  const searchDocuments = useCallback(async (query: string) => {
    if (!query.trim()) {
      setDocuments([]);
      return;
    }
    setDocumentsLoading(true);
    try {
      const params = new URLSearchParams({ q: query, limit: "10" });
      const res = await fetch(`/api/search?${params}`);
      if (res.ok) {
        const data = await res.json();
        setDocuments(
          (data.documents ?? []).map((d: DocumentOption) => ({
            id: d.id,
            title: d.title,
            referenceNumber: d.referenceNumber,
          }))
        );
      }
    } catch {
      // silently fail
    } finally {
      setDocumentsLoading(false);
    }
  }, []);

  // Debounced document search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (documentSearch.trim()) {
        searchDocuments(documentSearch);
      } else {
        setDocuments([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [documentSearch, searchDocuments]);

  // Search users for a step
  const searchUsers = useCallback(async (stepIndex: number, query: string) => {
    if (!query.trim()) {
      setUserResults((prev) => ({ ...prev, [stepIndex]: [] }));
      return;
    }
    setUserSearchLoading((prev) => ({ ...prev, [stepIndex]: true }));
    try {
      const params = new URLSearchParams({ search: query, limit: "10" });
      const res = await fetch(`/api/admin/users?${params}`);
      if (res.ok) {
        const data = await res.json();
        setUserResults((prev) => ({
          ...prev,
          [stepIndex]: data.users
            .filter((u: UserOption & { isActive: boolean }) => u.isActive !== false)
            .map((u: UserOption) => ({
              id: u.id,
              name: u.name,
              displayName: u.displayName,
              email: u.email,
              department: u.department,
            })),
        }));
      }
    } catch {
      // silently fail
    } finally {
      setUserSearchLoading((prev) => ({ ...prev, [stepIndex]: false }));
    }
  }, []);

  // Debounced user search
  useEffect(() => {
    if (focusedStep === null) return;
    const query = userSearches[focusedStep] ?? "";
    const timer = setTimeout(() => {
      searchUsers(focusedStep, query);
    }, 300);
    return () => clearTimeout(timer);
  }, [userSearches, focusedStep, searchUsers]);

  // Initialize assignees when template changes
  useEffect(() => {
    if (selectedTemplate) {
      const initial: Record<number, UserOption | null> = {};
      for (const step of selectedTemplate.definition.steps) {
        initial[step.index] = null;
      }
      setAssignees(initial);
      setUserSearches({});
      setUserResults({});
    }
  }, [selectedTemplate]);

  function canProceed(): boolean {
    switch (currentStep) {
      case 1:
        return selectedTemplate !== null;
      case 2:
        return subject.trim().length > 0;
      case 3:
        if (!selectedTemplate) return false;
        return selectedTemplate.definition.steps.every(
          (step) => assignees[step.index] !== null && assignees[step.index] !== undefined
        );
      case 4:
        return true;
      default:
        return false;
    }
  }

  function goNext() {
    if (currentStep < 4 && canProceed()) {
      setCurrentStep((prev) => (prev + 1) as WizardStep);
    }
  }

  function goBack() {
    if (currentStep > 1) {
      setCurrentStep((prev) => (prev - 1) as WizardStep);
    }
  }

  async function handleSubmit() {
    if (!selectedTemplate || !subject.trim()) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      const assigneePayload = selectedTemplate.definition.steps.map((step) => ({
        userId: assignees[step.index]!.id,
        stepIndex: step.index,
        stepName: step.name,
      }));

      const res = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: selectedTemplate.id,
          documentId: selectedDocument?.id ?? undefined,
          subject: subject.trim(),
          assignees: assigneePayload,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setSubmitError(data.error || "Failed to start workflow");
        return;
      }

      setShowSuccess(true);
      setTimeout(() => {
        router.push("/workflows");
      }, 1500);
    } catch {
      setSubmitError("An unexpected error occurred");
    } finally {
      setSubmitting(false);
    }
  }

  const stepLabels = [
    "Select Template",
    "Fill Details",
    "Assign Reviewers",
    "Review & Submit",
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Start New Workflow
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Initiate a workflow by selecting a template and assigning reviewers
        </p>
      </div>

      {/* Success toast */}
      {showSuccess && (
        <div className="fixed top-4 right-4 z-50 animate-slide-up">
          <div className="bg-green-50 dark:bg-green-950/50 border border-green-200 dark:border-green-800 rounded-xl px-5 py-4 shadow-lg flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-green-800 dark:text-green-200">Workflow started successfully</p>
              <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">Redirecting to tasks...</p>
            </div>
          </div>
        </div>
      )}

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {stepLabels.map((label, idx) => {
          const stepNum = (idx + 1) as WizardStep;
          const isActive = currentStep === stepNum;
          const isCompleted = currentStep > stepNum;
          return (
            <div key={label} className="flex items-center gap-2 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0 transition-colors ${
                    isCompleted
                      ? "bg-karu-green text-white"
                      : isActive
                        ? "bg-karu-green text-white"
                        : "bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
                  }`}
                >
                  {isCompleted ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                  ) : (
                    stepNum
                  )}
                </div>
                <span
                  className={`text-sm font-medium truncate hidden sm:block ${
                    isActive
                      ? "text-karu-green"
                      : isCompleted
                        ? "text-gray-700 dark:text-gray-300"
                        : "text-gray-400 dark:text-gray-500"
                  }`}
                >
                  {label}
                </span>
              </div>
              {idx < stepLabels.length - 1 && (
                <div
                  className={`flex-1 h-px ${
                    isCompleted
                      ? "bg-karu-green"
                      : "bg-gray-200 dark:bg-gray-700"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Step content */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
        {/* Step 1: Select Template */}
        {currentStep === 1 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Select a Workflow Template
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Choose a template that defines the workflow steps.
            </p>

            {templatesLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-20 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
                ))}
              </div>
            ) : templates.length === 0 ? (
              <div className="text-center py-12">
                <svg className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m6.75 12H9.75m3 0H9.75m0 0v3.75M5.625 5.25A2.625 2.625 0 0 1 8.25 2.625h7.5a2.625 2.625 0 0 1 2.625 2.625v14.25a2.625 2.625 0 0 1-2.625 2.625H8.25a2.625 2.625 0 0 1-2.625-2.625V5.25Z" />
                </svg>
                <p className="text-gray-500 dark:text-gray-400">No workflow templates available.</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Contact an administrator to create templates.</p>
              </div>
            ) : (
              <div className="grid gap-3">
                {templates.map((template) => {
                  const steps = template.definition?.steps ?? [];
                  const isSelected = selectedTemplate?.id === template.id;
                  return (
                    <button
                      key={template.id}
                      onClick={() => setSelectedTemplate(template)}
                      className={`w-full text-left p-4 rounded-xl border-2 transition-colors ${
                        isSelected
                          ? "border-karu-green bg-karu-green-light dark:bg-karu-green/10"
                          : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <h3 className={`text-sm font-semibold ${isSelected ? "text-karu-green" : "text-gray-900 dark:text-gray-100"}`}>
                            {template.name}
                          </h3>
                          {template.description && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                              {template.description}
                            </p>
                          )}
                          <div className="flex items-center gap-3 mt-2">
                            <span className="text-xs text-gray-400 dark:text-gray-500">
                              {steps.length} step{steps.length !== 1 ? "s" : ""}
                            </span>
                            <span className="text-xs text-gray-400 dark:text-gray-500">
                              v{template.version}
                            </span>
                          </div>
                        </div>
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                          isSelected
                            ? "border-karu-green bg-karu-green"
                            : "border-gray-300 dark:border-gray-600"
                        }`}>
                          {isSelected && (
                            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                            </svg>
                          )}
                        </div>
                      </div>
                      {/* Show steps preview */}
                      {isSelected && steps.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-karu-green/20 flex flex-wrap gap-2">
                          {steps.map((step: TemplateStep, idx: number) => (
                            <span
                              key={idx}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white dark:bg-gray-800 text-xs"
                            >
                              <span className="w-4 h-4 rounded-full bg-karu-green/10 text-karu-green text-[10px] font-bold flex items-center justify-center">
                                {idx + 1}
                              </span>
                              <span className="text-gray-700 dark:text-gray-300">{step.name}</span>
                              <span className="text-gray-400 dark:text-gray-500">({step.type})</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Step 2: Fill Details */}
        {currentStep === 2 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Workflow Details
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Provide a subject and optionally attach a document.
            </p>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                Subject <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g. Budget Approval for Q2 2026"
                className="w-full h-10 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                Attach Document <span className="text-xs text-gray-400 font-normal">(optional)</span>
              </label>

              {selectedDocument ? (
                <div className="flex items-center gap-3 p-3 rounded-xl border border-karu-green bg-karu-green-light dark:bg-karu-green/10">
                  <svg className="w-5 h-5 text-karu-green flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {selectedDocument.title}
                    </p>
                    <p className="text-xs text-karu-green font-mono">
                      {selectedDocument.referenceNumber}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedDocument(null);
                      setDocumentSearch("");
                    }}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                    </svg>
                  </div>
                  <input
                    type="text"
                    value={documentSearch}
                    onChange={(e) => setDocumentSearch(e.target.value)}
                    placeholder="Search documents by title or reference..."
                    className="w-full h-10 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 pl-9 pr-4 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
                  />

                  {/* Document search results */}
                  {(documents.length > 0 || documentsLoading) && documentSearch.trim() && (
                    <div className="absolute z-10 left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg max-h-60 overflow-y-auto">
                      {documentsLoading ? (
                        <div className="p-3 text-center text-sm text-gray-400">Searching...</div>
                      ) : (
                        documents.map((doc) => (
                          <button
                            key={doc.id}
                            onClick={() => {
                              setSelectedDocument(doc);
                              setDocumentSearch("");
                              setDocuments([]);
                            }}
                            className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors border-b last:border-b-0 border-gray-100 dark:border-gray-700"
                          >
                            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                              {doc.title}
                            </p>
                            <p className="text-xs text-karu-green font-mono mt-0.5">
                              {doc.referenceNumber}
                            </p>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 3: Assign Reviewers */}
        {currentStep === 3 && selectedTemplate && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Assign Reviewers
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Select a person for each step in the workflow. Tasks will be assigned in order.
            </p>

            <div className="space-y-4">
              {selectedTemplate.definition.steps.map((step, idx) => (
                <div key={step.index} className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full bg-karu-green/10 text-karu-green text-xs font-bold flex items-center justify-center flex-shrink-0">
                      {idx + 1}
                    </div>
                    <div>
                      <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {step.name}
                      </h3>
                      <p className="text-xs text-gray-400 dark:text-gray-500 capitalize">
                        {step.type}
                      </p>
                    </div>
                  </div>

                  {assignees[step.index] ? (
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-karu-green-light dark:bg-karu-green/10 border border-karu-green/20">
                      <div className="w-8 h-8 rounded-full bg-karu-green flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
                        {assignees[step.index]!.displayName
                          .split(" ")
                          .map((n) => n[0])
                          .join("")
                          .toUpperCase()
                          .slice(0, 2)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                          {assignees[step.index]!.displayName}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {assignees[step.index]!.email}
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setAssignees((prev) => ({ ...prev, [step.index]: null }));
                          setUserSearches((prev) => ({ ...prev, [step.index]: "" }));
                        }}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                        </svg>
                      </div>
                      <input
                        type="text"
                        value={userSearches[step.index] ?? ""}
                        onChange={(e) => {
                          setUserSearches((prev) => ({ ...prev, [step.index]: e.target.value }));
                          setFocusedStep(step.index);
                        }}
                        onFocus={() => setFocusedStep(step.index)}
                        placeholder="Search by name or email..."
                        className="w-full h-10 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 pl-9 pr-4 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 transition-colors focus:border-karu-green focus:ring-2 focus:ring-karu-green/20 outline-none"
                      />

                      {/* User results dropdown */}
                      {focusedStep === step.index && (userResults[step.index]?.length > 0 || userSearchLoading[step.index]) && (
                        <div className="absolute z-10 left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                          {userSearchLoading[step.index] ? (
                            <div className="p-3 text-center text-sm text-gray-400">Searching...</div>
                          ) : (
                            userResults[step.index].map((user) => (
                              <button
                                key={user.id}
                                onClick={() => {
                                  setAssignees((prev) => ({ ...prev, [step.index]: user }));
                                  setFocusedStep(null);
                                  setUserSearches((prev) => ({ ...prev, [step.index]: "" }));
                                  setUserResults((prev) => ({ ...prev, [step.index]: [] }));
                                }}
                                className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors border-b last:border-b-0 border-gray-100 dark:border-gray-700 flex items-center gap-3"
                              >
                                <div className="w-7 h-7 rounded-full bg-gray-200 dark:bg-gray-600 flex items-center justify-center text-xs font-semibold text-gray-600 dark:text-gray-300 flex-shrink-0">
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
                                    {user.email}
                                    {user.department && ` - ${user.department}`}
                                  </p>
                                </div>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step 4: Review & Submit */}
        {currentStep === 4 && selectedTemplate && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Review & Submit
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Please review the details before starting the workflow.
            </p>

            {submitError && (
              <div className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-3">
                <p className="text-sm text-red-700 dark:text-red-400">{submitError}</p>
              </div>
            )}

            <div className="space-y-4">
              {/* Template */}
              <div className="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 space-y-2">
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Template
                </h3>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {selectedTemplate.name}
                </p>
                {selectedTemplate.description && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {selectedTemplate.description}
                  </p>
                )}
              </div>

              {/* Subject */}
              <div className="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 space-y-2">
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Subject
                </h3>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {subject}
                </p>
              </div>

              {/* Document */}
              {selectedDocument && (
                <div className="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 space-y-2">
                  <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Attached Document
                  </h3>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {selectedDocument.title}
                  </p>
                  <p className="text-xs text-karu-green font-mono">
                    {selectedDocument.referenceNumber}
                  </p>
                </div>
              )}

              {/* Assignees */}
              <div className="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 space-y-3">
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Workflow Steps & Assignees
                </h3>
                <div className="space-y-2">
                  {selectedTemplate.definition.steps.map((step, idx) => {
                    const user = assignees[step.index];
                    return (
                      <div key={step.index} className="flex items-center gap-3">
                        <div className="w-6 h-6 rounded-full bg-karu-green/10 text-karu-green text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                          {idx + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm text-gray-900 dark:text-gray-100 font-medium">
                            {step.name}
                          </span>
                          <span className="text-xs text-gray-400 dark:text-gray-500 ml-2 capitalize">
                            ({step.type})
                          </span>
                        </div>
                        <div className="flex items-center gap-2 min-w-0">
                          <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                          </svg>
                          <span className="text-sm text-gray-600 dark:text-gray-300 truncate">
                            {user?.displayName ?? "Not assigned"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Navigation buttons */}
      <div className="flex items-center justify-between">
        <button
          onClick={goBack}
          disabled={currentStep === 1}
          className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Back
        </button>

        {currentStep < 4 ? (
          <button
            onClick={goNext}
            disabled={!canProceed()}
            className="px-5 py-2.5 rounded-xl bg-karu-green text-white text-sm font-medium hover:bg-karu-green-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            Next
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={submitting || !canProceed()}
            className="px-5 py-2.5 rounded-xl bg-karu-green text-white text-sm font-medium hover:bg-karu-green-dark transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {submitting && (
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            Start Workflow
          </button>
        )}
      </div>
    </div>
  );
}
