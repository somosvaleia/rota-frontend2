import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ==================== IMAGE HELPERS ====================

async function urlToBase64Part(url: string, label: string, maxBytes = 4_500_000): Promise<{ textPart: any; imgPart: any } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) { console.warn(`Ref fetch failed (${res.status}): ${url.substring(0, 60)}`); return null; }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > maxBytes) {
      console.warn(`Ref too large (${(buf.byteLength/1024).toFixed(0)}KB), skipping`);
      return null;
    }
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const b64 = btoa(binary);
    const ct = res.headers.get("content-type") || "image/png";
    return {
      textPart: { text: `[${label}]` },
      imgPart: { inlineData: { mimeType: ct, data: b64 } },
    };
  } catch (e) {
    console.error("Ref fetch error:", e);
    return null;
  }
}

// ==================== GEMINI (PRINCIPAL) ====================

async function generateImageGemini(apiKey: string, prompt: string, refUrls: string[], refLabels: string[]): Promise<string | null> {
  const parts: any[] = [];
  let loadedRefs = 0;

  for (let i = 0; i < refUrls.length; i++) {
    const label = refLabels[i] || "REFERÊNCIA";
    const ref = await urlToBase64Part(refUrls[i], label);
    if (ref) {
      parts.push(ref.textPart);
      parts.push(ref.imgPart);
      loadedRefs++;
    }
  }

  if (loadedRefs > 0) {
    parts.push({ text: `\n⚠️ INSTRUÇÃO OBRIGATÓRIA: As ${loadedRefs} imagens acima são REFERÊNCIAS ABSOLUTAS E VINCULANTES. Cada etiqueta anterior define o papel exato de cada referência. Você DEVE preservar fielmente arquitetura, paisagismo, materiais, volumetria, medidas proporcionais, posição da entrada, tipologia de gôndolas e identidade visual. Todas as cenas precisam representar O MESMO PROJETO REAL, sem reinterpretar aleatoriamente entre imagens. NÃO invente elementos fora das referências e NÃO contradiga a planta baixa resumida no prompt.\n\n${prompt}` });
  } else {
    parts.push({ text: prompt });
  }

  const models = [
    "gemini-2.5-flash-image",
    "gemini-2.0-flash-exp-image-generation",
  ];

  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    console.log(`[GEMINI] Tentando ${model} com ${loadedRefs} refs`);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: {
            responseModalities: ["IMAGE", "TEXT"],
            temperature: 0.1,
          },
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`[GEMINI] ${model} erro ${res.status}: ${errText.substring(0, 300)}`);
        continue;
      }

      const data = await res.json();
      for (const p of (data.candidates?.[0]?.content?.parts || [])) {
        if (p.inlineData) {
          console.log(`[GEMINI] ✓ Imagem gerada por ${model}`);
          return `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`;
        }
      }
      console.warn(`[GEMINI] ${model} sem dados de imagem na resposta`);
    } catch (e) {
      console.error(`[GEMINI] ${model} erro:`, e.message);
    }
  }

  return null;
}

