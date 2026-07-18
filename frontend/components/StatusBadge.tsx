import {
  CheckCircle2,
  Clock,
  Loader2,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Status = "queued" | "processing" | "completed" | "failed";

const config: Record<
  Status,
  { label: string; variant: "muted" | "secondary" | "success" | "destructive"; icon: React.ReactNode }
> = {
  queued: {
    label: "Queued",
    variant: "muted",
    icon: <Clock className="h-3 w-3" />,
  },
  processing: {
    label: "Processing",
    variant: "secondary",
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
  },
  completed: {
    label: "Completed",
    variant: "success",
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
  failed: {
    label: "Failed",
    variant: "destructive",
    icon: <XCircle className="h-3 w-3" />,
  },
};

export default function StatusBadge({ status }: { status: Status }) {
  const c = config[status] ?? { label: status, variant: "muted" as const, icon: null };
  return (
    <Badge variant={c.variant} className={cn("gap-1")}>
      {c.icon}
      {c.label}
    </Badge>
  );
}
