"use client";

import { useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";

export default function LoginPage() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Detect auth errors from URL (NextAuth redirects with ?error=) — only used
  // for legacy redirect-based flows; this page uses redirect:false so most
  // errors come back inline.
  useEffect(() => {
    const err = searchParams.get("error");
    if (err && err !== "CredentialsSignin") {
      setError("Authentication error. Please try again.");
    }
  }, [searchParams]);

  function decodeAuthError(raw: string | undefined | null): string {
    // NextAuth returns the message thrown by `authorize()` either as `code`
    // (Auth.js v5) or appended to the URL after a slash. We try both.
    if (!raw) return "Invalid email or password. Please try again.";
    if (raw.includes("MFA_REQUIRED")) return "MFA_REQUIRED";
    // Strip the NextAuth wrapper "CredentialsSignin Read more..."
    const cleaned = raw
      .replace(/^CredentialsSignin\.?\s*/i, "")
      .replace(/Read more at.*$/i, "")
      .trim();
    return cleaned || "Invalid email or password. Please try again.";
  }

  async function requestEmailCode(): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch("/api/auth/mfa/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, purpose: "LOGIN" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        return { ok: false, error: data?.error ?? "Couldn't send code" };
      }
      return { ok: true };
    } catch {
      return { ok: false, error: "Network error" };
    }
  }

  async function handleResendCode() {
    if (!email || !password) return;
    setIsLoading(true);
    setError(null);
    const r = await requestEmailCode();
    setIsLoading(false);
    if (r.ok) {
      setError("A new code has been sent to your email.");
    } else if (r.error) {
      setError(r.error);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const result = await signIn("credentials", {
      email,
      password,
      mfaCode: mfaRequired ? mfaCode : undefined,
      redirect: false,
    });

    if (result?.ok) {
      window.location.href = "/dashboard";
      return;
    }

    const decoded = decodeAuthError(result?.error ?? result?.code ?? null);
    if (decoded === "MFA_REQUIRED") {
      // Auto-issue the email code so the user doesn't have to click anything.
      const sent = await requestEmailCode();
      setMfaRequired(true);
      setError(
        sent.ok
          ? null
          : sent.error ?? "Couldn't send your sign-in code — try again."
      );
    } else {
      setError(decoded);
    }
    setIsLoading(false);
  }

  return (
    <div>
      {/* Header with crest */}
      <div className="text-center mb-6 lg:mb-8">
        <div className="flex justify-center mb-5 animate-scale-in">
          <Image
            src="/karu-crest.png"
            alt="Karatina University Crest"
            width={112}
            height={112}
            className="h-14 w-auto drop-shadow-sm"
            priority
          />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 animate-fade-in delay-100">
          Welcome back
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1.5 animate-fade-in delay-200">
          Access the document management system
        </p>
      </div>

      {/* Error alert */}
      {error && (
        <div className="mb-6 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-3 animate-slide-up">
          <div className="flex items-center gap-2">
            <svg className="h-4 w-4 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          </div>
        </div>
      )}

      {/* Login form */}
      <form onSubmit={handleSubmit} className="space-y-4 animate-slide-up delay-200">
        <div className="space-y-1.5">
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
            Email Address
          </label>
          <div className="relative">
            <div className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
              </svg>
            </div>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@karu.ac.ke"
              autoComplete="email"
              required
              className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 pl-10 pr-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 transition-colors focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20 outline-none"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
            Password
          </label>
          <div className="relative">
            <div className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
              </svg>
            </div>
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              autoComplete="current-password"
              required
              className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 pl-10 pr-10 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 transition-colors focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20 outline-none"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300"
            >
              {showPassword ? (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12c1.292 4.338 5.31 7.5 10.066 7.5.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {mfaRequired && (
          <div className="space-y-1.5 animate-slide-up">
            <label htmlFor="mfa" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
              Sign-in code
            </label>
            <div className="relative">
              <div className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                </svg>
              </div>
              <input
                id="mfa"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))}
                placeholder="6-digit code"
                autoComplete="one-time-code"
                autoFocus
                required
                className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 pl-10 pr-4 py-2.5 text-sm tracking-[0.4em] font-mono text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 placeholder:font-sans placeholder:tracking-normal transition-colors focus:border-[#02773b] focus:ring-2 focus:ring-[#02773b]/20 outline-none"
              />
            </div>
            <div className="flex items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
              <span>We&apos;ve emailed a 6-digit code to <strong>{email}</strong>. It expires in 10 minutes.</span>
              <button
                type="button"
                onClick={handleResendCode}
                disabled={isLoading}
                className="text-[#02773b] dark:text-[#60c988] font-medium hover:underline disabled:opacity-50 shrink-0"
              >
                Resend
              </button>
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={isLoading}
          className="w-full h-11 rounded-xl bg-[#02773b] text-white font-medium text-sm transition-all hover:bg-[#014d28] focus:ring-2 focus:ring-[#02773b]/20 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <>
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Signing in...
            </>
          ) : (
            <>
              {mfaRequired ? "Verify code" : "Sign In"}
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
              </svg>
            </>
          )}
        </button>
      </form>

      {/* Support footer */}
      <div className="mt-6 rounded-xl bg-gray-50 dark:bg-gray-800/50 px-4 py-3 text-center animate-fade-in delay-500">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Need help? Contact ICT Support at{" "}
          <a href="mailto:ict@karu.ac.ke" className="text-[#02773b] font-medium hover:underline">
            ict@karu.ac.ke
          </a>
        </p>
      </div>
    </div>
  );
}
