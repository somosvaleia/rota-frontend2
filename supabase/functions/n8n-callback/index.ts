import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();

    // Required field
    const projectId = body.project_id;
    if (!projectId) {
      return new Response(
        JSON.stringify({ error: "project_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build update object with only provided fields
    const updateData: Record<string, unknown> = {};

    if (body.img_a_url) updateData.img_a_url = body.img_a_url;
    if (body.img_b_url) updateData.img_b_url = body.img_b_url;
    if (body.img_c_url) updateData.img_c_url = body.img_c_url;
    if (body.img_d_url) updateData.img_d_url = body.img_d_url;
    if (body.img_e_url) updateData.img_e_url = body.img_e_url;
    if (body.video_url) updateData.video_url = body.video_url;
    if (body.status) updateData.status = body.status;

    // Default: if images are sent but no status, mark as "concluido"
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

    // Use service role to bypass RLS
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
