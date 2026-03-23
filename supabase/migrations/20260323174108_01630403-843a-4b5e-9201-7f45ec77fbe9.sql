
-- Create projects table
CREATE TABLE public.projects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  nome_mercado TEXT NOT NULL,
  cidade TEXT NOT NULL DEFAULT '',
  observacoes TEXT DEFAULT '',
  categorias JSONB DEFAULT '[]'::jsonb,
  imagens JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'processando' CHECK (status IN ('rascunho', 'processando', 'concluido', 'erro')),
  img_a_url TEXT,
  img_b_url TEXT,
  img_c_url TEXT,
  img_d_url TEXT,
  img_e_url TEXT,
  video_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- Users can read their own projects
CREATE POLICY "Users can read own projects"
  ON public.projects FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can insert their own projects
CREATE POLICY "Users can insert own projects"
  ON public.projects FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own projects
CREATE POLICY "Users can update own projects"
  ON public.projects FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own projects
CREATE POLICY "Users can delete own projects"
  ON public.projects FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Service role can update any project (for webhook callbacks)
CREATE POLICY "Service role full access"
  ON public.projects FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Enable realtime for projects
ALTER PUBLICATION supabase_realtime ADD TABLE public.projects;

-- Create storage bucket for reference images
INSERT INTO storage.buckets (id, name, public)
VALUES ('rota-referencias', 'rota-referencias', true);

-- Storage policies: authenticated users can upload
CREATE POLICY "Authenticated users can upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'rota-referencias');

-- Anyone can view (public bucket)
CREATE POLICY "Public read access"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'rota-referencias');

-- Users can delete their own uploads
CREATE POLICY "Authenticated users can delete own uploads"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'rota-referencias');
