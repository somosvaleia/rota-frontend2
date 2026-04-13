import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ==================== PROMPTS ====================

const PROMPT_BASE_EXTERNO = (nome: string, cidade: string, obs: string) => `
Você é um especialista em renderização arquitetônica fotorrealista de supermercados brasileiros.

PROJETO:
- Nome: ${nome}
- Cidade: ${cidade || "cidade não informada"}
${obs ? `- Observações: ${obs}` : ""}

INSTRUÇÕES CRÍTICAS DE CONSTÂNCIA:
1. LOGO (PRIORIDADE MÁXIMA): A imagem da logo enviada é a referência ABSOLUTA da identidade visual. Extraia dela:
   - Paleta de cores exata (use SOMENTE essas cores na fachada, letreiro, comunicação visual)
   - Nome do mercado exatamente como aparece na logo
   - Estilo gráfico (moderno, tradicional, etc.)
   - Aplique a logo fielmente no letreiro da fachada

2. PLANTA BAIXA (ESTRUTURA OBRIGATÓRIA): A planta baixa enviada define:
   - Dimensões e proporções exatas do prédio
   - Formato da construção (retangular, L, etc.)
   - Posição de entrada, estacionamento, áreas
   - NÃO invente uma estrutura diferente da planta

3. LOCALIZAÇÃO - ${cidade || "Brasil"}:
   - O mercado deve parecer real para esta cidade/região
   - Vegetação, clima e entorno típicos da região
   - Padrão construtivo local
   - Materiais e acabamentos comuns na região

4. REFERÊNCIA VISUAL: Se houver imagem de referência para esta vista, use como guia de estilo e composição.

REGRAS:
- Fotorrealismo extremo (parecer foto real, não render 3D)
- Arquitetura comercial brasileira real
- Sem textos aleatórios ou inventados
- Sem distorções
- Iluminação natural
`;

const PROMPT_BASE_INTERNO = (nome: string, cidade: string, obs: string) => `
Você é um especialista em renderização de interiores de supermercados brasileiros.

PROJETO:
- Nome: ${nome}
- Cidade: ${cidade || "cidade não informada"}
${obs ? `- Observações: ${obs}` : ""}

INSTRUÇÕES CRÍTICAS DE CONSTÂNCIA:
1. LOGO: Use a logo enviada para extrair a identidade visual do mercado.
   - Placas de categoria, faixas e sinalização devem usar as cores da logo
   - O nome do mercado nas placas deve ser exatamente como na logo

2. PLANTA BAIXA: A planta baixa define o layout interno:
   - Posição de corredores, caixas, seções
   - Largura dos corredores
   - Distribuição das áreas
   - SIGA a planta, não invente layout

3. LOCALIZAÇÃO - ${cidade || "Brasil"}:
   - Produtos típicos de supermercado brasileiro real
   - Marcas e embalagens brasileiras nos produtos
   - Padrão de supermercado da região

REGRAS:
- Fotorrealismo extremo
- Interior de supermercado brasileiro real
- Produtos reais e reconhecíveis
- Sem textos aleatórios
- Iluminação comercial branca/neutra
`;

const PROMPT_BASE_PRODUTO = (nome: string, cidade: string) => `
Gere uma imagem fotorrealista de um item do supermercado "${nome}" (${cidade || "Brasil"}).

REGRAS DE CONSTÂNCIA:
- Se houver logo enviada, use EXATAMENTE as cores e o design da logo
- O item deve ser SIMPLES e LOCALIZADO (padrão supermercado brasileiro comum)
- Nada sofisticado, nada importado, nada fora da realidade de um supermercado de bairro brasileiro
- Fundo neutro limpo
- Fotorrealismo total
`;

// ==================== SCENES ====================

interface FixedScene {
  key: string;
  name: string;
  refField: string;
  type: "externo" | "interno" | "produto";
  scenePrompt: string;
}

