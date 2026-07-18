"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, FileText, Sparkles, Target } from "lucide-react";
import { useAuth, EmailConfirmationRequiredError } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle } from "lucide-react";

export default function LoginPage() {
  const { signIn, signUp, user, loading } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">("signin");

  useEffect(() => {
    if (!loading && user) router.replace("/");
  }, [loading, user, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "signin") await signIn(email, password);
      else await signUp(email, password);
    } catch (err: unknown) {
      if (err instanceof EmailConfirmationRequiredError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message || "Authentication failed");
      } else {
        setError("Authentication failed");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen items-center gap-12 px-4 py-12 lg:grid-cols-2 lg:px-8">
      {/* Left: decorative panel */}
      <div className="relative hidden overflow-hidden rounded-3xl border border-border/60 bg-card p-12 lg:flex lg:flex-col lg:justify-between shadow-lg shadow-black/[0.03]">
        {/* Decorative background pattern */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-blue-500/5" />
        <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-blue-500/8 blur-3xl" />

        {/* Grid pattern overlay */}
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
          <ul className="space-y-4 text-sm">
            <li className="flex items-center gap-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <Target className="h-4 w-4" />
              </span>
              <span className="text-foreground">Score your resume against any role</span>
            </li>
            <li className="flex items-center gap-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <Sparkles className="h-4 w-4" />
              </span>
              <span className="text-foreground">See exactly which skills you match</span>
            </li>
            <li className="flex items-center gap-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <FileText className="h-4 w-4" />
              </span>
              <span className="text-foreground">Track every analysis in your history</span>
            </li>
          </ul>
        </div>
      </div>

      {/* Right: form card */}
      <div className="mx-auto w-full max-w-md animate-fade-in">
        <div className="mb-10 text-center lg:text-left">
          {/* Mobile logo */}
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
              <Label htmlFor="password" className="text-sm font-medium">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="h-11"
                autoComplete={
                  mode === "signin" ? "current-password" : "new-password"
                }
              />
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
                onClick={() => {
                  setError("");
                  setMode(mode === "signin" ? "signup" : "signin");
                }}
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
