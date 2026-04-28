import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
// Fallback chain — se um modelo retornar 404 (modelo não disponível para a chave),
// tenta o próximo automaticamente.
const GEMINI_IMAGE_MODELS = [
  "gemini-3.1-flash-image-preview",
  "gemini-2.5-flash-image-preview",
  "gemini-2.5-flash-image",
  "gemini-2.0-flash-exp-image-generation",
];
const GEMINI_TEXT_MODELS = [
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
];
const MAX_REFERENCE_BYTES = 500_000;
const IMAGE_SIZE_STEPS = [1400, 1280, 1152, 1024, 896, 768, 640];

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

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function resizeToFit(source: Image, maxDimension: number): Image {
  const scale = Math.min(maxDimension / source.width, maxDimension / source.height, 1);
  const copy = source.clone();

  if (scale >= 1) return copy;

  const targetWidth = Math.max(1, Math.round(source.width * scale));
  const targetHeight = Math.max(1, Math.round(source.height * scale));
  copy.resize(targetWidth, targetHeight);
  return copy;
}

async function optimizeImageDataUrl(bytes: Uint8Array, maxBytes = MAX_REFERENCE_BYTES): Promise<string | null> {
  try {
    const decoded = await Image.decode(bytes);

    for (const maxDimension of IMAGE_SIZE_STEPS) {
      const resized = resizeToFit(decoded, maxDimension);
      const encoded = await resized.encode(1);

      if (encoded.byteLength <= maxBytes || maxDimension === IMAGE_SIZE_STEPS[IMAGE_SIZE_STEPS.length - 1]) {
        console.log(`[REF] imagem otimizada para ${resized.width}x${resized.height} (${Math.round(encoded.byteLength / 1024)}KB)`);
        return `data:image/png;base64,${bytesToBase64(encoded)}`;
      }
    }

    return null;
  } catch (error) {
    console.error("[REF] falha ao otimizar imagem:", getErrorMessage(error));
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
    return `data:image/png;base64,${bytesToBase64(outBytes)}`;
  } catch (e) {
    console.error("[WATERMARK] aplicar:", e instanceof Error ? e.message : String(e));
    return base64Url;
  }
}

