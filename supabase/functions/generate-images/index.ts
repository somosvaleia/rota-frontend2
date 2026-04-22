import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ==================== WATERMARK ====================

let cachedWatermark: Image | null = null;

async function loadWatermark(): Promise<Image | null> {
  if (cachedWatermark) return cachedWatermark;
  try {
    const fontRes = await fetch("https://deno.land/x/imagescript@1.2.17/tests/fonts/Roboto-Regular.ttf");
    if (!fontRes.ok) return null;
    const font = new Uint8Array(await fontRes.arrayBuffer());
    const text = await Image.renderText(font, 64, "ROTA", 0xffffffff);
    const padX = 24, padY = 12;
    const wm = new Image(text.width + padX * 2, text.height + padY * 2);
    wm.fill(0x00000099);
    wm.composite(text, padX, padY);
    cachedWatermark = wm;
    return wm;
  } catch (e) {
    console.error("[WATERMARK] erro:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

async function applyWatermark(base64Url: string): Promise<string> {
  try {
    const wm = await loadWatermark();
    if (!wm) return base64Url;
    const b64 = base64Url.replace(/^data:image\/\w+;base64,/, "");
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const img = await Image.decode(bytes);
    const targetW = Math.round(img.width * 0.16);
    const ratio = wm.height / wm.width;
    const targetH = Math.round(targetW * ratio);
    const wmResized = wm.clone().resize(targetW, targetH);
    const margin = Math.round(img.width * 0.025);
    const x = img.width - targetW - margin;
    const y = img.height - targetH - margin;
    img.composite(wmResized, x, y);
    const outBytes = await img.encode(1);
    let bin = "";
    for (let i = 0; i < outBytes.length; i++) bin += String.fromCharCode(outBytes[i]);
    return `data:image/png;base64,${btoa(bin)}`;
  } catch (e) {
    console.error("[WATERMARK] aplicar:", e instanceof Error ? e.message : String(e));
    return base64Url;
  }
}

// ==================== HELPERS ====================

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchImageAsFile(url: string, filename: string, maxBytes = 4_000_000): Promise<File | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) { console.warn(`Ref fetch ${res.status}: ${url.substring(0, 60)}`); return null; }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > maxBytes) {
      console.warn(`Ref too large (${(buf.byteLength/1024).toFixed(0)}KB), skipping`);
      return null;
    }
    const ct = res.headers.get("content-type") || "image/png";
    const ext = ct.includes("jpeg") || ct.includes("jpg") ? "jpg" : ct.includes("webp") ? "webp" : "png";
    return new File([buf], `${filename}.${ext}`, { type: ct });
  } catch (e) {
    console.error("Ref fetch err:", e);
    return null;
  }
}

async function urlToDataUrl(url: string, maxBytes = 4_000_000): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > maxBytes) return null;
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const ct = res.headers.get("content-type") || "image/png";
    return `data:${ct};base64,${btoa(bin)}`;
  } catch { return null; }
}

// ==================== OPENAI IMAGE GEN ====================
// Usa gpt-image-1 (modelo realista da OpenAI) com referências multimodais via /images/edits
// quando há referências, ou /images/generations quando é apenas texto.

