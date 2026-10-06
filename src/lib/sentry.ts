import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';

// DSN jamais en dur : vient de la config EXPO_PUBLIC_SENTRY_DSN (inlinee au
// build/publish par Expo, cf .env / secrets EAS -- voir README Sentry).
// Pas de clef = Sentry desactive silencieusement (utile en dev local sans
// .env, ou tant que le DSN n'a pas encore ete fourni).
const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

// production = build/update publie sur le channel EAS Update "production"
// (cf eas.json). Tout le reste (dev client, preview, local) = "test" --
// Marine n'a demande que ces deux environnements, pas un par profil EAS.
const ENVIRONMENT = Updates.channel === 'production' ? 'production' : 'test';

const APP_VERSION = Constants.expoConfig?.version ?? 'inconnue';

// Cles dont la VALEUR doit etre retiree si elles apparaissent n'importe ou
// dans un evenement (extra/contexts/breadcrumbs) -- email, position precise,
// donnees de sante (carnet de sante). Meme contrat que le scrubbing deja en
// place dans le tracking produit (cf the-pack/tracking.js : "ne jamais
// passer de donnee de sante ni de position precise").
const SENSITIVE_KEY_PATTERN = /email|e-?mail|phone|telephone|tel\b|adresse|address|lat(itude)?|lng|lon(gitude)?|position|geoloc|coord|sante|health|vaccin|carnet|poids|taille_cm/i;

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(v => scrub(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY_PATTERN.test(k) ? '[retiré]' : scrub(v, depth + 1);
    }
    return out;
  }
  return value;
}

export function initSentry() {
  if (!DSN) {
    if (__DEV__) console.log('[sentry] EXPO_PUBLIC_SENTRY_DSN absent, Sentry désactivé');
    return;
  }

  Sentry.init({
    dsn: DSN,
    environment: ENVIRONMENT,
    release: `the-pack-app@${APP_VERSION}`,
    dist: Platform.OS,
    enabled: !__DEV__,
    // Aucune donnee perso par defaut (pas d'IP, pas de cookies, pas de
    // device name) -- seul Sentry.setUser({id}) (cf navigation/index.tsx)
    // identifie un utilisateur, jamais son email.
    sendDefaultPii: false,
    tracesSampleRate: ENVIRONMENT === 'production' ? 0.2 : 1.0,
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.data) breadcrumb.data = scrub(breadcrumb.data) as Record<string, unknown>;
      return breadcrumb;
    },
    beforeSend(event) {
      if (event.user) event.user = event.user.id ? { id: event.user.id } : undefined;
      if (event.request) delete event.request.cookies;
      if (event.extra) event.extra = scrub(event.extra) as Record<string, unknown>;
      if (event.contexts) event.contexts = scrub(event.contexts) as typeof event.contexts;
      return event;
    },
  });

  Sentry.setTag('app_version', APP_VERSION);
  Sentry.setTag('platform', Platform.OS);
  Sentry.setTag('update_channel', Updates.channel || 'none');
}

export function setSentryUser(userId: string | null) {
  if (!DSN) return;
  if (userId) Sentry.setUser({ id: userId });
  else Sentry.setUser(null);
}

export { Sentry };
