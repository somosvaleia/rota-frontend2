import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

async function fetchImageAsFile(url: string, filename: string, maxBytes = 4_000_000): Promise<File | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > maxBytes) return null;
    const ct = res.headers.get("content-type") || "image/png";
    const ext = ct.includes("jpeg") || ct.includes("jpg") ? "jpg" : ct.includes("webp") ? "webp" : "png";
    return new File([buf], `${filename}.${ext}`, { type: ct });
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

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return new Response(
        JSON.stringify({ error: "OPENAI_API_KEY não configurada" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Carrega imagem original como referência para edição
    const refFile = await fetchImageAsFile(image_url, "original");
    if (!refFile) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch source image" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Edita via OpenAI gpt-image-1 /images/edits
    const form = new FormData();
    form.append("model", "gpt-image-1");
    form.append("prompt", `${prompt}\n\nMantenha o mesmo enquadramento, identidade visual e qualidade fotorrealista da imagem original.`.substring(0, 32000));
    form.append("size", "1536x1024");
    form.append("quality", "high");
    form.append("n", "1");
    form.append("image[]", refFile);

    console.log(`[OPENAI/edit] editando ${image_key}`);
    const aiRes = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: form,
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error(`[OPENAI/edit] ${aiRes.status}: ${errText.substring(0, 400)}`);
      return new Response(
        JSON.stringify({ error: `OpenAI request failed: ${errText.substring(0, 300)}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiData = await aiRes.json();
    const b64 = aiData.data?.[0]?.b64_json;
    if (!b64) {
      return new Response(
        JSON.stringify({ error: "OpenAI did not return an image" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

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
