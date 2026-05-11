import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import ActiveTab from "./active-tab";

interface Props {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}

interface CustomView {
  id: string;
  label: string;
  description?: string;
  filter: string;
}

export default async function WorkflowModuleLayout({ children, params }: Props) {
  const { slug } = await params;

  const session = await auth();
  if (!session?.user) notFound();

  const template = await db.workflowTemplate.findUnique({
    where: { slug, isActive: true },
    select: { id: true, name: true, instanceName: true, customQueries: true },
  });

  if (!template) notFound();

  const instanceLabel = template.instanceName ?? template.name;
  const customViews = (template.customQueries as unknown as CustomView[]) ?? [];

  const coreTabs = [
    { label: `New ${instanceLabel}`, href: `/w/${slug}/create` },
    { label: "My Inbox", href: `/w/${slug}/inbox` },
    { label: "Drafts", href: `/w/${slug}/drafts` },
    { label: "Trace", href: `/w/${slug}/trace` },
    { label: "Analytics", href: `/w/${slug}/analytics` },
  ];

  const allTabs = [
    ...coreTabs,
    ...customViews.map((v) => ({ label: v.label, href: `/w/${slug}/view/${v.id}` })),
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 pt-4">
        <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">{template.name}</h1>
        <nav className="flex gap-1 mt-3 overflow-x-auto pb-0 -mb-px">
          {allTabs.map((tab) => (
            <ActiveTab key={tab.href} label={tab.label} href={tab.href} />
          ))}
        </nav>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {children}
      </div>
    </div>
  );
}
