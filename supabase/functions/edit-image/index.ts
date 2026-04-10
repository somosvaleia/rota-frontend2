import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GOOGLE_AI_BASE = "https://generativelanguage.googleapis.com/v1beta";

async function urlToBase64Part(url: string) {
  const res = await fetch(url);
  if (!res.ok) return null;
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const b64 = btoa(binary);
  const ct = res.headers.get("content-type") || "image/png";
  return { inlineData: { mimeType: ct, data: b64 } };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { project_id, image_key, prompt, image_url } = await req.json();

    if (!project_id || !image_key || !prompt || !image_url) {
      return new Response(
        JSON.stringify({ error: "project_id, image_key, prompt, and image_url are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const googleApiKey = Deno.env.get("GOOGLE_AI_API_KEY");
    if (!googleApiKey) {
      return new Response(
        JSON.stringify({ error: "GOOGLE_AI_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Convert reference image to inline data
    const imgPart = await urlToBase64Part(image_url);
    if (!imgPart) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch source image" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Call Gemini to edit the image
    const aiUrl = `${GOOGLE_AI_BASE}/models/gemini-2.0-flash-exp:generateContent?key=${googleApiKey}`;
    const aiResponse = await fetch(aiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            imgPart,
          ],
        }],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
        },
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      return new Response(
        JSON.stringify({ error: `AI request failed: ${errText}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiData = await aiResponse.json();
    const candidateParts = aiData.candidates?.[0]?.content?.parts || [];
    let editedBase64: string | null = null;
    for (const p of candidateParts) {
      if (p.inlineData) {
        editedBase64 = `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`;
        break;
      }
    }

    if (!editedBase64) {
      return new Response(
        JSON.stringify({ error: "AI did not return an edited image" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Upload the edited image
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const base64Data = editedBase64.replace(/^data:image\/\w+;base64,/, "");
    const imageBytes = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
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
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
