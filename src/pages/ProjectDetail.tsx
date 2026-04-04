import { useParams, Link, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Download, Play, ExternalLink, Loader2, Trash2, Pencil } from "lucide-react";
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

const IMAGE_KEYS = [
  "img_a_url", "img_b_url", "img_c_url", "img_d_url", "img_e_url",
  "img_f_url", "img_g_url", "img_h_url", "img_i_url", "img_j_url",
  "img_k_url", "img_l_url", "img_m_url", "img_n_url", "img_o_url",
  "img_p_url", "img_q_url", "img_r_url", "img_s_url", "img_t_url",
] as const;

const VIDEO_KEYS = ["video_url", "video_b_url", "video_c_url"] as const;

const imageLabel = (key: string) => {
  const letter = key.replace("img_", "").replace("_url", "").toUpperCase();
  return `Imagem ${letter}`;
};

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingImage, setEditingImage] = useState<{ key: string; url: string; label: string } | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    const fetchProject = async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("id", id)
        .single();

      if (!error && data) setProject(data);
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

    return () => { supabase.removeChannel(channel); };
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

  return (
    <AppLayout>
      <div className="p-8 max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start gap-4 mb-8"
        >
          <Link to="/" className="mt-1 text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="font-display text-2xl font-bold">{project.nome_mercado}</h1>
              <StatusBadge status={project.status as any} />
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {project.cidade} • Criado em {new Date(project.created_at).toLocaleDateString("pt-BR")}
            </p>
            {project.observacoes && (
              <p className="text-sm text-secondary-foreground mt-2">{project.observacoes}</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => setShowEditDialog(true)}
            >
              <Pencil className="w-4 h-4" />
              Editar
            </Button>
            {project.status === "concluido" && (
              <Button variant="outline" className="gap-2">
                <Download className="w-4 h-4" />
                Exportar
              </Button>
            )}
            <Button
              variant="outline"
              className="gap-2 text-destructive hover:bg-destructive hover:text-destructive-foreground"
              onClick={() => setShowDeleteDialog(true)}
            >
              <Trash2 className="w-4 h-4" />
              Excluir
            </Button>
          </div>
        </motion.div>

        {/* Images */}
        {images.length > 0 && (
          <div className="space-y-6 mb-8">
            <h2 className="font-display text-lg font-semibold">Imagens Geradas ({images.length})</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
                  <div className="p-3">
                    <p className="text-sm font-medium">{imageLabel(img.key)}</p>
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
                  A IA está processando as referências e gerando as imagens e vídeos do seu supermercado. Isso pode levar alguns minutos.
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
    </AppLayout>
  );
}