async function generateImageOpenAI(
  apiKey: string,
  prompt: string,
  refUrls: string[],
  refLabels: string[],
): Promise<string | null> {
  // Monta prompt enriquecido com descrição das referências (rótulos contam contexto à IA)
  const labeledPrompt = refUrls.length > 0
    ? `${prompt}\n\nREFERÊNCIAS VISUAIS FORNECIDAS (em ordem):\n${refLabels.map((l, i) => `${i + 1}. ${l}`).join("\n")}\n\nUse essas imagens como referência ABSOLUTA de cores, formato, identidade visual, arquitetura e implantação. Mantenha CONSTÂNCIA TOTAL com elas.`
    : prompt;

  // Carrega referências (até 4 — limite prático do gpt-image-1 edits)
  const files: File[] = [];
  for (let i = 0; i < Math.min(refUrls.length, 4); i++) {
    const f = await fetchImageAsFile(refUrls[i], `ref_${i}`);
    if (f) files.push(f);
  }

  try {
    if (files.length > 0) {
      // /images/edits — aceita múltiplas imagens como referência
      const form = new FormData();
      form.append("model", "gpt-image-1");
      form.append("prompt", labeledPrompt.substring(0, 32000));
      form.append("size", "1536x1024"); // landscape ~16:10, fotorrealista
      form.append("quality", "high");
      form.append("n", "1");
      for (const f of files) form.append("image[]", f);

      console.log(`[OPENAI/edits] ${files.length} refs, prompt ${labeledPrompt.length} chars`);
      const res = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });

      if (!res.ok) {
        const err = await res.text();
        console.error(`[OPENAI/edits] ${res.status}: ${err.substring(0, 400)}`);
        return null;
      }

      const data = await res.json();
      const b64 = data.data?.[0]?.b64_json;
      if (b64) {
        console.log(`[OPENAI/edits] ✓ imagem gerada`);
        return `data:image/png;base64,${b64}`;
      }
      return null;
    } else {
      // /images/generations — apenas texto
      console.log(`[OPENAI/gen] sem refs, prompt ${labeledPrompt.length} chars`);
      const res = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-image-1",
          prompt: labeledPrompt.substring(0, 32000),
          size: "1536x1024",
          quality: "high",
          n: 1,
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        console.error(`[OPENAI/gen] ${res.status}: ${err.substring(0, 400)}`);
        return null;
      }

      const data = await res.json();
      const b64 = data.data?.[0]?.b64_json;
      if (b64) {
        console.log(`[OPENAI/gen] ✓ imagem gerada`);
        return `data:image/png;base64,${b64}`;
      }
      return null;
    }
  } catch (e) {
    console.error("[OPENAI] erro:", getErrorMessage(e));
    return null;
  }
}

// ==================== ANÁLISE DE PLANTA (GPT-4o) ====================

async function analyzeFloorPlanOpenAI(apiKey: string, plantaUrl?: string, nome = "Mercado", cidade = "Brasil"): Promise<string> {
  if (!plantaUrl) return "";
  const dataUrl = await urlToDataUrl(plantaUrl);
  if (!dataUrl) return "";

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{
          role: "user",
          content: [
            {
              type: "text",
              text: `Analise esta PLANTA BAIXA / implantação / foto satelital do projeto "${nome}" em ${cidade || "Brasil"}.

IMPORTANTE: a imagem é uma vista DE CIMA. Extraia restrições espaciais REAIS para construir um supermercado coerente em 3D. NÃO trate como textura ou fachada pronta.

Responda em português, curto e objetivo, com estes tópicos:
1. FOOTPRINT OBRIGATÓRIO — formato exato do prédio/terreno
2. MEDIDAS E PROPORÇÕES OBRIGATÓRIAS — TODAS as medidas, cotas, larguras, comprimentos, módulos visíveis (copie números explicitamente)
3. FRENTE DO MERCADO — lado da fachada/entrada principal
4. ACESSOS E APOIOS — estacionamento, doca, recuos, circulação externa
5. LAYOUT INTERNO OBRIGATÓRIO — entrada, caixas, corredores, setores, fundos, fluxo
6. MAPA DE CONSTÂNCIA — o que precisa permanecer igual em fachada, entrada, corredores e vista superior
7. ELEMENTOS QUE NÃO PODEM SER INVENTADOS
8. INSTRUÇÃO FINAL — como transformar a vista superior em render 3D coerente

Se algo não estiver claro, diga "não identificado".`,
            },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        }],
        max_tokens: 800,
        temperature: 0.1,
      }),
    });

    if (!res.ok) {
      console.error("[PLANTA/openai]", res.status, (await res.text()).substring(0, 300));
      return "";
    }

    const data = await res.json();
    const text = (data.choices?.[0]?.message?.content || "").trim();
    if (text) console.log(`[PLANTA] resumo: ${text.substring(0, 200)}...`);
    return text;
  } catch (e) {
    console.error("[PLANTA] erro:", getErrorMessage(e));
    return "";
  }
}

// ==================== REFS BUILDERS ====================

function pushMandatoryRef(urls: string[], labels: string[], url?: string, label?: string) {
  if (!url || !label || urls.includes(url)) return;
  urls.push(url);
  labels.push(label);
}

function extractMeasurementLines(plantaResumo = ""): string {
  return plantaResumo
    .split(/\n+/).map((l) => l.trim()).filter(Boolean)
    .filter((l) => /\d/.test(l)).join("\n");
}

