import { Project } from "@/types/project";

// Mock data for demonstration
export const mockProjects: Project[] = [
  {
    id: "1",
    nome_mercado: "Supermercado Bom Preço",
    cidade: "São Paulo, SP",
    observacoes: "Layout moderno com foco em sustentabilidade",
    categorias: [],
    status: "concluido",
    created_at: "2026-03-01T10:00:00Z",
    img_a_url: "https://images.unsplash.com/photo-1604719312566-8912e9227c6a?w=600&q=80",
    img_b_url: "https://images.unsplash.com/photo-1534723452862-4c874018d66d?w=600&q=80",
    img_c_url: "https://images.unsplash.com/photo-1542838132-92c53300491e?w=600&q=80",
  },
  {
    id: "2",
    nome_mercado: "Mercado Central",
    cidade: "Belo Horizonte, MG",
    observacoes: "Estilo rústico contemporâneo",
    categorias: [],
    status: "processando",
    created_at: "2026-03-04T14:30:00Z",
  },
  {
    id: "3",
    nome_mercado: "Supermercado Estrela",
    cidade: "Curitiba, PR",
    observacoes: "",
    categorias: [],
    status: "rascunho",
    created_at: "2026-03-05T09:15:00Z",
  },
];
