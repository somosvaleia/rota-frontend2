// Edge Function: generate-videos
// Gera 3 vídeos drone via Google Veo 2.0 (Vertex AI) usando imagens aprovadas como starting frame.
// Padrão recursivo: cada invocação processa 1 cena e agenda a próxima, evitando timeout.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

declare const EdgeRuntime: { waitUntil?: (p: Promise<unknown>) => void } | undefined;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VIDEO_KEYS = ["video_url", "video_b_url", "video_c_url", "video_d_url", "video_e_url"] as const;
// Imagens-base para cada vídeo: fachada, corredor, interior, vista drone, vista lateral
const SOURCE_IMAGE_KEYS = ["img_a_url", "img_c_url", "img_e_url", "img_t_url", "img_s_url"] as const;
const TOTAL_SCENES = VIDEO_KEYS.length;
const POLL_DELAY_MS = 15_000;
const MAX_POLL_ATTEMPTS = 80; // ~20 minutos por vídeo sem manter a função presa
const SCENE_PROMPTS = [
  "Cinematic drone shot slowly approaching the storefront facade of a Brazilian neighborhood market. Smooth forward movement, golden hour lighting, photorealistic, no text overlays, no captions, maintain exact visual identity from the reference image.",
  "Smooth steadicam-style drone shot moving through the main aisle of a Brazilian neighborhood market between gondolas. Forward dolly motion, natural store lighting, photorealistic, no text overlays, maintain exact visual identity, products and signage from the reference image.",
  "Slow cinematic drone pull-back revealing the full interior of a Brazilian neighborhood market from above. Smooth ascending motion, photorealistic, natural lighting, no text overlays, maintain exact layout and visual identity from the reference image.",
  "Cinematic aerial drone orbit around a Brazilian neighborhood market, slow 90-degree arc revealing the full building, parking lot and surroundings from a 3/4 high angle. Smooth lateral movement, photorealistic, golden hour, no text overlays, maintain exact architecture, facade, signage and footprint from the reference image.",
  "Low-angle cinematic tracking shot moving sideways past the side facade of a Brazilian neighborhood market, revealing length, materials and entrance at the end. Smooth lateral dolly, natural daylight, photorealistic, no text overlays, maintain exact materials, colors and proportions from the reference image.",
];

// ---------- OAuth: Service Account JWT -> access token ----------
function b64urlFromBytes(bytes: Uint8Array): string {
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function b64url(input: string): string { return b64urlFromBytes(new TextEncoder().encode(input)); }
function pemToDer(pem: string): Uint8Array {
  const b64 = pem.replace(/-----BEGIN [^-]+-----/g, "").replace(/-----END [^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function getAccessToken(): Promise<string> {
  const raw = Deno.env.get("GOOGLE_APPLICATION_CREDENTIALS_JSON");
  if (!raw) throw new Error("GOOGLE_APPLICATION_CREDENTIALS_JSON não configurado");
  const sa = JSON.parse(raw);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600,
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
  const key = await crypto.subtle.importKey(
    "pkcs8", pemToDer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)));
  const jwt = `${unsigned}.${b64urlFromBytes(sig)}`;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  if (!r.ok) throw new Error(`OAuth token falhou: ${r.status} ${await r.text()}`);
  const j = await r.json();
  return j.access_token as string;
}

// ---------- Image fetch -> base64 ----------
async function imageUrlToB64(url: string): Promise<{ b64: string; mime: string } | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const mime = r.headers.get("content-type") || "image/png";
    const buf = new Uint8Array(await r.arrayBuffer());
    let s = ""; for (const b of buf) s += String.fromCharCode(b);
    return { b64: btoa(s), mime };
  } catch { return null; }
}

