"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ArrowLeft, Mail, Check, X, RefreshCw, Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { getEmailConfig, updateEmailConfig, syncEmails, EmailConfig, EmailSyncResult } from "@/lib/api";

export default function SettingsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [emailConfig, setEmailConfig] = useState<EmailConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<EmailSyncResult | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    imap_host: "",
    imap_port: "993",
    email_address: "",
    app_password: "",
    enabled: false,
  });

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    getEmailConfig()
      .then((cfg) => {
        if (cfg) {
          setEmailConfig(cfg);
          setForm({
            imap_host: cfg.imap_host || "",
            imap_port: String(cfg.imap_port || 993),
            email_address: cfg.email_address || "",
            app_password: "",
            enabled: cfg.enabled,
          });
        }
      })
      .catch(() => setError("Failed to load settings."))
      .finally(() => setLoading(false));
  }, [user]);

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const updated = await updateEmailConfig({
        imap_host: form.imap_host || undefined,
        imap_port: parseInt(form.imap_port, 10) || 993,
        email_address: form.email_address || undefined,
        app_password: form.app_password || undefined,
        enabled: form.enabled,
      });
      setEmailConfig(updated);
      setForm({
        imap_host: updated.imap_host || "",
        imap_port: String(updated.imap_port || 993),
        email_address: updated.email_address || "",
        app_password: "",
        enabled: updated.enabled,
      });
    } catch { setError("Failed to save email settings."); } finally { setSaving(false); }
  };

  const handleSync = async () => {
    setSyncing(true);
    setError("");
    setSyncResult(null);
    try {
      const result = await syncEmails();
      setSyncResult(result);
    } catch (e) { setError(e instanceof Error ? e.message : "Sync failed."); } finally { setSyncing(false); }
  };

  if (authLoading) return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  if (!user) return null;

  return (
    <div className="container animate-fade-in py-8 max-w-2xl">
      {/* Header */}
      <div className="mb-8 flex items-center gap-3">
        <Button variant="ghost" size="icon" className="rounded-lg hover:bg-muted" onClick={() => router.push("/profile")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-bold tracking-tight">Settings</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Email monitoring and application preferences</p>
        </div>
      </div>

      {error && (
        <div className="mb-6 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <X className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="space-y-8">
          {/* Email Monitoring */}
          <div className="rounded-2xl border border-border/80 bg-card/60 p-6">
            <div className="flex items-center gap-3 mb-1">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <Mail className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-base font-semibold">Email Monitoring</h2>
                <p className="text-xs text-muted-foreground">
                  Connect your email to automatically detect application responses.
                </p>
              </div>
            </div>

            <Separator className="my-5 bg-border/60" />

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="imap_host" className="text-xs font-medium">IMAP Server</Label>
                  <Input
                    id="imap_host"
                    value={form.imap_host}
                    onChange={(e) => setForm((p) => ({ ...p, imap_host: e.target.value }))}
                    placeholder="imap.gmail.com"
                    className="h-9 rounded-lg text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="imap_port" className="text-xs font-medium">Port</Label>
                  <Input
                    id="imap_port"
                    value={form.imap_port}
                    onChange={(e) => setForm((p) => ({ ...p, imap_port: e.target.value }))}
                    placeholder="993"
                    className="h-9 rounded-lg text-sm"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email_address" className="text-xs font-medium">Email Address</Label>
                <Input
                  id="email_address"
                  type="email"
                  value={form.email_address}
                  onChange={(e) => setForm((p) => ({ ...p, email_address: e.target.value }))}
                  placeholder="you@gmail.com"
                  className="h-9 rounded-lg text-sm"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="app_password" className="text-xs font-medium">App Password</Label>
                <div className="relative">
                  <Input
                    id="app_password"
                    type={showPassword ? "text" : "password"}
                    value={form.app_password}
                    onChange={(e) => setForm((p) => ({ ...p, app_password: e.target.value }))}
                    placeholder="16-character app password"
                    className="h-9 rounded-lg text-sm pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="text-[10px] text-muted-foreground/70">
                  For Gmail, generate an app-specific password at {" "}
                  <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    myaccount.google.com/apppasswords
                  </a>.
                  Your password is encrypted at rest by Supabase.
                </p>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={() => setForm((p) => ({ ...p, enabled: !p.enabled }))}
                  className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors ${
                    form.enabled ? "bg-primary" : "bg-muted-foreground/30"
                  }`}
                  role="switch"
                  aria-checked={form.enabled}
                >
                  <span className={`inline-block h-4.5 w-4.5 transform rounded-full bg-white transition-transform ${
                    form.enabled ? "translate-x-4.5" : "translate-x-0.5"
                  }`} />
                </button>
                <span className="text-sm text-muted-foreground">
                  {form.enabled ? "Monitoring is active" : "Monitoring is paused"}
                </span>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <Button
                  variant="default"
                  size="sm"
                  className="rounded-lg"
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
                  Save
                </Button>

                {emailConfig?.enabled && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-lg"
                    onClick={handleSync}
                    disabled={syncing}
                  >
                    {syncing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
                    Sync Now
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Last Sync Info */}
          {emailConfig?.last_sync_at && (
            <div className="text-xs text-muted-foreground/60 text-center">
              Last synced: {new Date(emailConfig.last_sync_at).toLocaleString()}
            </div>
          )}

          {/* Sync Result */}
          {syncResult && (
            <div className="rounded-2xl border border-success/30 bg-success/5 p-5">
              <div className="flex items-center gap-2 mb-3">
                <Check className="h-5 w-5 text-success" />
                <span className="text-sm font-semibold text-foreground">Sync Complete</span>
              </div>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-lg font-bold text-foreground">{syncResult.processed}</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Emails Scanned</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-foreground">{syncResult.matched}</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Matched</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-foreground">{syncResult.updated_applications}</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Updated</p>
                </div>
              </div>
              {syncResult.errors.length > 0 && (
                <div className="mt-3 rounded-lg bg-destructive/10 p-2.5">
                  <p className="text-xs text-destructive font-medium mb-1">Errors:</p>
                  {syncResult.errors.map((err, i) => (
                    <p key={i} className="text-[10px] text-destructive/80">{err}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Account Info */}
          <div className="rounded-2xl border border-border/80 bg-card/60 p-5 text-xs text-muted-foreground">
            <p className="font-medium text-foreground mb-1">Account</p>
            <p>Signed in as <span className="text-foreground">{user.email}</span></p>
          </div>
        </div>
      )}
    </div>
  );
}
