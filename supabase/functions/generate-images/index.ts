import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Scene definitions with default prompts - you can customize these later
const SCENES = [
  {
    key: "img_a_url",
    name: "Fachada",
    refField: "fachada_ref",
    prompt:
      "Gere uma imagem fotorrealista da fachada de um supermercado moderno chamado '{nome}'. A fachada deve ser atrativa, com letreiro visível e iluminação moderna. Localizado em {cidade}.",
    editPrompt:
      "Redesenhe esta fachada de supermercado mantendo a estrutura mas aplicando o estilo visual de um supermercado moderno chamado '{nome}'. Mantenha proporções realistas.",
  },
  {
    key: "img_b_url",
    name: "Entrada e Caixas",
    refField: "caixa_ref",
    prompt:
      "Gere uma imagem fotorrealista da área de entrada e caixas de um supermercado moderno chamado '{nome}'. Mostre os caixas de pagamento organizados e a entrada acolhedora.",
    editPrompt:
      "Redesenhe esta área de caixas/entrada para o supermercado '{nome}', modernizando o layout mas mantendo a estrutura geral da imagem.",
  },
  {
    key: "img_c_url",
    name: "Corredores",
    refField: "corredor_ref",
    prompt:
      "Gere uma imagem fotorrealista dos corredores internos de um supermercado moderno chamado '{nome}'. Mostre gôndolas bem organizadas, iluminação clara e sinalização de categorias.",
    editPrompt:
      "Redesenhe este corredor de supermercado para o '{nome}', aplicando um design moderno com boa iluminação e organização, mantendo a perspectiva.",
  },
  {
    key: "img_d_url",
    name: "Interior / Fundo",
    refField: "interno_ref",
    prompt:
      "Gere uma imagem fotorrealista do interior de um supermercado moderno chamado '{nome}'. Mostre seções de produtos, iluminação profissional e decoração atrativa.",
    editPrompt:
      "Redesenhe este interior de supermercado para o '{nome}', modernizando o ambiente mas preservando o layout geral.",
  },
  {
    key: "img_e_url",
    name: "Vista Superior",
    refField: "vista_superior_ref",
    prompt:
      "Gere uma imagem fotorrealista de vista aérea/superior de um supermercado moderno chamado '{nome}'. Mostre o layout das gôndolas e seções de forma organizada, como se visto de cima.",
    editPrompt:
      "Redesenhe esta vista superior/planta do supermercado '{nome}', modernizando a disposição das seções mantendo a estrutura geral.",
  },
];

function fillPrompt(
  template: string,
  vars: Record<string, string>
): string {
  let result = template;
  for (const [k, v] of Object.entries(vars)) {
    result = result.replaceAll(`{${k}}`, v || "");
  }
  return result;
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

async function editImageWithPrompt(
  apiKey: string,
  prompt: string,
  imageUrl: string
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
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
        modalities: ["image", "text"],
      }),
    }
  );

  if (!res.ok) {
    console.error("AI edit error:", res.status, await res.text());
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

      const base64Url = await editImageWithPrompt(
        lovableApiKey,
        customPrompt,
        image_url
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
    const vars = { nome: nome_mercado || "", cidade: cidade || "" };
    const updates: Record<string, string> = {};
    let hasError = false;

    for (const scene of SCENES) {
      console.log(`Processing scene: ${scene.name} (${scene.key})`);

      const refUrl = refs[scene.refField] as string | undefined;
      let base64Url: string | null = null;

      try {
        if (refUrl) {
          // Has reference image -> edit it
          const prompt = fillPrompt(scene.editPrompt, vars);
          console.log(`Editing with reference for ${scene.name}`);
          base64Url = await editImageWithPrompt(lovableApiKey, prompt, refUrl);
        } else {
          // No reference -> generate from scratch
          const prompt = fillPrompt(scene.prompt, vars);
          console.log(`Generating from scratch for ${scene.name}`);
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
