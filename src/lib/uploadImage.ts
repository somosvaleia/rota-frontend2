import { supabase } from "@/integrations/supabase/client";

export async function uploadImage(file: File, folder = "referencias") {
  const fileExt = file.name.split(".").pop();
  const fileName = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;

  const { error } = await supabase.storage
    .from("rota-referencias")
    .upload(fileName, file, {
      cacheControl: "3600",
      upsert: false,
    });

  if (error) throw error;

  const { data } = supabase.storage
    .from("rota-referencias")
    .getPublicUrl(fileName);

  return data.publicUrl;
}
