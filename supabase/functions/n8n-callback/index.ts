import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const IMAGE_KEYS = [
  "img_a_url", "img_b_url", "img_c_url", "img_d_url", "img_e_url",
  "img_f_url", "img_g_url", "img_h_url", "img_i_url", "img_j_url",
  "img_k_url", "img_l_url", "img_m_url", "img_n_url", "img_o_url",
  "img_p_url", "img_q_url", "img_r_url", "img_s_url", "img_t_url",
];

const VIDEO_KEYS = ["video_url", "video_b_url", "video_c_url"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();

    const projectId = body.project_id;
    if (!projectId) {
      return new Response(
        JSON.stringify({ error: "project_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const updateData: Record<string, unknown> = {};

    for (const key of [...IMAGE_KEYS, ...VIDEO_KEYS]) {
      if (body[key]) updateData[key] = body[key];
    }

    if (body.status) updateData.status = body.status;

    if (!body.status && Object.keys(updateData).length > 0) {
      updateData.status = "concluido";
    }

    if (Object.keys(updateData).length === 0) {
      return new Response(
        JSON.stringify({ error: "No fields to update" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    updateData.updated_at = new Date().toISOString();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data, error } = await supabase
      .from("projects")
      .update(updateData)
      .eq("id", projectId)
      .select()
      .single();

    if (error) {
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, project: data }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
