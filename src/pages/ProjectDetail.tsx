import { useParams, Link, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Download, Play, ExternalLink, Loader2, Trash2, Pencil, PauseCircle, CheckCircle2, RotateCw, Save, Share2, Copy, Check, FileArchive } from "lucide-react";
import JSZip from "jszip";
import AppLayout from "@/components/AppLayout";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import EditProjectDialog from "@/components/EditProjectDialog";
import EditImageDialog from "@/components/EditImageDialog";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

const IMAGE_KEYS = [
  "img_a_url", "img_b_url", "img_c_url", "img_d_url", "img_e_url",
  "img_f_url", "img_g_url", "img_h_url", "img_i_url", "img_j_url",
  "img_k_url", "img_l_url", "img_m_url", "img_n_url", "img_o_url",
  "img_p_url", "img_q_url", "img_r_url", "img_s_url", "img_t_url",
] as const;

const VIDEO_KEYS = ["video_url", "video_b_url", "video_c_url", "video_d_url", "video_e_url", "video_f_url"] as const;

const IMAGE_LABELS: Record<string, string> = {
  img_a_url: "Fachada (Vista Frontal)",
  img_b_url: "Entrada e Caixas",
  img_c_url: "Corredores",
  img_d_url: "Interior / Fundo",
  img_e_url: "Vista Superior (Aérea)",
  img_f_url: "Farda / Uniforme",
  img_g_url: "Sacola Plástica",
  img_h_url: "Carrinho de Mercado",
  img_s_url: "Vista Lateral",
};

