import { supabase } from "@/integrations/supabase/client";

const MAX_BYTES = 500 * 1024; // 500KB - evita WORKER_RESOURCE_LIMIT na Edge Function
const MAX_DIMENSION = 1600;

async function compressImage(file: File): Promise<Blob> {
  // Se já é pequeno o suficiente e não é HEIC/etc, retorna direto
  if (file.size <= MAX_BYTES && /^image\/(jpeg|jpg|png|webp)$/i.test(file.type)) {
    return file;
  }

  const dataUrl: string = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });

  const img: HTMLImageElement = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = dataUrl;
  });

  let { width, height } = img;
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    const scale = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(img, 0, 0, width, height);

  // Tenta qualidades decrescentes até <= 500KB
  const qualities = [0.85, 0.75, 0.65, 0.55, 0.45, 0.35];
  for (const q of qualities) {
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", q)
    );
    if (blob && blob.size <= MAX_BYTES) return blob;
    if (q === qualities[qualities.length - 1] && blob) return blob;
  }
  return file;
}

export async function uploadImage(file: File, folder = "referencias") {
  const compressed = await compressImage(file);
  const ext = compressed.type === "image/jpeg" ? "jpg" : (file.name.split(".").pop() || "jpg");
  const fileName = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error } = await supabase.storage
    .from("rota-referencias")
    .upload(fileName, compressed, {
      cacheControl: "3600",
      upsert: false,
      contentType: compressed.type || "image/jpeg",
    });

  if (error) throw error;

  const { data } = supabase.storage
    .from("rota-referencias")
    .getPublicUrl(fileName);

  return data.publicUrl;
}
