import { useCallback, useState } from "react";
import { X, Image as ImageIcon, Loader2 } from "lucide-react";
import { uploadImage } from "@/lib/uploadImage";

interface ImageUploadProps {
  label: string;
  description?: string;
  value?: string;
  onChange: (url: string | undefined) => void;
}

export default function ImageUpload({ label, description, value, onChange }: ImageUploadProps) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);

  const handleFile = useCallback(async (file: File) => {
    try {
      setUploading(true);
      const url = await uploadImage(file);
      onChange(url);
    } catch (error) {
      console.error("Erro no upload:", error);
      alert("Erro ao enviar imagem");
    } finally {
      setUploading(false);
    }
  }, [onChange]);

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-foreground">{label}</label>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}

      {value ? (
        <div className="relative group rounded-lg overflow-hidden border border-border">
          <img src={value} alt={label} className="w-full h-40 object-cover" />
          <button
            onClick={() => onChange(undefined)}
            className="absolute top-2 right-2 w-7 h-7 rounded-full bg-background/80 backdrop-blur flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-destructive"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file && file.type.startsWith("image/")) handleFile(file);
          }}
          className={`relative border-2 border-dashed rounded-lg h-40 flex flex-col items-center justify-center gap-2 cursor-pointer transition-all ${
            dragOver ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground"
          }`}
        >
          <input
            type="file"
            accept="image/*"
            className="absolute inset-0 opacity-0 cursor-pointer"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
          {uploading ? <Loader2 className="w-8 h-8 animate-spin" /> : <ImageIcon className="w-8 h-8 text-muted-foreground" />}
          <span className="text-xs text-muted-foreground">
            {uploading ? "Enviando imagem..." : "Arraste ou clique para enviar"}
          </span>
        </div>
      )}
    </div>
  );
}
