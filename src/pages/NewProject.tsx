import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Store, Image, Grid3X3 } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import ImageUpload from "@/components/ImageUpload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_CATEGORIES, ProjectCategory } from "@/types/project";

const steps = [
  { id: 1, label: "Dados do Mercado", icon: Store },
  { id: 2, label: "Imagens de Referência", icon: Image },
  { id: 3, label: "Categorias e Gôndolas", icon: Grid3X3 },
];

export default function NewProject() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);

  // Step 1
  const [nome, setNome] = useState("");
  const [cidade, setCidade] = useState("");
  const [observacoes, setObservacoes] = useState("");

  // Step 2
  const [logo, setLogo] = useState<string>();
  const [planta, setPlanta] = useState<string>();
  const [fachadaRef, setFachadaRef] = useState<string>();
  const [internoRef, setInternoRef] = useState<string>();
  const [corredorRef, setCorredorRef] = useState<string>();
  const [caixaRef, setCaixaRef] = useState<string>();
  const [vistaRef, setVistaRef] = useState<string>();

  // Step 3
  const [categorias, setCategorias] = useState<ProjectCategory[]>(
    DEFAULT_CATEGORIES.map((c, i) => ({ ...c, id: String(i) }))
  );

  const updateCategoria = (id: string, field: keyof ProjectCategory, value: any) => {
    setCategorias((prev) =>
      prev.map((c) => (c.id === id ? { ...c, [field]: value } : c))
    );
  };

  const handleSubmit = () => {
    // In the future, this will send data to n8n webhook
    console.log("Project submitted:", { nome, cidade, observacoes, categorias });
    navigate("/");
  };

  return (
    <AppLayout>
      <div className="p-8 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <button onClick={() => navigate("/")} className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="font-display text-2xl font-bold text-foreground">Novo Projeto</h1>
            <p className="text-sm text-muted-foreground">Preencha os dados para gerar o projeto</p>
          </div>
        </div>

        {/* Steps indicator */}
        <div className="flex items-center gap-2 mb-10">
          {steps.map((s, i) => (
            <div key={s.id} className="flex items-center gap-2 flex-1">
              <button
                onClick={() => setStep(s.id)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all w-full ${
                  step === s.id
                    ? "bg-primary/10 text-primary glow-border"
                    : step > s.id
                    ? "bg-success/10 text-success"
                    : "bg-secondary text-muted-foreground"
                }`}
              >
                {step > s.id ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <s.icon className="w-4 h-4" />
                )}
                <span className="hidden sm:inline">{s.label}</span>
                <span className="sm:hidden">{s.id}</span>
              </button>
              {i < steps.length - 1 && (
                <div className={`h-px w-6 shrink-0 ${step > s.id ? "bg-success" : "bg-border"}`} />
              )}
            </div>
          ))}
        </div>

        {/* Step content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
          >
            {step === 1 && (
              <div className="glass-card rounded-xl p-6 space-y-5">
                <h2 className="font-display text-lg font-semibold">Dados do Mercado</h2>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block">Nome do Mercado</label>
                    <Input
                      value={nome}
                      onChange={(e) => setNome(e.target.value)}
                      placeholder="Ex: Supermercado Bom Preço"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block">Cidade / Estado</label>
                    <Input
                      value={cidade}
                      onChange={(e) => setCidade(e.target.value)}
                      placeholder="Ex: São Paulo, SP"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block">Observações</label>
                    <Textarea
                      value={observacoes}
                      onChange={(e) => setObservacoes(e.target.value)}
                      placeholder="Detalhes do projeto, estilo desejado, referências..."
                      rows={4}
                    />
                  </div>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="glass-card rounded-xl p-6 space-y-5">
                <h2 className="font-display text-lg font-semibold">Imagens de Referência</h2>
                <p className="text-sm text-muted-foreground">
                  Envie imagens que serão usadas pela IA como base para o projeto.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <ImageUpload label="Logomarca" description="Logo do mercado" value={logo} onChange={setLogo} />
                  <ImageUpload label="Planta Baixa" description="Planta do estabelecimento" value={planta} onChange={setPlanta} />
                  <ImageUpload label="Fachada Ref." description="Referência de fachada" value={fachadaRef} onChange={setFachadaRef} />
                  <ImageUpload label="Interior Ref." description="Referência interna" value={internoRef} onChange={setInternoRef} />
                  <ImageUpload label="Corredor Ref." description="Referência de corredor" value={corredorRef} onChange={setCorredorRef} />
                  <ImageUpload label="Caixas Ref." description="Área de caixas" value={caixaRef} onChange={setCaixaRef} />
                  <ImageUpload label="Vista Superior Ref." description="Vista de cima" value={vistaRef} onChange={setVistaRef} />
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="glass-card rounded-xl p-6 space-y-5">
                <h2 className="font-display text-lg font-semibold">Categorias e Gôndolas</h2>
                <p className="text-sm text-muted-foreground">
                  Ative os setores e defina a quantidade de gôndolas.
                </p>
                <div className="space-y-3">
                  {categorias.map((cat) => (
                    <div
                      key={cat.id}
                      className={`rounded-lg border p-4 transition-all ${
                        cat.enabled ? "border-primary/30 bg-primary/5" : "border-border bg-secondary/30 opacity-60"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Switch
                            checked={cat.enabled}
                            onCheckedChange={(v) => updateCategoria(cat.id, "enabled", v)}
                          />
                          <span className="font-medium text-sm">{cat.name}</span>
                        </div>
                        {cat.enabled && (
                          <div className="flex items-center gap-3">
                            <label className="text-xs text-muted-foreground">Gôndolas:</label>
                            <Input
                              type="number"
                              min={1}
                              max={20}
                              value={cat.prateleiras}
                              onChange={(e) =>
                                updateCategoria(cat.id, "prateleiras", parseInt(e.target.value) || 1)
                              }
                              className="w-16 h-8 text-center text-sm"
                            />
                          </div>
                        )}
                      </div>
                      {cat.enabled && (
                        <div className="mt-3">
                          <Input
                            value={cat.observacao}
                            onChange={(e) => updateCategoria(cat.id, "observacao", e.target.value)}
                            placeholder="Observações sobre este setor..."
                            className="text-sm h-8"
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Navigation */}
        <div className="flex justify-between mt-8">
          <Button
            variant="outline"
            onClick={() => (step === 1 ? navigate("/") : setStep(step - 1))}
            className="gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            {step === 1 ? "Cancelar" : "Anterior"}
          </Button>

          {step < 3 ? (
            <Button onClick={() => setStep(step + 1)} className="gap-2">
              Próximo
              <ArrowRight className="w-4 h-4" />
            </Button>
          ) : (
            <Button onClick={handleSubmit} className="gap-2">
              <Check className="w-4 h-4" />
              Criar Projeto
            </Button>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
