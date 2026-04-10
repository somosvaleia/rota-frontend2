import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ==================== PROMPTS ====================

const PROMPT_BASE_EXTERNO = (nome: string, cidade: string, obs: string) => `
Gerar imagens arquitetônicas fotorrealistas de um supermercado brasileiro.

DADOS DO PROJETO:
- Nome: ${nome || "Mercado"}
- Cidade: ${cidade || "não informada"}
- Observações: ${obs || "sem observações adicionais"}
- Identidade adicional: seguir principalmente a logo, se houver

IDENTIDADE VISUAL (PRIORIDADE ALTA):
- Usar obrigatoriamente a logo enviada como referência principal de marca.
- Seguir fielmente as cores predominantes da logo.
- O letreiro, fachada e comunicação visual devem refletir a marca.

ESTRUTURA (PRIORIDADE MÁXIMA):
- A planta enviada deve ser seguida com precisão.
- A volumetria, proporções e organização arquitetônica devem respeitar a planta.
- Não inventar uma estrutura diferente.
- Todas as vistas devem representar o mesmo prédio baseado na planta.

REFERÊNCIAS COMPLEMENTARES:
- As referências complementares refinam o estilo, mas não substituem a planta quando ela existir.

REGRAS GERAIS:
- Alto realismo
- Arquitetura comercial brasileira
- Coerência total entre todas as imagens
- Mesmo mercado em todos os ângulos
- Iluminação natural agradável
- Materiais realistas
- Sem distorções exageradas
- Sem textos aleatórios
`;

const PROMPT_BASE_INTERNO = (nome: string, cidade: string, obs: string) => `
Gere uma imagem fotorealista interna de supermercado brasileiro.

REGRAS OBRIGATÓRIAS:
- Use a planta baixa enviada como base estrutural principal.
- Respeite fielmente o layout da planta.
- A cena deve parecer parte do mesmo mercado em todos os ângulos.
- Use a identidade visual da logo do mercado na comunicação interna, placas, faixas e ambientação.
- Não invente um layout diferente da planta.
- Os produtos e o ambiente devem parecer de um supermercado brasileiro real.
- Categorias do projeto: sortimento de supermercado brasileiro.
- Nome do mercado: ${nome || "Mercado"}.
- Cidade: ${cidade || "não informada"}.
${obs ? `- Observações: ${obs}` : ""}
`;

const PROMPT_BASE_PRODUTO = (nome: string) => `
Gere uma imagem fotorealista de produto/material do supermercado "${nome || "Mercado"}".

REGRAS:
- Alto realismo fotográfico
- Se houver logo, aplicar fielmente as cores e identidade visual da logo
- Se não houver logo, criar um design moderno e profissional usando o nome do mercado
- Fundo neutro/clean para destaque do produto
- Sem textos aleatórios ou distorções
`;

// ==================== SCENES ====================

interface FixedScene {
  key: string;
  name: string;
  refField: string;
  type: "externo" | "interno" | "produto";
  vistaRegras?: string;
  cenaDesc?: string;
  produtoDesc?: string;
}

