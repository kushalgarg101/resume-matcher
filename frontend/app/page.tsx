"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  History,
  Sparkles,
  Target,
  Upload,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const features = [
  {
    icon: Target,
    title: "Instant match score",
    description:
      "See how well your resume fits a role on a 0–100 scale, powered by AI.",
  },
  {
    icon: Sparkles,
    title: "Skill breakdown",
    description:
      "Know exactly which skills you match and what's missing from the JD.",
  },
  {
    icon: History,
    title: "Track your progress",
    description: "Every analysis is saved so you can compare roles over time.",
  },
];

export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading) {
    return (
      <div className="container flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }
  if (!user) return null;

  return (
    <div className="container animate-fade-in py-10">
      {/* Hero */}
      <section className="rounded-2xl border-x border-b border-border bg-gradient-to-br from-primary/10 via-card to-card p-8 text-center sm:p-12">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          <Sparkles className="h-3 w-3" />
          AI-powered resume scoring
        </span>
        <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
          See how well your resume matches the job
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
          Upload your resume and paste a job description. Get a fit score,
          matched skills, and a clear list of what&apos;s missing — in seconds.
        </p>
        <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link href="/upload">
              <Upload className="h-4 w-4" />
              New analysis
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/history">
              <History className="h-4 w-4" />
              View history
            </Link>
          </Button>
        </div>
      </section>

      {/* Features */}
      <section className="mt-8 grid gap-4 sm:grid-cols-3">
        {features.map((f) => (
          <Card key={f.title} className="hover:border-primary/40">
            <CardHeader>
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <f.icon className="h-5 w-5" />
              </span>
              <CardTitle className="text-base">{f.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>{f.description}</CardDescription>
            </CardContent>
          </Card>
        ))}
      </section>

    </div>
  );
}
