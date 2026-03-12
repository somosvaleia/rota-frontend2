import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://idggnfpdrnnozxmkftgg.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlkZ2duZnBkcm5ub3p4bWtmdGdnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA4MTkyNTEsImV4cCI6MjA4NjM5NTI1MX0.vsbhYX9UyGqF0scFBNiuQKy1fIqoxde1Ucoze6x6wS8';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
