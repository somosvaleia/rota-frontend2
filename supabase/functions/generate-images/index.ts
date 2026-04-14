import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ==================== IMAGE HELPERS ====================

async function urlToBase64Part(url: string, maxBytes = 500000): Promise<{ inlineData: { mimeType: string; data: string } } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    // Skip if too large (>500KB) to avoid memory issues
    if (buf.byteLength > maxBytes) {
      console.warn(`Ref image too large (${(buf.byteLength/1024).toFixed(0)}KB), skipping: ${url.substring(0, 80)}`);
      return null;
    }
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const b64 = btoa(binary);
    const ct = res.headers.get("content-type") || "image/png";
    return { inlineData: { mimeType: ct, data: b64 } };
  } catch (e) {
    console.error("Failed to fetch ref:", e);
    return null;
  }
}

// ==================== GOOGLE AI STUDIO ====================

async function generateImageGemini(apiKey: string, prompt: string, refUrls: string[] = []): Promise<string | null> {
  const parts: any[] = [];

  const refLabels = [
    "LOGO DO MERCADO - identidade visual: cores, nome, estilo",
    "PLANTA BAIXA - estrutura e layout do prédio",
    "REFERÊNCIA VISUAL - guia de estilo para esta cena",
  ];

  let loadedRefs = 0;
  for (let i = 0; i < refUrls.length; i++) {
    const part = await urlToBase64Part(refUrls[i]);
    if (part) {
      parts.push({ text: `[${refLabels[Math.min(i, refLabels.length - 1)]}]:` });
      parts.push(part);
      loadedRefs++;
    }
  }

  if (loadedRefs > 0) {
    parts.push({ text: `\nAs imagens acima são referências OBRIGATÓRIAS. Siga-as fielmente.\n\n${prompt}` });
  } else {
    parts.push({ text: prompt });
  }

  const models = ["gemini-2.0-flash-exp", "gemini-2.0-flash-preview-image-generation"];

  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    console.log(`Trying ${model} with ${loadedRefs} refs`);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: { responseModalities: ["IMAGE", "TEXT"], temperature: 0.4 },
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`${model} error ${res.status}: ${errText.substring(0, 200)}`);
        continue;
      }

      const data = await res.json();
      for (const p of (data.candidates?.[0]?.content?.parts || [])) {
        if (p.inlineData) {
          console.log(`✓ Image from ${model}`);
          return `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`;
        }
      }
      console.warn(`${model} no image data`);
    } catch (e) {
      console.error(`${model} error:`, e.message);
    }
  }

  return null;
}

// ==================== VERTEX AI IMAGEN 3 FALLBACK ====================

