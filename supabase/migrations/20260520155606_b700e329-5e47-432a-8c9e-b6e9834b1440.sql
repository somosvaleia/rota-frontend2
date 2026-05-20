ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS share_token uuid UNIQUE DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS share_enabled boolean NOT NULL DEFAULT false;

UPDATE public.projects SET share_token = gen_random_uuid() WHERE share_token IS NULL;

CREATE POLICY "Public can view shared projects by token"
ON public.projects
FOR SELECT
TO anon, authenticated
USING (share_enabled = true);