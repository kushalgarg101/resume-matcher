"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, FileText, Sparkles, Target, Check, X, Eye, EyeOff, Mail, ArrowLeft, Globe, Search, Briefcase, MessageSquare, PenLine, AlertCircle } from "lucide-react";
import { useAuth, EmailConfirmationRequiredError } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const signupRequirements = [
  { label: "At least 6 characters", test: (p: string) => p.length >= 6 },
  { label: "Contains a number", test: (p: string) => /\d/.test(p) },
  { label: "Contains an uppercase letter", test: (p: string) => /[A-Z]/.test(p) },
  { label: "Contains a lowercase letter", test: (p: string) => /[a-z]/.test(p) },
];

const jobSources = [
  "RemoteOK",
  "We Work Remotely",
  "Jooble",
  "Adzuna",
  "Arbeitnow",
  "RSS feeds",
];

const features = [
  { icon: Search, text: "Live job feed from 6+ aggregators" },
  { icon: Target, text: "AI-powered resume scoring" },
  { icon: Briefcase, text: "Personalized job matching" },
  { icon: PenLine, text: "Cover letter generator" },
  { icon: MessageSquare, text: "Agent-assisted profile builder" },
];

function UrlErrorDisplay() {
  const searchParams = useSearchParams();
  const urlError = searchParams.get("error");
  if (!urlError) return null;
  return (
    <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive animate-fade-in">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{urlError}</span>
    </div>
  );
}

