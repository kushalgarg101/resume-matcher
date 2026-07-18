"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Loader2,
  Plus,
  Trash2,
  Save,
  ExternalLink,
  Briefcase,
  GraduationCap,
  Code2,
  Award,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  UserProfile,
  Experience,
  Education,
  Project,
  Certification,
  getProfile,
  updateProfile,
} from "@/lib/api";

export default function ProfileForm() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    getProfile()
      .then((p) => { if (active) setProfile(p); })
      .catch(() => {})
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const handleField = useCallback(<K extends keyof UserProfile>(
    key: K,
    value: UserProfile[K]
  ) => {
    setProfile((prev) => (prev ? { ...prev, [key]: value } : prev));
    setSaved(false);
  }, []);

  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSave = async () => {
    if (!profile) return;
    setSaving(true);
    try {
      const updated = await updateProfile(profile);
      setProfile(updated);
      setSaved(true);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaved(false), 2000);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    return () => { if (savedTimerRef.current) clearTimeout(savedTimerRef.current); };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="py-20 text-center text-sm text-muted-foreground">
        Could not load profile. Try uploading a resume first.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Save button */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Your Profile</h2>
        <Button onClick={handleSave} disabled={saving} size="sm">
          {saving ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="mr-1.5 h-3.5 w-3.5" />
          )}
          {saved ? "Saved!" : "Save"}
        </Button>
      </div>

      {/* Basic Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Basic Info</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Full Name</Label>
              <Input
                value={profile.full_name ?? ""}
                onChange={(e) => handleField("full_name", e.target.value || null)}
                placeholder="John Doe"
              />
            </div>
            <div className="space-y-1">
              <Label>Phone</Label>
              <Input
                value={profile.phone ?? ""}
                onChange={(e) => handleField("phone", e.target.value || null)}
                placeholder="+1 (555) 123-4567"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Location</Label>
            <Input
              value={profile.location ?? ""}
              onChange={(e) => handleField("location", e.target.value || null)}
              placeholder="San Francisco, CA"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>LinkedIn URL</Label>
              <Input
                value={profile.linkedin_url ?? ""}
                onChange={(e) => handleField("linkedin_url", e.target.value || null)}
                placeholder="https://linkedin.com/in/..."
              />
            </div>
            <div className="space-y-1">
              <Label>Portfolio / Website</Label>
              <Input
                value={profile.portfolio_url ?? ""}
                onChange={(e) => handleField("portfolio_url", e.target.value || null)}
                placeholder="https://github.com/..."
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Professional Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={profile.summary ?? ""}
            onChange={(e) => handleField("summary", e.target.value || null)}
            placeholder="Write 2-3 sentences about your background and goals..."
            rows={3}
          />
        </CardContent>
      </Card>

      {/* Skills */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Skills</CardTitle>
        </CardHeader>
        <CardContent>
          <SkillsInput
            skills={profile.skills}
            onChange={(skills) => handleField("skills", skills)}
          />
        </CardContent>
      </Card>

      {/* Experience */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Briefcase className="h-4 w-4 text-primary" />
            Experience
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {profile.experience.map((exp, i) => (
            <ExperienceItem
              key={i}
              exp={exp}
              onChange={(e) => {
                const next = [...profile.experience];
                next[i] = e;
                handleField("experience", next);
              }}
              onRemove={() => {
                const next = profile.experience.filter((_, j) => j !== i);
                handleField("experience", next);
              }}
            />
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              handleField("experience", [
                ...profile.experience,
                { company: "", role: "" },
              ])
            }
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Add Experience
          </Button>
        </CardContent>
      </Card>

      {/* Education */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <GraduationCap className="h-4 w-4 text-primary" />
            Education
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {profile.education.map((edu, i) => (
            <EducationItem
              key={i}
              edu={edu}
              onChange={(e) => {
                const next = [...profile.education];
                next[i] = e;
                handleField("education", next);
              }}
              onRemove={() => {
                const next = profile.education.filter((_, j) => j !== i);
                handleField("education", next);
              }}
            />
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              handleField("education", [
                ...profile.education,
                { institution: "" },
              ])
            }
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Add Education
          </Button>
        </CardContent>
      </Card>

      {/* Projects */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Code2 className="h-4 w-4 text-primary" />
            Projects
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {profile.projects.map((proj, i) => (
            <ProjectItem
              key={i}
              proj={proj}
              onChange={(p) => {
                const next = [...profile.projects];
                next[i] = p;
                handleField("projects", next);
              }}
              onRemove={() => {
                const next = profile.projects.filter((_, j) => j !== i);
                handleField("projects", next);
              }}
            />
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              handleField("projects", [
                ...profile.projects,
                { name: "", technologies: [] },
              ])
            }
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Add Project
          </Button>
        </CardContent>
      </Card>

      {/* Certifications */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Award className="h-4 w-4 text-primary" />
            Certifications
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {profile.certifications.map((cert, i) => (
            <CertificationItem
              key={i}
              cert={cert}
              onChange={(c) => {
                const next = [...profile.certifications];
                next[i] = c;
                handleField("certifications", next);
              }}
              onRemove={() => {
                const next = profile.certifications.filter((_, j) => j !== i);
                handleField("certifications", next);
              }}
            />
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              handleField("certifications", [
                ...profile.certifications,
                { name: "" },
              ])
            }
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Add Certification
          </Button>
        </CardContent>
      </Card>

      {/* Preferences */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Preferences</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>Preferred Roles</Label>
            <Textarea
              value={profile.preferred_roles.join(", ")}
              onChange={(e) =>
                handleField(
                  "preferred_roles",
                  e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean)
                )
              }
              placeholder="Software Engineer, Full Stack Developer, ..."
              rows={2}
            />
          </div>
          <div className="space-y-1">
            <Label>Preferred Locations</Label>
            <Textarea
              value={profile.preferred_locations.join(", ")}
              onChange={(e) =>
                handleField(
                  "preferred_locations",
                  e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean)
                )
              }
              placeholder="San Francisco, Remote, New York, ..."
              rows={2}
            />
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={profile.is_open_to_work}
              onChange={(e) => handleField("is_open_to_work", e.target.checked)}
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
            />
            <span className="text-sm">Open to work</span>
          </label>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function SkillsInput({
  skills,
  onChange,
}: {
  skills: string[];
  onChange: (s: string[]) => void;
}) {
  const [input, setInput] = useState("");

  const addSkill = () => {
    const trimmed = input.trim();
    if (trimmed && !skills.includes(trimmed)) {
      onChange([...skills, trimmed]);
    }
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addSkill();
    }
    if (e.key === "," || e.key === ";") {
      e.preventDefault();
      addSkill();
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {skills.map((s, i) => (
          <Badge key={i} variant="secondary" className="cursor-pointer" onClick={() => onChange(skills.filter((_, j) => j !== i))}>
            {s} &times;
          </Badge>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a skill and press Enter..."
          className="flex-1"
        />
        <Button variant="outline" size="sm" onClick={addSkill} type="button">
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function ExperienceItem({
  exp,
  onChange,
  onRemove,
}: {
  exp: Experience;
  onChange: (e: Experience) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex items-start justify-between">
        <div className="grid flex-1 gap-2 sm:grid-cols-2">
          <Input
            value={exp.role}
            onChange={(e) => onChange({ ...exp, role: e.target.value })}
            placeholder="Role (e.g. Software Engineer)"
          />
          <Input
            value={exp.company}
            onChange={(e) => onChange({ ...exp, company: e.target.value })}
            placeholder="Company"
          />
        </div>
        <Button variant="ghost" size="icon" className="ml-2 h-8 w-8 shrink-0 text-destructive" onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Input
          value={exp.start_date ?? ""}
          onChange={(e) => onChange({ ...exp, start_date: e.target.value || null })}
          placeholder="Start (e.g. Jan 2020)"
        />
        <Input
          value={exp.end_date ?? ""}
          onChange={(e) => onChange({ ...exp, end_date: e.target.value || null })}
          placeholder="End (e.g. Dec 2022)"
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={exp.current ?? false}
            onChange={(e) => onChange({ ...exp, current: e.target.checked, end_date: e.target.checked ? null : exp.end_date })}
            className="h-4 w-4 rounded border-border text-primary"
          />
          Current
        </label>
      </div>
      <Textarea
        value={exp.description ?? ""}
        onChange={(e) => onChange({ ...exp, description: e.target.value || null })}
        placeholder="Describe your responsibilities and achievements..."
        rows={2}
      />
    </div>
  );
}

function EducationItem({
  edu,
  onChange,
  onRemove,
}: {
  edu: Education;
  onChange: (e: Education) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex items-start justify-between">
        <div className="grid flex-1 gap-2 sm:grid-cols-2">
          <Input
            value={edu.institution}
            onChange={(e) => onChange({ ...edu, institution: e.target.value })}
            placeholder="Institution"
          />
          <Input
            value={edu.degree ?? ""}
            onChange={(e) => onChange({ ...edu, degree: e.target.value || null })}
            placeholder="Degree (e.g. B.S.)"
          />
        </div>
        <Button variant="ghost" size="icon" className="ml-2 h-8 w-8 shrink-0 text-destructive" onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Input
          value={edu.field ?? ""}
          onChange={(e) => onChange({ ...edu, field: e.target.value || null })}
          placeholder="Field (e.g. Computer Science)"
        />
        <Input
          value={edu.start_date ?? ""}
          onChange={(e) => onChange({ ...edu, start_date: e.target.value || null })}
          placeholder="Start"
        />
        <Input
          value={edu.end_date ?? ""}
          onChange={(e) => onChange({ ...edu, end_date: e.target.value || null })}
          placeholder="End"
        />
      </div>
    </div>
  );
}

function ProjectItem({
  proj,
  onChange,
  onRemove,
}: {
  proj: Project;
  onChange: (p: Project) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex items-start justify-between">
        <Input
          className="flex-1"
          value={proj.name}
          onChange={(e) => onChange({ ...proj, name: e.target.value })}
          placeholder="Project name"
        />
        <Button variant="ghost" size="icon" className="ml-2 h-8 w-8 shrink-0 text-destructive" onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <Textarea
        value={proj.description ?? ""}
        onChange={(e) => onChange({ ...proj, description: e.target.value || null })}
        placeholder="Brief description..."
        rows={2}
      />
      <Input
        value={(proj.technologies ?? []).join(", ")}
        onChange={(e) =>
          onChange({
            ...proj,
            technologies: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
          })
        }
        placeholder="Technologies (comma separated)"
      />
    </div>
  );
}

function CertificationItem({
  cert,
  onChange,
  onRemove,
}: {
  cert: Certification;
  onChange: (c: Certification) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex items-start justify-between">
        <div className="grid flex-1 gap-2 sm:grid-cols-2">
          <Input
            value={cert.name}
            onChange={(e) => onChange({ ...cert, name: e.target.value })}
            placeholder="Certification name"
          />
          <Input
            value={cert.issuer ?? ""}
            onChange={(e) => onChange({ ...cert, issuer: e.target.value || null })}
            placeholder="Issuer (e.g. AWS)"
          />
        </div>
        <Button variant="ghost" size="icon" className="ml-2 h-8 w-8 shrink-0 text-destructive" onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <Input
        value={cert.date ?? ""}
        onChange={(e) => onChange({ ...cert, date: e.target.value || null })}
        placeholder="Date obtained"
      />
    </div>
  );
}