function normalizeExtraRefs(rawExtras: unknown): Array<{ label: string; url: string }> {
  if (!Array.isArray(rawExtras)) return [];
  return rawExtras
    .filter((item): item is { label?: unknown; url?: unknown } => Boolean(item && typeof item === "object"))
    .map((item, index) => ({
      label: typeof item.label === "string" && item.label.trim() ? item.label.trim() : `Anexo ${index + 1}`,
      url: typeof item.url === "string" ? item.url : "",
    }))
    .filter((item) => Boolean(item.url));
}

function pushProjectContextRefs(
  urls: string[],
  labels: string[],
  refs: Record<string, any>,
  sceneType: "externo" | "interno" | "produto",
) {
  if (sceneType === "produto") return;
  pushMandatoryRef(urls, labels, refs.planta as string | undefined,
    "PLANTA BAIXA / IMPLANTAÇÃO — REFERÊNCIA ESTRUTURAL MÁXIMA. Prédio, acessos, entrada, gôndolas, recuos e estacionamento DEVEM nascer dela.");

  const extras = normalizeExtraRefs(refs.extras);
  for (const [index, extra] of extras.slice(0, 3).entries()) {
    pushMandatoryRef(urls, labels, extra.url,
      `ANEXO DO CLIENTE ${index + 1} (${extra.label}) — evidência REAL do mercado/terreno. Preserve elementos. Se for mercado existente, REFORME o mesmo, não invente outro.`);
  }
}

// ==================== PROMPTS ====================

function promptExterno(nome: string, cidade: string, obs: string, scene: string, plantaResumo = ""): string {
  const medidas = extractMeasurementLines(plantaResumo);
  return `Renderização 3D FOTORREALISTA de alta qualidade de um supermercado brasileiro de bairro.

PROJETO: "${nome}" em ${cidade || "Brasil"}.
${obs ? `OBSERVAÇÕES: ${obs}` : ""}

${plantaResumo ? `LEITURA ESTRUTURAL DA PLANTA (OBRIGATÓRIO):\n${plantaResumo}\n` : ""}
${medidas ? `MEDIDAS EXTRAÍDAS DA PLANTA (OBRIGATÓRIO RESPEITAR):\n${medidas}\n` : ""}

REGRAS DE CONSTÂNCIA (OBRIGATÓRIO):
1. A LOGO define cores, nome no letreiro e identidade visual da fachada.
2. A PLANTA BAIXA é vista superior. CONVERTA em edifício 3D respeitando: footprint exato, posição da entrada, dimensões/cotas reais, estacionamento e doca conforme planta.
3. ${cidade || "Brasil"} define vegetação típica, calçada e estilo arquitetônico.
4. Medidas numéricas = restrição arquitetônica VINCULANTE.
5. Resultado deve parecer prédio real CONSTRUÍDO a partir da planta.
6. Se referência mostrar mercado existente, REFORME o MESMO imóvel — não troque formato nem mova entrada.

PROIBIÇÕES: NÃO desenhe linhas de blueprint, cotas ou textos técnicos. NÃO invente formato. NÃO mude cores da logo.

ESTILO: fotorrealismo extremo, qualidade de foto profissional de arquitetura, iluminação natural.

CENA: ${scene}`;
}

function promptInterno(nome: string, cidade: string, obs: string, scene: string, plantaResumo = ""): string {
  const medidas = extractMeasurementLines(plantaResumo);
  return `Renderização 3D FOTORREALISTA do INTERIOR de um supermercado brasileiro de bairro.

PROJETO: "${nome}" em ${cidade || "Brasil"}.
${obs ? `OBSERVAÇÕES: ${obs}` : ""}

${plantaResumo ? `LEITURA ESTRUTURAL DA PLANTA (OBRIGATÓRIO):\n${plantaResumo}\n` : ""}
${medidas ? `MEDIDAS EXTRAÍDAS DA PLANTA (OBRIGATÓRIO RESPEITAR):\n${medidas}\n` : ""}

REGRAS DE CONSTÂNCIA (OBRIGATÓRIO):
1. LOGO define placas internas, sinalização e cores das gôndolas.
2. PLANTA BAIXA define EXATAMENTE: largura/comprimento dos corredores, posição de cada seção (açougue, padaria, hortifruti, caixas), fluxo de circulação, disposição das gôndolas e áreas de serviço.
3. Medidas numéricas = restrição VINCULANTE.
4. Se houver referência de gôndola, COPIE FIELMENTE modelo, prateleiras e disposição.
5. Produtos brasileiros REAIS de marcas conhecidas (Nestlé, Sadia, Perdigão, Ypê, OMO).
6. Interior deve parecer materialização 3D do layout da planta.

PROIBIÇÕES: NÃO use marcas estrangeiras. NÃO invente layouts. NÃO mostre planta desenhada na cena. NÃO ignore medidas.

ESTILO: fotorrealismo extremo, iluminação comercial fluorescente branca, piso cerâmico claro.

CENA: ${scene}`;
}

