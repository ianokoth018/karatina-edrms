import { db } from "@/lib/db";
import type { FormField } from "@/components/forms/form-renderer";
import PublicFormClient from "./public-form-client";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * Public-by-opt-in form submission portal.
 *
 * Renders a FormTemplate only when its `isPublic` flag is true and it is
 * active. Any other case (missing template, opt-out, soft-deleted) returns
 * a neutral 404-style page that does not reveal the form exists.
 */
export default async function PublicFormPage({ params }: PageProps) {
  const { id } = await params;

  const template = await db.formTemplate.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      description: true,
      fields: true,
      isPublic: true,
      isActive: true,
    },
  });

  const accessible = template?.isPublic === true && template?.isActive === true;

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-2xl bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm p-6 sm:p-8">
          {accessible && template ? (
            <PublicFormClient
              formId={template.id}
              formName={template.name}
              formDescription={template.description ?? null}
              fields={template.fields as unknown as FormField[]}
            />
          ) : (
            <div className="text-center space-y-3 py-10">
              <svg
                className="w-14 h-14 mx-auto text-gray-300 dark:text-gray-700"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z"
                />
              </svg>
              <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Page not available
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                The link you followed may be broken or no longer active.
              </p>
            </div>
          )}
        </div>
      </main>
      <footer className="py-4 text-center text-xs text-gray-400 dark:text-gray-600">
        Powered by Karatina eRegistry
      </footer>
    </div>
  );
}