const FIXED_SCENES: FixedScene[] = [
  {
    key: "img_a_url", name: "Fachada", refField: "fachada_ref", type: "externo",
    vistaRegras: `VISTA DESTA GERAÇÃO:
- Tipo: Fachada frontal
- Descrição: vista frontal completa da fachada do supermercado

REGRAS ESPECÍFICAS DESTA VISTA:
- Gerar exatamente esta perspectiva
- Letreiro com o nome do mercado bem visível
- Manter coerência total com o mesmo projeto arquitetônico
- Se houver planta, seguir a planta com prioridade máxima
- Se houver logo, seguir a logo nas cores e identidade visual
- A construção deve parecer o mesmo mercado visto de frente`,
  },
  {
    key: "img_b_url", name: "Entrada e Caixas", refField: "caixa_ref", type: "interno",
    cenaDesc: `Gerar a área de caixas do supermercado, com checkouts posicionados de forma coerente com a planta baixa, fluxo de entrada e saída, visão interna fotorealista, identidade visual da marca e padrão de mercado brasileiro.`,
  },
  {
    key: "img_c_url", name: "Corredores", refField: "corredor_ref", type: "interno",
    cenaDesc: `Gerar um corredor interno do supermercado com gôndolas bem organizadas, produtos variados de supermercado brasileiro, sinalização de categorias com a identidade visual da marca, iluminação clara e ambiente limpo e acolhedor. Seguir a planta baixa para posicionamento.`,
  },
  {
    key: "img_d_url", name: "Interior / Fundo", refField: "interno_ref", type: "interno",
    cenaDesc: `Gerar uma vista interna do fundo do supermercado mostrando seções como açougue, padaria ou hortifruti (conforme o projeto). Ambiente fotorealista, com comunicação visual da marca, produtos brasileiros e layout coerente com a planta baixa.`,
  },
  {
    key: "img_e_url", name: "Vista Superior", refField: "vista_superior_ref", type: "externo",
    vistaRegras: `VISTA DESTA GERAÇÃO:
- Tipo: Vista superior
- Descrição: vista aérea superior completa do mercado

REGRAS ESPECÍFICAS DESTA VISTA:
- Gerar exatamente esta perspectiva
- Manter coerência total com o mesmo projeto arquitetônico
- Não alterar a estrutura entre as imagens
- Se houver planta, seguir a planta com prioridade máxima
- Se houver logo, seguir a logo nas cores e identidade visual
- Não inventar layout diferente
- A construção deve parecer o mesmo mercado visto de outro ângulo`,
  },
  {
    key: "img_f_url", name: "Farda / Uniforme", refField: "", type: "produto",
    produtoDesc: `Gere uma imagem fotorealista de um uniforme/farda completo para funcionários do supermercado "{nome}".
- Mostrar camisa polo ou camiseta com a identidade visual do mercado
- Se houver logo, aplicar a logo no peito da camisa e nas cores do uniforme
- Se não houver logo, criar um design profissional com o nome "{nome}" estampado
- Incluir avental ou colete se adequado ao estilo do mercado
- Mostrar o uniforme em manequim ou pessoa, de corpo inteiro
- Cores devem seguir a paleta da marca
- Aspecto limpo, profissional e moderno`,
  },
  {
    key: "img_g_url", name: "Sacola Plástica", refField: "", type: "produto",
    produtoDesc: `Gere uma imagem fotorealista de uma sacola plástica personalizada do supermercado "{nome}".
- Sacola de supermercado padrão brasileiro
- Se houver logo, aplicar a logo centralizada na sacola
- Se não houver logo, estampar o nome "{nome}" de forma visível e atrativa
- Cores da sacola devem seguir a identidade visual da marca
- Mostrar a sacola de frente, bem enquadrada
- Fundo neutro para destaque
- Realismo total no material plástico`,
  },
  {
    key: "img_h_url", name: "Carrinho de Mercado", refField: "", type: "produto",
    produtoDesc: `Gere uma imagem fotorealista de um carrinho de supermercado personalizado do "{nome}".
- Carrinho de supermercado padrão brasileiro, tamanho regular
- Se houver logo, aplicar a logo na parte frontal do carrinho e/ou na alça
- Se não houver logo, aplicar o nome "{nome}" de forma visível
- Cores e detalhes do carrinho devem refletir a identidade visual da marca
- Carrinho limpo, moderno e bem conservado
- Fundo neutro ou dentro do ambiente do mercado
- Alto realismo fotográfico`,
  },
];

const GONDOLA_KEYS = [
  "img_i_url", "img_j_url", "img_k_url", "img_l_url",
  "img_m_url", "img_n_url", "img_o_url", "img_p_url",
  "img_q_url", "img_r_url", "img_s_url", "img_t_url",
];

function buildFixedPrompt(scene: FixedScene, nome: string, cidade: string, obs: string): string {
  if (scene.type === "externo") return PROMPT_BASE_EXTERNO(nome, cidade, obs) + "\n" + (scene.vistaRegras || "");
  if (scene.type === "interno") return PROMPT_BASE_INTERNO(nome, cidade, obs) + "\nCENA SOLICITADA:\n" + (scene.cenaDesc || "");
  return PROMPT_BASE_PRODUTO(nome) + "\n" + (scene.produtoDesc || "").replaceAll("{nome}", nome);
}

function buildGondolaPrompt(
  nome: string, cidade: string, obs: string,
  categoria: { name: string; prateleiras: number; observacao?: string }
): string {
  return PROMPT_BASE_INTERNO(nome, cidade, obs) + `
CENA SOLICITADA:
Gerar uma gôndola/seção de "${categoria.name}" dentro do supermercado "${nome}".
- Mostrar a gôndola com ${categoria.prateleiras} prateleiras/níveis de exposição
- Produtos típicos de "${categoria.name}" em supermercado brasileiro
- Sinalização da categoria com a identidade visual da marca
- Layout e organização coerente com a planta baixa
- Iluminação clara, ambiente limpo e realista
${categoria.observacao ? `- Observação específica: ${categoria.observacao}` : ""}
- Se houver imagem de referência para esta gôndola, seguir o estilo visual da referência
`;
}

// ==================== GOOGLE AI STUDIO HELPERS ====================

const GOOGLE_AI_BASE = "https://generativelanguage.googleapis.com/v1beta";

async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 2): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, options);
    if (res.ok || (res.status < 500 && res.status !== 429)) return res;
    console.warn(`Attempt ${attempt + 1} failed with ${res.status}, retrying in 5s...`);
    if (attempt < maxRetries) await new Promise((r) => setTimeout(r, 5000));
    else return res;
  }
  throw new Error("Unreachable");
}

// Convert a URL image to base64 inline data for Gemini
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