function promptProduto(nome: string, cidade: string, scene: string): string {
  return `Foto FOTORREALISTA de um item/acessório de supermercado brasileiro de bairro chamado "${nome}".

REGRAS:
1. LOGO define cores exatas e nome/símbolo no item.
2. Item SIMPLES e FUNCIONAL, típico de mercado de bairro brasileiro. NADA sofisticado.
3. Fundo neutro (branco/cinza claro). Iluminação de estúdio.

PROIBIÇÕES: NÃO invente cores. NÃO faça design premium. Item REAL de mercadinho.

CENA: ${scene}`;
}

// ==================== SCENES ====================

interface SceneTask {
  imgKey: string;
  sceneName: string;
  prompt: string;
  refUrls: string[];
  refLabels: string[];
}

const GONDOLA_KEYS = ["img_i_url","img_j_url","img_k_url","img_l_url","img_m_url","img_n_url","img_o_url","img_p_url","img_q_url","img_r_url"];

function buildAllScenes(nome: string, cidade: string, obs: string, categorias: any[], refs: Record<string, any>, plantaResumo = ""): SceneTask[] {
  const logo = refs.logo as string | undefined;
  const tasks: SceneTask[] = [];

  const mkRefs = (_type: string, extra?: string): { urls: string[]; labels: string[] } => {
    const urls: string[] = [];
    const labels: string[] = [];
    pushMandatoryRef(urls, labels, logo, "LOGO DO MERCADO — use estas cores, nome e símbolo em TODA a imagem");
    pushMandatoryRef(urls, labels, extra, "REFERÊNCIA VISUAL ADICIONAL — guia de estilo para esta cena");
    return { urls, labels };
  };

  const fachadaGerada = refs.fachada_gerada as string | undefined;
  const entradaGerada = refs.entrada_gerada as string | undefined;
  const corredoresGerada = refs.corredores_gerada as string | undefined;
  const interiorGerado = refs.interior_gerado as string | undefined;
  const vistaSuperiorGerada = refs.vista_superior_gerada as string | undefined;
  const fachadaRef = refs.fachada_ref as string | undefined;
  const internoRef = refs.interno_ref as string | undefined;
  const corredorRef = refs.corredor_ref as string | undefined;
  const caixaRef = refs.caixa_ref as string | undefined;
  const vistaSuperiorRef = refs.vista_superior_ref as string | undefined;

  const fixed = [
    { key: "img_a_url", name: "Fachada (Vista Frontal)", type: "externo", ref: "fachada_ref", scene: "VISTA FRONTAL OBRIGATÓRIA do supermercado. Renderização arquitetônica fotorrealista vista DE FRENTE (perpendicular à fachada, câmera na altura humana, sem distorção). Fachada principal centralizada e completa. Letreiro com nome e cores EXATOS da LOGO. Estacionamento e recuos conforme PLANTA. Vegetação típica de " + cidade + "." },
    { key: "img_b_url", name: "Entrada e Caixas", type: "interno", ref: "caixa_ref", scene: "Área interna logo após a ENTRADA com frente de caixas visível. OBRIGATÓRIO: portas automáticas de vidro duplas ao fundo, mostrando ATRAVÉS DELAS A MESMA paisagem da FACHADA JÁ GERADA (mesma calçada, vegetação, estacionamento). Quantidade de checkouts conforme PLANTA. Sinalização nas cores da LOGO." },
    { key: "img_c_url", name: "Corredores", type: "interno", ref: "corredor_ref", scene: "Corredor principal interno. Gôndolas dos dois lados com produtos brasileiros. Placas de seção nas cores da LOGO. Perspectiva central profunda." },
    { key: "img_d_url", name: "Interior / Fundo", type: "interno", ref: "interno_ref", scene: "Área dos fundos: açougue, padaria e hortifruti conforme PLANTA. Balcões refrigerados. Comunicação visual nas cores da LOGO." },
    { key: "img_e_url", name: "Vista Superior (Aérea)", type: "externo", ref: "vista_superior_ref", scene: "VISTA SUPERIOR OBRIGATÓRIA. Aérea perpendicular (drone DIRETAMENTE DE CIMA, top-down 90°). Footprint do prédio idêntico à PLANTA. Telhado, fachada e estacionamento devem corresponder EXATAMENTE à FACHADA JÁ GERADA. Entorno urbano de " + cidade + "." },
    { key: "img_f_url", name: "Farda", type: "produto", ref: "", scene: "Uniforme: camiseta polo SIMPLES com LOGO bordada no peito esquerdo. Cores EXATAS da logo. Em manequim. Fundo neutro." },
    { key: "img_g_url", name: "Sacola", type: "produto", ref: "", scene: "Sacola plástica SIMPLES com LOGO impressa. Plástico branco ou cor da logo. Sacola comum de mercadinho. Fundo neutro." },
    { key: "img_h_url", name: "Carrinho", type: "produto", ref: "", scene: "Carrinho de supermercado padrão brasileiro (metal/arame). LOGO frontal. Detalhes na cor da logo. SIMPLES e funcional. Fundo neutro." },
    { key: "img_s_url", name: "Vista Lateral", type: "externo", ref: "", scene: "VISTA LATERAL OBRIGATÓRIA. Renderização vista DE LADO (perpendicular à lateral). Comprimento total do prédio, alturas e recuos visíveis. Cores, materiais e telhado EXATAMENTE iguais à FACHADA JÁ GERADA e VISTA SUPERIOR. Comprimento conforme PLANTA." },
  ];

  for (const s of fixed) {
    const refUrl = s.ref ? refs[s.ref] : undefined;
    const { urls, labels } = mkRefs(s.type, refUrl);
    pushProjectContextRefs(urls, labels, refs, s.type as "externo" | "interno" | "produto");

    pushMandatoryRef(urls, labels, fachadaRef, "REFERÊNCIA DE FACHADA ENVIADA — preserve volumetria, materiais e linguagem arquitetônica.");
    if (s.type === "interno") {
      pushMandatoryRef(urls, labels, internoRef, "REFERÊNCIA INTERNA ENVIADA — preserve linguagem, materiais e iluminação.");
      pushMandatoryRef(urls, labels, corredorRef, "REFERÊNCIA DE CORREDOR ENVIADA — preserve circulação e ritmo das gôndolas.");
      pushMandatoryRef(urls, labels, caixaRef, "REFERÊNCIA DE CAIXAS ENVIADA — preserve padrão da entrada/caixas.");
    }
    if (s.key === "img_e_url") {
      pushMandatoryRef(urls, labels, vistaSuperiorRef, "REFERÊNCIA DE VISTA SUPERIOR ENVIADA — preserve leitura aérea.");
    }
    if (fachadaGerada && (s.key === "img_b_url" || s.key === "img_c_url" || s.key === "img_d_url" || s.key === "img_e_url" || s.key === "img_s_url")) {
      pushMandatoryRef(urls, labels, fachadaGerada, "FACHADA JÁ GERADA — referência ABSOLUTA de constância. Mantenha mesmas cores, letreiro, paisagem externa e identidade arquitetônica.");
    }
    if (entradaGerada && (s.key === "img_c_url" || s.key === "img_d_url" || s.key === "img_e_url")) {
      pushMandatoryRef(urls, labels, entradaGerada, "ENTRADA JÁ GERADA — preserve posição da porta, transição e fluxo inicial.");
    }
    if (corredoresGerada && (s.key === "img_d_url" || s.key === "img_e_url")) {
      pushMandatoryRef(urls, labels, corredoresGerada, "CORREDORES JÁ GERADOS — continuidade obrigatória do layout interno.");
    }
    if (interiorGerado && s.key === "img_e_url") {
      pushMandatoryRef(urls, labels, interiorGerado, "INTERIOR JÁ GERADO — vista aérea representa o MESMO edifício.");
    }
    if (vistaSuperiorGerada && s.key === "img_s_url") {
      pushMandatoryRef(urls, labels, vistaSuperiorGerada, "VISTA SUPERIOR JÁ GERADA — referência ABSOLUTA do footprint. Lateral deve corresponder EXATAMENTE.");
    }

    let prompt: string;
    if (s.type === "externo") prompt = promptExterno(nome, cidade, obs, s.scene, plantaResumo);
    else if (s.type === "interno") prompt = promptInterno(nome, cidade, obs, s.scene, plantaResumo);
    else prompt = promptProduto(nome, cidade, s.scene);
    tasks.push({ imgKey: s.key, sceneName: s.name, prompt, refUrls: urls, refLabels: labels });
  }

  const cats = Array.isArray(categorias) ? categorias.filter((c: any) => c?.enabled !== false) : [];
  for (let i = 0; i < cats.length && i < GONDOLA_KEYS.length; i++) {
    const c = cats[i];
    const gondolaRefLabel = c.refImage
      ? "REFERÊNCIA EXATA DA GÔNDOLA — copie FIELMENTE modelo, prateleiras e tipo de produtos"
      : undefined;
    const { urls, labels } = mkRefs("interno", c.refImage);
    pushProjectContextRefs(urls, labels, refs, "interno");
    pushMandatoryRef(urls, labels, internoRef, "REFERÊNCIA INTERNA ENVIADA — mantenha materiais e identidade visual.");
    pushMandatoryRef(urls, labels, corredorRef, "REFERÊNCIA DE CORREDOR ENVIADA — mantenha linguagem das gôndolas.");
    if (fachadaGerada) pushMandatoryRef(urls, labels, fachadaGerada, "FACHADA JÁ GERADA — identidade visual continua igual.");
    if (entradaGerada) pushMandatoryRef(urls, labels, entradaGerada, "ENTRADA JÁ GERADA — continuidade do layout.");
    if (corredoresGerada) pushMandatoryRef(urls, labels, corredoresGerada, "CORREDORES JÁ GERADOS — mesmo padrão espacial.");
    if (interiorGerado) pushMandatoryRef(urls, labels, interiorGerado, "INTERIOR JÁ GERADO — coerência do mesmo prédio.");
    if (c.refImage && gondolaRefLabel && labels.length > 0) labels[labels.length - 1] = gondolaRefLabel;

    const gondolaScene = `Gôndola/seção de "${c.name}" com EXATAMENTE ${c.prateleiras || 3} prateleiras visíveis.
${c.refImage ? "IMPORTANTE: referência da gôndola foi fornecida. Reproduza FIELMENTE estilo, modelo e disposição." : ""}
Produtos brasileiros REAIS adequados para "${c.name}".
Placa de sinalização nas cores da LOGO.
Posição conforme PLANTA e zoneamento.
${c.observacao || ""}`;
    tasks.push({
      imgKey: GONDOLA_KEYS[i],
      sceneName: `Gôndola: ${c.name}`,
      prompt: promptInterno(nome, cidade, obs, gondolaScene, plantaResumo),
      refUrls: urls,
      refLabels: labels,
    });
  }

  return tasks;
}

