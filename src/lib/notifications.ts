import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

const CLE_TOKEN_ENREGISTRE = 'push_token_enregistre_v1';
const UN_JOUR_MS = 86400000;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function registerForPushNotifications(): Promise<string | null> {
  try {
    if (!Device.isDevice) return null;

    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;

    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') return null;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'The Pack',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
      });
    }

    // easConfig?.projectId is more reliable in EAS production builds
    const projectId =
      (Constants.easConfig as any)?.projectId ??
      Constants.expoConfig?.extra?.eas?.projectId;

    if (!projectId) return null;

    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    return token;
  } catch {
    return null;
  }
}

export async function savePushToken(userId: string): Promise<void> {
  try {
    const token = await registerForPushNotifications();
    if (!token) return;
    // Deja enregistre pour ce compte il y a moins de 24 h : rien a ecrire
    // (avant : 3 ecritures en base a chaque retour dans l'app).
    try {
      const deja = JSON.parse((await AsyncStorage.getItem(CLE_TOKEN_ENREGISTRE)) || 'null');
      if (deja && deja.u === userId && deja.t === token && Date.now() - deja.at < UN_JOUR_MS) return;
    } catch {}
    // Un token de push identifie un appareil precis, pas un compte : si un autre profil
    // (ex : session precedente sur ce meme telephone) a encore ce token enregistre, on le
    // retire de ce profil-la avant de l'attribuer ici. Sans ca, deux comptes utilises sur
    // le meme telephone (cas frequent : compte marque + compte perso) partagent le meme
    // token -- chacun recoit alors les notifs de l'autre, y compris pour ses propres
    // messages des qu'il envoie dans une conversation ou l'autre compte est membre.
    await supabase.from('profils').update({ push_token: null }).eq('push_token', token).neq('id', userId);
    await supabase.from('profils').update({ push_token: token }).eq('id', userId);

    // device_tokens (Phase 7) : support multi-appareils pour le nouvel outil
    // de campagne admin -- en plus de profils.push_token (inchange, toujours
    // utilise par les notifications produit existantes). Reattribution via
    // une fonction dediee (claim_device_token) et non un upsert direct : la
    // RLS (user_id = auth.uid()) bloquerait silencieusement la reprise de la
    // ligne d'un autre compte ayant utilise ce meme appareil avant.
    const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : null;
    const appVersion = Constants.expoConfig?.version ?? null;
    await supabase.rpc('claim_device_token', { p_token: token, p_platform: platform, p_app_version: appVersion });
    AsyncStorage.setItem(CLE_TOKEN_ENREGISTRE, JSON.stringify({ u: userId, t: token, at: Date.now() })).catch(() => {});
  } catch {}
}

export async function sendPushNotification(
  token: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<void> {
  let ok = false;
  let detail = '';
  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ to: token, title, body, data, sound: 'default', badge: 1 }),
    });
    const json = await res.json().catch(() => null);
    const ticket = json?.data;
    ok = res.ok && ticket?.status === 'ok';
    detail = JSON.stringify({ httpStatus: res.status, ticket });
  } catch (e: any) {
    detail = `exception: ${e?.message || String(e)}`;
  }
  try {
    await supabase.from('push_debug_logs').insert({ to_token: token, title, ok, detail });
  } catch {}
}

export async function clearBadge(): Promise<void> {
  try {
    await Notifications.setBadgeCountAsync(0);
  } catch {}
}
