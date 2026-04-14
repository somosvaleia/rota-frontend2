import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ==================== VERTEX AI AUTH ====================

async function getAccessToken(): Promise<string> {
  const credJson = Deno.env.get("GOOGLE_APPLICATION_CREDENTIALS_JSON");
  if (!credJson) throw new Error("GOOGLE_APPLICATION_CREDENTIALS_JSON not set");

  const creds = JSON.parse(credJson);
  const now = Math.floor(Date.now() / 1000);

  const toBase64Url = (str: string) =>
    btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const header = toBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = toBase64Url(
    JSON.stringify({
      iss: creds.client_email,
      sub: creds.client_email,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
      scope: "https://www.googleapis.com/auth/cloud-platform",
    })
  );

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
  for (let i = 0; i < sigBytes.length; i++)
    sigBinary += String.fromCharCode(sigBytes[i]);
  const signature = toBase64Url(sigBinary);

  const jwt = `${header}.${payload}.${signature}`;

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

async function urlToBase64Part(
  url: string
): Promise<{ inlineData: { mimeType: string; data: string } } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.length; i++)
      binary += String.fromCharCode(bytes[i]);
    const b64 = btoa(binary);
    const ct = res.headers.get("content-type") || "image/png";
    return { inlineData: { mimeType: ct, data: b64 } };
  } catch (e) {
    console.error("Failed to fetch reference image:", url, e);
    return null;
  }
}

async function generateImageVertex(
  accessToken: string,
  prompt: string,
  refUrls: string[] = []
): Promise<string | null> {
  const parts: any[] = [];

  // Add reference images with labels
  const refLabels = [
    "LOGO DO MERCADO - identidade visual absoluta: cores, nome, estilo gráfico",
    "PLANTA BAIXA - estrutura e layout obrigatório do prédio",
    "REFERÊNCIA VISUAL - guia de estilo e composição para esta cena",
    "REFERÊNCIA ADICIONAL",
  ];

  let loadedRefs = 0;
  for (let i = 0; i < refUrls.length; i++) {
    const part = await urlToBase64Part(refUrls[i]);
    if (part) {
      const label = refLabels[Math.min(i, refLabels.length - 1)];
      parts.push({ text: `[${label}]:` });
      parts.push(part);
      loadedRefs++;
    }
  }

  if (loadedRefs > 0) {
    parts.push({
      text: `\nIMPORTANTE: As ${loadedRefs} imagens acima são referências OBRIGATÓRIAS. A logo define cores e identidade. A planta define a estrutura. Siga-as FIELMENTE.\n\n${prompt}`,
    });
  } else {
    parts.push({ text: prompt });
  }

  const baseUrl = getVertexBaseUrl();

  // Try Gemini models that support image generation
  const models = ["gemini-2.0-flash-001", "gemini-2.0-flash"];

  for (const model of models) {
    const url = `${baseUrl}/publishers/google/models/${model}:generateContent`;
    console.log(
      `Trying ${model} with ${loadedRefs} refs for prompt: ${prompt.substring(0, 80)}...`
    );

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
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
        console.error(`${model} error ${res.status}: ${errText.substring(0, 200)}`);
        continue;
      }

      const data = await res.json();
      const candidateParts = data.candidates?.[0]?.content?.parts || [];
      for (const p of candidateParts) {
        if (p.inlineData) {
          console.log(`✓ Image from ${model}`);
          return `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`;
        }
      }
      console.warn(`${model} returned no image data`);
    } catch (e) {
      console.error(`${model} exception:`, e.message);
    }
  }

  // Fallback: Imagen 3 (text-only, no refs)
  console.log("Falling back to Imagen 3...");
  return await generateImageImagen3(accessToken, prompt);
}

async function generateImageImagen3(
  accessToken: string,
  prompt: string
): Promise<string | null> {
  const baseUrl = getVertexBaseUrl();
  const url = `${baseUrl}/publishers/google/models/imagen-3.0-generate-001:predict`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
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
      console.log("✓ Image from Imagen 3");
      return `data:image/png;base64,${predictions[0].bytesBase64Encoded}`;
    }
  } catch (e) {
    console.error("Imagen 3 exception:", e.message);
  }
  return null;
}

// ==================== STORAGE UPLOAD ====================

async function uploadBase64Image(
  supabaseClient: any,
  projectId: string,
  key: string,
  base64Url: string
): Promise<string | null> {
  const base64Data = base64Url.replace(/^data:image\/\w+;base64,/, "");
  const imageBytes = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
  const fileName = `${projectId}/output/${key}_${Date.now()}.png`;

  const { error } = await supabaseClient.storage
    .from("rota-referencias")
    .upload(fileName, imageBytes, { contentType: "image/png", upsert: true });

  if (error) {
    console.error(`Upload error for ${key}:`, error.message);
    return null;
  }

  const { data } = supabaseClient.storage
    .from("rota-referencias")
    .getPublicUrl(fileName);
  return data.publicUrl;
}

