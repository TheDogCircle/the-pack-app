import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const BALADE_TASK_NAME = 'thepack-balade-tracking';
const TRACE_KEY = 'thepack_balade_trace';
const START_KEY = 'thepack_balade_start_ms';

// Filtre le bruit GPS (~3m) — meme seuil que l'ancien suivi premier-plan.
const MIN_SEGMENT_KM = 0.003;

export type BaladePoint = { latitude: number; longitude: number; t: number };

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Definie au niveau module (pas dans un composant) : c'est ce qui permet a
// l'OS de relancer ce callback meme quand l'app est en arriere-plan ou
// suspendue. Le seul canal fiable pour persister les points recus dans ce
// contexte est le stockage local (AsyncStorage) — l'etat React du composant
// CarteScreen n'existe pas forcement au moment ou ce callback s'execute.
TaskManager.defineTask(BALADE_TASK_NAME, async ({ data, error }) => {
  if (error) return;
  const locations = (data as any)?.locations as Location.LocationObject[] | undefined;
  if (!locations?.length) return;
  try {
    const [raw, startRaw] = await Promise.all([
      AsyncStorage.getItem(TRACE_KEY),
      AsyncStorage.getItem(START_KEY),
    ]);
    const trace: BaladePoint[] = raw ? JSON.parse(raw) : [];
    const startMs = startRaw ? parseInt(startRaw, 10) : Date.now();
    let changed = false;
    for (const loc of locations) {
      const { latitude, longitude } = loc.coords;
      const last = trace[trace.length - 1];
      if (last && haversineKm(last.latitude, last.longitude, latitude, longitude) < MIN_SEGMENT_KM) continue;
      trace.push({ latitude, longitude, t: Math.round((Date.now() - startMs) / 1000) });
      changed = true;
    }
    if (changed) await AsyncStorage.setItem(TRACE_KEY, JSON.stringify(trace));
  } catch {}
});

async function registerLocationUpdates() {
  await Location.startLocationUpdatesAsync(BALADE_TASK_NAME, {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 3000,
    distanceInterval: 5,
    showsBackgroundLocationIndicator: true,
    pausesUpdatesAutomatically: false,
    foregroundService: {
      notificationTitle: 'Balade en cours 🐾',
      notificationBody: 'The Pack Club enregistre ton trajet.',
      notificationColor: '#3D1A1A',
    },
  });
}

// Premier demarrage : reinitialise la trace persistee et repart de zero.
export async function startBaladeBackgroundTracking(initial: BaladePoint) {
  await AsyncStorage.setItem(START_KEY, String(Date.now()));
  await AsyncStorage.setItem(TRACE_KEY, JSON.stringify([initial]));
  await registerLocationUpdates();
}

// Reprise apres une pause : NE touche pas a la trace/heure de depart deja
// persistees, se contente de reenregistrer les mises a jour de position.
export async function resumeBaladeBackgroundTracking() {
  await registerLocationUpdates();
}

export async function stopBaladeBackgroundTracking() {
  const running = await TaskManager.isTaskRegisteredAsync(BALADE_TASK_NAME).catch(() => false);
  if (running) await Location.stopLocationUpdatesAsync(BALADE_TASK_NAME).catch(() => {});
}

export async function getBaladeTrace(): Promise<BaladePoint[]> {
  const raw = await AsyncStorage.getItem(TRACE_KEY);
  return raw ? JSON.parse(raw) : [];
}

export async function getBaladeStartMs(): Promise<number | null> {
  const raw = await AsyncStorage.getItem(START_KEY);
  return raw ? parseInt(raw, 10) : null;
}

export async function clearBaladeTrace() {
  await AsyncStorage.multiRemove([TRACE_KEY, START_KEY]);
}

export function distanceKmOf(trace: BaladePoint[]): number {
  let total = 0;
  for (let i = 1; i < trace.length; i++) {
    total += haversineKm(trace[i - 1].latitude, trace[i - 1].longitude, trace[i].latitude, trace[i].longitude);
  }
  return total;
}