const FIXED_SCENES: FixedScene[] = [
  {
    key: "img_a_url", name: "Fachada", refField: "fachada_ref", type: "externo",
    scenePrompt: `CENA: Fachada frontal completa do supermercado.
- Vista frontal, centralizada, mostrando toda a largura da fachada
- Letreiro principal com o nome do mercado (copiar da logo)
- Cores da fachada seguindo a paleta da logo
- Estacionamento frontal se houver na planta
- Calçada, postes, vegetação local realista`,
  },
  {
    key: "img_b_url", name: "Entrada e Caixas", refField: "caixa_ref", type: "interno",
    scenePrompt: `CENA: Área de entrada e caixas do supermercado.
- Checkouts/caixas posicionados conforme a planta baixa
- Fluxo de entrada e saída visível
- Caixas com identidade visual do mercado (cores da logo)
- Sacolas plásticas simples nos caixas
- Piso, iluminação e acabamento de mercado brasileiro real`,
  },
  {
    key: "img_c_url", name: "Corredores", refField: "corredor_ref", type: "interno",
    scenePrompt: `CENA: Corredor interno do supermercado.
- Gôndolas organizadas dos dois lados
- Produtos brasileiros reais nas prateleiras
- Sinalização de categorias com as cores da logo do mercado
- Piso limpo, iluminação comercial
- Perspectiva central do corredor`,
  },
  {
    key: "img_d_url", name: "Interior / Fundo", refField: "interno_ref", type: "interno",
    scenePrompt: `CENA: Área dos fundos do supermercado (açougue/padaria/hortifruti).
- Seções perecíveis típicas de mercado brasileiro
- Balcões de atendimento com vitrine refrigerada
- Comunicação visual usando as cores da logo
- Produtos frescos brasileiros
- Layout seguindo a planta baixa`,
  },
  {
    key: "img_e_url", name: "Vista Superior", refField: "vista_superior_ref", type: "externo",
    scenePrompt: `CENA: Vista aérea/superior do supermercado.
- Drone view mostrando o telhado e entorno
- MESMA CONSTRUÇÃO da fachada, vista de cima
- Formato do prédio idêntico à planta baixa
- Estacionamento, acessos e paisagismo local
- Vegetação e entorno típicos da cidade/região`,
  },
  {
    key: "img_f_url", name: "Farda / Uniforme", refField: "", type: "produto",
    scenePrompt: `CENA: Uniforme/farda de funcionário do supermercado.
IMPORTANTE - DEVE SER SIMPLES E LOCAL:
- Camiseta polo OU camiseta básica com a logo do mercado no peito
- Cores da camiseta seguindo as cores da logo
- Avental simples por cima (opcional)
- Calça social preta ou jeans
- NADA sofisticado: é um uniforme de supermercado de bairro brasileiro
- Mostrar em manequim ou cabide, sem modelo humano
- Fundo neutro branco/cinza claro`,
  },
  {
    key: "img_g_url", name: "Sacola Plástica", refField: "", type: "produto",
    scenePrompt: `CENA: Sacola plástica do supermercado.
IMPORTANTE - DEVE SER SIMPLES E LOCAL:
- Sacola plástica SIMPLES, tipo sacolinha de supermercado brasileiro
- Logo do mercado impressa na sacola (copiar da logo enviada)
- Cores da sacola seguindo a logo
- Material plástico comum, não premium
- Tamanho padrão de supermercado
- UMA sacola, fundo neutro branco
- NÃO é sacola ecológica, NÃO é sacola de grife, é sacolinha de mercado`,
  },
  {
    key: "img_h_url", name: "Carrinho de Mercado", refField: "", type: "produto",
    scenePrompt: `CENA: Carrinho de supermercado.
- Carrinho padrão brasileiro de supermercado (metal/arame)
- Logo do mercado aplicada na parte frontal do carrinho
- Cores nos detalhes plásticos (alça, protetor) seguindo a logo
- Carrinho limpo e bem conservado
- Tamanho padrão, nada especial
- Fundo neutro ou dentro do mercado
- Carrinho REAL de mercado brasileiro, não importado`,
  },
];

