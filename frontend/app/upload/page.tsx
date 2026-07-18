"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FileText } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { createAnalysis, getAnalysis, Analysis, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import FileDropzone from "@/components/FileDropzone";
import EmptyState from "@/components/EmptyState";
import ResultCard from "@/components/ResultCard";

export default function UploadPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [jdText, setJdText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading || !user) return null;

  const poll = async (id: string) => {
    for (let i = 0; i < 150; i++) {
      if (cancelledRef.current) return;
      await new Promise((r) => setTimeout(r, 2000));
      if (cancelledRef.current) return;
      let a: Analysis;
      try {
        a = await getAnalysis(id);
      } catch (err) {
        if (err instanceof ApiError && (err.status === 401 || err.status === 404)) {
          if (err.status === 401) {
            setError("Session expired. Please sign in again.");
            router.replace("/login");
          } else {
            setError("Analysis not found.");
          }
          return;
        }
        setError("Could not refresh status. Stopping polling.");
        return;
      }
      setAnalysis(a);
      if (a.status === "completed" || a.status === "failed") return;
    }
    setError("Still processing — check the History page for the latest status.");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError("Please attach a resume PDF.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const created = await createAnalysis(jdText, file);
      setAnalysis(created);
      await poll(created.id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError("Session expired. Please sign in again.");
        router.replace("/login");
      } else if (err instanceof Error) {
        setError(err.message || "Upload failed");
      } else {
        setError("Upload failed");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container animate-fade-in py-8">
      <div className="mb-6 ml-2">
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Back
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">New analysis</h1>
        <p className="text-sm text-muted-foreground">
          Paste a job description and upload your resume to get a match score.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Left: input form */}
        <div className="lg:col-span-3">
          <form onSubmit={submit}>
            <Card>
              <CardContent className="space-y-5 p-6">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="jd">Job description</Label>
                    <span className="text-xs text-muted-foreground">
                      {jdText.length}/20000
                    </span>
                  </div>
                  <Textarea
                    id="jd"
                    rows={8}
                    placeholder="Paste the job description here…"
                    value={jdText}
                    onChange={(e) => setJdText(e.target.value)}
                    required
                    className="resize-none"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="resume">Resume (PDF)</Label>
                  <FileDropzone file={file} onFileChange={setFile} />
                </div>

                {error && (
                  <p className="text-sm text-destructive">{error}</p>
                )}

                <Button
                  type="submit"
                  size="lg"
                  disabled={busy}
                  className="w-full"
                >
                  {busy ? "Processing…" : "Score match"}
                </Button>
              </CardContent>
            </Card>
          </form>
        </div>

        {/* Right: live result */}
        <div className="lg:col-span-2">
          {analysis ? (
            <ResultCard analysis={analysis} />
          ) : busy ? (
            <Card>
              <CardContent className="space-y-4 p-6">
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-32 w-32 rounded-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </CardContent>
            </Card>
          ) : (
            <EmptyState
              icon={<FileText className="h-6 w-6" />}
              title="No result yet"
              description="Your match score and skill breakdown will appear here once you run an analysis."
              className="h-full"
            />
          )}
        </div>
      </div>
    </div>
  );
}
