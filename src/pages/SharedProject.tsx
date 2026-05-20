import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const IMAGE_KEYS = [
  "img_a_url","img_b_url","img_c_url","img_d_url","img_e_url",
  "img_f_url","img_g_url","img_h_url","img_i_url","img_j_url",
  "img_k_url","img_l_url","img_m_url","img_n_url","img_o_url",
  "img_p_url","img_q_url","img_r_url","img_s_url","img_t_url",
] as const;

const VIDEO_KEYS = ["video_url","video_b_url","video_c_url","video_d_url","video_e_url"] as const;

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

export default function SharedProject() {
  const { token } = useParams();
  const [project, setProject] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    (async () => {
      const { data } = await supabase
        .from("projects")
        .select("*")
        .eq("share_token", token)
        .eq("share_enabled", true)
        .maybeSingle();
      setProject(data);
      setLoading(false);
    })();
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6 text-center">
        <div>
          <h1 className="font-display text-2xl font-bold mb-2">Link indisponível</h1>
          <p className="text-muted-foreground">Este projeto não está mais compartilhado ou o link é inválido.</p>
        </div>
      </div>
    );
  }

  const images = IMAGE_KEYS
    .map((key) => ({ key, url: project[key] as string | null }))
    .filter((img) => img.url);

  const videos = VIDEO_KEYS
    .map((key) => ({ key, url: project[key] as string | null }))
    .filter((v) => v.url);

  const plantaUrl: string | undefined = project.imagens?.planta;

  return (
    <div className="min-h-screen bg-background">
      <div className="p-4 sm:p-6 md:p-8 max-w-5xl mx-auto">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Visualização compartilhada</div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold break-words">{project.nome_mercado}</h1>
          <p className="text-sm text-muted-foreground mt-1">{project.cidade}</p>
          {project.observacoes && (
            <p className="text-sm text-secondary-foreground mt-3 break-words">{project.observacoes}</p>
          )}
        </motion.div>

        {plantaUrl && (
          <div className="space-y-3 mb-8">
            <h2 className="font-display text-base sm:text-lg font-semibold">Planta Baixa (Referência)</h2>
            <div className="glass-card rounded-xl overflow-hidden">
              {plantaUrl.toLowerCase().endsWith(".pdf") ? (
                <iframe src={plantaUrl} title="Planta baixa" className="w-full h-[600px]" />
              ) : (
                <img
                  src={plantaUrl}
                  alt="Planta baixa do projeto"
                  className="w-full max-h-[600px] object-contain bg-muted cursor-pointer"
                  onClick={() => setLightboxUrl(plantaUrl)}
                />
              )}
            </div>
          </div>
        )}

        {project.overhead_image_url && (
          <div className="space-y-3 mb-8">
            <h2 className="font-display text-base sm:text-lg font-semibold">Vista Superior Base</h2>
            <div
              className="glass-card rounded-xl overflow-hidden cursor-pointer"
              onClick={() => setLightboxUrl(project.overhead_image_url)}
            >
              <img src={project.overhead_image_url} alt="Vista superior base" className="w-full max-h-[520px] object-cover" />
            </div>
          </div>
        )}

        {images.length > 0 && (
          <div className="space-y-4 mb-8">
            <h2 className="font-display text-base sm:text-lg font-semibold">Imagens Geradas ({images.length})</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              {images.map((img, i) => (
                <motion.div
                  key={img.key}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.04 }}
                  className="glass-card rounded-xl overflow-hidden cursor-pointer"
                  onClick={() => setLightboxUrl(img.url!)}
                >
                  <img src={img.url!} alt={imageLabel(img.key)} className="w-full h-48 object-cover" />
                  <div className="p-3">
                    <p className="text-sm font-medium">{imageLabel(img.key)}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}

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

        <div className="text-center text-xs text-muted-foreground py-8">
          Visualização somente leitura • Rota
        </div>
      </div>

      <Dialog open={!!lightboxUrl} onOpenChange={() => setLightboxUrl(null)}>
        <DialogContent className="max-w-4xl p-2">
          <DialogHeader className="sr-only">
            <DialogTitle>Imagem ampliada</DialogTitle>
            <DialogDescription>Visualização em tamanho completo</DialogDescription>
          </DialogHeader>
          {lightboxUrl && <img src={lightboxUrl} alt="Ampliada" className="w-full h-auto rounded-lg" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
