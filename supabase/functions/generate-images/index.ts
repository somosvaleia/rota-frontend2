import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ==================== IMAGE HELPERS ====================

async function urlToBase64Part(url: string, label: string, maxBytes = 800000): Promise<{ textPart: any; imgPart: any } | null> {
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
    parts.push({ text: `\n⚠️ INSTRUÇÃO OBRIGATÓRIA: As ${loadedRefs} imagens acima são REFERÊNCIAS ABSOLUTAS. Você DEVE copiar fielmente as cores, formas, proporções e identidade visual dessas referências na imagem gerada. NÃO invente elementos que não estejam nas referências.\n\n${prompt}` });
  } else {
    parts.push({ text: prompt });
  }

  const models = [
    "gemini-2.5-flash-preview-image-generation",
    "gemini-2.5-flash-image",
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
            temperature: 0.2,
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

function promptExterno(nome: string, cidade: string, obs: string, scene: string): string {
  return `Crie uma renderização 3D FOTORREALISTA de alta qualidade de um supermercado brasileiro de bairro.

PROJETO: "${nome}" localizado em ${cidade || "Brasil"}.
${obs ? `OBSERVAÇÕES DO CLIENTE: ${obs}` : ""}

REGRAS DE CONSTÂNCIA VISUAL (OBRIGATÓRIO):
1. A LOGO fornecida como referência define TUDO: nome do mercado no letreiro, paleta de cores da fachada, identidade visual completa.
2. A PLANTA BAIXA fornecida define a ESTRUTURA: formato do prédio, quantidade de andares, estacionamento, dimensões proporcionais.
3. A LOCALIZAÇÃO (${cidade || "Brasil"}) define o CONTEXTO: vegetação típica da região, tipo de calçada, estilo arquitetônico local, iluminação natural coerente.

PROIBIÇÕES: NÃO invente nome diferente da logo. NÃO mude as cores da logo. NÃO altere a estrutura da planta. NÃO coloque elementos que não existem na realidade de ${cidade || "Brasil"}.

ESTILO: Fotorrealismo extremo. Qualidade de foto profissional de arquitetura. Iluminação natural. Resolução alta.

CENA: ${scene}`;
}

function promptInterno(nome: string, cidade: string, obs: string, scene: string): string {
  return `Crie uma renderização 3D FOTORREALISTA de alta qualidade do INTERIOR de um supermercado brasileiro de bairro.

PROJETO: "${nome}" localizado em ${cidade || "Brasil"}.
${obs ? `OBSERVAÇÕES DO CLIENTE: ${obs}` : ""}

REGRAS DE CONSTÂNCIA VISUAL (OBRIGATÓRIO):
1. A LOGO fornecida define: placas internas, sinalização de seções, cores das gôndolas e comunicação visual em TODO o interior.
2. A PLANTA BAIXA fornecida define: layout dos corredores, posição das seções (açougue, padaria, hortifruti, caixas), fluxo de clientes.
3. Produtos devem ser BRASILEIROS REAIS de marcas conhecidas (Nestlé, Sadia, Perdigão, Ypê, OMO, etc).

PROIBIÇÕES: NÃO use marcas estrangeiras. NÃO invente layouts diferentes da planta. NÃO mude cores da identidade visual.

ESTILO: Fotorrealismo extremo. Iluminação comercial fluorescente branca. Piso cerâmico claro. Teto com estrutura metálica aparente.

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

function buildAllScenes(nome: string, cidade: string, obs: string, categorias: any[], refs: Record<string, any>): SceneTask[] {
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
    if (planta && type !== "produto") {
      urls.push(planta);
      labels.push("PLANTA BAIXA — siga esta estrutura, proporções e layout EXATAMENTE");
    }
    if (extra) {
      urls.push(extra);
      labels.push("REFERÊNCIA VISUAL ADICIONAL — use como guia de estilo para esta cena específica");
    }
    return { urls, labels };
  };

  const fixed = [
    { key: "img_a_url", name: "Fachada", type: "externo", ref: "fachada_ref", scene: "Fachada frontal completa do supermercado. Vista frontal centralizada. O LETREIRO deve conter EXATAMENTE o nome e cores da LOGO. Estacionamento conforme a PLANTA BAIXA. Vegetação típica de " + cidade + ". Calçada brasileira." },
    { key: "img_b_url", name: "Entrada e Caixas", type: "interno", ref: "caixa_ref", scene: "Área de entrada com caixas registradoras. Quantidade de checkouts conforme PLANTA BAIXA. Sinalização com cores da LOGO. Sacolas plásticas simples com logo." },
    { key: "img_c_url", name: "Corredores", type: "interno", ref: "corredor_ref", scene: "Corredor principal interno. Gôndolas dos dois lados com produtos brasileiros. Placas de seção nas cores da LOGO. Perspectiva central profunda." },
    { key: "img_d_url", name: "Interior / Fundo", type: "interno", ref: "interno_ref", scene: "Área dos fundos: açougue, padaria e hortifruti conforme PLANTA BAIXA. Balcões refrigerados. Comunicação visual com cores da LOGO." },
    { key: "img_e_url", name: "Vista Superior", type: "externo", ref: "vista_superior_ref", scene: "Vista aérea (drone) do supermercado. O formato do telhado e a implantação devem seguir EXATAMENTE a PLANTA BAIXA. Entorno urbano de " + cidade + "." },
    { key: "img_f_url", name: "Farda", type: "produto", ref: "", scene: "Uniforme de funcionário: camiseta polo SIMPLES com a LOGO bordada no peito esquerdo. Cores EXATAS da logo. Em cabide ou manequim. Fundo neutro." },
    { key: "img_g_url", name: "Sacola", type: "produto", ref: "", scene: "Sacola plástica SIMPLES de supermercado com a LOGO impressa. Plástico branco ou na cor principal da logo. Sacola comum de mercadinho brasileiro. Fundo neutro." },
    { key: "img_h_url", name: "Carrinho", type: "produto", ref: "", scene: "Carrinho de supermercado padrão brasileiro (metal/arame). LOGO aplicada na parte frontal. Detalhes na cor da logo. Carrinho SIMPLES e funcional. Fundo neutro." },
  ];

  for (const s of fixed) {
    const refUrl = s.ref ? refs[s.ref] : undefined;
    const { urls, labels } = mkRefs(s.type, refUrl);
    let prompt: string;
    if (s.type === "externo") prompt = promptExterno(nome, cidade, obs, s.scene);
    else if (s.type === "interno") prompt = promptInterno(nome, cidade, obs, s.scene);
    else prompt = promptProduto(nome, cidade, s.scene);
    tasks.push({ imgKey: s.key, sceneName: s.name, prompt, refUrls: urls, refLabels: labels });
  }

  const cats = Array.isArray(categorias) ? categorias.filter((c: any) => c?.enabled !== false) : [];
  for (let i = 0; i < cats.length && i < GONDOLA_KEYS.length; i++) {
    const c = cats[i];
    const { urls, labels } = mkRefs("interno", c.refImage);
    tasks.push({
      imgKey: GONDOLA_KEYS[i],
      sceneName: `Gôndola: ${c.name}`,
      prompt: promptInterno(nome, cidade, obs, `Gôndola/seção de "${c.name}". ${c.prateleiras || 3} prateleiras. Produtos brasileiros REAIS de marcas conhecidas. Sinalização com cores da LOGO. ${c.observacao || ""}`),
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
    const { project_id, tipo, nome_mercado, cidade, observacoes, categorias, imagens, image_key, image_url, prompt: customPrompt, stage = "start", scene_offset = 0 } = body;

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
    const scenes = buildAllScenes(nome, cidadeVal, obsVal, catsVal, refs);

    // Marcar como processando no início
    if (stage === "start") {
      await sb.from("projects").update({ status: "processando", updated_at: new Date().toISOString() }).eq("id", project_id);
      console.log(`[START] Projeto "${nome}" em ${cidadeVal} — ${scenes.length} cenas, refs: logo=${!!refs.logo}, planta=${!!refs.planta}`);
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
        await invokeNextStage({ project_id, stage: "images", scene_offset: next });
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
