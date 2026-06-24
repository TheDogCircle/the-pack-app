import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SUPABASE_URL = 'https://rdioupfyinxcmjascmcb.supabase.co';
const SUPABASE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJkaW91cGZ5aW54Y21qYXNjbWNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4OTM1MDYsImV4cCI6MjA5MDQ2OTUwNn0.1IU-U5wfWMe_7gH98a6P9ClXAuJgChn0lm6Bva9sSwg';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
});
