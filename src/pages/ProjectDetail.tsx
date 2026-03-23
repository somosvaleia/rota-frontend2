import { useParams, Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Download, Play, ExternalLink, Loader2 } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

interface ProjectRow {
  id: string;
  nome_mercado: string;
  cidade: string;
  observacoes: string;
  categorias: any;
  imagens: any;
  status: string;
  img_a_url: string | null;
  img_b_url: string | null;
  img_c_url: string | null;
  img_d_url: string | null;
  img_e_url: string | null;
  video_url: string | null;
  created_at: string;
}

const sceneLabels: Record<string, string> = {
  img_a: "A – Fachada",
  img_b: "B – Entrada e Caixas",
  img_c: "C – Corredores Internos",
  img_d: "D – Vista Fundo → Frente",
  img_e: "E – Vista Superior",
};

export default function ProjectDetail() {
  const { id } = useParams();
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;

    const fetchProject = async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("id", id)
        .single();

      if (!error && data) setProject(data as ProjectRow);
      setLoading(false);
    };

    fetchProject();

    // Realtime for this project
    const channel = supabase
      .channel(`project-${id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "projects", filter: `id=eq.${id}` },
        (payload) => {
          setProject(payload.new as ProjectRow);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id]);

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

  const images = [
    { key: "img_a", url: project.img_a_url },
    { key: "img_b", url: project.img_b_url },
    { key: "img_c", url: project.img_c_url },
    { key: "img_d", url: project.img_d_url },
    { key: "img_e", url: project.img_e_url },
  ].filter((img) => img.url);

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
          {project.status === "concluido" && (
            <Button variant="outline" className="gap-2">
              <Download className="w-4 h-4" />
              Exportar
            </Button>
          )}
        </motion.div>

        {images.length > 0 ? (
          <div className="space-y-6">
            <h2 className="font-display text-lg font-semibold">Imagens Geradas</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {images.map((img, i) => (
                <motion.div
                  key={img.key}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.1 }}
                  className="glass-card rounded-xl overflow-hidden group"
                >
                  <div className="relative">
                    <img src={img.url!} alt={sceneLabels[img.key]} className="w-full h-56 object-cover" />
                    <div className="absolute inset-0 bg-background/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                      <Button size="sm" variant="outline" className="gap-1.5">
                        <ExternalLink className="w-3.5 h-3.5" />
                        Ampliar
                      </Button>
                    </div>
                  </div>
                  <div className="p-3">
                    <p className="text-sm font-medium">{sceneLabels[img.key]}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        ) : (
          <div className="glass-card rounded-xl p-12 text-center">
            {project.status === "processando" ? (
              <>
                <div className="w-16 h-16 rounded-full bg-warning/10 flex items-center justify-center mx-auto mb-4 animate-pulse-glow">
                  <Play className="w-6 h-6 text-warning" />
                </div>
                <h3 className="font-display text-lg font-semibold mb-2">Gerando Projeto...</h3>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  A IA está processando as referências e gerando as imagens do seu supermercado. Isso pode levar alguns minutos.
                </p>
              </>
            ) : (
              <>
                <h3 className="font-display text-lg font-semibold mb-2">Nenhuma imagem gerada</h3>
                <p className="text-sm text-muted-foreground">
                  Este projeto ainda está em rascunho. Finalize as configurações para iniciar a geração.
                </p>
              </>
            )}
          </div>
        )}

        {project.video_url && (
          <div className="mt-8 space-y-4">
            <h2 className="font-display text-lg font-semibold">Vídeo do Projeto</h2>
            <div className="glass-card rounded-xl overflow-hidden">
              <video src={project.video_url} controls className="w-full" />
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
