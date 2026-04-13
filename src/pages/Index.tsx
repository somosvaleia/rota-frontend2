import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Plus, ArrowRight, Store, MapPin, Calendar } from "lucide-react";
import { useEffect, useState } from "react";
import AppLayout from "@/components/AppLayout";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

interface ProjectRow {
  id: string;
  nome_mercado: string;
  cidade: string;
  observacoes: string;
  status: string;
  created_at: string;
  img_a_url: string | null;
}

export default function Dashboard() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProjects = async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, nome_mercado, cidade, observacoes, status, created_at, img_a_url")
        .order("created_at", { ascending: false });

      if (!error && data) setProjects(data as ProjectRow[]);
      setLoading(false);
    };

    fetchProjects();

    const channel = supabase
      .channel("projects-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "projects" },
        () => {
          fetchProjects();
        }
      )
      .subscribe();

    const interval = window.setInterval(fetchProjects, 10000);

    return () => {
      window.clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, []);

  const stats = [
    { label: "Total de Projetos", value: projects.length, color: "text-foreground" },
    { label: "Em Processamento", value: projects.filter((p) => p.status === "processando").length, color: "text-warning" },
    { label: "Concluídos", value: projects.filter((p) => p.status === "concluido").length, color: "text-success" },
  ];

  return (
    <AppLayout>
      <div className="p-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between mb-8"
        >
          <div>
            <h1 className="font-display text-3xl font-bold text-foreground">Projetos</h1>
            <p className="text-muted-foreground mt-1">Gerencie seus projetos de supermercado</p>
          </div>
          <Link to="/novo-projeto">
            <Button className="gap-2">
              <Plus className="w-4 h-4" />
              Novo Projeto
            </Button>
          </Link>
        </motion.div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {stats.map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className="glass-card rounded-xl p-5"
            >
              <p className="text-xs text-muted-foreground uppercase tracking-wider">{stat.label}</p>
              <p className={`text-3xl font-display font-bold mt-1 ${stat.color}`}>{stat.value}</p>
            </motion.div>
          ))}
        </div>

        {/* Project List */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 rounded-lg bg-primary animate-pulse" />
          </div>
        ) : projects.length === 0 ? (
          <div className="glass-card rounded-xl p-12 text-center">
            <Store className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-display text-lg font-semibold mb-2">Nenhum projeto ainda</h3>
            <p className="text-sm text-muted-foreground mb-4">Crie seu primeiro projeto para começar.</p>
            <Link to="/novo-projeto">
              <Button className="gap-2">
                <Plus className="w-4 h-4" />
                Novo Projeto
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {projects.map((project, i) => (
              <motion.div
                key={project.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + i * 0.08 }}
              >
                <Link
                  to={`/projeto/${project.id}`}
                  className="glass-card rounded-xl p-5 flex items-center gap-5 group hover:glow-border transition-all block"
                >
                  <div className="w-16 h-16 rounded-lg bg-secondary flex items-center justify-center overflow-hidden shrink-0">
                    {project.img_a_url ? (
                      <img src={project.img_a_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <Store className="w-6 h-6 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <h3 className="font-display font-semibold text-foreground truncate">{project.nome_mercado}</h3>
                      <StatusBadge status={project.status as any} />
                    </div>
                    <div className="flex items-center gap-4 mt-1.5 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3 h-3" /> {project.cidade}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" /> {new Date(project.created_at).toLocaleDateString("pt-BR")}
                      </span>
                    </div>
                  </div>
                  <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                </Link>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
