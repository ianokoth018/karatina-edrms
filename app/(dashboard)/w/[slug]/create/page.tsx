"use client";

import { useEffect, use } from "react";
import { useRouter } from "next/navigation";

interface Props {
  params: Promise<{ slug: string }>;
}

export default function WorkflowCreatePage({ params }: Props) {
  const { slug } = use(params);
  const router = useRouter();

  useEffect(() => {
    async function redirect() {
      const res = await fetch(`/api/workflows/sidebar`);
      if (!res.ok) return;
      const { modules } = await res.json();
      const mod = (modules as { slug: string; id: string; linkedFormId: string | null }[]).find(
        (m) => m.slug === slug
      );
      if (!mod) return;

      if (mod.linkedFormId) {
        // Go straight to the linked form — it will auto-start the workflow on submit
        router.replace(`/forms/${mod.linkedFormId}`);
      } else {
        // No linked form: fall back to the generic workflow start page
        router.replace(`/workflows/start?template=${mod.id}`);
      }
    }
    redirect();
  }, [slug, router]);

  return (
    <div className="flex items-center justify-center py-20">
      <div className="text-center">
        <svg className="animate-spin h-6 w-6 text-gray-400 mx-auto mb-3" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <p className="text-sm text-gray-500">Loading…</p>
      </div>
    </div>
  );
}
