ALTER TABLE public.projects
ADD COLUMN IF NOT EXISTS processing_status text NOT NULL DEFAULT 'uploaded',
ADD COLUMN IF NOT EXISTS paused_at_step text,
ADD COLUMN IF NOT EXISTS structural_analysis_json jsonb NOT NULL DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS visual_identity_json jsonb NOT NULL DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS overhead_image_url text,
ADD COLUMN IF NOT EXISTS overhead_prompt text,
ADD COLUMN IF NOT EXISTS user_revision_notes text NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS approved_steps jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_projects_processing_status ON public.projects(processing_status);