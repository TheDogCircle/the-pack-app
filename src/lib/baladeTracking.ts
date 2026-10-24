import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Suivi GPS d'une balade, y compris en arriere-plan : la tache ci-dessous ecrit
// la trace dans AsyncStorage (seule source fiable quand l'app est suspendue),
// l'ecran la relit pour l'affichage.
//
// Fiabilite des stats (prerequis du classement de la semaine) :
// - heure de chaque point = heure de la MESURE (loc.timestamp), pas de son
//   traitement : en arriere-plan iOS livre les positions par paquets, l'ancien
//   Date.now() donnait la meme heure a tout un paquet et faussait l'allure ;
// - points imprecis (> 35 m) ignores : un point mal place ajoutait de la distance ;
// - segment trop rapide (> 15 km/h) ou trop long (> 300 m d'un coup) : le point
//   ouvre un nouveau segment (b: 1) dont la distance n'est pas comptee -- un
//   trajet en voiture ou un saut GPS n'ajoute rien ;
// - les pauses sont exclues de la duree, et la reprise ouvre un nouveau segment.

export const BALADE_TASK_NAME = 'thepack-balade-tracking';
const TRACE_KEY = 'thepack_balade_trace';
const START_KEY = 'thepack_balade_start_ms';
const PAUSE_TOTAL_KEY = 'thepack_balade_pause_total_ms';
const PAUSE_START_KEY = 'thepack_balade_pause_start_ms';
const NEXT_BREAK_KEY = 'thepack_balade_next_break';

const MIN_SEGMENT_KM = 0.003;
const MAX_PRECISION_M = 35;
const MAX_VITESSE_KMH = 15;
const MAX_SEGMENT_KM = 0.3;

// b: 1 = debut d'un nouveau segment (reprise apres pause, saut GPS, vehicule)
export type BaladePoint = { latitude: number; longitude: number; t: number; b?: 1 };

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function appendLocations(locations: Location.LocationObject[]) {
  if (!locations.length) return;
  try {
    const [[, raw], [, startRaw], [, pauseRaw], [, breakRaw]] = await AsyncStorage.multiGet([
      TRACE_KEY, START_KEY, PAUSE_TOTAL_KEY, NEXT_BREAK_KEY,
    ]);
    const trace: BaladePoint[] = raw ? JSON.parse(raw) : [];
    const startMs = startRaw ? parseInt(startRaw, 10) : Date.now();
    const pauseTotal = pauseRaw ? parseInt(pauseRaw, 10) : 0;
    let nouveauSegment = breakRaw === '1';
    let changed = false;
    const tries = [...locations].sort((a, b) => a.timestamp - b.timestamp);
    for (const loc of tries) {
      const { latitude, longitude, accuracy } = loc.coords;
      if (accuracy != null && accuracy > MAX_PRECISION_M) continue;
      const t = Math.max(0, Math.round((loc.timestamp - startMs - pauseTotal) / 1000));
      const last = trace[trace.length - 1];
      if (last) {
        const km = haversineKm(last.latitude, last.longitude, latitude, longitude);
        if (km < MIN_SEGMENT_KM && !nouveauSegment) continue;
        const dt = t - last.t;
        const vitesse = dt > 0 ? km / (dt / 3600) : Infinity;
        if (km > MAX_SEGMENT_KM || (km > 0.02 && vitesse > MAX_VITESSE_KMH)) nouveauSegment = true;
      }
      trace.push(nouveauSegment && last ? { latitude, longitude, t, b: 1 } : { latitude, longitude, t });
      nouveauSegment = false;
      changed = true;
    }
    if (changed) {
      await AsyncStorage.setItem(TRACE_KEY, JSON.stringify(trace));
      if (breakRaw === '1') await AsyncStorage.removeItem(NEXT_BREAK_KEY);
    }
  } catch {}
}

TaskManager.defineTask(BALADE_TASK_NAME, async ({ data, error }) => {
  if (error) return;
  const locations = (data as any)?.locations as Location.LocationObject[] | undefined;
  await appendLocations(locations ?? []);
});

async function registerLocationUpdates() {
  await Location.startLocationUpdatesAsync(BALADE_TASK_NAME, {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 3000,
    distanceInterval: 5,
    showsBackgroundLocationIndicator: true,
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.Fitness,
    foregroundService: {
      notificationTitle: 'Balade en cours 🐾',
      notificationBody: 'The Pack La Meute enregistre ton trajet.',
      notificationColor: '#3D1A1A',
    },
  });
}

export async function startBaladeBackgroundTracking(initial: BaladePoint) {
  await AsyncStorage.multiRemove([PAUSE_TOTAL_KEY, PAUSE_START_KEY, NEXT_BREAK_KEY]);
  await AsyncStorage.multiSet([
    [START_KEY, String(Date.now())],
    [TRACE_KEY, JSON.stringify([initial])],
  ]);
  await registerLocationUpdates();
}

export async function pauseBaladeBackgroundTracking() {
  await stopBaladeBackgroundTracking();
  await AsyncStorage.setItem(PAUSE_START_KEY, String(Date.now()));
}

export async function resumeBaladeBackgroundTracking() {
  const [[, pauseStartRaw], [, totalRaw]] = await AsyncStorage.multiGet([PAUSE_START_KEY, PAUSE_TOTAL_KEY]);
  if (pauseStartRaw) {
    const total = (totalRaw ? parseInt(totalRaw, 10) : 0) + (Date.now() - parseInt(pauseStartRaw, 10));
    await AsyncStorage.multiSet([[PAUSE_TOTAL_KEY, String(total)], [NEXT_BREAK_KEY, '1']]);
    await AsyncStorage.removeItem(PAUSE_START_KEY);
  }
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

// Duree de marche effective, pauses exclues (pause en cours comprise)
export async function getBaladeElapsedSec(): Promise<number | null> {
  const [[, startRaw], [, totalRaw], [, pauseStartRaw]] = await AsyncStorage.multiGet([
    START_KEY, PAUSE_TOTAL_KEY, PAUSE_START_KEY,
  ]);
  if (!startRaw) return null;
  const now = Date.now();
  const pauses = (totalRaw ? parseInt(totalRaw, 10) : 0) + (pauseStartRaw ? now - parseInt(pauseStartRaw, 10) : 0);
  return Math.max(0, Math.round((now - parseInt(startRaw, 10) - pauses) / 1000));
}

export async function clearBaladeTrace() {
  await AsyncStorage.multiRemove([TRACE_KEY, START_KEY, PAUSE_TOTAL_KEY, PAUSE_START_KEY, NEXT_BREAK_KEY]);
}

// Distance des segments marches (un point b: 1 ouvre un segment non relie au precedent)
export function distanceKmOf(trace: BaladePoint[]): number {
  let total = 0;
  for (let i = 1; i < trace.length; i++) {
    if (trace[i].b) continue;
    total += haversineKm(trace[i - 1].latitude, trace[i - 1].longitude, trace[i].latitude, trace[i].longitude);
  }
  return total;
}