// ==================== PROMPTS ====================

function buildExternoPrompt(
  nome: string,
  cidade: string,
  obs: string,
  scenePrompt: string
): string {
  return `Você é um especialista em renderização arquitetônica fotorrealista de supermercados brasileiros de bairro.

PROJETO: "${nome}" em ${cidade || "Brasil"}
${obs ? `Observações: ${obs}` : ""}

REGRAS ABSOLUTAS:
1. LOGO = IDENTIDADE: Cores da fachada, letreiro, comunicação visual DEVEM vir da logo enviada. O nome no letreiro deve ser EXATAMENTE o da logo.
2. PLANTA BAIXA = ESTRUTURA: Formato, dimensões e proporções do prédio DEVEM seguir a planta baixa. NÃO invente outra estrutura.
3. LOCALIZAÇÃO = REALIDADE: O mercado deve parecer REAL em ${cidade || "Brasil"} — vegetação, clima, materiais e padrão construtivo local.
4. Se houver imagem de referência para esta vista, use como guia de estilo e composição.

ESTILO: Fotorrealismo extremo (parecer foto real). Arquitetura comercial brasileira. Iluminação natural. Sem textos inventados. Sem distorções.

${scenePrompt}`;
}

function buildInternoPrompt(
  nome: string,
  cidade: string,
  obs: string,
  scenePrompt: string
): string {
  return `Você é um especialista em renderização de interiores de supermercados brasileiros de bairro.

PROJETO: "${nome}" em ${cidade || "Brasil"}
${obs ? `Observações: ${obs}` : ""}

REGRAS ABSOLUTAS:
1. LOGO = IDENTIDADE: Placas de categoria, faixas e sinalização DEVEM usar as cores da logo. Nome do mercado nas placas = exatamente como na logo.
2. PLANTA BAIXA = LAYOUT: Posição de corredores, caixas e seções DEVEM seguir a planta. NÃO invente layout.
3. PRODUTOS: Marcas e embalagens brasileiras REAIS. Produtos típicos de supermercado brasileiro. Nada importado ou sofisticado.

ESTILO: Fotorrealismo extremo. Interior de supermercado brasileiro real. Iluminação comercial branca/neutra.

${scenePrompt}`;
}

function buildProdutoPrompt(
  nome: string,
  cidade: string,
  scenePrompt: string
): string {
  return `Gere uma imagem fotorrealista de um item do supermercado "${nome}" (${cidade || "Brasil"}).

REGRAS:
- Use EXATAMENTE as cores e o design da logo enviada
- O item deve ser SIMPLES (padrão supermercado de bairro brasileiro)
- Nada sofisticado, nada importado, nada fora da realidade
- Fundo neutro limpo
- Fotorrealismo total

${scenePrompt}`;
}

// ==================== SCENE DEFINITIONS ====================

interface SceneTask {
  imgKey: string;
  sceneName: string;
  prompt: string;
  refImages: string[];
}

const GONDOLA_KEYS = [
  "img_i_url", "img_j_url", "img_k_url", "img_l_url",
  "img_m_url", "img_n_url", "img_o_url", "img_p_url",
  "img_q_url", "img_r_url", "img_s_url", "img_t_url",
];