// ==================== UPLOAD ====================

async function uploadBase64Image(sb: any, projectId: string, key: string, base64Url: string): Promise<string | null> {
  const base64Data = base64Url.replace(/^data:image\/\w+;base64,/, "");
  const bytes = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
  const fileName = `${projectId}/output/${key}_${Date.now()}.png`;
  const { error } = await sb.storage.from("rota-referencias").upload(fileName, bytes, { contentType: "image/png", upsert: true });
  if (error) { console.error(`Upload ${key}:`, error.message); return null; }
  return sb.storage.from("rota-referencias").getPublicUrl(fileName).data.publicUrl;
}

// ==================== SELF-INVOKE ====================

async function invokeNextStage(payload: Record<string, unknown>) {
  try {
    const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-images`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        "apikey": Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) console.error("Self-invoke falhou:", res.status, await res.text());
    else await res.text();
  } catch (e) {
    console.error("Self-invoke erro:", getErrorMessage(e));
  }
}

// ==================== MAIN HANDLER ====================

const IMAGE_KEYS = [
  "img_a_url","img_b_url","img_c_url","img_d_url","img_e_url",
  "img_f_url","img_g_url","img_h_url","img_i_url","img_j_url",
  "img_k_url","img_l_url","img_m_url","img_n_url","img_o_url",
  "img_p_url","img_q_url","img_r_url","img_s_url","img_t_url",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { project_id, tipo, nome_mercado, cidade, observacoes, categorias, imagens, image_key, image_url, prompt: customPrompt, stage = "start", scene_offset = 0, floor_plan_summary = "" } = body;

    if (!project_id) {
      return new Response(JSON.stringify({ error: "project_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY não configurada" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // ---- Edição individual ----
    if (tipo === "edicao" && image_key && image_url && customPrompt) {
      let base64 = await generateImageOpenAI(openaiKey, customPrompt, [image_url], ["IMAGEM ORIGINAL — edite conforme instruções"]);
      if (!base64) return new Response(JSON.stringify({ error: "Falha ao gerar imagem" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      base64 = await applyWatermark(base64);
      const url = await uploadBase64Image(sb, project_id, image_key.replace("_url", ""), base64);
      if (url) await sb.from("projects").update({ [image_key]: url, status: "concluido", updated_at: new Date().toISOString() }).eq("id", project_id);
      return new Response(JSON.stringify({ success: true, new_url: url }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ---- Geração completa ----
    const { data: project } = await sb.from("projects").select("*").eq("id", project_id).single();
    if (!project) return new Response(JSON.stringify({ error: "Projeto não encontrado" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const refs = imagens && Object.keys(imagens).length > 0 ? imagens : ((project.imagens as Record<string, any>) || {});
    const nome = nome_mercado || project.nome_mercado || "Mercado";
    const cidadeVal = cidade || project.cidade || "";
    const obsVal = observacoes || project.observacoes || "";
    const catsVal = Array.isArray(categorias) && categorias.length > 0 ? categorias : (Array.isArray(project.categorias) ? project.categorias : []);
    const plantaResumo = floor_plan_summary || await analyzeFloorPlanOpenAI(openaiKey, refs.planta, nome, cidadeVal);

    const refsComFachada = { ...refs };
    if (project.img_a_url) refsComFachada.fachada_gerada = project.img_a_url;
    if (project.img_b_url) refsComFachada.entrada_gerada = project.img_b_url;
    if (project.img_c_url) refsComFachada.corredores_gerada = project.img_c_url;
    if (project.img_d_url) refsComFachada.interior_gerado = project.img_d_url;
    if (project.img_e_url) refsComFachada.vista_superior_gerada = project.img_e_url;
    const scenes = buildAllScenes(nome, cidadeVal, obsVal, catsVal, refsComFachada, plantaResumo);

    if (stage === "start") {
      await sb.from("projects").update({ status: "processando", updated_at: new Date().toISOString() }).eq("id", project_id);
      console.log(`[START] "${nome}" / ${cidadeVal} — ${scenes.length} cenas, logo=${!!refs.logo}, planta=${!!refs.planta}`);
      if (plantaResumo) console.log(`[START] resumo planta ATIVO`);
    }

    if (stage === "start" || stage === "images") {
      const current = scenes[scene_offset];
      if (current) {
        console.log(`[${scene_offset + 1}/${scenes.length}] ${current.sceneName} (${current.refUrls.length} refs)`);
        try {
          let base64 = await generateImageOpenAI(openaiKey, current.prompt, current.refUrls, current.refLabels);

          if (base64) {
            const stamped = await applyWatermark(base64);
            const url = await uploadBase64Image(sb, project_id, current.imgKey.replace("_url", ""), stamped);
            if (url) {
              await sb.from("projects").update({ [current.imgKey]: url, updated_at: new Date().toISOString() }).eq("id", project_id);
              console.log(`✓ ${current.sceneName} concluída`);
            }
          } else {
            console.error(`✗ ${current.sceneName} — OpenAI falhou`);
          }
        } catch (err) {
          console.error(`✗ ${current.sceneName}:`, getErrorMessage(err));
        }
      }

      const next = scene_offset + 1;
      if (next < scenes.length) {
        await invokeNextStage({ project_id, stage: "images", scene_offset: next, floor_plan_summary: plantaResumo });
        return new Response(JSON.stringify({ stage: "images", scene: next, total: scenes.length }), { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      await invokeNextStage({ project_id, stage: "finalize" });
      return new Response(JSON.stringify({ stage: "finalize" }), { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (stage === "finalize") {
      const { data: final } = await sb.from("projects").select("*").eq("id", project_id).single();
      const count = IMAGE_KEYS.filter(k => Boolean(final?.[k])).length;
      const status = count > 0 ? "concluido" : "erro";
      await sb.from("projects").update({ status, updated_at: new Date().toISOString() }).eq("id", project_id);
      console.log(`✓ Finalizado: ${status} (${count} imagens)`);
      return new Response(JSON.stringify({ status, images: count }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Estágio desconhecido" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const errorMessage = getErrorMessage(err);
    console.error("Erro fatal:", errorMessage);
    return new Response(JSON.stringify({ error: errorMessage }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
