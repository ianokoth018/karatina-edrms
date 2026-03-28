"use client";

import { useState, useEffect } from "react";
import Image from "next/image";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setMounted(true);
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggleTheme() {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  }

  if (!mounted) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-[#02773b]" />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden" suppressHydrationWarning>
      {/* Left Panel — Hidden on mobile */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        <Image
          src="/DJI_0070-scaled.jpg"
          alt="Karatina University Campus"
          fill
          sizes="50vw"
          className="object-cover"
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-br from-[#02773b]/80 via-black/50 to-[#02773b]/60" />
        <div className="absolute -bottom-20 -left-20 h-80 w-80 rounded-full bg-[#dd9f42]/10 blur-3xl" />
        <div className="absolute -top-20 -right-20 h-64 w-64 rounded-full bg-white/5 blur-3xl" />

        <div className="relative z-10 flex flex-col justify-between p-8 xl:p-10 w-full h-full">
          {/* Logo */}
          <div className="flex-shrink-0">
            <Image
              src="/karu-logo.png"
              alt="Karatina University Logo"
              width={200}
              height={80}
              className="w-[160px] h-auto brightness-0 invert drop-shadow-lg"
              priority
            />
          </div>

          {/* Content */}
          <div className="flex-1 flex flex-col justify-center max-w-md py-6">
            <div className="mb-4 inline-flex w-fit items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3.5 py-1 backdrop-blur-sm animate-fade-in">
              <span className="h-1.5 w-1.5 rounded-full bg-[#dd9f42] animate-pulse" />
              <span className="text-xs font-medium text-white/90">
                Document Management
              </span>
            </div>

            <h1 className="text-3xl xl:text-4xl font-bold text-white leading-tight mb-4 animate-fade-in delay-200">
              Electronic Document &{" "}
              <span className="text-[#dd9f42]">Records Management</span>
            </h1>
            <p className="text-sm text-white/70 leading-relaxed mb-6 animate-fade-in delay-300">
              Securely manage, track, and retrieve university documents and
              records with full audit trail compliance.
            </p>

            <ul className="space-y-3">
              {[
                "Document classification & retention policies",
                "Automated workflow approvals",
                "Complete audit trail & compliance",
                "Student portal integration",
              ].map((text, i) => (
                <li
                  key={text}
                  className="flex items-center gap-2.5 animate-fade-in"
                  style={{ animationDelay: `${500 + i * 150}ms` }}
                >
                  <span className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-md bg-white/10 backdrop-blur-sm border border-white/10">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="w-3 h-3 text-[#dd9f42]"
                    >
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  </span>
                  <span className="text-white/90 text-sm font-medium">
                    {text}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Stats */}
          <div className="flex items-center gap-6 pt-4 border-t border-white/10 flex-shrink-0">
            <div>
              <p className="text-xl font-bold text-white">15+</p>
              <p className="text-[10px] text-white/50">Years of Excellence</p>
            </div>
            <div className="h-6 w-px bg-white/10" />
            <div>
              <p className="text-xl font-bold text-white">10,000+</p>
              <p className="text-[10px] text-white/50">Students Served</p>
            </div>
            <div className="h-6 w-px bg-white/10" />
            <div>
              <p className="text-xl font-bold text-white">6</p>
              <p className="text-[10px] text-white/50">Schools</p>
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel — Form area */}
      <div className="relative w-full lg:w-1/2 overflow-y-auto bg-gradient-to-b from-gray-50 to-white dark:from-gray-950 dark:to-gray-900">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(2,119,59,0.03),transparent_50%)] dark:bg-[radial-gradient(circle_at_80%_20%,rgba(2,119,59,0.08),transparent_50%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_80%,rgba(221,159,66,0.03),transparent_50%)] dark:bg-[radial-gradient(circle_at_20%_80%,rgba(221,159,66,0.06),transparent_50%)]" />

        {/* Theme toggle */}
        <div className="absolute top-4 right-4 z-10 sm:top-6 sm:right-6">
          {mounted && (
            <button
              onClick={toggleTheme}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/80 dark:bg-gray-800/80 text-gray-600 dark:text-gray-300 shadow-sm ring-1 ring-gray-200/80 dark:ring-gray-700 backdrop-blur-sm transition-all hover:bg-white dark:hover:bg-gray-700 hover:shadow-md"
              aria-label="Toggle theme"
            >
              {isDark ? (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
                </svg>
              ) : (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" />
                </svg>
              )}
            </button>
          )}
        </div>

        <div className="relative min-h-screen lg:min-h-0 lg:h-full flex items-center justify-center px-4 py-6 sm:py-8 lg:py-6 sm:px-8 lg:px-12">
          <div className="w-full max-w-lg lg:max-w-xl">{children}</div>
        </div>
      </div>
    </div>
  );
}