function buildAllScenes(
  nome: string,
  cidade: string,
  obs: string,
  categorias: any[],
  refs: Record<string, any>
): SceneTask[] {
  const logoUrl = refs.logo as string | undefined;
  const plantaUrl = refs.planta as string | undefined;
  const tasks: SceneTask[] = [];

  const makeRefs = (
    type: "externo" | "interno" | "produto",
    extraRef?: string
  ): string[] => {
    const r: string[] = [];
    if (logoUrl) r.push(logoUrl);
    if (plantaUrl && type !== "produto") r.push(plantaUrl);
    if (extraRef) r.push(extraRef);
    return r;
  };

  // Fixed scenes
  const fixedScenes: {
    key: string;
    name: string;
    type: "externo" | "interno" | "produto";
    refField: string;
    prompt: string;
  }[] = [
    {
      key: "img_a_url",
      name: "Fachada",
      type: "externo",
      refField: "fachada_ref",
      prompt: `CENA: Fachada frontal completa do supermercado.
- Vista frontal centralizada mostrando toda a largura
- Letreiro principal com nome do mercado (copiar da logo)
- Cores da fachada seguindo a paleta da logo
- Estacionamento frontal se houver na planta
- Calçada, postes, vegetação local realista`,
    },
    {
      key: "img_b_url",
      name: "Entrada e Caixas",
      type: "interno",
      refField: "caixa_ref",
      prompt: `CENA: Área de entrada e caixas do supermercado.
- Checkouts posicionados conforme a planta baixa
- Identidade visual do mercado (cores da logo) nos caixas
- Sacolas plásticas simples
- Piso e acabamento de mercado brasileiro real`,
    },
    {
      key: "img_c_url",
      name: "Corredores",
      type: "interno",
      refField: "corredor_ref",
      prompt: `CENA: Corredor interno do supermercado.
- Gôndolas organizadas dos dois lados
- Produtos brasileiros reais nas prateleiras
- Sinalização de categorias com cores da logo
- Perspectiva central do corredor`,
    },
    {
      key: "img_d_url",
      name: "Interior / Fundo",
      type: "interno",
      refField: "interno_ref",
      prompt: `CENA: Área dos fundos (açougue/padaria/hortifruti).
- Seções perecíveis típicas de mercado brasileiro
- Balcões com vitrine refrigerada
- Comunicação visual usando cores da logo
- Layout seguindo a planta baixa`,
    },
    {
      key: "img_e_url",
      name: "Vista Superior",
      type: "externo",
      refField: "vista_superior_ref",
      prompt: `CENA: Vista aérea/superior do supermercado.
- Drone view mostrando telhado e entorno
- MESMA construção da fachada, vista de cima
- Formato do prédio idêntico à planta baixa
- Estacionamento e paisagismo local`,
    },
    {
      key: "img_f_url",
      name: "Farda / Uniforme",
      type: "produto",
      refField: "",
      prompt: `CENA: Uniforme de funcionário do supermercado.
- Camiseta polo OU básica com a logo do mercado no peito
- Cores seguindo a logo
- SIMPLES: uniforme de mercado de bairro brasileiro
- Em manequim ou cabide, sem modelo humano
- Fundo neutro`,
    },
    {
      key: "img_g_url",
      name: "Sacola Plástica",
      type: "produto",
      refField: "",
      prompt: `CENA: Sacola plástica do supermercado.
- Sacolinha plástica SIMPLES de mercado brasileiro
- Logo do mercado impressa (copiar da logo enviada)
- Cores seguindo a logo
- Material plástico comum, NÃO premium, NÃO ecológica
- UMA sacola, fundo neutro`,
    },
    {
      key: "img_h_url",
      name: "Carrinho de Mercado",
      type: "produto",
      refField: "",
      prompt: `CENA: Carrinho de supermercado.
- Carrinho padrão brasileiro (metal/arame)
- Logo do mercado na parte frontal
- Detalhes plásticos nas cores da logo
- Carrinho REAL de mercado brasileiro
- Fundo neutro ou dentro do mercado`,
    },
  ];

  for (const scene of fixedScenes) {
    const refUrl = scene.refField
      ? (refs[scene.refField] as string | undefined)
      : undefined;

    let prompt: string;
    if (scene.type === "externo")
      prompt = buildExternoPrompt(nome, cidade, obs, scene.prompt);
    else if (scene.type === "interno")
      prompt = buildInternoPrompt(nome, cidade, obs, scene.prompt);
    else prompt = buildProdutoPrompt(nome, cidade, scene.prompt);

    tasks.push({
      imgKey: scene.key,
      sceneName: scene.name,
      prompt,
      refImages: makeRefs(scene.type, refUrl),
    });
  }

  // Gondola scenes from categories
  const enabledCats = Array.isArray(categorias)
    ? categorias.filter((c: any) => c?.enabled !== false)
    : [];

  for (let i = 0; i < enabledCats.length && i < GONDOLA_KEYS.length; i++) {
    const cat = enabledCats[i];
    const prompt = buildInternoPrompt(
      nome,
      cidade,
      obs,
      `CENA: Gôndola/seção de "${cat.name}".
- Gôndola com ${cat.prateleiras || 3} prateleiras/níveis
- Produtos típicos de "${cat.name}" em supermercado brasileiro REAL
- Marcas e embalagens brasileiras reconhecíveis
- Sinalização da categoria com cores da logo
${cat.observacao ? `- Obs: ${cat.observacao}` : ""}`
    );

    tasks.push({
      imgKey: GONDOLA_KEYS[i],
      sceneName: `Gôndola: ${cat.name}`,
      prompt,
      refImages: makeRefs("interno", cat.refImage),
    });
  }

  return tasks;
}

// ==================== BACKGROUND PROCESSOR ====================

