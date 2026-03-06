export interface ProjectCategory {
  id: string;
  name: string;
  enabled: boolean;
  prateleiras: number;
  observacao: string;
  refImage?: string;
}

export interface Project {
  id: string;
  nome_mercado: string;
  cidade: string;
  observacoes: string;
  categorias: ProjectCategory[];
  logo_url?: string;
  planta_url?: string;
  fachada_ref_url?: string;
  interno_ref_url?: string;
  corredor_ref_url?: string;
  caixa_ref_url?: string;
  vista_superior_ref_url?: string;
  img_a_url?: string;
  img_b_url?: string;
  img_c_url?: string;
  img_d_url?: string;
  img_e_url?: string;
  video_url?: string;
  status: "rascunho" | "processando" | "concluido" | "erro";
  created_at: string;
}

export const DEFAULT_CATEGORIES: Omit<ProjectCategory, "id">[] = [
  { name: "Bebidas", enabled: true, prateleiras: 4, observacao: "" },
  { name: "Biscoitos", enabled: true, prateleiras: 3, observacao: "" },
  { name: "Massas", enabled: true, prateleiras: 2, observacao: "" },
  { name: "Enlatados", enabled: true, prateleiras: 3, observacao: "" },
  { name: "Higiene", enabled: true, prateleiras: 3, observacao: "" },
  { name: "Limpeza", enabled: true, prateleiras: 3, observacao: "" },
  { name: "Hortifruti", enabled: true, prateleiras: 2, observacao: "" },
  { name: "Açougue", enabled: true, prateleiras: 1, observacao: "" },
  { name: "Congelados", enabled: true, prateleiras: 2, observacao: "" },
  { name: "Pet", enabled: false, prateleiras: 2, observacao: "" },
  { name: "Bazar", enabled: false, prateleiras: 2, observacao: "" },
  { name: "Adega", enabled: false, prateleiras: 2, observacao: "" },
];