// ==================== HELPERS ====================

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchImageAsFile(url: string, filename: string, maxBytes = MAX_REFERENCE_BYTES): Promise<File | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`Ref fetch ${res.status}: ${url.substring(0, 60)}`);
      return null;
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > maxBytes) {
      console.warn(`Ref too large (${(buf.byteLength / 1024).toFixed(0)}KB), skipping`);
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

async function urlToDataUrl(url: string, maxBytes = MAX_REFERENCE_BYTES): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[REF] fetch ${res.status}: ${url.substring(0, 80)}`);
      return null;
    }

    const ct = res.headers.get("content-type") || "image/png";
    const bytes = new Uint8Array(await res.arrayBuffer());

    if (bytes.byteLength <= maxBytes) {
      return `data:${ct};base64,${bytesToBase64(bytes)}`;
    }

    console.warn(`[REF] imagem acima do limite (${Math.round(bytes.byteLength / 1024)}KB). Otimizando...`);
    return await optimizeImageDataUrl(bytes, maxBytes);
  } catch (error) {
    console.error("[REF] erro ao carregar referência:", getErrorMessage(error));
    return null;
  }
}

// ==================== GEMINI IMAGE GEN (Google AI Studio API direta) ====================
// Usa gemini-3.1-flash-image-preview — modelo multimodal que gera imagens
// fotorrealistas mantendo CONSTÂNCIA com as imagens de referência fornecidas.

function dataUrlToInlineData(dataUrl: string): { mimeType: string; data: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

function extractGeminiImageData(payload: any): string | null {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];

  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    for (const part of parts) {
      const inline = part?.inlineData || part?.inline_data;
      if (inline?.data) {
        const mimeType = inline?.mimeType || inline?.mime_type || "image/png";
        return `data:${mimeType};base64,${inline.data}`;
      }
    }
  }

  return null;
}

function extractGeminiText(payload: any): string {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  const texts: string[] = [];

  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    for (const part of parts) {
      if (typeof part?.text === "string" && part.text.trim()) texts.push(part.text.trim());
    }
  }

  return texts.join("\n").trim();
}

function logGeminiDiagnostics(scope: string, payload: any) {
  const candidate = payload?.candidates?.[0];
  console.log(`[${scope}] finishReason=${candidate?.finishReason || "unknown"} promptTokens=${payload?.usageMetadata?.promptTokenCount ?? "n/a"} totalTokens=${payload?.usageMetadata?.totalTokenCount ?? "n/a"}`);
}

async function generateImageGemini(
  apiKey: string,
  prompt: string,
  refUrls: string[],
  refLabels: string[],
): Promise<string | null> {
  const labeledPrompt = refUrls.length > 0
    ? `${prompt}\n\nREFERÊNCIAS VISUAIS FORNECIDAS (em ordem):\n${refLabels.map((l, i) => `${i + 1}. ${l}`).join("\n")}\n\nUse essas imagens como referência ABSOLUTA de cores, formato, identidade visual, arquitetura e implantação. Mantenha CONSTÂNCIA TOTAL com elas.`
    : prompt;

  const parts: Array<Record<string, unknown>> = [{ text: labeledPrompt.substring(0, 30000) }];
  const normalizedRefs = await Promise.all(refUrls.slice(0, 10).map((url) => urlToDataUrl(url)));

  normalizedRefs.forEach((dataUrl, index) => {
    if (dataUrl) {
      const inline = dataUrlToInlineData(dataUrl);
      if (inline) {
        parts.push({ inlineData: inline });
      }
    } else {
      console.warn(`[GEMINI/image] referência ignorada: ${refLabels[index] || `Ref ${index + 1}`}`);
    }
  });

  const body = JSON.stringify({
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      maxOutputTokens: 8192,
    },
  });

  console.log(`[GEMINI/image] ${parts.length - 1} refs, prompt ${labeledPrompt.length} chars`);

  for (let i = 0; i < GEMINI_IMAGE_MODELS.length; i++) {
    const model = GEMINI_IMAGE_MODELS[i];
    try {
      const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });

      if (!res.ok) {
        const err = await res.text();
        console.error(`[GEMINI/image] ${model} → ${res.status}: ${err.substring(0, 300)}`);
        const shouldFallback = res.status === 404 ||
          (res.status === 400 && /not.?found|unsupported|invalid.*model|does not exist/i.test(err));
        if (shouldFallback && i < GEMINI_IMAGE_MODELS.length - 1) {
          console.warn(`[GEMINI/image] fallback → ${GEMINI_IMAGE_MODELS[i + 1]}`);
          continue;
        }
        return null;
      }

      const data = await res.json();
      logGeminiDiagnostics(`GEMINI/image:${model}`, data);
      const imageData = extractGeminiImageData(data);
      if (imageData) {
        console.log(`[GEMINI/image] ✓ imagem gerada com ${model}`);
        return imageData;
      }
      console.error(`[GEMINI/image] ${model} resposta sem imagem: ${JSON.stringify(data).substring(0, 300)}`);
      return null;
    } catch (e) {
      console.error(`[GEMINI/image] ${model} erro:`, getErrorMessage(e));
      if (i === GEMINI_IMAGE_MODELS.length - 1) return null;
    }
  }
  return null;
}

// ==================== ANÁLISE MULTIMODAL (Gemini 2.5 Pro — API direta) ====================

function extractJsonObject(text: string): Record<string, unknown> {
  try {
    const clean = text.replace(/```json|```/gi, "").trim();
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(clean.slice(start, end + 1));
  } catch (_e) {
    // fallback abaixo
  }
  return { resumo: text };
}

function collectAssetRefs(refs: Record<string, any>): Array<{ key: string; label: string; url: string }> {
  const base = [
    ["planta", "Planta baixa — estrutura, fluxo, proporções e quantidades"],
    ["logo", "Logo — branding, cores, tipografia e identidade"],
    ["fachada_ref", "Fachada de referência — arquitetura externa e materiais"],
    ["interno_ref", "Interior de referência — acabamento, mobiliário e iluminação"],
    ["corredor_ref", "Corredores de referência — gôndolas, circulação e exposição"],
    ["caixa_ref", "Caixa/checkout de referência — atendimento e comunicação visual"],
    ["vista_superior_ref", "Vista superior de referência — leitura aérea e implantação"],
  ] as const;
  const items = base
    .map(([key, label]) => ({ key, label, url: typeof refs[key] === "string" ? refs[key] : "" }))
    .filter((item) => Boolean(item.url));
  for (const extra of normalizeExtraRefs(refs.extras).slice(0, 4)) {
    items.push({ key: "extra", label: `Referência extra — ${extra.label}`, url: extra.url });
  }
  return items;
}

async function analyzeProjectAssetsGemini(apiKey: string, refs: Record<string, any>, nome = "Mercado", cidade = "Brasil", obs = "", categorias: any[] = []): Promise<{ structural: Record<string, unknown>; visual: Record<string, unknown>; summary: string }> {
  const assets = collectAssetRefs(refs);
  const parts: Array<Record<string, unknown>> = [{
    text: `Analise profundamente TODOS os materiais enviados para o projeto "${nome}" em ${cidade || "Brasil"}.

OBSERVAÇÕES DO CLIENTE:
${obs || "Sem observações adicionais."}

CATEGORIAS/GÔNDOLAS:
${JSON.stringify(categorias || []).substring(0, 6000)}

REGRA CENTRAL:
- PLANTA = estrutura, distribuição, fluxo, quantidade e proporções.
- IMAGENS/LOGO/REFERÊNCIAS = identidade visual, materiais, mobiliário, acabamento, cores, comunicação, iluminação e nível comercial.

Retorne APENAS um JSON válido com esta estrutura:
{
  "structural_analysis": {
    "layout": "...",
    "setores": [],
    "fluxo": "...",
    "medidas": [],
    "quantidade_elementos": {},
    "restricoes_obrigatorias": []
  },
  "visual_identity": {
    "estilo_fachada": "...",
    "estilo_interno": "...",
    "cores_predominantes": [],
    "materiais": [],
    "iluminacao": "...",
    "comunicacao_visual": "...",
    "tipo_exposicao": "...",
    "tipo_gondolas": "...",
    "acabamento_comercial": "...",
    "perfil": "premium | atacarejo | popular | bairro funcional"
  },
  "summary": "síntese objetiva para orientar prompts"
}

Não ignore nenhuma referência. Se algum item não existir, marque como "não enviado" e inferir somente o mínimo comercial coerente.`,
  }];

  const dataUrls = await Promise.all(assets.slice(0, 10).map((asset) => urlToDataUrl(asset.url)));
  dataUrls.forEach((dataUrl, index) => {
    const inline = dataUrl ? dataUrlToInlineData(dataUrl) : null;
    if (inline) {
      parts.push({ text: `Referência ${index + 1}: ${assets[index].label}` });
      parts.push({ inlineData: inline });
    }
  });

  const requestBody = JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { maxOutputTokens: 8192 } });

  for (let i = 0; i < GEMINI_TEXT_MODELS.length; i++) {
    const model = GEMINI_TEXT_MODELS[i];
    try {
      const res = await fetch(`${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: requestBody });
      if (!res.ok) {
        const errText = await res.text();
        const shouldFallback = res.status === 404 || (res.status === 400 && /not.?found|unsupported|invalid.*model|does not exist/i.test(errText));
        if (shouldFallback && i < GEMINI_TEXT_MODELS.length - 1) continue;
        return { structural: {}, visual: {}, summary: "" };
      }
      const data = await res.json();
      logGeminiDiagnostics(`ASSETS/gemini:${model}`, data);
      const text = extractGeminiText(data);
      const parsed = extractJsonObject(text);
      return {
        structural: (parsed.structural_analysis as Record<string, unknown>) || { resumo: text },
        visual: (parsed.visual_identity as Record<string, unknown>) || { resumo: text },
        summary: typeof parsed.summary === "string" ? parsed.summary : text,
      };
    } catch (e) {
      console.error(`[ASSETS] ${model} erro:`, getErrorMessage(e));
    }
  }
  return { structural: {}, visual: {}, summary: "" };
}