async function processProjectInBackground(
  projectId: string,
  nome: string,
  cidade: string,
  obs: string,
  categorias: any[],
  refs: Record<string, any>
) {
  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let accessToken: string;
  try {
    accessToken = await getAccessToken();
    console.log("✓ Vertex AI auth OK");
  } catch (e) {
    console.error("✗ Auth failed:", e.message);
    await supabaseClient
      .from("projects")
      .update({ status: "erro", updated_at: new Date().toISOString() })
      .eq("id", projectId);
    return;
  }

  await supabaseClient
    .from("projects")
    .update({ status: "processando", updated_at: new Date().toISOString() })
    .eq("id", projectId);

  const scenes = buildAllScenes(nome, cidade, obs, categorias, refs);
  console.log(`Starting generation: ${scenes.length} scenes`);

  let successCount = 0;

  // Process images one by one
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    console.log(`[${i + 1}/${scenes.length}] ${scene.sceneName} (${scene.refImages.length} refs)`);

    try {
      const base64Url = await generateImageVertex(
        accessToken,
        scene.prompt,
        scene.refImages
      );

      if (base64Url) {
        const publicUrl = await uploadBase64Image(
          supabaseClient,
          projectId,
          scene.imgKey.replace("_url", ""),
          base64Url
        );

        if (publicUrl) {
          await supabaseClient
            .from("projects")
            .update({
              [scene.imgKey]: publicUrl,
              updated_at: new Date().toISOString(),
            })
            .eq("id", projectId);
          successCount++;
          console.log(`✓ ${scene.sceneName} done (${successCount} total)`);
        }
      } else {
        console.error(`✗ ${scene.sceneName} - no image returned`);
      }
    } catch (err) {
      console.error(`✗ ${scene.sceneName} error:`, err.message);
    }
  }

  // Finalize
  const finalStatus = successCount > 0 ? "concluido" : "erro";
  await supabaseClient
    .from("projects")
    .update({ status: finalStatus, updated_at: new Date().toISOString() })
    .eq("id", projectId);

  console.log(
    `✓ Project ${projectId} finalized: ${finalStatus} (${successCount}/${scenes.length} images)`
  );
}

// ==================== SINGLE IMAGE EDIT ====================

async function editSingleImage(
  projectId: string,
  imageKey: string,
  imageUrl: string,
  customPrompt: string
) {
  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (e) {
    console.error("Auth failed for edit:", e.message);
    await supabaseClient
      .from("projects")
      .update({ status: "erro", updated_at: new Date().toISOString() })
      .eq("id", projectId);
    return { error: "Auth failed" };
  }

  const base64Url = await generateImageVertex(accessToken, customPrompt, [
    imageUrl,
  ]);

  if (!base64Url) {
    return { error: "No image returned" };
  }

  const publicUrl = await uploadBase64Image(
    supabaseClient,
    projectId,
    imageKey.replace("_url", ""),
    base64Url
  );

  if (publicUrl) {
    await supabaseClient
      .from("projects")
      .update({
        [imageKey]: publicUrl,
        status: "concluido",
        updated_at: new Date().toISOString(),
      })
      .eq("id", projectId);
  }

  return { success: true, new_url: publicUrl };
}

// ==================== MAIN HANDLER ====================

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      project_id,
      tipo,
      nome_mercado,
      cidade,
      observacoes,
      categorias,
      imagens,
      image_key,
      image_url,
      prompt: customPrompt,
    } = body;

    if (!project_id) {
      return new Response(
        JSON.stringify({ error: "project_id is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Single image edit
    if (tipo === "edicao" && image_key && image_url && customPrompt) {
      const result = await editSingleImage(
        project_id,
        image_key,
        image_url,
        customPrompt
      );
      const status = result.error ? 500 : 200;
      return new Response(JSON.stringify(result), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Full project generation - get project data
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: project, error: projectError } = await supabaseClient
      .from("projects")
      .select("*")
      .eq("id", project_id)
      .single();

    if (projectError || !project) {
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const refs =
      imagens && Object.keys(imagens).length > 0
        ? imagens
        : ((project.imagens as Record<string, any>) || {});
    const nome = nome_mercado || project.nome_mercado || "Mercado";
    const cidadeVal = cidade || project.cidade || "";
    const obsVal = observacoes || project.observacoes || "";
    const categoriasVal =
      Array.isArray(categorias) && categorias.length > 0
        ? categorias
        : Array.isArray(project.categorias)
        ? project.categorias
        : [];

    // Use EdgeRuntime.waitUntil to process in background
    // @ts-ignore - EdgeRuntime is available in Supabase Edge Functions
    EdgeRuntime.waitUntil(
      processProjectInBackground(
        project_id,
        nome,
        cidadeVal,
        obsVal,
        categoriasVal,
        refs
      )
    );

    // Return immediately
    return new Response(
      JSON.stringify({
        message: "Processing started",
        project_id,
      }),
      {
        status: 202,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("Fatal error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