async function getVertexAccessToken(): Promise<string> {
  const credJson = Deno.env.get("GOOGLE_APPLICATION_CREDENTIALS_JSON");
  if (!credJson) throw new Error("No credentials");
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

async function generateImageImagen3(accessToken: string, prompt: string): Promise<string | null> {
  const project = Deno.env.get("GOOGLE_CLOUD_PROJECT_ID") || "rota-489018";
  const location = Deno.env.get("GOOGLE_CLOUD_LOCATION") || "us-central1";
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/imagen-3.0-generate-001:predict`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: { sampleCount: 1, aspectRatio: "16:9", safetyFilterLevel: "block_few" },
      }),
    });
    if (!res.ok) { console.error("Imagen3:", res.status, await res.text()); return null; }
    const data = await res.json();
    if (data.predictions?.[0]?.bytesBase64Encoded) {
      console.log("✓ Image from Imagen 3");
      return `data:image/png;base64,${data.predictions[0].bytesBase64Encoded}`;
    }
  } catch (e) { console.error("Imagen3:", e.message); }
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

// ==================== PROMPTS ====================

function promptExterno(nome: string, cidade: string, obs: string, scene: string): string {
  return `Renderização fotorrealista de supermercado brasileiro de bairro.
PROJETO: "${nome}" em ${cidade || "Brasil"}. ${obs || ""}
REGRAS: Logo = identidade visual (cores, nome no letreiro). Planta = estrutura obrigatória. Localização = realidade de ${cidade || "Brasil"}.
Fotorrealismo extremo. Arquitetura comercial brasileira. Iluminação natural. Sem textos inventados.
${scene}`;
}

function promptInterno(nome: string, cidade: string, obs: string, scene: string): string {
  return `Renderização fotorrealista de interior de supermercado brasileiro de bairro.
PROJETO: "${nome}" em ${cidade || "Brasil"}. ${obs || ""}
REGRAS: Logo = identidade visual (placas, sinalização). Planta = layout dos corredores e seções. Produtos brasileiros REAIS, marcas reconhecíveis.
Fotorrealismo extremo. Iluminação comercial branca.
${scene}`;
}

function promptProduto(nome: string, cidade: string, scene: string): string {
  return `Foto de item de supermercado "${nome}" (${cidade || "Brasil"}).
Use as cores da logo. Item SIMPLES de mercado de bairro. Fundo neutro. Fotorrealismo.
${scene}`;
}

// ==================== SCENES ====================

interface SceneTask { imgKey: string; sceneName: string; prompt: string; refImages: string[]; }

const GONDOLA_KEYS = ["img_i_url","img_j_url","img_k_url","img_l_url","img_m_url","img_n_url","img_o_url","img_p_url","img_q_url","img_r_url","img_s_url","img_t_url"];

function buildAllScenes(nome: string, cidade: string, obs: string, categorias: any[], refs: Record<string, any>): SceneTask[] {
  const logo = refs.logo as string | undefined;
  const planta = refs.planta as string | undefined;
  const tasks: SceneTask[] = [];

  const mkRefs = (type: string, extra?: string) => {
    const r: string[] = [];
    if (logo) r.push(logo);
    if (planta && type !== "produto") r.push(planta);
    if (extra) r.push(extra);
    return r;
  };

  const fixed = [
    { key: "img_a_url", name: "Fachada", type: "externo", ref: "fachada_ref", scene: "Fachada frontal completa. Vista frontal centralizada. Letreiro com nome da logo. Cores da logo na fachada. Estacionamento se na planta. Vegetação local." },
    { key: "img_b_url", name: "Entrada e Caixas", type: "interno", ref: "caixa_ref", scene: "Área de entrada e caixas. Checkouts conforme planta. Identidade visual da logo. Sacolas plásticas simples." },
    { key: "img_c_url", name: "Corredores", type: "interno", ref: "corredor_ref", scene: "Corredor interno. Gôndolas dos dois lados. Produtos brasileiros. Sinalização com cores da logo. Perspectiva central." },
    { key: "img_d_url", name: "Interior / Fundo", type: "interno", ref: "interno_ref", scene: "Fundos: açougue/padaria/hortifruti. Balcões refrigerados. Comunicação visual da logo." },
    { key: "img_e_url", name: "Vista Superior", type: "externo", ref: "vista_superior_ref", scene: "Vista aérea drone. Telhado e entorno. Formato = planta baixa. Paisagismo local." },
    { key: "img_f_url", name: "Farda", type: "produto", ref: "", scene: "Uniforme: camiseta polo com logo no peito. Cores da logo. SIMPLES. Em manequim, fundo neutro." },
    { key: "img_g_url", name: "Sacola", type: "produto", ref: "", scene: "Sacola plástica SIMPLES. Logo impressa. Cores da logo. Plástico comum. Fundo neutro." },
    { key: "img_h_url", name: "Carrinho", type: "produto", ref: "", scene: "Carrinho padrão brasileiro metal/arame. Logo na frente. Cores da logo nos detalhes. Fundo neutro." },
  ];

  for (const s of fixed) {
    const refUrl = s.ref ? refs[s.ref] : undefined;
    let prompt: string;
    if (s.type === "externo") prompt = promptExterno(nome, cidade, obs, s.scene);
    else if (s.type === "interno") prompt = promptInterno(nome, cidade, obs, s.scene);
    else prompt = promptProduto(nome, cidade, s.scene);
    tasks.push({ imgKey: s.key, sceneName: s.name, prompt, refImages: mkRefs(s.type, refUrl) });
  }

  const cats = Array.isArray(categorias) ? categorias.filter((c: any) => c?.enabled !== false) : [];
  for (let i = 0; i < cats.length && i < GONDOLA_KEYS.length; i++) {
    const c = cats[i];
    tasks.push({
      imgKey: GONDOLA_KEYS[i],
      sceneName: `Gôndola: ${c.name}`,
      prompt: promptInterno(nome, cidade, obs, `Gôndola de "${c.name}". ${c.prateleiras || 3} prateleiras. Produtos brasileiros reais. Marcas reconhecíveis. ${c.observacao || ""}`),
      refImages: mkRefs("interno", c.refImage),
    });
  }

  return tasks;
}

// ==================== SELF-INVOKE ====================

async function invokeNextStage(payload: Record<string, unknown>) {
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-images`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      "apikey": Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) console.error("Self-invoke failed:", res.status, await res.text());
  else await res.text(); // consume body
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
    const { project_id, tipo, nome_mercado, cidade, observacoes, categorias, imagens, image_key, image_url, prompt: customPrompt, stage = "start", scene_offset = 0 } = body;

    if (!project_id) {
      return new Response(JSON.stringify({ error: "project_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const apiKey = Deno.env.get("GOOGLE_AI_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "API key not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // ---- Single image edit ----
    if (tipo === "edicao" && image_key && image_url && customPrompt) {
      const base64 = await generateImageGemini(apiKey, customPrompt, [image_url]);
      if (!base64) return new Response(JSON.stringify({ error: "No image" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const url = await uploadBase64Image(sb, project_id, image_key.replace("_url", ""), base64);
      if (url) await sb.from("projects").update({ [image_key]: url, status: "concluido", updated_at: new Date().toISOString() }).eq("id", project_id);
      return new Response(JSON.stringify({ success: true, new_url: url }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ---- Full generation (recursive per scene) ----
    const { data: project } = await sb.from("projects").select("*").eq("id", project_id).single();
    if (!project) return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const refs = imagens && Object.keys(imagens).length > 0 ? imagens : ((project.imagens as Record<string, any>) || {});
    const nome = nome_mercado || project.nome_mercado || "Mercado";
    const cidadeVal = cidade || project.cidade || "";
    const obsVal = observacoes || project.observacoes || "";
    const catsVal = Array.isArray(categorias) && categorias.length > 0 ? categorias : (Array.isArray(project.categorias) ? project.categorias : []);
    const scenes = buildAllScenes(nome, cidadeVal, obsVal, catsVal, refs);

    // Mark as processing on start
    if (stage === "start") {
      await sb.from("projects").update({ status: "processando", updated_at: new Date().toISOString() }).eq("id", project_id);
    }

    // Process current scene
    if (stage === "start" || stage === "images") {
      const current = scenes[scene_offset];
      if (current) {
        console.log(`[${scene_offset + 1}/${scenes.length}] ${current.sceneName} (${current.refImages.length} refs)`);

        try {
          // Try Gemini (with refs) first
          let base64 = await generateImageGemini(apiKey, current.prompt, current.refImages);

          // Fallback: Imagen 3 (text only)
          if (!base64) {
            try {
              const vToken = await getVertexAccessToken();
              base64 = await generateImageImagen3(vToken, current.prompt);
            } catch (e) { console.error("Imagen3 fallback failed:", e.message); }
          }

          if (base64) {
            const url = await uploadBase64Image(sb, project_id, current.imgKey.replace("_url", ""), base64);
            if (url) {
              await sb.from("projects").update({ [current.imgKey]: url, updated_at: new Date().toISOString() }).eq("id", project_id);
              console.log(`✓ ${current.sceneName} done`);
            }
          } else {
            console.error(`✗ ${current.sceneName} failed`);
          }
        } catch (err) {
          console.error(`✗ ${current.sceneName}:`, err.message);
        }
      }

      // Next scene or finalize
      const next = scene_offset + 1;
      if (next < scenes.length) {
        // Chain to next scene
        await invokeNextStage({ project_id, stage: "images", scene_offset: next });
        return new Response(JSON.stringify({ stage: "images", next }), { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // All scenes done -> finalize
      await invokeNextStage({ project_id, stage: "finalize" });
      return new Response(JSON.stringify({ stage: "finalize" }), { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ---- Finalize ----
    if (stage === "finalize") {
      const { data: final } = await sb.from("projects").select("*").eq("id", project_id).single();
      const count = IMAGE_KEYS.filter(k => Boolean(final?.[k])).length;
      const status = count > 0 ? "concluido" : "erro";
      await sb.from("projects").update({ status, updated_at: new Date().toISOString() }).eq("id", project_id);
      console.log(`✓ Finalized: ${status} (${count} images)`);
      return new Response(JSON.stringify({ status, images: count }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Unknown stage" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("Fatal:", err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
