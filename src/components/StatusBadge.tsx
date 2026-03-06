import { Project } from "@/types/project";
import { Loader2, CheckCircle2, AlertCircle, FileText } from "lucide-react";

const statusConfig = {
  rascunho: { label: "Rascunho", icon: FileText, className: "text-muted-foreground bg-muted" },
  processando: { label: "Processando", icon: Loader2, className: "text-warning bg-warning/10 animate-pulse" },
  concluido: { label: "Concluído", icon: CheckCircle2, className: "text-success bg-success/10" },
  erro: { label: "Erro", icon: AlertCircle, className: "text-destructive bg-destructive/10" },
};

export default function StatusBadge({ status }: { status: Project["status"] }) {
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${config.className}`}>
      <Icon className={`w-3 h-3 ${status === "processando" ? "animate-spin" : ""}`} />
      {config.label}
    </span>
  );
}