function delay(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

// ---------- Veo: predict + poll ----------
const PROJECT_ID = Deno.env.get("GOOGLE_CLOUD_PROJECT_ID") || "";
const LOCATION = Deno.env.get("GOOGLE_CLOUD_LOCATION") || "us-central1";
const VEO_MODEL = "veo-2.0-generate-001";

async function veoStart(token: string, prompt: string, image: { b64: string; mime: string } | null): Promise<string> {
  const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${VEO_MODEL}:predictLongRunning`;
  const instance: Record<string, unknown> = { prompt };
  if (image) instance.image = { bytesBase64Encoded: image.b64, mimeType: image.mime };
  const body = {
    instances: [instance],
    parameters: { aspectRatio: "16:9", sampleCount: 1, personGeneration: "allow_adult" },
  };
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Veo start falhou: ${r.status} ${await r.text()}`);
  const j = await r.json();
  if (!j.name) throw new Error(`Veo start sem operation name: ${JSON.stringify(j)}`);
  return j.name as string;
}

function extractVideoResult(payload: any): { b64?: string; gcsUri?: string; mime?: string } | null {
  const videos = payload?.response?.videos || payload?.response?.generatedVideos || payload?.response?.predictions?.[0]?.videos;
  const video = Array.isArray(videos) ? videos[0] : null;
  if (!video) return null;
  return {
    b64: video?.bytesBase64Encoded || video?.video?.bytesBase64Encoded,
    gcsUri: video?.gcsUri || video?.uri || video?.video?.gcsUri || video?.video?.uri,
    mime: video?.mimeType || video?.video?.mimeType || "video/mp4",
  };
}

async function veoPollOnce(token: string, opName: string): Promise<{ done: boolean; b64?: string; gcsUri?: string; mime?: string }> {
  const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${VEO_MODEL}:fetchPredictOperation`;
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ operationName: opName }),
  });
  if (!r.ok) throw new Error(`poll falhou: ${r.status} ${await r.text()}`);
  const j = await r.json();
  if (!j.done) return { done: false };
  if (j.error) throw new Error(`Veo erro: ${JSON.stringify(j.error)}`);
  const result = extractVideoResult(j);
  if (!result?.b64 && !result?.gcsUri) {
    throw new Error(`Veo sem vídeo utilizável: ${JSON.stringify(j.response).slice(0, 500)}`);
  }
  return { done: true, ...result };
}

async function uploadVideo(sb: ReturnType<typeof createClient>, projectId: string, key: string, b64: string): Promise<string | null> {
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return uploadVideoBytes(sb, projectId, key, bytes);
}

async function uploadVideoBytes(sb: ReturnType<typeof createClient>, projectId: string, key: string, bytes: Uint8Array): Promise<string | null> {
  const path = `${projectId}/videos/${key}_${Date.now()}.mp4`;
  const { error } = await sb.storage.from("rota-referencias").upload(path, bytes, { contentType: "video/mp4", upsert: true });
  if (error) { console.error("upload video:", error.message); return null; }
  return sb.storage.from("rota-referencias").getPublicUrl(path).data.publicUrl;
}

async function uploadVideoFromGcsUri(sb: ReturnType<typeof createClient>, projectId: string, key: string, token: string, gcsUri: string): Promise<string | null> {
  const match = gcsUri.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!match) return null;
  const [, bucket, object] = match;
  const url = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(object)}?alt=media`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`download GCS falhou: ${r.status} ${await r.text()}`);
  return uploadVideoBytes(sb, projectId, key, new Uint8Array(await r.arrayBuffer()));
}

