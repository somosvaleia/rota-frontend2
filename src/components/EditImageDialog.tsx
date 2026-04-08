import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { uploadImage } from "@/lib/uploadImage";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Upload, Wand2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface EditImageDialogProps {
  projectId: string;
  imageKey: string;
  imageUrl: string;
  imageLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function EditImageDialog({
  projectId,
  imageKey,
  imageUrl,
  imageLabel,
  open,
  onOpenChange,
}: EditImageDialogProps) {
  const [mode, setMode] = useState<"choose" | "ai" | "upload">("choose");
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAiEdit = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    try {
      const webhookUrl = "https://api.rota.valeia.space/webhook/rota/projeto";
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          tipo: "edicao",
          image_key: imageKey,
          image_url: imageUrl,
          prompt,
        }),
      });

      if (!res.ok) throw new Error("Webhook failed");
      onOpenChange(false);
      setMode("choose");
      setPrompt("");
    } catch (err) {
      console.error(err);
      alert("Erro ao enviar edição para processamento.");
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (file: File) => {
    setLoading(true);
    try {
      const newUrl = await uploadImage(file, `${projectId}/output`);

      const { error } = await supabase
        .from("projects")
        .update({ [imageKey]: newUrl, updated_at: new Date().toISOString() })
        .eq("id", projectId);

      if (error) throw error;
      onOpenChange(false);
      setMode("choose");
    } catch (err) {
      console.error(err);
      alert("Erro ao substituir imagem.");
    } finally {
      setLoading(false);
    }
  };

  const resetAndClose = (val: boolean) => {
    if (!val) {
      setMode("choose");
      setPrompt("");
    }
    onOpenChange(val);
  };

  return (
    <Dialog open={open} onOpenChange={resetAndClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar {imageLabel}</DialogTitle>
          <DialogDescription>Escolha como deseja editar esta imagem.</DialogDescription>
        </DialogHeader>

        {mode === "choose" && (
          <div className="grid grid-cols-2 gap-4 py-4">
            <button
              onClick={() => setMode("ai")}
              className="glass-card rounded-xl p-6 text-center hover:border-primary/50 transition-colors flex flex-col items-center gap-3"
            >
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Wand2 className="w-5 h-5 text-primary" />
              </div>
              <span className="text-sm font-medium">Editar com IA</span>
              <span className="text-xs text-muted-foreground">Descreva as alterações</span>
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="glass-card rounded-xl p-6 text-center hover:border-primary/50 transition-colors flex flex-col items-center gap-3"
            >
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Upload className="w-5 h-5 text-primary" />
              </div>
              <span className="text-sm font-medium">Substituir</span>
              <span className="text-xs text-muted-foreground">Fazer upload de outra</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUpload(file);
              }}
            />
          </div>
        )}

        {mode === "ai" && (
          <div className="space-y-4 py-2">
            <img src={imageUrl} alt={imageLabel} className="w-full h-48 object-cover rounded-lg" />
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Ex: Mude as cores para tons mais quentes, adicione mais iluminação..."
              rows={3}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setMode("choose")} disabled={loading}>
                Voltar
              </Button>
              <Button onClick={handleAiEdit} disabled={loading || !prompt.trim()} className="gap-2">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                {loading ? "Editando..." : "Aplicar com IA"}
              </Button>
            </DialogFooter>
          </div>
        )}

        {loading && mode === "choose" && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <span className="ml-3 text-sm text-muted-foreground">Substituindo imagem...</span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
