import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
// Fallback chain — se um modelo retornar 404, tenta o próximo automaticamente.
const GEMINI_IMAGE_MODELS = [
  "gemini-3.1-flash-image-preview",
  "gemini-2.5-flash-image-preview",
  "gemini-2.5-flash-image",
  "gemini-2.0-flash-exp-image-generation",
];

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
    console.error("[WATERMARK]", e instanceof Error ? e.message : String(e));
    return null;
  }
}

async function applyWatermarkBytes(bytes: Uint8Array): Promise<Uint8Array> {
  try {
    const wm = await loadWatermark();
    if (!wm) return bytes;
    const img = await Image.decode(bytes);
    const targetW = Math.round(img.width * 0.14);
    const ratio = wm.height / wm.width;
    const targetH = Math.round(targetW * ratio);
    const wmResized = wm.clone().resize(targetW, targetH);
    const margin = Math.round(img.width * 0.025);
    const x = img.width - targetW - margin;
    const y = img.height - targetH - margin;
    img.composite(wmResized, x, y);
    return await img.encode(1);
  } catch (e) {
    console.error("[WATERMARK]", e instanceof Error ? e.message : String(e));
    return bytes;
  }
}

// ==================== HELPERS ====================

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { project_id, image_key, prompt, image_url } = await req.json();

    if (!project_id || !image_key || !prompt || !image_url) {
      return new Response(
        JSON.stringify({ error: "project_id, image_key, prompt, and image_url are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const lovableKey = Deno.env.get("GEMINI_API_KEY");
    if (!lovableKey) {
      return new Response(
        JSON.stringify({ error: "GEMINI_API_KEY não configurada" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Carrega imagem original como referência
    const refDataUrl = await urlToDataUrl(image_url);
    if (!refDataUrl) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch source image" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const inlineMatch = refDataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!inlineMatch) {
      return new Response(
        JSON.stringify({ error: "Invalid source image data" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const enrichedPrompt = `${prompt}\n\nMantenha o mesmo enquadramento, identidade visual e qualidade fotorrealista da imagem original. CONSTÂNCIA TOTAL com a referência fornecida.`;

    console.log(`[GEMINI/edit] editando ${image_key}`);
    const url = `${GEMINI_API_BASE}/${GEMINI_IMAGE_MODEL}:generateContent?key=${lovableKey}`;
    const aiRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            { text: enrichedPrompt.substring(0, 30000) },
            { inlineData: { mimeType: inlineMatch[1], data: inlineMatch[2] } },
          ],
        }],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
          maxOutputTokens: 8192,
        },
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error(`[GEMINI/edit] ${aiRes.status}: ${errText.substring(0, 400)}`);
      if (aiRes.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit excedido. Aguarde alguns segundos e tente novamente." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ error: `Gemini request failed: ${errText.substring(0, 300)}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiData = await aiRes.json();
    const candParts = aiData.candidates?.[0]?.content?.parts || [];
    let imgUrl: string | undefined;
    for (const p of candParts) {
      const inline = p.inlineData || p.inline_data;
      if (inline?.data) {
        const mimeType = inline.mimeType || inline.mime_type || "image/png";
        imgUrl = `data:${mimeType};base64,${inline.data}`;
        break;
      }
    }
    if (!imgUrl) {
      console.error("[GEMINI/edit] resposta sem imagem:", JSON.stringify(aiData).substring(0, 300));
      return new Response(
        JSON.stringify({ error: "Gemini did not return an image" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const b64 = imgUrl.replace(/^data:image\/\w+;base64,/, "");
    const rawBytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const imageBytes = await applyWatermarkBytes(rawBytes);
    const fileName = `${project_id}/output/edited_${image_key}_${Date.now()}.png`;

    const { error: uploadError } = await supabase.storage
      .from("rota-referencias")
      .upload(fileName, imageBytes, { contentType: "image/png", upsert: true });

    if (uploadError) {
      return new Response(
        JSON.stringify({ error: `Upload failed: ${uploadError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: publicUrlData } = supabase.storage.from("rota-referencias").getPublicUrl(fileName);
    const newUrl = publicUrlData.publicUrl;

    await supabase.from("projects").update({
      [image_key]: newUrl, updated_at: new Date().toISOString(),
    }).eq("id", project_id);

    return new Response(
      JSON.stringify({ success: true, new_url: newUrl }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
