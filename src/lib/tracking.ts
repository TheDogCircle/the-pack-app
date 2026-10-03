// Module de tracking produit mobile. Ecrit dans la table `events` (Phase 3,
// cf docs/tracking-plan.md dans le repo web the-pack). Meme API que le
// module jumeau web (the-pack/tracking.js) : track(eventName, properties),
// implementation separee -- pas de monorepo partage entre les deux repos.
//
// Contrat : ne jamais passer de donnee de sante (carnet de sante, vaccins...)
// ni de position precise (lat/lng exacts) dans `properties` -- ville ou
// geohash grossier seulement si la position compte pour l'evenement.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';

const QUEUE_KEY = 'tp_track_queue';
const ANON_ID_KEY = 'tp_anonymous_id';
const SESSION_ID = uuid(); // un id par lancement de l'app, pas persiste
const FLUSH_INTERVAL_MS = 8000;
const BATCH_SIZE = 20;
const SUPABASE_URL = 'https://rdioupfyinxcmjascmcb.supabase.co';
const SUPABASE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJkaW91cGZ5aW54Y21qYXNjbWNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4OTM1MDYsImV4cCI6MjA5MDQ2OTUwNn0.1IU-U5wfWMe_7gH98a6P9ClXAuJgChn0lm6Bva9sSwg';

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const platform: 'ios' | 'android' | 'web' =
  Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';

const appVersion = Constants.expoConfig?.version || null;
const deviceModel = Device.modelName || null;
const osVersion = Device.osVersion || null;

let anonymousIdCache: string | null = null;
async function getAnonymousId(): Promise<string> {
  if (anonymousIdCache) return anonymousIdCache;
  let id = await AsyncStorage.getItem(ANON_ID_KEY);
  if (!id) { id = uuid(); await AsyncStorage.setItem(ANON_ID_KEY, id); }
  anonymousIdCache = id;
  return id;
}

async function readQueue(): Promise<any[]> {
  try { return JSON.parse((await AsyncStorage.getItem(QUEUE_KEY)) || '[]'); } catch { return []; }
}
async function writeQueue(q: any[]): Promise<void> {
  try { await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch { /* noop */ }
}

export async function track(eventName: string, properties?: Record<string, unknown>): Promise<void> {
  if (!eventName) return;
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id || null;
  const row = {
    user_id: userId,
    anonymous_id: userId ? null : await getAnonymousId(),
    event_name: eventName,
    properties: properties || {},
    platform,
    app_version: appVersion,
    device_model: deviceModel,
    os_version: osVersion,
    session_id: SESSION_ID,
  };
  const queue = await readQueue();
  queue.push(row);
  await writeQueue(queue);
}

export async function flushTrackQueue(): Promise<void> {
  const queue = await readQueue();
  if (!queue.length) return;
  const batch = queue.slice(0, BATCH_SIZE);
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || SUPABASE_KEY;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${token}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(batch),
    });
    if (!res.ok) throw new Error('flush failed: ' + res.status);
    await writeQueue(queue.slice(batch.length));
  } catch {
    // Reste en file, retente au prochain flush -- pas de perte silencieuse,
    // juste un delai si hors-ligne ou API indisponible.
  }
}

let flushInterval: ReturnType<typeof setInterval> | null = null;
export function startTrackingFlushLoop(): void {
  if (flushInterval) return;
  flushInterval = setInterval(flushTrackQueue, FLUSH_INTERVAL_MS);
  flushTrackQueue();
}

// app_open etait compte deux fois par lancement : le useEffect de App.tsx
// l'appelle directement au montage, et l'ecouteur AppState peut aussi se
// declencher une fois de plus pendant la sequence de demarrage (transition
// rapide background->active le temps que l'app finisse de charger). Un
// garde-fou de 3s suffit -- deux vrais lancements ne peuvent pas se produire
// aussi rapproches.
const APP_OPEN_DEBOUNCE_MS = 3000;
let lastAppOpenAt = 0;
export function trackAppOpen(): void {
  const now = Date.now();
  if (now - lastAppOpenAt < APP_OPEN_DEBOUNCE_MS) return;
  lastAppOpenAt = now;
  track('app_open');
}
