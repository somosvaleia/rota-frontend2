import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Store, Image, Grid3X3, Plus, Trash2 } from "lucide-react";
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
  const [extraRefs, setExtraRefs] = useState<{ id: string; label: string; url?: string }[]>([]);
  const [nextExtraId, setNextExtraId] = useState(0);

  // Step 3
  const [categorias, setCategorias] = useState<ProjectCategory[]>(
    DEFAULT_CATEGORIES.map((c, i) => ({ ...c, id: String(i) }))
  );

  const updateCategoria = (id: string, field: keyof ProjectCategory, value: any) => {
    setCategorias((prev) =>
      prev.map((c) => (c.id === id ? { ...c, [field]: value } : c))
    );
  };

  const addCategoria = () => {
    setCategorias((prev) => [
      ...prev,
      { id: `custom-${Date.now()}`, name: "", enabled: true, prateleiras: 2, observacao: "" },
    ]);
  };

  const removeCategoria = (id: string) => {
    setCategorias((prev) => prev.filter((c) => c.id !== id));
  };

  const addExtraRef = () => {
    setExtraRefs((prev) => [...prev, { id: `ref-${nextExtraId}`, label: `Referência Extra ${nextExtraId + 1}` }]);
    setNextExtraId((n) => n + 1);
  };

  const removeExtraRef = (id: string) => {
    setExtraRefs((prev) => prev.filter((r) => r.id !== id));
  };

  const updateExtraRef = (id: string, url: string | undefined) => {
    setExtraRefs((prev) => prev.map((r) => (r.id === id ? { ...r, url } : r)));
  };

  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const payload = {
        nome_mercado: nome,
        cidade,
        observacoes,
        categorias: categorias.filter((c) => c.enabled),
        imagens: {
          logo,
          planta,
          fachada_ref: fachadaRef,
          interno_ref: internoRef,
          corredor_ref: corredorRef,
          caixa_ref: caixaRef,
          vista_superior_ref: vistaRef,
          extras: extraRefs.filter((r) => r.url).map((r) => ({ label: r.label, url: r.url })),
        },
      };

      const res = await fetch("https://api.rota.valeia.space/webhook/rota/projeto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(`Erro ${res.status}`);

      navigate("/");
    } catch (err) {
      console.error("Erro ao enviar projeto:", err);
      alert("Erro ao enviar o projeto. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
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
                  {extraRefs.map((ref) => (
                    <div key={ref.id} className="relative">
                      <ImageUpload
                        label={ref.label}
                        description="Referência adicional"
                        value={ref.url}
                        onChange={(url) => updateExtraRef(ref.id, url)}
                      />
                      <button
                        onClick={() => removeExtraRef(ref.id)}
                        className="absolute top-0 right-0 w-6 h-6 rounded-full bg-destructive/80 text-destructive-foreground flex items-center justify-center hover:bg-destructive transition-colors"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
                <Button variant="outline" onClick={addExtraRef} className="gap-2 w-full mt-2">
                  <Plus className="w-4 h-4" />
                  Adicionar Imagem de Referência
                </Button>
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
                          {cat.id.startsWith("custom-") ? (
                            <Input
                              value={cat.name}
                              onChange={(e) => updateCategoria(cat.id, "name", e.target.value)}
                              placeholder="Nome da categoria..."
                              className="text-sm h-8 w-40"
                            />
                          ) : (
                            <span className="font-medium text-sm">{cat.name}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          {cat.enabled && (
                            <>
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
                            </>
                          )}
                          {cat.id.startsWith("custom-") && (
                            <button
                              onClick={() => removeCategoria(cat.id)}
                              className="w-7 h-7 rounded-full bg-destructive/10 text-destructive flex items-center justify-center hover:bg-destructive/20 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                      {cat.enabled && (
                        <div className="mt-3 space-y-3">
                          <Input
                            value={cat.observacao}
                            onChange={(e) => updateCategoria(cat.id, "observacao", e.target.value)}
                            placeholder="Observações sobre este setor..."
                            className="text-sm h-8"
                          />
                          <div className="max-w-[200px]">
                            <ImageUpload
                              label="Ref. da Gôndola"
                              description="Imagem de referência"
                              value={cat.refImage}
                              onChange={(url) => updateCategoria(cat.id, "refImage", url)}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <Button variant="outline" onClick={addCategoria} className="gap-2 w-full mt-2">
                  <Plus className="w-4 h-4" />
                  Adicionar Categoria
                </Button>
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