async function analyzeFloorPlanGemini(apiKey: string, plantaUrl?: string, nome = "Mercado", cidade = "Brasil"): Promise<string> {
  if (!plantaUrl) return "";

  const plantaRef = await urlToBase64Part(
    plantaUrl,
    "PLANTA BAIXA / FOTO SATELITAL / IMPLANTAÇÃO — interprete como vista superior do terreno e do formato do mercado, NÃO como imagem a ser copiada literalmente na perspectiva final",
  );

  if (!plantaRef) return "";

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            { text: `Você vai analisar uma PLANTA BAIXA, implantação ou foto satelital do terreno do projeto "${nome}" em ${cidade || "Brasil"}.

IMPORTANTE:
- Essa imagem é uma vista DE CIMA.
- Ela representa terreno, contorno, implantação, medidas, acessos e layout.
- NÃO trate como textura, fachada pronta ou referência estética.
- O objetivo é extrair RESTRIÇÕES ESPACIAIS REAIS para construir um supermercado coerente em perspectiva 3D.
- A imagem final JAMAIS pode mostrar linhas técnicas, cotas, textos da planta ou aparência de blueprint sobreposta.

Responda em texto curto e objetivo, em português, com estes tópicos:
1. FOOTPRINT OBRIGATÓRIO — formato exato do prédio ou terreno
2. MEDIDAS E PROPORÇÕES OBRIGATÓRIAS — liste TODAS as medidas, cotas, larguras, comprimentos, módulos, proporções e quantidades visíveis na planta; se houver números, copie-os explicitamente
3. FRENTE DO MERCADO — lado que mais parece ser a fachada/entrada principal
4. ACESSOS E APOIOS — estacionamento, doca, carga, recuos, circulação externa
5. LAYOUT INTERNO OBRIGATÓRIO — entrada, portas, caixas, corredores, setores, fundos e fluxo
6. MAPA DE CONSTÂNCIA — o que precisa permanecer igual em fachada, entrada, corredores, vista superior e gôndolas para representar o mesmo projeto
7. ELEMENTOS QUE NÃO PODEM SER INVENTADOS — diga claramente o que precisa ser preservado
8. INSTRUÇÃO FINAL DE CONVERSÃO — descreva em uma frase como transformar a vista superior em render 3D coerente

Se algo não estiver claro, diga "não identificado" em vez de inventar.` },
            plantaRef.textPart,
            plantaRef.imgPart,
          ],
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 700,
        },
      }),
    });

    if (!res.ok) {
      console.error("[PLANTA] Erro na análise:", res.status, (await res.text()).substring(0, 300));
      return "";
    }

    const data = await res.json();
    const text = (data.candidates?.[0]?.content?.parts || [])
      .map((part: any) => typeof part.text === "string" ? part.text : "")
      .join("\n")
      .trim();

    if (text) console.log(`[PLANTA] Resumo estrutural gerado: ${text.substring(0, 220)}...`);
    return text;
  } catch (e) {
    console.error("[PLANTA] Falha ao analisar planta:", e.message);
    return "";
  }
}

function pushMandatoryRef(urls: string[], labels: string[], url?: string, label?: string) {
  if (!url || !label || urls.includes(url)) return;
  urls.push(url);
  labels.push(label);
}

function extractMeasurementLines(plantaResumo = ""): string {
  return plantaResumo
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /\d/.test(line))
    .join("\n");
}

// ==================== VERTEX AI (FALLBACK) ====================