const GONDOLA_KEYS = [
  "img_i_url", "img_j_url", "img_k_url", "img_l_url",
  "img_m_url", "img_n_url", "img_o_url", "img_p_url",
  "img_q_url", "img_r_url", "img_s_url", "img_t_url",
];

function buildFixedPrompt(scene: FixedScene, nome: string, cidade: string, obs: string): string {
  if (scene.type === "externo") return PROMPT_BASE_EXTERNO(nome, cidade, obs) + "\n" + scene.scenePrompt;
  if (scene.type === "interno") return PROMPT_BASE_INTERNO(nome, cidade, obs) + "\n" + scene.scenePrompt;
  return PROMPT_BASE_PRODUTO(nome, cidade) + "\n" + scene.scenePrompt;
}

function buildGondolaPrompt(
  nome: string, cidade: string, obs: string,
  categoria: { name: string; prateleiras: number; observacao?: string }
): string {
  return PROMPT_BASE_INTERNO(nome, cidade, obs) + `
CENA: Gôndola/seção de "${categoria.name}".
- Gôndola com ${categoria.prateleiras} prateleiras/níveis
- Produtos típicos de "${categoria.name}" em supermercado brasileiro REAL
- Marcas e embalagens brasileiras reconhecíveis
- Sinalização da categoria com as cores da logo do mercado
- Posição e layout coerente com a planta baixa
- Se houver imagem de referência para esta categoria, seguir o estilo
${categoria.observacao ? `- Observação: ${categoria.observacao}` : ""}
`;
}

// ==================== VERTEX AI AUTH ====================

