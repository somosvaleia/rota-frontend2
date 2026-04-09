import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Base prompt blocks reused across scenes
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

// Scene definitions with professional prompts
const SCENES = [
  {
    key: "img_a_url",
    name: "Fachada",
    refField: "fachada_ref",
    type: "externo" as const,
    vistaDesc: "Fachada frontal do mercado",
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
    key: "img_b_url",
    name: "Entrada e Caixas",
    refField: "caixa_ref",
    type: "interno" as const,
    cenaDesc: `Gerar a área de caixas do supermercado, com checkouts posicionados de forma coerente com a planta baixa, fluxo de entrada e saída, visão interna fotorealista, identidade visual da marca e padrão de mercado brasileiro.`,
  },
  {
    key: "img_c_url",
    name: "Corredores",
    refField: "corredor_ref",
    type: "interno" as const,
    cenaDesc: `Gerar um corredor interno do supermercado com gôndolas bem organizadas, produtos variados de supermercado brasileiro, sinalização de categorias com a identidade visual da marca, iluminação clara e ambiente limpo e acolhedor. Seguir a planta baixa para posicionamento.`,
  },
  {
    key: "img_d_url",
    name: "Interior / Fundo",
    refField: "interno_ref",
    type: "interno" as const,
    cenaDesc: `Gerar uma vista interna do fundo do supermercado mostrando seções como açougue, padaria ou hortifruti (conforme o projeto). Ambiente fotorealista, com comunicação visual da marca, produtos brasileiros e layout coerente com a planta baixa.`,
  },
  {
    key: "img_e_url",
    name: "Vista Superior",
    refField: "vista_superior_ref",
    type: "externo" as const,
    vistaDesc: "Vista aérea superior completa do mercado",
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
];

type Scene = typeof SCENES[number];

function buildPrompt(scene: Scene, nome: string, cidade: string, obs: string): string {
  if (scene.type === "externo") {
    return PROMPT_BASE_EXTERNO(nome, cidade, obs) + "\n" + (scene as any).vistaRegras;
  }
  return PROMPT_BASE_INTERNO(nome, cidade, obs) + "\nCENA SOLICITADA:\n" + (scene as any).cenaDesc;
}


async function generateImageFromPrompt(
  apiKey: string,
  prompt: string
): Promise<string | null> {
  const res = await fetch(
    "https://ai.gateway.lovable.dev/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-pro-image-preview",
        messages: [{ role: "user", content: prompt }],
        modalities: ["image", "text"],
      }),
    }
  );

  if (!res.ok) {
    console.error("AI generate error:", res.status, await res.text());
    return null;
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.images?.[0]?.image_url?.url ?? null;
}

async function generateWithMultipleRefs(
  apiKey: string,
  prompt: string,
  imageUrls: string[]
): Promise<string | null> {
  // Build content array with text + all reference images
  const content: any[] = [{ type: "text", text: prompt }];
  for (const url of imageUrls) {
    content.push({ type: "image_url", image_url: { url } });
  }

  const res = await fetch(
    "https://ai.gateway.lovable.dev/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-pro-image-preview",
        messages: [{ role: "user", content }],
        modalities: ["image", "text"],
      }),
    }
  );

  if (!res.ok) {
    console.error("AI error:", res.status, await res.text());
    return null;
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.images?.[0]?.image_url?.url ?? null;
}