function DecorativePanel({ accentColor = "bg-blue-500/8" }: { accentColor?: string }) {
  return (
    <div className="relative hidden overflow-hidden rounded-3xl border border-border/60 bg-card p-12 lg:flex lg:flex-col lg:justify-between shadow-lg shadow-black/[0.03]">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-blue-500/5" />
      <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
      <div className={`absolute -bottom-16 -left-16 h-48 w-48 rounded-full ${accentColor} blur-3xl`} />
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)`,
          backgroundSize: "24px 24px",
        }}
      />
      <div className="relative">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <FileText className="h-5 w-5" />
          </span>
          <span className="text-xl font-semibold tracking-tight text-foreground">
            Resume Matcher
          </span>
        </div>
      </div>
      <div className="relative space-y-8">
        <h2 className="text-4xl font-bold leading-tight tracking-tight text-foreground">
          Know your match
          <br />
          before you apply.
        </h2>
        <p className="max-w-sm text-lg leading-relaxed text-muted-foreground">
          Drop in a job description and your resume to get an instant fit score,
          matched skills, and what&apos;s missing.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  const { signIn, signUp, user, loading, resetPassword } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [view, setView] = useState<"form" | "forgot" | "sent" | "confirmed">("form");
  const [signupEmail, setSignupEmail] = useState("");

  useEffect(() => {
    if (!loading && user) router.replace("/");
  }, [loading, user, router]);

  const resetForm = () => {
    setError("");
    setPassword("");
  };

  const switchMode = (newMode: "signin" | "signup") => {
    resetForm();
    setMode(newMode);
    setView("form");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "signin") {
        await signIn(email, password);
      } else {
        const passwordErrors = signupRequirements.filter((r) => !r.test(password));
        if (passwordErrors.length > 0) {
          throw new Error("Your password doesn't meet all requirements below.");
        }
        setSignupEmail(email);
        await signUp(email, password);
      }
    } catch (err: unknown) {
      if (err instanceof EmailConfirmationRequiredError) {
        setView("confirmed");
      } else if (err instanceof Error) {
        setError(err.message || "Authentication failed");
      } else {
        setError("Authentication failed");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await resetPassword(email);
      setView("sent");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to send reset email.");
    } finally {
      setBusy(false);
    }
  };

  if (view === "confirmed") {
    return (
      <div className="grid min-h-screen items-center gap-12 px-4 py-12 lg:grid-cols-2 lg:px-8">
        <DecorativePanel accentColor="bg-green-500/8" />

        <div className="mx-auto w-full max-w-md animate-fade-in">
          <div className="rounded-2xl border border-success/30 bg-success/5 p-8 shadow-lg shadow-black/[0.03]">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success/15">
              <Check className="h-7 w-7 text-success" />
            </div>
            <h2 className="text-center text-xl font-bold tracking-tight text-foreground">
              You&apos;re almost there!
            </h2>
            <p className="mt-2 text-center text-sm text-muted-foreground">
              We sent a confirmation link to{" "}
              <span className="font-medium text-foreground">{signupEmail}</span>.
            </p>

            <div className="mt-6 space-y-3 rounded-xl border border-border/60 bg-card p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Once confirmed, you&apos;ll get:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {jobSources.map((s) => (
                  <span
                    key={s}
                    className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
                  >
                    <Globe className="h-3 w-3" />
                    {s}
                  </span>
                ))}
              </div>
              <ul className="space-y-2 pt-1">
                {features.map((f) => (
                  <li key={f.text} className="flex items-center gap-2.5 text-sm text-muted-foreground">
                    <f.icon className="h-4 w-4 text-primary shrink-0" />
                    {f.text}
                  </li>
                ))}
              </ul>
            </div>

            <p className="mt-4 text-center text-xs text-muted-foreground">
              Check your inbox (and spam folder) for the confirmation email.
            </p>
          </div>

          <div className="mt-4 text-center">
              <button
                onClick={() => { window.history.replaceState(null, "", "/login"); setView("form"); setError(""); }}
                className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4 transition-colors"
              >
                Back to sign in
              </button>
            </div>
          </div>
        </div>
    );
  }

  if (view === "forgot" || view === "sent") {
    return (
      <div className="grid min-h-screen items-center gap-12 px-4 py-12 lg:grid-cols-2 lg:px-8">
        <DecorativePanel />

        <div className="mx-auto w-full max-w-md animate-fade-in">
          {view === "forgot" ? (
            <>
              <div className="mb-8">
                <button
                  onClick={() => { window.history.replaceState(null, "", "/login"); setView("form"); setError(""); }}
                  className="mb-6 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to sign in
                </button>
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15 text-primary">
                  <Mail className="h-6 w-6" />
                </div>
                <h1 className="text-2xl font-bold tracking-tight">Reset your password</h1>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  Enter your email address and we&apos;ll send you a reset link.
                </p>
              </div>

              <form onSubmit={handleForgotSubmit} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="reset-email">Email</Label>
                  <Input
                    id="reset-email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    className="h-11"
                  />
                </div>

                {error && (
                  <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive animate-fade-in">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <Button type="submit" disabled={busy} size="lg" className="w-full h-12 text-base">
                  {busy ? "Sending…" : "Send reset link"}
                </Button>
              </form>
            </>
          ) : (
            <div className="rounded-2xl border border-border/60 bg-card p-8 shadow-lg shadow-black/[0.03] text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/15">
                <Mail className="h-7 w-7 text-primary" />
              </div>
              <h2 className="text-xl font-bold tracking-tight">Check your email</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                We sent a password reset link to{" "}
                <span className="font-medium text-foreground">{email}</span>.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Didn&apos;t receive it? Check your spam folder or{" "}
                <button
                  onClick={() => { setView("forgot"); setError(""); }}
                  className="text-primary hover:underline underline-offset-4"
                >
                  try again
                </button>
                .
              </p>
              <div className="mt-6 pt-6 border-t border-border/60">
                <button
                  onClick={() => { window.history.replaceState(null, "", "/login"); setView("form"); setError(""); }}
                  className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4 transition-colors"
                >
                  Back to sign in
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-screen items-center gap-12 px-4 py-12 lg:grid-cols-2 lg:px-8">
      <DecorativePanel />

      <div className="mx-auto w-full max-w-md animate-fade-in">
        <div className="mb-10 text-center lg:text-left">
          <div className="mb-6 flex items-center justify-center gap-2 lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <FileText className="h-5 w-5" />
            </span>
            <span className="text-xl font-semibold tracking-tight text-foreground">
              Resume Matcher
            </span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            {mode === "signin" ? "Welcome back" : "Create your account"}
          </h1>
          <p className="mt-2 text-muted-foreground">
            {mode === "signin"
              ? "Sign in to continue to your analyses."
              : "Start matching your resume in seconds."}
          </p>
        </div>

        <Suspense fallback={null}>
          <UrlErrorDisplay />
        </Suspense>

        <div className="rounded-2xl border border-border/60 bg-card p-8 shadow-lg shadow-black/[0.03]">
          <form onSubmit={submit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-sm font-medium">
                  Password
                </Label>
                {mode === "signin" && (
                  <button
                    type="button"
                    onClick={() => { setView("forgot"); setError(""); }}
                    className="text-xs text-muted-foreground hover:text-primary underline underline-offset-4 transition-colors"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="h-11 pr-10"
                  autoComplete={
                    mode === "signin" ? "current-password" : "new-password"
                  }
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              {mode === "signup" && (
                <ul className="space-y-1 pt-1">
                  {signupRequirements.map((req) => {
                    const hasContent = password.length > 0;
                    const met = req.test(password);
                    return (
                      <li
                        key={req.label}
                        className={`flex items-center gap-2 text-xs transition-colors ${
                          hasContent ? (met ? "text-success" : "text-destructive") : "text-muted-foreground"
                        }`}
                      >
                        {hasContent ? (
                          met ? <Check className="h-3.5 w-3.5 shrink-0" /> : <X className="h-3.5 w-3.5 shrink-0" />
                        ) : (
                          <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-muted-foreground/40" />
                        )}
                        {req.label}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive animate-fade-in">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button type="submit" disabled={busy} size="lg" className="w-full h-12 text-base">
              {busy
                ? "Please wait…"
                : mode === "signin"
                ? "Sign in"
                : "Create account"}
              {!busy && <ArrowRight className="h-4 w-4" />}
            </Button>
          </form>

          <div className="mt-6 pt-6 border-t border-border/60">
            <p className="text-center text-sm text-muted-foreground">
              {mode === "signin"
                ? "Don't have an account? "
                : "Already have an account? "}
              <button
                onClick={() => switchMode(mode === "signin" ? "signup" : "signin")}
                className="font-semibold text-primary hover:underline underline-offset-4"
              >
                {mode === "signin" ? "Sign up" : "Sign in"}
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
