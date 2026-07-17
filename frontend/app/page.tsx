"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

export default function HomePage() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading) return <main className="container">Loading…</main>;
  if (!user) return null;

  return (
    <main className="container">
      <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ margin: 0 }}>Resume Matcher</h1>
          <p className="muted">Signed in as {user.email}</p>
        </div>
        <button style={{ width: "auto" }} onClick={async () => { await signOut(); router.replace("/login"); }}>
          Sign out
        </button>
      </div>
      <div className="card">
        <a href="/upload"><button style={{ width: "auto" }}>New analysis</button></a>{" "}
        <a href="/history"><button style={{ width: "auto" }}>View history</button></a>
      </div>
    </main>
  );
}