async function analyzeFloorPlanGemini(apiKey: string, plantaUrl?: string, nome = "Mercado", cidade = "Brasil"): Promise<string> {
  if (!plantaUrl) return "";
  const dataUrl = await urlToDataUrl(plantaUrl);
  if (!dataUrl) return "";
  const inline = dataUrlToInlineData(dataUrl);
  if (!inline) return "";

  const requestBody = JSON.stringify({
    contents: [{
      role: "user",
      parts: [
        {
          text: `Analise esta PLANTA BAIXA do projeto "${nome}" em ${cidade || "Brasil"} como documento arquitetônico principal para gerar imagens internas fotorrealistas.

IMPORTANTE: a imagem é uma vista DE CIMA. Extraia restrições espaciais REAIS. A planta deve comandar a geração das cenas internas; não trate como textura, decoração ou fachada pronta.

Responda em português, objetivo, mas específico, com estes tópicos obrigatórios:
1. FOOTPRINT OBRIGATÓRIO — formato exato do prédio/terreno e orientação geral
2. MEDIDAS E PROPORÇÕES OBRIGATÓRIAS — TODAS as medidas, cotas, larguras, comprimentos, módulos visíveis (copie números explicitamente)
3. ENTRADA / SAÍDA — posição da entrada principal, saída e sentido provável do fluxo
4. CAIXAS / CHECKOUTS — quantidade real visível, posição exata e orientação
5. GÔNDOLAS CENTRAIS — quantidade real de linhas/ilhas, orientação, comprimento proporcional e espaçamentos
6. ILHAS PROMOCIONAIS / EXPOSITORES — quantidade e posição quando visíveis
7. CORREDORES — corredores principais, secundários, largura relativa e direção de circulação
8. SETORES LATERAIS — posição de padaria, açougue, frios, hortifrúti, congelados, balcões e expositores refrigerados
9. ÁREAS DE APOIO — câmaras frias, estoque, depósito, administração, banheiros, escadas, doca e áreas técnicas
10. MAPA INTERNO LÓGICO — descreva como se fosse um mapa: frente/fundos/esquerda/direita/centro e o que existe em cada área
11. CENAS INTERNAS RECOMENDADAS — quais vistas devem ser geradas sem contradizer a planta
12. ELEMENTOS QUE NÃO PODEM SER INVENTADOS — liste o que deve permanecer fiel
13. INCERTEZAS — se algo não estiver claro, diga "não identificado" e sugira a solução comercial mais simples e coerente
14. INSTRUÇÃO FINAL — como transformar a vista superior em render 3D interno coerente

Se algo não estiver claro, diga "não identificado".`,
        },
        { inlineData: inline },
      ],
    }],
    generationConfig: { maxOutputTokens: 4096 },
  });

  for (let i = 0; i < GEMINI_TEXT_MODELS.length; i++) {
    const model = GEMINI_TEXT_MODELS[i];
    try {
      const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`[PLANTA/gemini] ${model} → ${res.status}: ${errText.substring(0, 300)}`);
        const shouldFallback = res.status === 404 ||
          (res.status === 400 && /not.?found|unsupported|invalid.*model|does not exist/i.test(errText));
        if (shouldFallback && i < GEMINI_TEXT_MODELS.length - 1) {
          console.warn(`[PLANTA/gemini] fallback → ${GEMINI_TEXT_MODELS[i + 1]}`);
          continue;
        }
        return "";
      }

      const data = await res.json();
      logGeminiDiagnostics(`PLANTA/gemini:${model}`, data);
      const text = extractGeminiText(data);
      if (text) console.log(`[PLANTA] resumo (${model}): ${text.substring(0, 200)}...`);
      return text;
    } catch (e) {
      console.error(`[PLANTA] ${model} erro:`, getErrorMessage(e));
      if (i === GEMINI_TEXT_MODELS.length - 1) return "";
    }
  }
  return "";
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
    sceneType === "interno"
      ? "PLANTA BAIXA — REFERÊNCIA ESTRUTURAL PRINCIPAL E OBRIGATÓRIA. A imagem interna DEVE nascer dela: entrada, caixas, gôndolas, corredores, setores, balcões, frios, câmaras, depósitos, banheiros e fluxo."
      : "PLANTA BAIXA / IMPLANTAÇÃO — REFERÊNCIA ESTRUTURAL MÁXIMA. Prédio, acessos, entrada, gôndolas, recuos e estacionamento DEVEM nascer dela.");

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