async function getAccessToken(): Promise<string> {
  const credJson = Deno.env.get("GOOGLE_APPLICATION_CREDENTIALS_JSON");
  if (!credJson) throw new Error("GOOGLE_APPLICATION_CREDENTIALS_JSON not set");

  const creds = JSON.parse(credJson);
  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = btoa(JSON.stringify({
    iss: creds.client_email,
    sub: creds.client_email,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
    scope: "https://www.googleapis.com/auth/cloud-platform",
  }));

  const signInput = `${header}.${payload}`;

  const pemContent = creds.private_key
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\n/g, "");
  const binaryKey = Uint8Array.from(atob(pemContent), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signInput)
  );

  const sigBytes = new Uint8Array(signatureBuffer);
  let sigBinary = "";
  for (let i = 0; i < sigBytes.length; i++) sigBinary += String.fromCharCode(sigBytes[i]);
  const signature = btoa(sigBinary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const jwt = `${header.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.${payload.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.${signature}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`Token exchange failed: ${err}`);
  }

  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

// ==================== VERTEX AI HELPERS ====================

function getVertexBaseUrl(): string {
  const project = Deno.env.get("GOOGLE_CLOUD_PROJECT_ID") || "rota-489018";
  const location = Deno.env.get("GOOGLE_CLOUD_LOCATION") || "us-central1";
  return `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}`;
}

async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 3): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, options);
    if (res.ok || (res.status < 500 && res.status !== 429)) return res;
    const wait = Math.min(5000 * (attempt + 1), 30000);
    console.warn(`Attempt ${attempt + 1} failed with ${res.status}, retrying in ${wait/1000}s...`);
    if (attempt < maxRetries) await new Promise((r) => setTimeout(r, wait));
    else return res;
  }
  throw new Error("Unreachable");
}

async function urlToBase64Part(url: string): Promise<{ inlineData: { mimeType: string; data: string } } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const b64 = btoa(binary);
    const ct = res.headers.get("content-type") || "image/png";
    return { inlineData: { mimeType: ct, data: b64 } };
  } catch (e) {
    console.error("Failed to fetch reference image:", url, e);
    return null;
  }
}

// Primary: Gemini 2.0 Flash (stable version) with reference images
async function generateImageVertex(accessToken: string, prompt: string, refUrls: string[] = []): Promise<string | null> {
  // Build parts: first text instruction about references, then reference images, then the prompt
  const parts: any[] = [];

  // Add reference images with explicit instructions
  const refLabels: string[] = [];
  for (let i = 0; i < refUrls.length; i++) {
    const part = await urlToBase64Part(refUrls[i]);
    if (part) {
      // Determine what this reference is based on position/content
      let label = "Referência visual";
      if (i === 0) label = "LOGO DO MERCADO (use como identidade visual absoluta - cores, nome, estilo)";
      else if (i === 1) label = "PLANTA BAIXA (use como estrutura e layout obrigatório)";
      else label = `REFERÊNCIA VISUAL ${i} (use como guia de estilo para esta cena)`;
      
      refLabels.push(label);
      parts.push({ text: `[${label}]:` });
      parts.push(part);
    }
  }

  // Add the main prompt at the end
  if (refLabels.length > 0) {
    parts.push({ text: `\nIMPORTANTE: As imagens acima são referências OBRIGATÓRIAS. Gere a imagem seguindo fielmente essas referências.\n\n${prompt}` });
  } else {
    parts.push({ text: prompt });
  }

  const baseUrl = getVertexBaseUrl();
  
  // Try multiple models in order of preference
  const models = [
    "gemini-2.0-flash-001",
    "gemini-2.0-flash",
    "gemini-1.5-flash-002",
  ];

  for (const model of models) {
    const url = `${baseUrl}/publishers/google/models/${model}:generateContent`;
    console.log(`Trying model: ${model} with ${refUrls.length} reference images`);

    const res = await fetchWithRetry(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseModalities: ["IMAGE", "TEXT"],
          temperature: 0.4,
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`Model ${model} error:`, res.status, errText);
      continue; // try next model
    }

    const data = await res.json();
    const candidateParts = data.candidates?.[0]?.content?.parts || [];
    for (const p of candidateParts) {
      if (p.inlineData) {
        console.log(`✓ Image generated with model ${model}`);
        return `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`;
      }
    }

    console.warn(`Model ${model} returned no image data, trying next...`);
  }

  // Final fallback: Imagen 3 (no reference images, text-only)
  console.log("All Gemini models failed, trying Imagen 3 fallback (text-only)...");
  return await generateImageImagen3(accessToken, prompt);
}

async function generateImageImagen3(accessToken: string, prompt: string): Promise<string | null> {
  const baseUrl = getVertexBaseUrl();
  const url = `${baseUrl}/publishers/google/models/imagen-3.0-generate-001:predict`;

  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: {
        sampleCount: 1,
        aspectRatio: "16:9",
        safetyFilterLevel: "block_few",
      },
    }),
  });

  if (!res.ok) {
    console.error("Imagen 3 error:", res.status, await res.text());
    return null;
  }

  const data = await res.json();
  const predictions = data.predictions || [];
  if (predictions.length > 0 && predictions[0].bytesBase64Encoded) {
    return `data:image/png;base64,${predictions[0].bytesBase64Encoded}`;
  }

  console.error("No image in Imagen 3 response");
  return null;
}

// ==================== VEO VIDEO (VERTEX AI) ====================

async function generateDroneVideo(
  accessToken: string,
  imageUrl: string,
  dronePrompt: string
): Promise<string | null> {
  const imgPart = await urlToBase64Part(imageUrl);
  if (!imgPart) {
    console.error("Failed to load image for video generation");
    return null;
  }

  const baseUrl = getVertexBaseUrl();
  const generateUrl = `${baseUrl}/publishers/google/models/veo-2.0-generate-001:predictLongRunning`;

  const res = await fetchWithRetry(generateUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      instances: [{
        prompt: dronePrompt,
        image: imgPart.inlineData,
      }],
      parameters: {
        aspectRatio: "16:9",
        sampleCount: 1,
        durationSeconds: 8,
        personGeneration: "dont_allow",
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("Veo start error:", res.status, errText);
    return null;
  }

  const opData = await res.json();
  const operationName = opData.name;

  if (!operationName) {
    console.error("No operation name returned from Veo");
    return null;
  }

  console.log(`Veo operation started: ${operationName}`);

  const location = Deno.env.get("GOOGLE_CLOUD_LOCATION") || "us-central1";
  const pollUrl = `https://${location}-aiplatform.googleapis.com/v1/${operationName}`;

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 5000));

    const pollRes = await fetch(pollUrl, {
      headers: { "Authorization": `Bearer ${accessToken}` },
    });
    if (!pollRes.ok) {
      console.warn(`Poll attempt ${i} failed: ${pollRes.status}`);
      continue;
    }

    const pollData = await pollRes.json();

    if (pollData.done) {
      const videos = pollData.response?.generatedSamples || pollData.response?.videos || [];
      if (videos.length > 0) {
        const videoData = videos[0].video?.bytesBase64Encoded || videos[0].bytesBase64Encoded;
        if (videoData) {
          return `data:video/mp4;base64,${videoData}`;
        }
        const videoUri = videos[0].video?.uri || videos[0].uri;
        if (videoUri) return videoUri;
      }
      console.error("Veo completed but no video data:", JSON.stringify(pollData.response));
      return null;
    }

    if (pollData.error) {
      console.error("Veo error:", JSON.stringify(pollData.error));
      return null;
    }
  }

  console.error("Veo timed out after 5 minutes");
  return null;
}