async function uploadBase64Image(
  supabase: any,
  projectId: string,
  key: string,
  base64Url: string
): Promise<string | null> {
  const base64Data = base64Url.replace(/^data:image\/\w+;base64,/, "");
  const imageBytes = Uint8Array.from(atob(base64Data), (c) =>
    c.charCodeAt(0)
  );

  const fileName = `${projectId}/output/${key}_${Date.now()}.png`;

  const { error } = await supabase.storage
    .from("rota-referencias")
    .upload(fileName, imageBytes, {
      contentType: "image/png",
      upsert: true,
    });

  if (error) {
    console.error(`Upload error for ${key}:`, error.message);
    return null;
  }

  const { data } = supabase.storage
    .from("rota-referencias")
    .getPublicUrl(fileName);

  return data.publicUrl;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      project_id,
      tipo,
      nome_mercado,
      cidade,
      observacoes,
      categorias,
      imagens,
      // For single image edit
      image_key,
      image_url,
      prompt: customPrompt,
    } = await req.json();

    if (!project_id) {
      return new Response(
        JSON.stringify({ error: "project_id is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableApiKey) {
      return new Response(
        JSON.stringify({ error: "LOVABLE_API_KEY not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Single image edit mode
    if (tipo === "edicao" && image_key && image_url && customPrompt) {
      console.log(`Editing single image: ${image_key}`);

      const base64Url = await generateWithMultipleRefs(
        lovableApiKey,
        customPrompt,
        [image_url]
      );

      if (!base64Url) {
        await supabase
          .from("projects")
          .update({ status: "erro", updated_at: new Date().toISOString() })
          .eq("id", project_id);

        return new Response(
          JSON.stringify({ error: "AI did not return an edited image" }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const publicUrl = await uploadBase64Image(
        supabase,
        project_id,
        image_key.replace("_url", ""),
        base64Url
      );

      if (publicUrl) {
        await supabase
          .from("projects")
          .update({
            [image_key]: publicUrl,
            status: "concluido",
            updated_at: new Date().toISOString(),
          })
          .eq("id", project_id);
      }

      return new Response(
        JSON.stringify({ success: true, new_url: publicUrl }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Full generation (criacao) or reprocess (edicao without image_key)
    console.log(`Starting full generation for project ${project_id}, tipo: ${tipo}`);

    const refs = imagens || {};
    const nome = nome_mercado || "Mercado";
    const cidadeVal = cidade || "";
    const obsVal = observacoes || "";
    const updates: Record<string, string> = {};
    let hasError = false;

    // Collect global reference images (logo, planta)
    const logoUrl = refs.logo as string | undefined;
    const plantaUrl = refs.planta as string | undefined;

    for (const scene of SCENES) {
      console.log(`Processing scene: ${scene.name} (${scene.key})`);

      const sceneRefUrl = refs[scene.refField] as string | undefined;
      let base64Url: string | null = null;

      try {
        const prompt = buildPrompt(scene, nome, cidadeVal, obsVal);

        // Collect all available reference images for this scene
        const refImages: string[] = [];
        if (logoUrl) refImages.push(logoUrl);
        if (plantaUrl) refImages.push(plantaUrl);
        if (sceneRefUrl) refImages.push(sceneRefUrl);

        if (refImages.length > 0) {
          console.log(`Generating ${scene.name} with ${refImages.length} reference(s)`);
          base64Url = await generateWithMultipleRefs(lovableApiKey, prompt, refImages);
        } else {
          console.log(`Generating ${scene.name} from scratch (no references)`);
          base64Url = await generateImageFromPrompt(lovableApiKey, prompt);
        }

        if (base64Url) {
          const publicUrl = await uploadBase64Image(
            supabase,
            project_id,
            scene.key.replace("_url", ""),
            base64Url
          );
          if (publicUrl) {
            updates[scene.key] = publicUrl;
            // Update progressively so realtime picks it up
            await supabase
              .from("projects")
              .update({
                [scene.key]: publicUrl,
                updated_at: new Date().toISOString(),
              })
              .eq("id", project_id);
            console.log(`✓ ${scene.name} done`);
          }
        } else {
          console.error(`✗ ${scene.name} - no image returned`);
          hasError = true;
        }
      } catch (err) {
        console.error(`✗ ${scene.name} error:`, err.message);
        hasError = true;
      }

      // Small delay between requests to avoid rate limiting
      await new Promise((r) => setTimeout(r, 2000));
    }

    // Final status update
    await supabase
      .from("projects")
      .update({
        status: hasError && Object.keys(updates).length === 0 ? "erro" : "concluido",
        updated_at: new Date().toISOString(),
      })
      .eq("id", project_id);

    console.log(
      `Generation complete. ${Object.keys(updates).length}/${SCENES.length} images generated.`
    );

    return new Response(
      JSON.stringify({
        success: true,
        generated: Object.keys(updates).length,
        total: SCENES.length,
        has_errors: hasError,
      }),
      {
        status: 200,
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