${plantaResumo ? `MAPA INTERNO EXTRAÍDO DA PLANTA — REFERÊNCIA ESTRUTURAL PRINCIPAL E OBRIGATÓRIA:\n${plantaResumo}\n` : ""}
${medidas ? `MEDIDAS EXTRAÍDAS DA PLANTA (OBRIGATÓRIO RESPEITAR):\n${medidas}\n` : ""}

HIERARQUIA DE PRIORIDADE: FIDELIDADE À PLANTA > OBSERVAÇÕES DO CLIENTE > IDENTIDADE VISUAL > ESTÉTICA CRIATIVA.

REGRAS DE CONSTÂNCIA ARQUITETÔNICA (OBRIGATÓRIO):
1. A PLANTA BAIXA define EXATAMENTE: entrada, saída, quantidade e posição dos caixas, número de gôndolas centrais, ilhas promocionais, largura/comprimento dos corredores, direção de circulação, setores laterais e áreas de apoio.
2. Cada cena deve representar uma área REAL detectada na planta; não gere ambiente genérico.
3. Respeite posições relativas: frente/fundos/esquerda/direita/centro conforme o mapa interno extraído.
4. Medidas numéricas, cotas e proporções = restrição VINCULANTE.
5. Se algum setor não estiver claro, não invente estrutura complexa: use solução comercial simples, plausível e coerente com a planta.
6. LOGO ou, se não houver logo, FACHADA JÁ GERADA define placas internas, sinalização, nome do mercado e cores das gôndolas.
7. Se houver referência de gôndola, COPIE FIELMENTE modelo, prateleiras e disposição.
8. Produtos brasileiros REAIS de marcas conhecidas (Nestlé, Sadia, Perdigão, Ypê, OMO).

