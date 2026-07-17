"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth, EmailConfirmationRequiredError } from "@/lib/auth";

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
      router.replace("/");
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
    <main className="container">
      <div className="card">
        <h1>{mode === "signin" ? "Sign in" : "Create account"}</h1>
        <form onSubmit={submit}>
          <label>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <label>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          <button disabled={busy} style={{ marginTop: "1rem" }}>
            {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Sign up"}
          </button>
        </form>
        {error && <p className="error">{error}</p>}
        <p className="muted" style={{ marginTop: "1rem" }}>
          {mode === "signin" ? "No account? " : "Have an account? "}
          <a href="#" onClick={(e) => { e.preventDefault(); setMode(mode === "signin" ? "signup" : "signin"); }}>
            {mode === "signin" ? "Sign up" : "Sign in"}
          </a>
        </p>
      </div>
    </main>
  );
}
