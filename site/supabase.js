import { createClient } from '@supabase/supabase-js'

// Adresse et clé publique (anon) du projet Supabase.
// Cette clé peut être publique : ce sont les règles de la base qui protègent les données.
const url = import.meta.env.VITE_SUPABASE_URL || 'https://sbxcdvmaefkvdogcoldw.supabase.co'
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNieGNkdm1hZWZrdmRvZ2NvbGR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3NjA4NzgsImV4cCI6MjEwODMzNjg3OH0.1MO0tcZkLCKhfzplBnkbSz4hweDVHoSxkM0TCtLasPs'

export const configured = Boolean(url && key)
export const supabase = configured ? createClient(url, key) : null