CHECKLIST OBRIGATÓRIO ANTES DE GERAR: confirme visualmente que a imagem respeita quantidade real de caixas, quantidade real de gôndolas, corredores, setores, fluxo interno, balcões, refrigerados, câmaras/estoques quando visíveis e escala proporcional.

NEGATIVE PROMPT OBRIGATÓRIO: não alterar layout, não criar corredores extras, não mudar caixas de posição, não remover setores, não adicionar setores falsos, não distorcer proporções, não criar arquitetura inconsistente, não gerar maquete, não criar imagem genérica, não ignorar planta baixa, não mostrar linhas/cotas de blueprint na cena final.

ESTILO: fotorrealismo extremo, iluminação comercial fluorescente branca, piso cerâmico claro.

CENA: ${scene}`;
}

function promptVistaSuperiorBase(nome: string, cidade: string, obs: string, structural: Record<string, unknown>, visual: Record<string, unknown>, summary = ""): string {
  return `Renderização 3D FOTORREALISTA em VISTA SUPERIOR TOP-DOWN 90° do supermercado "${nome}" em ${cidade || "Brasil"}.

OBJETIVO: gerar o MAPA VISUAL BASE para aprovação do usuário antes das demais cenas.

OBSERVAÇÕES DO CLIENTE:
${obs || "Sem observações adicionais."}

ANÁLISE ESTRUTURAL OBRIGATÓRIA (PLANTA = ESTRUTURA):
${JSON.stringify(structural, null, 2).substring(0, 10000)}

ANÁLISE VISUAL OBRIGATÓRIA (IMAGENS = IDENTIDADE):
${JSON.stringify(visual, null, 2).substring(0, 10000)}

SÍNTESE MULTIMODAL:
${summary}

