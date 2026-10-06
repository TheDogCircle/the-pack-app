import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from './supabase';

// Compare "1.2.3" vs "1.10.0" numeriquement composant par composant --
// une comparaison de chaines classerait a tort "1.10.0" avant "1.2.3".
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export type VersionCheckResult = {
  blocked: boolean;
  updateAvailable: boolean;
  minVersion?: string;
  latestVersion?: string;
};

// Echec reseau ou cle manquante : on laisse passer (fail-open) -- un
// probleme de reseau au demarrage ne doit jamais bloquer l'app a tort.
export async function checkAppVersion(): Promise<VersionCheckResult> {
  const fallback: VersionCheckResult = { blocked: false, updateAvailable: false };
  try {
    const currentVersion = Constants.expoConfig?.version;
    if (!currentVersion) return fallback;
    const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : null;
    if (!platform) return fallback;

    const { data, error } = await supabase
      .from('app_settings')
      .select('key, value')
      .in('key', ['min_app_version', 'latest_app_version']);
    if (error || !data) return fallback;

    const minVersion: string | undefined = data.find((r) => r.key === 'min_app_version')?.value?.[platform];
    const latestVersion: string | undefined = data.find((r) => r.key === 'latest_app_version')?.value?.[platform];

    return {
      blocked: !!minVersion && compareVersions(currentVersion, minVersion) < 0,
      updateAvailable: !!latestVersion && compareVersions(currentVersion, latestVersion) < 0,
      minVersion,
      latestVersion,
    };
  } catch {
    return fallback;
  }
}

export function getStoreUrl(): string {
  return Platform.OS === 'ios'
    ? 'https://apps.apple.com/app/id6780366952'
    : 'https://play.google.com/store/apps/details?id=fr.thepackclub.app';
}
