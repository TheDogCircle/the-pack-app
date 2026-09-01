import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const SUPABASE_URL = 'https://rdioupfyinxcmjascmcb.supabase.co';
const SUPABASE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJkaW91cGZ5aW54Y21qYXNjbWNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4OTM1MDYsImV4cCI6MjA5MDQ2OTUwNn0.1IU-U5wfWMe_7gH98a6P9ClXAuJgChn0lm6Bva9sSwg';

const R2_WORKER_URL = 'https://the-pack-upload.thedogcircleclub.workers.dev';
const R2_WORKER_SECRET = '5fcf2f9b8287130b8ce3133fa57e5472454aa1fbae68d4b97a96f9b9b21be632';

export async function uploadToR2(localUri: string, r2Key: string): Promise<string> {
  const ext = localUri.split('.').pop()?.toLowerCase() || 'jpg';
  const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';

  const formData = new FormData();
  formData.append('file', { uri: localUri, type: mimeType, name: `photo.${ext}` } as any);
  formData.append('key', r2Key);

  const response = await fetch(R2_WORKER_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${R2_WORKER_SECRET}` },
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Upload R2 échoué (${response.status}): ${text}`);
  }

  const { url } = await response.json();
  return url;
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'implicit',
  },
});

const APP_SESSION_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function trackEvent(
  eventType: 'page_view' | 'click',
  page: string,
  opts: { target_type?: string; target_id?: string; action?: string } = {}
) {
  supabase
    .from('analytics_events')
    .insert({
      event_type: eventType,
      page,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      session_id: APP_SESSION_ID,
      ...opts,
    })
    .then(
      () => {},
      () => {}
    );
}