REGRAS ABSOLUTAS:
1. A planta define layout, setores, fluxo, quantidades, proporções, entrada, caixas, corredores, gôndolas e áreas de apoio.
2. As referências visuais definem materiais, cores, iluminação, comunicação visual, fachada, mobiliário, gôndolas e nível comercial.
3. A logo define branding; se não houver logo, use a identidade visual sugerida pela fachada/referências.
4. Não gerar imagem genérica, não desenhar blueprint, não mostrar cotas técnicas, não ignorar referências.
5. A imagem deve parecer uma loja real vista de cima, com telhado/parcial corte arquitetônico coerente e leitura clara do interior.

RESULTADO: uma vista superior realista, legível e aprovada como mapa base para todas as próximas imagens.`;
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
const INTERNAL_IMAGE_KEYS = new Set(["img_b_url", "img_c_url", "img_d_url", ...GONDOLA_KEYS]);

function buildAllScenes(nome: string, cidade: string, obs: string, categorias: any[], refs: Record<string, any>, plantaResumo = "", structural: Record<string, unknown> = {}, visual: Record<string, unknown> = {}): SceneTask[] {
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
      pushMandatoryRef(urls, labels, fachadaGerada, logo
        ? "FACHADA JÁ GERADA — referência ABSOLUTA de constância. Mantenha mesmas cores, letreiro, paisagem externa e identidade arquitetônica."
        : "FACHADA JÁ GERADA — NÃO HÁ LOGO ENVIADA. Use o letreiro, nome, cores e identidade criados na fachada como identidade visual obrigatória do interior.");
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
    const hybridContext = `\n\nBASE ESTRUTURAL APROVADA:\n${JSON.stringify(structural, null, 2).substring(0, 8000)}\n\nBASE VISUAL APROVADA:\n${JSON.stringify(visual, null, 2).substring(0, 8000)}\n\nMantenha coerência total com a vista superior/mapa base quando fornecida.`;
    if (s.type === "externo") prompt = promptExterno(nome, cidade, obs, s.scene, plantaResumo) + hybridContext;
    else if (s.type === "interno") prompt = promptInterno(nome, cidade, obs, s.scene, plantaResumo) + hybridContext;
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
    if (fachadaGerada) pushMandatoryRef(urls, labels, fachadaGerada, logo
      ? "FACHADA JÁ GERADA — identidade visual continua igual."
      : "FACHADA JÁ GERADA — NÃO HÁ LOGO ENVIADA. Use o letreiro, nome, cores e identidade criados na fachada como identidade visual obrigatória das gôndolas e placas internas.");
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
      prompt: promptInterno(nome, cidade, obs, gondolaScene, plantaResumo) + `\n\nBASE ESTRUTURAL APROVADA:\n${JSON.stringify(structural, null, 2).substring(0, 8000)}\n\nBASE VISUAL APROVADA:\n${JSON.stringify(visual, null, 2).substring(0, 8000)}\n\nMantenha coerência total com a vista superior/mapa base quando fornecida.`,
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

    const lovableKey = Deno.env.get("GEMINI_API_KEY");
    if (!lovableKey) {
      return new Response(JSON.stringify({ error: "GEMINI_API_KEY não configurada" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // ---- Edição individual ----
    if (tipo === "edicao" && image_key && image_url && customPrompt) {
      let base64 = await generateImageGemini(lovableKey, customPrompt, [image_url], ["IMAGEM ORIGINAL — edite conforme instruções"]);
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
    const plantaResumo = floor_plan_summary || await analyzeFloorPlanGemini(lovableKey, refs.planta, nome, cidadeVal);

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
          if (INTERNAL_IMAGE_KEYS.has(current.imgKey) && !refsComFachada.planta) {
            console.warn(`[INTERNO] ${current.sceneName} sem planta enviada; usando apenas referências disponíveis e observações.`);
          }
          let base64 = await generateImageGemini(lovableKey, current.prompt, current.refUrls, current.refLabels);

          if (base64) {
            const stamped = await applyWatermark(base64);
            const url = await uploadBase64Image(sb, project_id, current.imgKey.replace("_url", ""), stamped);
            if (url) {
              await sb.from("projects").update({ [current.imgKey]: url, updated_at: new Date().toISOString() }).eq("id", project_id);
              console.log(`✓ ${current.sceneName} concluída`);
            }
          } else {
            console.error(`✗ ${current.sceneName} — Gemini falhou`);
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
