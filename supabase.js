import { createClient } from '@supabase/supabase-js'

const url = 'https://sbxcdvmaefkvdogcoldw.supabase.co'
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNieGNkdm1hZWZrdmRvZ2NvbGR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3NjA4NzgsImV4cCI6MjEwODMzNjg3OH0.1MO0tcZkLCKhfzplBnkbSz4hweDVHoSxkM0TCtLasPs'

export const configured = Boolean(url && key)
export const supabase = configured ? createClient(url, key) : null