async function getVertexAccessToken(): Promise<string> {
  const credJson = Deno.env.get("GOOGLE_APPLICATION_CREDENTIALS_JSON");
  if (!credJson) throw new Error("Sem credenciais Vertex");
  const creds = JSON.parse(credJson);
  const now = Math.floor(Date.now() / 1000);
  const toB64Url = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const header = toB64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = toB64Url(JSON.stringify({
    iss: creds.client_email, sub: creds.client_email,
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
    scope: "https://www.googleapis.com/auth/cloud-platform",
  }));

  const pemContent = creds.private_key.replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").replace(/\n/g, "");
  const binaryKey = Uint8Array.from(atob(pemContent), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey("pkcs8", binaryKey, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(`${header}.${payload}`));
  let sigBin = ""; const sigBytes = new Uint8Array(sig);
  for (let i = 0; i < sigBytes.length; i++) sigBin += String.fromCharCode(sigBytes[i]);

  const jwt = `${header}.${payload}.${toB64Url(sigBin)}`;
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  if (!tokenRes.ok) throw new Error(`Token failed: ${await tokenRes.text()}`);
  return (await tokenRes.json()).access_token;
}

async function generateImageVertex(accessToken: string, prompt: string): Promise<string | null> {
  const project = Deno.env.get("GOOGLE_CLOUD_PROJECT_ID") || "rota-489018";
  const location = Deno.env.get("GOOGLE_CLOUD_LOCATION") || "us-central1";
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/imagen-3.0-generate-001:predict`;

  console.log(`[VERTEX] Tentando Imagen 3.0 como fallback`);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: { sampleCount: 1, aspectRatio: "16:9", safetyFilterLevel: "block_few" },
      }),
    });
    if (!res.ok) {
      console.error("[VERTEX] Imagen3 erro:", res.status, await res.text());
      return null;
    }
    const data = await res.json();
    if (data.predictions?.[0]?.bytesBase64Encoded) {
      console.log("[VERTEX] ✓ Imagem gerada por Imagen 3.0");
      return `data:image/png;base64,${data.predictions[0].bytesBase64Encoded}`;
    }
  } catch (e) { console.error("[VERTEX] Imagen3 erro:", e.message); }
  return null;
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

// ==================== PROMPTS COM CONSTÂNCIA ====================

function promptExterno(nome: string, cidade: string, obs: string, scene: string, plantaResumo = ""): string {
  return `Crie uma renderização 3D FOTORREALISTA de alta qualidade de um supermercado brasileiro de bairro.

PROJETO: "${nome}" localizado em ${cidade || "Brasil"}.
${obs ? `OBSERVAÇÕES DO CLIENTE: ${obs}` : ""}

${plantaResumo ? `LEITURA ESTRUTURAL DA PLANTA/TERRENO (OBRIGATÓRIO RESPEITAR):\n${plantaResumo}\n` : ""}

REGRAS DE CONSTÂNCIA VISUAL (OBRIGATÓRIO):
1. A LOGO fornecida define TUDO: nome do mercado no letreiro, paleta de cores da fachada, identidade visual completa.
2. A PLANTA BAIXA é uma VISTA SUPERIOR do terreno/implantação do mercado. Ela NÃO é uma arte para ser copiada literalmente na imagem final.
   Você deve CONVERTER a planta em um edifício 3D construído e reproduzir FIELMENTE:
   - O footprint exato do prédio (retangular, em L, trapézio, recuos, encaixes, etc)
   - A posição da entrada principal
   - As dimensões e proporções reais
   - A frente, lateral, fundos e orientação do edifício no lote
   - O estacionamento, doca/carga e áreas externas se indicados na planta
   - A orientação do edifício
    A planta baixa NÃO é decorativa — ela é o MAPA ARQUITETÔNICO da volumetria e implantação reais do mercado.
3. A LOCALIZAÇÃO (${cidade || "Brasil"}) define o CONTEXTO: vegetação típica da região, tipo de calçada, estilo arquitetônico local.
4. Gere a cena como se um arquiteto tivesse usado a planta para modelar o mercado em 3D. O resultado deve parecer um prédio real CONSTRUÍDO a partir da planta, nunca uma colagem ou interpretação livre.

PROIBIÇÕES: NÃO renderize a planta como se fosse textura/foto colada. NÃO desenhe linhas de blueprint, cotas, legendas ou marcações técnicas. NÃO invente formato de prédio diferente da planta. NÃO mude as cores da logo. NÃO ignore a estrutura da planta baixa.

ESTILO: Fotorrealismo extremo. Qualidade de foto profissional de arquitetura. Iluminação natural.

CENA: ${scene}`;
}

function promptInterno(nome: string, cidade: string, obs: string, scene: string, plantaResumo = ""): string {
  return `Crie uma renderização 3D FOTORREALISTA de alta qualidade do INTERIOR de um supermercado brasileiro de bairro.

PROJETO: "${nome}" localizado em ${cidade || "Brasil"}.
${obs ? `OBSERVAÇÕES DO CLIENTE: ${obs}` : ""}

${plantaResumo ? `LEITURA ESTRUTURAL DA PLANTA/TERRENO (OBRIGATÓRIO RESPEITAR):\n${plantaResumo}\n` : ""}

REGRAS DE CONSTÂNCIA VISUAL (OBRIGATÓRIO):
1. A LOGO fornecida define: placas internas, sinalização de seções, cores das gôndolas e comunicação visual.
2. A PLANTA BAIXA é o PROJETO ARQUITETÔNICO visto DE CIMA. Você deve traduzi-la para um interior coerente em perspectiva 3D e reproduzir FIELMENTE:
   - A largura e comprimento dos corredores
   - A posição exata de cada seção (açougue, padaria, hortifruti, caixas) conforme indicado na planta
   - O fluxo de circulação dos clientes
   - A disposição das gôndolas e ilhas conforme o layout da planta
   - As áreas de serviço (depósito, câmara fria) nas posições da planta
   - O sentido da entrada até os fundos conforme a organização espacial da planta
    A planta baixa define EXATAMENTE onde cada coisa deve estar. NÃO invente posições e NÃO trate a planta como imagem decorativa.
3. Se uma IMAGEM DE REFERÊNCIA DE GÔNDOLA foi fornecida, copie FIELMENTE: modelo da gôndola, estilo das prateleiras, disposição dos produtos, cores. A gôndola gerada deve parecer a mesma da referência.
4. Produtos devem ser BRASILEIROS REAIS de marcas conhecidas (Nestlé, Sadia, Perdigão, Ypê, OMO, etc).
5. O interior deve parecer a materialização 3D do layout visto de cima na planta, mantendo proporções, fluxo e zoneamento.

PROIBIÇÕES: NÃO use marcas estrangeiras. NÃO invente layouts diferentes da planta. NÃO mostre a planta baixa desenhada na cena. NÃO mude cores da identidade visual. NÃO ignore referências de gôndola.

ESTILO: Fotorrealismo extremo. Iluminação comercial fluorescente branca. Piso cerâmico claro.

CENA: ${scene}`;
}

function promptProduto(nome: string, cidade: string, scene: string): string {
  return `Crie uma foto FOTORREALISTA de um item/acessório de supermercado brasileiro de bairro chamado "${nome}".

REGRAS DE CONSTÂNCIA VISUAL (OBRIGATÓRIO):
1. A LOGO fornecida define: as cores exatas e o nome/símbolo que deve aparecer no item.
2. O item deve ser SIMPLES e FUNCIONAL, típico de mercado de bairro brasileiro. NADA sofisticado ou premium.
3. Fundo neutro (branco ou cinza claro). Iluminação de estúdio profissional.

PROIBIÇÕES: NÃO invente cores diferentes da logo. NÃO faça design sofisticado/premium. Deve parecer item REAL de mercadinho.

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

const GONDOLA_KEYS = ["img_i_url","img_j_url","img_k_url","img_l_url","img_m_url","img_n_url","img_o_url","img_p_url","img_q_url","img_r_url","img_s_url","img_t_url"];

function buildAllScenes(nome: string, cidade: string, obs: string, categorias: any[], refs: Record<string, any>, plantaResumo = ""): SceneTask[] {
  const logo = refs.logo as string | undefined;
  const planta = refs.planta as string | undefined;
  const tasks: SceneTask[] = [];

  const mkRefs = (type: string, extra?: string): { urls: string[]; labels: string[] } => {
    const urls: string[] = [];
    const labels: string[] = [];
    if (logo) {
      urls.push(logo);
      labels.push("LOGO DO MERCADO — use estas cores, este nome e este símbolo em TODA a imagem");
    }
    if (extra) {
      urls.push(extra);
      labels.push("REFERÊNCIA VISUAL ADICIONAL — use como guia de estilo para esta cena específica");
    }
    return { urls, labels };
  };

  const fachadaGerada = refs.fachada_gerada as string | undefined;

  const fixed = [
    { key: "img_a_url", name: "Fachada", type: "externo", ref: "fachada_ref", scene: "Fachada frontal completa do supermercado. Vista frontal centralizada. O LETREIRO deve conter EXATAMENTE o nome e cores da LOGO. Estacionamento conforme a PLANTA BAIXA. Vegetação típica de " + cidade + ". Calçada brasileira." },
    { key: "img_b_url", name: "Entrada e Caixas", type: "interno", ref: "caixa_ref", scene: "Área interna logo após a ENTRADA PRINCIPAL do supermercado, com a frente de caixas registradoras visível. OBRIGATÓRIO ABSOLUTO: mostrar com clareza as PORTAS DE ENTRADA (portas automáticas de vidro duplas, típicas de supermercado brasileiro, com molduras de alumínio e adesivos/sinalização) ao fundo. As portas devem estar visíveis, transparentes e ATRAVÉS DELAS deve aparecer EXATAMENTE A MESMA PAISAGEM EXTERIOR DA FACHADA JÁ GERADA (mesma calçada, mesma vegetação, mesmo estacionamento, mesma luz, mesma cidade). Posição da entrada conforme PLANTA BAIXA. Quantidade de checkouts conforme PLANTA BAIXA, alinhados próximos à entrada. Tapete de entrada, sinalização com cores da LOGO. Sacolas plásticas simples com logo. Realismo fotográfico absoluto e CONSTÂNCIA TOTAL com a fachada externa de referência." },
    { key: "img_c_url", name: "Corredores", type: "interno", ref: "corredor_ref", scene: "Corredor principal interno. Gôndolas dos dois lados com produtos brasileiros. Placas de seção nas cores da LOGO. Perspectiva central profunda." },
    { key: "img_d_url", name: "Interior / Fundo", type: "interno", ref: "interno_ref", scene: "Área dos fundos: açougue, padaria e hortifruti conforme PLANTA BAIXA. Balcões refrigerados. Comunicação visual com cores da LOGO." },
    { key: "img_e_url", name: "Vista Superior", type: "externo", ref: "vista_superior_ref", scene: "Vista aérea (drone) do supermercado. O formato do telhado, fachada, cores, letreiro e implantação devem corresponder EXATAMENTE à FACHADA JÁ GERADA fornecida como referência (mesmas cores, mesmo letreiro, mesmo material de telhado, mesmo estacionamento, mesma vegetação). O footprint deve seguir a PLANTA BAIXA. Entorno urbano de " + cidade + "." },
    { key: "img_f_url", name: "Farda", type: "produto", ref: "", scene: "Uniforme de funcionário: camiseta polo SIMPLES com a LOGO bordada no peito esquerdo. Cores EXATAS da logo. Em cabide ou manequim. Fundo neutro." },
    { key: "img_g_url", name: "Sacola", type: "produto", ref: "", scene: "Sacola plástica SIMPLES de supermercado com a LOGO impressa. Plástico branco ou na cor principal da logo. Sacola comum de mercadinho brasileiro. Fundo neutro." },
    { key: "img_h_url", name: "Carrinho", type: "produto", ref: "", scene: "Carrinho de supermercado padrão brasileiro (metal/arame). LOGO aplicada na parte frontal. Detalhes na cor da logo. Carrinho SIMPLES e funcional. Fundo neutro." },
  ];

  for (const s of fixed) {
    const refUrl = s.ref ? refs[s.ref] : undefined;
    const { urls, labels } = mkRefs(s.type, refUrl);

    // CONSTÂNCIA: injeta a FACHADA já gerada como referência absoluta nas cenas que precisam bater com o exterior
    if (fachadaGerada && (s.key === "img_b_url" || s.key === "img_e_url")) {
      urls.push(fachadaGerada);
      labels.push("FACHADA JÁ GERADA DESTE MERCADO — referência ABSOLUTA de constância. Mantenha EXATAMENTE as mesmas cores, mesmo letreiro, mesma paisagem externa (calçada, vegetação, estacionamento, céu, iluminação) e mesma identidade arquitetônica. NÃO invente uma fachada diferente.");
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
      ? "REFERÊNCIA EXATA DA GÔNDOLA — copie FIELMENTE este modelo de gôndola, estilo de prateleira, disposição e tipo de produtos"
      : undefined;
    const { urls, labels } = mkRefs("interno", c.refImage);
    // Override the generic label for gondola ref with specific one
    if (c.refImage && gondolaRefLabel && labels.length > 0) {
      labels[labels.length - 1] = gondolaRefLabel;
    }
    const gondolaScene = `Gôndola/seção de "${c.name}" com EXATAMENTE ${c.prateleiras || 3} prateleiras visíveis.
${c.refImage ? "IMPORTANTE: Uma imagem de referência da gôndola foi fornecida. Você DEVE reproduzir FIELMENTE o mesmo estilo, modelo e disposição da gôndola mostrada na referência." : ""}
Produtos brasileiros REAIS de marcas conhecidas adequados para a seção "${c.name}".
Placa de sinalização da seção "${c.name}" nas cores da LOGO.
A posição desta gôndola no mercado deve seguir o layout da PLANTA BAIXA e o zoneamento descrito no resumo estrutural.
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
    console.error("Self-invoke erro:", e.message);
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

    const apiKey = Deno.env.get("GOOGLE_AI_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "GOOGLE_AI_API_KEY não configurada" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // ---- Edição de imagem individual ----
    if (tipo === "edicao" && image_key && image_url && customPrompt) {
      const base64 = await generateImageGemini(apiKey, customPrompt, [image_url], ["IMAGEM ORIGINAL — edite conforme instruções"]);
      if (!base64) return new Response(JSON.stringify({ error: "Falha ao gerar imagem" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const url = await uploadBase64Image(sb, project_id, image_key.replace("_url", ""), base64);
      if (url) await sb.from("projects").update({ [image_key]: url, status: "concluido", updated_at: new Date().toISOString() }).eq("id", project_id);
      return new Response(JSON.stringify({ success: true, new_url: url }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ---- Geração completa (recursiva por cena) ----
    const { data: project } = await sb.from("projects").select("*").eq("id", project_id).single();
    if (!project) return new Response(JSON.stringify({ error: "Projeto não encontrado" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const refs = imagens && Object.keys(imagens).length > 0 ? imagens : ((project.imagens as Record<string, any>) || {});
    const nome = nome_mercado || project.nome_mercado || "Mercado";
    const cidadeVal = cidade || project.cidade || "";
    const obsVal = observacoes || project.observacoes || "";
    const catsVal = Array.isArray(categorias) && categorias.length > 0 ? categorias : (Array.isArray(project.categorias) ? project.categorias : []);
    const plantaResumo = floor_plan_summary || await analyzeFloorPlanGemini(apiKey, refs.planta, nome, cidadeVal);

    // CONSTÂNCIA: usa a FACHADA já gerada (img_a_url) como referência obrigatória nas cenas que mostram o exterior
    const refsComFachada = { ...refs };
    if (project.img_a_url) {
      refsComFachada.fachada_gerada = project.img_a_url;
    }
    const scenes = buildAllScenes(nome, cidadeVal, obsVal, catsVal, refsComFachada, plantaResumo);

    // Marcar como processando no início
    if (stage === "start") {
      await sb.from("projects").update({ status: "processando", updated_at: new Date().toISOString() }).eq("id", project_id);
      console.log(`[START] Projeto "${nome}" em ${cidadeVal} — ${scenes.length} cenas, refs: logo=${!!refs.logo}, planta=${!!refs.planta}`);
      if (plantaResumo) console.log(`[START] Resumo estrutural da planta ativo`);
    }

    // Processar cena atual
    if (stage === "start" || stage === "images") {
      const current = scenes[scene_offset];
      if (current) {
        console.log(`[${scene_offset + 1}/${scenes.length}] ${current.sceneName} (${current.refUrls.length} refs)`);

        try {
          // 1. GEMINI (principal) — com referências visuais
          let base64 = await generateImageGemini(apiKey, current.prompt, current.refUrls, current.refLabels);

          // 2. VERTEX/IMAGEN 3 (fallback) — só texto
          if (!base64) {
            console.log(`[FALLBACK] Gemini falhou para ${current.sceneName}, tentando Vertex...`);
            try {
              const vToken = await getVertexAccessToken();
              base64 = await generateImageVertex(vToken, current.prompt);
            } catch (e) { console.error("[FALLBACK] Vertex falhou:", e.message); }
          }

          if (base64) {
            const url = await uploadBase64Image(sb, project_id, current.imgKey.replace("_url", ""), base64);
            if (url) {
              await sb.from("projects").update({ [current.imgKey]: url, updated_at: new Date().toISOString() }).eq("id", project_id);
              console.log(`✓ ${current.sceneName} concluída`);
            }
          } else {
            console.error(`✗ ${current.sceneName} — todos os provedores falharam`);
          }
        } catch (err) {
          console.error(`✗ ${current.sceneName}:`, err.message);
        }
      }

      // Próxima cena ou finalizar
      const next = scene_offset + 1;
      if (next < scenes.length) {
        await invokeNextStage({ project_id, stage: "images", scene_offset: next, floor_plan_summary: plantaResumo });
        return new Response(JSON.stringify({ stage: "images", scene: next, total: scenes.length }), { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Todas as cenas processadas -> finalizar
      await invokeNextStage({ project_id, stage: "finalize" });
      return new Response(JSON.stringify({ stage: "finalize" }), { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ---- Finalizar ----
    if (stage === "finalize") {
      const { data: final } = await sb.from("projects").select("*").eq("id", project_id).single();
      const count = IMAGE_KEYS.filter(k => Boolean(final?.[k])).length;
      const status = count > 0 ? "concluido" : "erro";
      await sb.from("projects").update({ status, updated_at: new Date().toISOString() }).eq("id", project_id);
      console.log(`✓ Finalizado: ${status} (${count} imagens geradas)`);
      return new Response(JSON.stringify({ status, images: count }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Estágio desconhecido" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("Erro fatal:", err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
