import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ==================== WATERMARK ====================

const WATERMARK_URL = "https://djjafjvywyvuzpkjuqjl.supabase.co/storage/v1/object/public/rota-referencias/_brand/rota-watermark.png";
let cachedWatermark: Image | null = null;

async function loadWatermark(): Promise<Image | null> {
  if (cachedWatermark) return cachedWatermark;
  try {
    const res = await fetch(WATERMARK_URL);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    cachedWatermark = await Image.decode(buf);
    return cachedWatermark;
  } catch (_e) {
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
    console.error("[WATERMARK] falha:", e instanceof Error ? e.message : String(e));
    return bytes;
  }
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

// ==================== HELPERS ====================

function getVertexBaseUrl(): string {
  const project = Deno.env.get("GOOGLE_CLOUD_PROJECT_ID") || "rota-489018";
  const location = Deno.env.get("GOOGLE_CLOUD_LOCATION") || "us-central1";
  return `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}`;
}

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

    // Get Vertex AI access token
    let accessToken: string;
    try {
      accessToken = await getAccessToken();
    } catch (authErr) {
      return new Response(
        JSON.stringify({ error: `Authentication failed: ${authErr.message}` }),
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

    // Call Vertex AI Gemini to edit the image
    const baseUrl = getVertexBaseUrl();
    const aiUrl = `${baseUrl}/publishers/google/models/gemini-2.0-flash-exp:generateContent`;
    const aiResponse = await fetch(aiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
      },
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
    const rawBytes = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
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
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
