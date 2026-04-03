"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import Sidebar from "@/components/layout/sidebar";
import Header from "@/components/layout/header";

function DashboardSkeleton() {
  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-950">
      {/* Sidebar skeleton (desktop only) */}
      <div className="hidden lg:flex w-64 flex-col bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800">
        {/* Logo area */}
        <div className="flex items-center gap-3 px-5 h-16 border-b border-gray-200 dark:border-gray-800">
          <div className="w-8 h-8 rounded-lg bg-gray-200 dark:bg-gray-700 animate-pulse" />
          <div className="space-y-1.5">
            <div className="h-3 w-16 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
            <div className="h-2 w-24 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
          </div>
        </div>

        {/* Nav items skeleton */}
        <div className="flex-1 p-3 space-y-2">
          {[75, 60, 85, 70, 90, 65, 80].map((w, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2.5">
              <div className="w-5 h-5 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
              <div
                className="h-3 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"
                style={{ width: `${w}%` }}
              />
            </div>
          ))}
        </div>

        {/* User skeleton */}
        <div className="border-t border-gray-200 dark:border-gray-800 p-3">
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="w-9 h-9 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-24 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
              <div className="h-2.5 w-16 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
            </div>
          </div>
        </div>
      </div>

      {/* Main area skeleton */}
      <div className="flex-1 flex flex-col">
        {/* Header skeleton */}
        <div className="h-16 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex items-center gap-4 px-6">
          <div className="w-20 h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
          <div className="flex-1 max-w-lg mx-auto">
            <div className="h-9 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gray-200 dark:bg-gray-700 animate-pulse" />
            <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse" />
          </div>
        </div>

        {/* Content skeleton */}
        <div className="flex-1 p-6 space-y-6">
          <div className="h-8 w-64 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-28 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 animate-pulse"
              />
            ))}
          </div>
          <div className="h-64 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 animate-pulse" />
        </div>
      </div>
    </div>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: session, status } = useSession();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Show skeleton while loading
  if (status === "loading") {
    return <DashboardSkeleton />;
  }

  // Redirect if not authenticated
  if (status === "unauthenticated" || !session) {
    redirect("/login");
  }

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-950 overflow-hidden">
      {/* Sidebar */}
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <Header onMenuToggle={() => setSidebarOpen((prev) => !prev)} />

        {/* Page content */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden pt-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {children}
        </main>
      </div>
    </div>
  );
}
