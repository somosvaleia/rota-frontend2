import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Pencil, RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface EditProjectDialogProps {
  project: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: (updated: any) => void;
}

export default function EditProjectDialog({ project, open, onOpenChange, onUpdated }: EditProjectDialogProps) {
  const [nome, setNome] = useState(project.nome_mercado);
  const [cidade, setCidade] = useState(project.cidade);
  const [observacoes, setObservacoes] = useState(project.observacoes || "");
  const [saving, setSaving] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const { data, error } = await supabase
      .from("projects")
      .update({
        nome_mercado: nome,
        cidade,
        observacoes,
        updated_at: new Date().toISOString(),
      })
      .eq("id", project.id)
      .select()
      .single();

    if (!error && data) {
      onUpdated(data);
      onOpenChange(false);
    } else {
      alert("Erro ao salvar alterações.");
    }
    setSaving(false);
  };

  const handleReprocess = async () => {
    setReprocessing(true);
    try {
      // Update project data first
      await supabase
        .from("projects")
        .update({
          nome_mercado: nome,
          cidade,
          observacoes,
          status: "processando",
          updated_at: new Date().toISOString(),
        })
        .eq("id", project.id);

      // Resend to n8n webhook
      const webhookUrl = import.meta.env.VITE_N8N_WEBHOOK_URL || "https://api.rota.valeia.space/webhook/rota/projeto";

      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: project.id,
          nome_mercado: nome,
          cidade,
          observacoes,
          categorias: project.categorias,
          imagens: project.imagens,
        }),
      });

      if (!res.ok) throw new Error(`Erro ${res.status}`);

      onUpdated({ ...project, nome_mercado: nome, cidade, observacoes, status: "processando" });
      onOpenChange(false);
    } catch (err) {
      console.error(err);
      alert("Erro ao reprocessar o projeto.");
    } finally {
      setReprocessing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar Projeto</DialogTitle>
          <DialogDescription>Altere os dados do projeto ou reenvie para processamento.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Nome do Mercado</label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Cidade / Estado</label>
            <Input value={cidade} onChange={(e) => setCidade(e.target.value)} />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Observações</label>
            <Textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={3} />
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={handleReprocess}
            disabled={saving || reprocessing}
            className="gap-2"
          >
            {reprocessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
            {reprocessing ? "Reenviando..." : "Salvar e Reprocessar"}
          </Button>
          <Button onClick={handleSave} disabled={saving || reprocessing} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pencil className="w-4 h-4" />}
            {saving ? "Salvando..." : "Salvar Alterações"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