const imageLabel = (key: string) => {
  if (IMAGE_LABELS[key]) return IMAGE_LABELS[key];
  const letter = key.replace("img_", "").replace("_url", "").toUpperCase();
  return `Gôndola ${letter}`;
};

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [shareSaving, setShareSaving] = useState(false);
  const [editingImage, setEditingImage] = useState<{ key: string; url: string; label: string } | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [revisionNotes, setRevisionNotes] = useState("");
  const [controlLoading, setControlLoading] = useState<string | null>(null);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [downloadingItem, setDownloadingItem] = useState<string | null>(null);

  const sanitize = (s: string) => (s || "projeto").replace(/[^a-z0-9\-_]+/gi, "_").slice(0, 60);

  const extFromUrl = (url: string, fallback: string) => {
    try {
      const u = new URL(url);
      const m = u.pathname.match(/\.([a-z0-9]{2,5})$/i);
      return m ? m[1].toLowerCase() : fallback;
    } catch { return fallback; }
  };

  const downloadSingle = async (url: string, filename: string) => {
    setDownloadingItem(url);
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const a = document.createElement("a");
      const objectUrl = URL.createObjectURL(blob);
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (e) {
      toast.error("Erro ao baixar arquivo.");
    } finally {
      setDownloadingItem(null);
    }
  };

  const downloadAllAsZip = async () => {
    if (!project) return;
    setDownloadingZip(true);
    try {
      const zip = new JSZip();
      const folder = zip.folder(sanitize(project.nome_mercado)) || zip;

      const tasks: Promise<void>[] = [];
      if (project.overhead_image_url) {
        tasks.push((async () => {
          const r = await fetch(project.overhead_image_url);
          const b = await r.blob();
          folder.file(`vista_superior.${extFromUrl(project.overhead_image_url, "jpg")}`, b);
        })());
      }
      images.forEach((img) => {
        tasks.push((async () => {
          const r = await fetch(img.url!);
          const b = await r.blob();
          folder.file(`${sanitize(imageLabel(img.key))}.${extFromUrl(img.url!, "jpg")}`, b);
        })());
      });
      videos.forEach((v, i) => {
        tasks.push((async () => {
          const r = await fetch(v.url!);
          const b = await r.blob();
          folder.file(`video_${i + 1}.${extFromUrl(v.url!, "mp4")}`, b);
        })());
      });

      await Promise.all(tasks);
      const blob = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a");
      const objectUrl = URL.createObjectURL(blob);
      a.href = objectUrl;
      a.download = `${sanitize(project.nome_mercado)}_completo.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
      toast.success("Download iniciado!");
    } catch (e) {
      console.error(e);
      toast.error("Erro ao gerar zip.");
    } finally {
      setDownloadingZip(false);
    }
  };

  useEffect(() => {
    if (!id) return;

    const fetchProject = async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("id", id)
        .single();

      if (!error && data) {
        setProject(data);
        setRevisionNotes((data as any).user_revision_notes || "");
      }
      setLoading(false);
    };

    fetchProject();

    const channel = supabase
      .channel(`project-${id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "projects", filter: `id=eq.${id}` },
        (payload) => setProject(payload.new)
      )
      .subscribe();

    const interval = window.setInterval(fetchProject, 8000);

    return () => {
      window.clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [id]);

  const handleDelete = async () => {
    if (!project) return;
    setDeleting(true);
    const { error } = await supabase.from("projects").delete().eq("id", project.id);
    if (!error) {
      navigate("/");
    } else {
      alert("Erro ao excluir o projeto.");
      setDeleting(false);
      setShowDeleteDialog(false);
    }
  };

  const runProcessingAction = async (action: "pause" | "continue" | "approve" | "regenerate_overhead") => {
    if (!project) return;
    setControlLoading(action);
    try {
      if (action === "pause") {
        await supabase.from("projects").update({ processing_status: "paused", paused_at_step: project.processing_status || "manual", user_revision_notes: revisionNotes } as any).eq("id", project.id);
      } else {
        await supabase.from("projects").update({ user_revision_notes: revisionNotes } as any).eq("id", project.id);
        const { error } = await supabase.functions.invoke("generate-images", {
          body: { project_id: project.id, control_action: action, user_revision_notes: revisionNotes },
        });
        if (error) throw error;
      }
    } catch (err) {
      console.error("Erro no controle de processamento:", err);
      alert("Erro ao executar ação. Tente novamente.");
    } finally {
      setControlLoading(null);
    }
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="p-8 flex items-center justify-center min-h-[50vh]">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  if (!project) {
    return (
      <AppLayout>
        <div className="p-8 text-center">
          <p className="text-muted-foreground">Projeto não encontrado.</p>
          <Link to="/" className="text-primary underline mt-2 inline-block">Voltar</Link>
        </div>
      </AppLayout>
    );
  }

  const images = IMAGE_KEYS
    .map((key) => ({ key, url: project[key] as string | null }))
    .filter((img) => img.url);

  const videos = VIDEO_KEYS
    .map((key) => ({ key, url: project[key] as string | null }))
    .filter((v) => v.url);

  const hasMedia = images.length > 0 || videos.length > 0;
  const enabledCategories = Array.isArray(project.categorias)
    ? project.categorias.filter((c: any) => c?.enabled !== false).length
    : 0;
  const totalExpectedImages = Math.max(11, 10 + enabledCategories);
  const totalExpectedVideos = 3;

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 md:p-8 max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col sm:flex-row sm:items-start gap-4 mb-6 md:mb-8"
        >
          <div className="flex items-start gap-3 sm:gap-4 flex-1 min-w-0">
            <Link to="/" className="mt-1 text-muted-foreground hover:text-foreground transition-colors shrink-0">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                <h1 className="font-display text-xl sm:text-2xl font-bold break-words">{project.nome_mercado}</h1>
                <StatusBadge status={project.status as any} />
              </div>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                {project.cidade} • Criado em {new Date(project.created_at).toLocaleDateString("pt-BR")}
              </p>
              {project.observacoes && (
                <p className="text-sm text-secondary-foreground mt-2 break-words">{project.observacoes}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => setShowShareDialog(true)}
            >
              <Share2 className="w-4 h-4" />
              Compartilhar
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => setShowEditDialog(true)}
            >
              <Pencil className="w-4 h-4" />
              Editar
            </Button>
            {hasMedia && (
              <Button variant="outline" size="sm" className="gap-2" onClick={downloadAllAsZip} disabled={downloadingZip}>
                {downloadingZip ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileArchive className="w-4 h-4" />}
                {downloadingZip ? "Gerando..." : "Baixar tudo (.zip)"}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="gap-2 text-destructive hover:bg-destructive hover:text-destructive-foreground"
              onClick={() => setShowDeleteDialog(true)}
            >
              <Trash2 className="w-4 h-4" />
              Excluir
            </Button>
          </div>
        </motion.div>

        {project.processing_status && project.processing_status !== "completed" && (
          <div className="glass-card rounded-xl p-4 sm:p-5 mb-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="font-display text-base font-semibold">Controle de processamento</h2>
                <p className="text-sm text-muted-foreground">Etapa atual: {project.processing_status}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" className="gap-2" disabled={!!controlLoading || project.processing_status === "paused"} onClick={() => runProcessingAction("pause")}>
                  {controlLoading === "pause" ? <Loader2 className="w-4 h-4 animate-spin" /> : <PauseCircle className="w-4 h-4" />}
                  Pausar
                </Button>
                <Button variant="outline" size="sm" className="gap-2" disabled={!!controlLoading} onClick={() => runProcessingAction("continue")}>
                  {controlLoading === "continue" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                  Continuar
                </Button>
                <Button variant="outline" size="sm" className="gap-2" disabled={!!controlLoading || project.processing_status !== "waiting_user_approval"} onClick={() => runProcessingAction("approve")}>
                  {controlLoading === "approve" ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Aprovar etapa
                </Button>
                <Button variant="outline" size="sm" className="gap-2" disabled={!!controlLoading} onClick={() => runProcessingAction("regenerate_overhead")}>
                  {controlLoading === "regenerate_overhead" ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4" />}
                  Regenerar etapa
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Editar observações da etapa</label>
              <Textarea value={revisionNotes} onChange={(e) => setRevisionNotes(e.target.value)} rows={3} placeholder="Ajustes para a próxima geração ou regeneração..." />
              <Button variant="ghost" size="sm" className="gap-2" disabled={!!controlLoading} onClick={() => runProcessingAction("pause")}>
                <Save className="w-4 h-4" />
                Salvar observações
              </Button>
            </div>
          </div>
        )}

        {project.overhead_image_url && (
          <div className="space-y-4 sm:space-y-6 mb-8">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-base sm:text-lg font-semibold">Vista Superior Base</h2>
              <Button
                size="sm"
                variant="outline"
                className="gap-2"
                onClick={() => downloadSingle(project.overhead_image_url, `vista_superior.${extFromUrl(project.overhead_image_url, "jpg")}`)}
                disabled={downloadingItem === project.overhead_image_url}
              >
                {downloadingItem === project.overhead_image_url ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                Baixar
              </Button>
            </div>
            <div className="glass-card rounded-xl overflow-hidden cursor-pointer" onClick={() => setLightboxUrl(project.overhead_image_url)}>
              <img src={project.overhead_image_url} alt="Vista superior base do projeto" className="w-full max-h-[520px] object-cover" />
            </div>
          </div>
        )}

        {/* Images */}
        {images.length > 0 && (
          <div className="space-y-4 sm:space-y-6 mb-8">
            <h2 className="font-display text-base sm:text-lg font-semibold">Imagens Geradas ({images.length})</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              {images.map((img, i) => (
                <motion.div
                  key={img.key}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.05 }}
                  className="glass-card rounded-xl overflow-hidden group cursor-pointer"
                  onClick={() => setLightboxUrl(img.url!)}
                >
                  <div className="relative">
                    <img src={img.url!} alt={imageLabel(img.key)} className="w-full h-48 object-cover" />
                    <div className="absolute inset-0 bg-background/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <Button size="sm" variant="outline" className="gap-1.5">
                        <ExternalLink className="w-3.5 h-3.5" />
                        Ampliar
                      </Button>
                    </div>
                  </div>
                  <div className="p-3 flex items-center justify-between gap-2">
                    <p className="text-sm font-medium truncate">{imageLabel(img.key)}</p>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1 h-7 text-xs"
                        disabled={downloadingItem === img.url}
                        onClick={(e) => {
                          e.stopPropagation();
                          downloadSingle(img.url!, `${sanitize(imageLabel(img.key))}.${extFromUrl(img.url!, "jpg")}`);
                        }}
                      >
                        {downloadingItem === img.url ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                        Baixar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1 h-7 text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingImage({ key: img.key, url: img.url!, label: imageLabel(img.key) });
                        }}
                      >
                        <Pencil className="w-3 h-3" />
                        Editar
                      </Button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {/* Videos */}
        {videos.length > 0 && (
          <div className="space-y-4 mb-8">
            <h2 className="font-display text-lg font-semibold">Vídeos ({videos.length})</h2>
            <div className="grid grid-cols-1 gap-4">
              {videos.map((v, i) => (
                <div key={v.key} className="glass-card rounded-xl overflow-hidden">
                  <video src={v.url!} controls className="w-full" />
                  <div className="p-3">
                    <p className="text-sm font-medium">Vídeo {i + 1}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty / Processing state */}
        {!hasMedia && (
          <div className="glass-card rounded-xl p-12 text-center">
            {project.status === "processando" ? (
              <>
                <div className="w-16 h-16 rounded-full bg-warning/10 flex items-center justify-center mx-auto mb-4 animate-pulse-glow">
                  <Play className="w-6 h-6 text-warning" />
                </div>
                <h3 className="font-display text-lg font-semibold mb-2">Gerando Projeto...</h3>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  Progresso atual: {images.length}/{totalExpectedImages} imagens • {videos.length}/{totalExpectedVideos} vídeos.
                </p>
                <p className="text-sm text-muted-foreground max-w-md mx-auto mt-2">
                  A geração acontece em etapas e o status será atualizado automaticamente ao concluir.
                </p>
              </>
            ) : project.status === "erro" ? (
              <>
                <h3 className="font-display text-lg font-semibold mb-2 text-destructive">Erro no processamento</h3>
                <p className="text-sm text-muted-foreground">
                  Ocorreu um erro ao processar este projeto. Tente criar um novo.
                </p>
              </>
            ) : (
              <>
                <h3 className="font-display text-lg font-semibold mb-2">Nenhuma mídia gerada</h3>
                <p className="text-sm text-muted-foreground">
                  Este projeto ainda está em rascunho.
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {/* Lightbox */}
      <Dialog open={!!lightboxUrl} onOpenChange={() => setLightboxUrl(null)}>
        <DialogContent className="max-w-4xl p-2">
          <DialogHeader className="sr-only">
            <DialogTitle>Imagem ampliada</DialogTitle>
            <DialogDescription>Visualização em tamanho completo</DialogDescription>
          </DialogHeader>
          {lightboxUrl && (
            <img src={lightboxUrl} alt="Ampliada" className="w-full h-auto rounded-lg" />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir projeto</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir o projeto "{project.nome_mercado}"? Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)} disabled={deleting}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting} className="gap-2">
              {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              {deleting ? "Excluindo..." : "Excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Share dialog */}
      <Dialog open={showShareDialog} onOpenChange={setShowShareDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Compartilhar projeto</DialogTitle>
            <DialogDescription>
              Ative o link público para que qualquer pessoa com o endereço possa visualizar o resultado (somente leitura). A planta baixa e as mídias geradas serão exibidas.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Link público ativado</p>
                <p className="text-xs text-muted-foreground">Desative a qualquer momento para revogar o acesso.</p>
              </div>
              <Switch
                checked={!!project.share_enabled}
                disabled={shareSaving}
                onCheckedChange={async (checked) => {
                  setShareSaving(true);
                  const { data, error } = await supabase
                    .from("projects")
                    .update({ share_enabled: checked } as any)
                    .eq("id", project.id)
                    .select()
                    .single();
                  setShareSaving(false);
                  if (error) {
                    toast.error("Erro ao atualizar compartilhamento.");
                  } else {
                    setProject(data);
                    toast.success(checked ? "Compartilhamento ativado." : "Compartilhamento desativado.");
                  }
                }}
              />
            </div>
            {project.share_enabled && project.share_token && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Link de compartilhamento</label>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={`${window.location.origin}/share/${project.share_token}`}
                    className="flex-1 px-3 py-2 text-sm rounded-md border bg-muted/40 font-mono truncate"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2 shrink-0"
                    onClick={async () => {
                      await navigator.clipboard.writeText(`${window.location.origin}/share/${project.share_token}`);
                      setShareCopied(true);
                      toast.success("Link copiado!");
                      setTimeout(() => setShareCopied(false), 2000);
                    }}
                  >
                    {shareCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    Copiar
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Project */}
      {showEditDialog && (
        <EditProjectDialog
          project={project}
          open={showEditDialog}
          onOpenChange={setShowEditDialog}
          onUpdated={(updated) => setProject(updated)}
        />
      )}

      {/* Edit Image */}
      {editingImage && (
        <EditImageDialog
          projectId={project.id}
          imageKey={editingImage.key}
          imageUrl={editingImage.url}
          imageLabel={editingImage.label}
          open={!!editingImage}
          onOpenChange={(open) => { if (!open) setEditingImage(null); }}
        />
      )}
    </AppLayout>
  );
}