// ---------- Self-invoke ----------
async function invokeNext(payload: Record<string, unknown>) {
  try {
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-videos`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      },
      body: JSON.stringify(payload),
    });
    if (!r.ok) console.error("self-invoke vídeo falhou:", r.status, await r.text());
    else await r.text();
  } catch (e) { console.error("self-invoke vídeo erro:", e); }
}
function scheduleNext(payload: Record<string, unknown>, delayMs = 0) {
  const t = (async () => {
    if (delayMs > 0) await delay(delayMs);
    await invokeNext(payload);
  })().catch((e) => console.error(e));
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(t);
}

// ==================== HANDLER ====================
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    const project_id: string = body.project_id;
    const scene_index: number = typeof body.scene_index === "number" ? body.scene_index : -1;
    const operation_name: string | undefined = typeof body.operation_name === "string" ? body.operation_name : undefined;
    const poll_attempt: number = typeof body.poll_attempt === "number" ? body.poll_attempt : 0;

    if (!project_id) return new Response(JSON.stringify({ error: "project_id obrigatório" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!PROJECT_ID) return new Response(JSON.stringify({ error: "GOOGLE_CLOUD_PROJECT_ID não configurado" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Início: agenda cena 0 e responde 202
    if (scene_index < 0) {
      await sb.from("projects").update({ processing_status: "generating_videos", updated_at: new Date().toISOString() }).eq("id", project_id);
      scheduleNext({ project_id, scene_index: 0 });
      return new Response(JSON.stringify({ success: true, queued: true }), { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (scene_index >= 3) {
      await sb.from("projects").update({ processing_status: "videos_completed", updated_at: new Date().toISOString() }).eq("id", project_id);
      return new Response(JSON.stringify({ success: true, done: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: project } = await sb.from("projects").select("*").eq("id", project_id).single();
    if (!project) return new Response(JSON.stringify({ error: "Projeto não encontrado" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const sourceKey = SOURCE_IMAGE_KEYS[scene_index];
    const targetKey = VIDEO_KEYS[scene_index];
    const sourceUrl = (project as Record<string, unknown>)[sourceKey] as string | undefined
      ?? (project as Record<string, unknown>)["img_a_url"] as string | undefined;

    console.log(`[veo] cena ${scene_index} src=${sourceKey} -> ${targetKey}`);

    if (operation_name) {
      const work = (async () => {
        try {
          const token = await getAccessToken();
          const result = await veoPollOnce(token, operation_name);
          if (!result.done) {
            if (poll_attempt >= MAX_POLL_ATTEMPTS) throw new Error("Veo polling timeout");
            scheduleNext({ project_id, scene_index, operation_name, poll_attempt: poll_attempt + 1 }, POLL_DELAY_MS);
            return;
          }

          const url = result.b64
            ? await uploadVideo(sb, project_id, targetKey, result.b64)
            : result.gcsUri
              ? await uploadVideoFromGcsUri(sb, project_id, targetKey, token, result.gcsUri)
              : null;
          if (url) {
            await sb.from("projects").update({ [targetKey]: url, updated_at: new Date().toISOString() }).eq("id", project_id);
            console.log(`[veo] cena ${scene_index} OK: ${url}`);
          }
          scheduleNext({ project_id, scene_index: scene_index + 1 });
        } catch (e) {
          console.error(`[veo] cena ${scene_index} poll erro:`, e instanceof Error ? e.message : e);
          await sb.from("projects").update({ processing_status: `video_${scene_index + 1}_error`, updated_at: new Date().toISOString() }).eq("id", project_id);
          scheduleNext({ project_id, scene_index: scene_index + 1 });
        }
      })();
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(work);
      return new Response(JSON.stringify({ success: true, polling: true, scene: scene_index }), { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Inicia a operação e agenda polling assíncrono. Não segura a função por minutos.
    const work = (async () => {
      try {
        const token = await getAccessToken();
        const img = sourceUrl ? await imageUrlToB64(sourceUrl) : null;
        const prompt = `${SCENE_PROMPTS[scene_index]} Market name: ${project.nome_mercado}.`;
        const opName = await veoStart(token, prompt, img);
        console.log(`[veo] cena ${scene_index} operação: ${opName}`);
        scheduleNext({ project_id, scene_index, operation_name: opName, poll_attempt: 0 }, POLL_DELAY_MS);
      } catch (e) {
        console.error(`[veo] cena ${scene_index} erro:`, e instanceof Error ? e.message : e);
        await sb.from("projects").update({ processing_status: `video_${scene_index + 1}_error`, updated_at: new Date().toISOString() }).eq("id", project_id);
        scheduleNext({ project_id, scene_index: scene_index + 1 });
      }
    })();

    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(work);

    return new Response(JSON.stringify({ success: true, scene: scene_index }), { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("handler erro:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "erro" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