async function generateImageGemini(apiKey: string, prompt: string, refUrls: string[] = []): Promise<string | null> {
  const parts: any[] = [{ text: prompt }];
  
  // Add reference images as inline data
  for (const url of refUrls) {
    const part = await urlToBase64Part(url);
    if (part) parts.push(part);
  }

  const url = `${GOOGLE_AI_BASE}/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`;
  
  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
      },
    }),
  });

  if (!res.ok) {
    console.error("Gemini image error:", res.status, await res.text());
    return null;
  }

  const data = await res.json();
  const candidateParts = data.candidates?.[0]?.content?.parts || [];
  for (const p of candidateParts) {
    if (p.inlineData) {
      return `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`;
    }
  }
  console.error("No image in Gemini response");
  return null;
}

// ==================== VEO VIDEO GENERATION ====================

async function generateDroneVideo(
  apiKey: string,
  imageUrl: string,
  dronePrompt: string
): Promise<string | null> {
  // Convert image URL to base64 for Veo
  const imgPart = await urlToBase64Part(imageUrl);
  if (!imgPart) {
    console.error("Failed to load image for video generation");
    return null;
  }

  // Start video generation using Veo via Gemini API
  const generateUrl = `${GOOGLE_AI_BASE}/models/veo-2.0-generate-001:predictLongRunning?key=${apiKey}`;
  
  const res = await fetchWithRetry(generateUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

  // Poll for completion (max 5 min)
  const pollUrl = `${GOOGLE_AI_BASE}/${operationName}?key=${apiKey}`;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    
    const pollRes = await fetch(pollUrl);
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
        // If URI based
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
  supabase: any,
  projectId: string,
  key: string,
  base64Url: string
): Promise<string | null> {
  const base64Data = base64Url.replace(/^data:video\/\w+;base64,/, "");
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

    const googleApiKey = Deno.env.get("GOOGLE_AI_API_KEY");
    if (!googleApiKey) {
      return new Response(JSON.stringify({ error: "GOOGLE_AI_API_KEY not configured" }), {
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
      const base64Url = await generateImageGemini(googleApiKey, customPrompt, [image_url]);

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

    interface SceneTask {
      imgKey: string;
      sceneName: string;
      prompt: string;
      refImages: string[];
    }

    const sceneTasks: SceneTask[] = [];

    // Fixed scenes
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

      for (const task of sceneTasks) {
        console.log(`Processing scene: ${task.sceneName} (${task.imgKey})`);
        try {
          const base64Url = await generateImageGemini(googleApiKey, task.prompt, task.refImages);

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
        await new Promise((r) => setTimeout(r, 2000));
      }

      // ---- VIDEO GENERATION (Veo) ----
      // Video 1: Externo (drone flight around exterior) — uses fachada + vista superior
      // Video 2: Interno (drone walkthrough inside) — uses entrada/caixas + corredores

      const externalImg = generatedUrls["img_a_url"] || generatedUrls["img_e_url"];
      const internalImg = generatedUrls["img_c_url"] || generatedUrls["img_b_url"];

      if (externalImg) {
        console.log("Generating external drone video...");
        try {
          const dronePrompt = `Smooth cinematic drone flight around a Brazilian supermarket building. The camera starts from a high aerial angle, slowly descends and orbits around the building, showcasing the full facade, parking lot, and surroundings. Smooth camera movement, golden hour lighting, photorealistic, architectural visualization. No people walking. Professional real estate drone footage style.`;
          
          const videoBase64 = await generateDroneVideo(googleApiKey, externalImg, dronePrompt);
          if (videoBase64) {
            const videoUrl = await uploadBase64Video(supabase, project_id, "video", videoBase64);
            if (videoUrl) {
              await supabase.from("projects").update({
                video_url: videoUrl, updated_at: new Date().toISOString(),
              }).eq("id", project_id);
              console.log("✓ External drone video done");
            }
          } else {
            console.error("✗ External drone video - no video returned");
          }
        } catch (err) {
          console.error("✗ External drone video error:", err.message);
        }
      }

      if (internalImg) {
        console.log("Generating internal drone video...");
        try {
          const dronePrompt = `Smooth cinematic drone walkthrough inside a Brazilian supermarket. The camera glides slowly through the aisles at eye level, showing organized shelves with products, category signage, clean floors, and warm commercial lighting. Steady and professional camera movement, as if floating through the store. No sudden movements. Photorealistic interior visualization. Professional architectural walkthrough style.`;
          
          const videoBase64 = await generateDroneVideo(googleApiKey, internalImg, dronePrompt);
          if (videoBase64) {
            const videoUrl = await uploadBase64Video(supabase, project_id, "video_b", videoBase64);
            if (videoUrl) {
              await supabase.from("projects").update({
                video_b_url: videoUrl, updated_at: new Date().toISOString(),
              }).eq("id", project_id);
              console.log("✓ Internal drone video done");
            }
          } else {
            console.error("✗ Internal drone video - no video returned");
          }
        } catch (err) {
          console.error("✗ Internal drone video error:", err.message);
        }
      }

      // Final status
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