async function uploadBase64Video(
  supabase: any, projectId: string, key: string, base64Url: string
): Promise<string | null> {
  let raw = base64Url;
  if (raw.startsWith("gs://") || raw.startsWith("https://storage.googleapis.com")) {
    try {
      const fetchUrl = raw.startsWith("gs://")
        ? `https://storage.googleapis.com/${raw.replace("gs://", "")}`
        : raw;
      const res = await fetch(fetchUrl);
      if (!res.ok) { console.error("Failed to download video from GCS"); return null; }
      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const fileName = `${projectId}/output/${key}_${Date.now()}.mp4`;
      const { error } = await supabase.storage
        .from("rota-referencias")
        .upload(fileName, bytes, { contentType: "video/mp4", upsert: true });
      if (error) { console.error(`Video upload error: ${error.message}`); return null; }
      const { data } = supabase.storage.from("rota-referencias").getPublicUrl(fileName);
      return data.publicUrl;
    } catch (e) {
      console.error("GCS download error:", e);
      return null;
    }
  }

  const base64Data = raw.replace(/^data:video\/\w+;base64,/, "");
  const videoBytes = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
  const fileName = `${projectId}/output/${key}_${Date.now()}.mp4`;

  const { error } = await supabase.storage
    .from("rota-referencias")
    .upload(fileName, videoBytes, { contentType: "video/mp4", upsert: true });

  if (error) {
    console.error(`Video upload error for ${key}:`, error.message);
    return null;
  }

  const { data } = supabase.storage.from("rota-referencias").getPublicUrl(fileName);
  return data.publicUrl;
}

// ==================== IMAGE UPLOAD ====================

async function uploadBase64Image(
  supabase: any, projectId: string, key: string, base64Url: string
): Promise<string | null> {
  const base64Data = base64Url.replace(/^data:image\/\w+;base64,/, "");
  const imageBytes = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
  const fileName = `${projectId}/output/${key}_${Date.now()}.png`;

  const { error } = await supabase.storage
    .from("rota-referencias")
    .upload(fileName, imageBytes, { contentType: "image/png", upsert: true });

  if (error) {
    console.error(`Upload error for ${key}:`, error.message);
    return null;
  }

  const { data } = supabase.storage.from("rota-referencias").getPublicUrl(fileName);
  return data.publicUrl;
}

// ==================== MAIN HANDLER ====================

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      project_id, tipo, nome_mercado, cidade, observacoes,
      categorias, imagens,
      image_key, image_url, prompt: customPrompt,
    } = await req.json();

    if (!project_id) {
      return new Response(JSON.stringify({ error: "project_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let accessToken: string;
    try {
      accessToken = await getAccessToken();
      console.log("Vertex AI access token obtained successfully");
    } catch (authErr) {
      console.error("Auth error:", authErr.message);
      return new Response(JSON.stringify({ error: `Authentication failed: ${authErr.message}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ---- Single image edit mode ----
    if (tipo === "edicao" && image_key && image_url && customPrompt) {
      console.log(`Editing single image: ${image_key}`);
      const base64Url = await generateImageVertex(accessToken, customPrompt, [image_url]);

      if (!base64Url) {
        await supabase.from("projects").update({ status: "erro", updated_at: new Date().toISOString() }).eq("id", project_id);
        return new Response(JSON.stringify({ error: "AI did not return an edited image" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const publicUrl = await uploadBase64Image(supabase, project_id, image_key.replace("_url", ""), base64Url);
      if (publicUrl) {
        await supabase.from("projects").update({
          [image_key]: publicUrl, status: "concluido", updated_at: new Date().toISOString(),
        }).eq("id", project_id);
      }

      return new Response(JSON.stringify({ success: true, new_url: publicUrl }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- Full generation ----
    console.log(`Starting full generation for project ${project_id}`);

    const refs = imagens || {};
    const nome = nome_mercado || "Mercado";
    const cidadeVal = cidade || "";
    const obsVal = observacoes || "";
    const logoUrl = refs.logo as string | undefined;
    const plantaUrl = refs.planta as string | undefined;

    console.log(`References - Logo: ${logoUrl ? "YES" : "NO"}, Planta: ${plantaUrl ? "YES" : "NO"}`);

    interface SceneTask {
      imgKey: string;
      sceneName: string;
      prompt: string;
      refImages: string[];
    }

    const sceneTasks: SceneTask[] = [];

    // Fixed scenes - always pass logo first, then planta, then scene-specific ref
    for (const scene of FIXED_SCENES) {
      const prompt = buildFixedPrompt(scene, nome, cidadeVal, obsVal);
      const refImages: string[] = [];
      if (logoUrl) refImages.push(logoUrl);
      if (plantaUrl && scene.type !== "produto") refImages.push(plantaUrl);
      const sceneRefUrl = scene.refField ? (refs[scene.refField] as string | undefined) : undefined;
      if (sceneRefUrl) refImages.push(sceneRefUrl);
      sceneTasks.push({ imgKey: scene.key, sceneName: scene.name, prompt, refImages });
    }

    // Gondola scenes
    const enabledCats = Array.isArray(categorias) ? categorias.filter((c: any) => c.enabled) : [];
    for (let i = 0; i < enabledCats.length && i < GONDOLA_KEYS.length; i++) {
      const cat = enabledCats[i];
      const prompt = buildGondolaPrompt(nome, cidadeVal, obsVal, cat);
      const refImages: string[] = [];
      if (logoUrl) refImages.push(logoUrl);
      if (plantaUrl) refImages.push(plantaUrl);
      if (cat.refImage) refImages.push(cat.refImage);
      sceneTasks.push({ imgKey: GONDOLA_KEYS[i], sceneName: `Gôndola: ${cat.name}`, prompt, refImages });
    }

    // Background processing
    const backgroundProcess = (async () => {
      let hasError = false;
      let generated = 0;
      const generatedUrls: Record<string, string> = {};
      let token = accessToken;

      for (const task of sceneTasks) {
        console.log(`Processing scene: ${task.sceneName} (${task.imgKey}) with ${task.refImages.length} refs`);
        try {
          const base64Url = await generateImageVertex(token, task.prompt, task.refImages);

          if (base64Url) {
            const publicUrl = await uploadBase64Image(supabase, project_id, task.imgKey.replace("_url", ""), base64Url);
            if (publicUrl) {
              await supabase.from("projects").update({
                [task.imgKey]: publicUrl, updated_at: new Date().toISOString(),
              }).eq("id", project_id);
              generatedUrls[task.imgKey] = publicUrl;
              console.log(`✓ ${task.sceneName} done`);
              generated++;
            }
          } else {
            console.error(`✗ ${task.sceneName} - no image returned`);
            hasError = true;
          }
        } catch (err) {
          console.error(`✗ ${task.sceneName} error:`, err.message);
          hasError = true;
        }
        // Delay between requests to avoid rate limiting
        await new Promise((r) => setTimeout(r, 3000));

        // Refresh token every 5 images
        if (generated > 0 && generated % 5 === 0) {
          try {
            token = await getAccessToken();
            console.log("Token refreshed");
          } catch (e) {
            console.warn("Token refresh failed, continuing with existing token");
          }
        }
      }

      // Refresh token before video generation
      try {
        token = await getAccessToken();
      } catch (e) {
        console.error("Failed to refresh token for video generation:", e);
      }

      // ---- VIDEO GENERATION ----
      const externalImg = generatedUrls["img_a_url"] || generatedUrls["img_e_url"];
      const internalImg = generatedUrls["img_c_url"] || generatedUrls["img_b_url"];

      if (externalImg) {
        console.log("Generating external drone video...");
        try {
          const dronePrompt = `Smooth cinematic drone flight around a Brazilian supermarket building. The camera starts from a high aerial angle, slowly descends and orbits around the building, showcasing the full facade, parking lot, and surroundings. Smooth camera movement, golden hour lighting, photorealistic, architectural visualization. No people walking. Professional real estate drone footage style.`;
          const videoResult = await generateDroneVideo(token, externalImg, dronePrompt);
          if (videoResult) {
            const videoUrl = await uploadBase64Video(supabase, project_id, "video", videoResult);
            if (videoUrl) {
              await supabase.from("projects").update({
                video_url: videoUrl, updated_at: new Date().toISOString(),
              }).eq("id", project_id);
              console.log("✓ External drone video done");
            }
          }
        } catch (err) {
          console.error("✗ External drone video error:", err.message);
        }
      }

      if (internalImg) {
        console.log("Generating internal drone video...");
        try {
          const dronePrompt = `Smooth cinematic drone walkthrough inside a Brazilian supermarket. The camera glides slowly through the aisles at eye level, showing organized shelves with products, category signage, clean floors, and warm commercial lighting. Steady and professional camera movement. Photorealistic interior visualization.`;
          const videoResult = await generateDroneVideo(token, internalImg, dronePrompt);
          if (videoResult) {
            const videoUrl = await uploadBase64Video(supabase, project_id, "video_b", videoResult);
            if (videoUrl) {
              await supabase.from("projects").update({
                video_b_url: videoUrl, updated_at: new Date().toISOString(),
              }).eq("id", project_id);
              console.log("✓ Internal drone video done");
            }
          }
        } catch (err) {
          console.error("✗ Internal drone video error:", err.message);
        }
      }

      await supabase.from("projects").update({
        status: hasError && generated === 0 ? "erro" : "concluido",
        updated_at: new Date().toISOString(),
      }).eq("id", project_id);

      console.log(`Generation complete. ${generated}/${sceneTasks.length} images + videos.`);
    })();

    // @ts-ignore
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(backgroundProcess);
    } else {
      backgroundProcess.catch((e) => console.error("Background error:", e));
    }

    return new Response(
      JSON.stringify({ success: true, message: "Generation started", total_scenes: sceneTasks.length }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Fatal error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
