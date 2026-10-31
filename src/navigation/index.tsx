import React, { useEffect, useState } from 'react';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Image, Linking, AppState, View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { savePushToken, clearBadge } from '../lib/notifications';
import { track } from '../lib/tracking';
import { usePastillesActives } from '../lib/pastilles';
import { mapNavigation } from '../lib/mapNavigation';
import SplashLoader from '../components/SplashLoader';

import { useSession } from '../hooks/useSession';
import { setSentryUser } from '../lib/sentry';
import AuthScreen from '../screens/AuthScreen';
import CarteScreen from '../screens/CarteScreen';
import FeedScreen from '../screens/FeedScreen';
import PartenairesScreen from '../screens/PartenairesScreen';

import EvenementsScreen from '../screens/EvenementsScreen';
import ProfilScreen from '../screens/ProfilScreen';
import ProfilPublicScreen from '../screens/ProfilPublicScreen';
import SettingsScreen from '../screens/SettingsScreen';
import BookingScreen from '../screens/BookingScreen';
import MesReservationsScreen from '../screens/MesReservationsScreen';
import ClassementScreen from '../screens/ClassementScreen';
import AnniversairesScreen from '../screens/AnniversairesScreen';
import CarnetSanteScreen from '../screens/CarnetSanteScreen';
import ContactScreen from '../screens/ContactScreen';
import ContactDetailScreen from '../screens/ContactDetailScreen';
import IdeesScreen from '../screens/IdeesScreen';
import MessagesScreen from '../screens/MessagesScreen';
import BulleMessages from '../components/BulleMessages';
import ActiviteScreen, { activityLastSeenKey } from '../screens/ActiviteScreen';
import OnboardingScreen from '../screens/OnboardingScreen';
import CompleteProfileModal, { MissingFields } from '../components/CompleteProfileModal';
import NpsPromptModal, { NpsPending } from '../components/NpsPromptModal';
import NouveautesModal from '../components/NouveautesModal';
import { colors } from '../lib/theme';

export type RootStackParamList = {
  Tabs: undefined;
  Onboarding: undefined;
  Auth: undefined;
  ProfilPublic: { userId: string; prenom: string; avatarUrl?: string };
  Settings: undefined;
  Booking: { lieuId: string; lieuNom: string };
  MesReservations: undefined;
  Classement: undefined;
  Anniversaires: undefined;
  Activite: undefined;
  CarnetSante: { chienId: string; chienNom: string };
  Contact: undefined;
  ContactDetail: { ticketId: string };
  Idees: undefined;
  // t : change a chaque demande, pour rouvrir la meme conversation si besoin
  Messages: { conversationId?: string; t?: number } | undefined;
};

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator<RootStackParamList>();

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];
const TAB_ICONS: Record<string, { active: IoniconsName; inactive: IoniconsName }> = {
  Explorer:    { active: 'compass',         inactive: 'compass-outline' },
  Carte:       { active: 'map',             inactive: 'map-outline' },
  Events:      { active: 'calendar',        inactive: 'calendar-outline' },
  Meute:       { active: 'people',          inactive: 'people-outline' },
  Services:    { active: 'ribbon',          inactive: 'ribbon-outline' },
  Profil:      { active: 'person-circle',   inactive: 'person-circle-outline' },
};

function renderMeuteHeartButton(navigation: any, activityBadge: boolean, setActivityBadge: (v: boolean) => void) {
  return (
    <TouchableOpacity
      style={headerStyles.heartBtn}
      onPress={() => { setActivityBadge(false); navigation.navigate('Activite' as any); }}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Ionicons name="heart-outline" size={22} color={colors.ivory} />
      {activityBadge ? <View style={headerStyles.heartDot} /> : null}
    </TouchableOpacity>
  );
}

function bottomTabSeenKey(tab: string, userId: string) {
  return `thepack_bottomtab_seen_${tab}_${userId}`;
}

// Suivi des sections visitees (cockpit admin > "Ce qui interesse les utilisateurs").
// Un evenement par changement d'ecran ; les sous-onglets Fil / Messages / Membres
// de la Meute sont suivis par FeedScreen lui-meme.
const NOMS_ECRANS: Record<string, string> = {
  Carte: 'Carte', Events: 'Events', Services: 'Partenaires', Profil: 'Mon profil',
  Classement: 'Balades & classement', MesReservations: 'Mes rendez-vous', Settings: 'Paramètres',
  CarnetSante: 'Carnet de santé', ProfilPublic: "Profil d'un membre", Activite: 'Activité',
  Anniversaires: 'Anniversaires', Booking: 'Réservation', Idees: 'Idées', Contact: 'Contact', ContactDetail: 'Contact',
  Messages: 'Messages',
};
let dernierEcran: string | null = null;
function suivreEcran() {
  const nom = navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name : undefined;
  if (!nom || nom === dernierEcran) return;
  dernierEcran = nom;
  const section = NOMS_ECRANS[nom];
  if (section) track('screen_viewed', { screen: section });
}

function MainTabs() {
  const { session } = useSession();
  const insets = useSafeAreaInsets();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [meuteBadge, setMeuteBadge] = useState(false);
  const [partBadge, setPartBadge] = useState(false);
  const [carteBadge, setCarteBadge] = useState(false);
  const [eventsBadge, setEventsBadge] = useState(false);
  const [profilBadge, setProfilBadge] = useState(false);
  const [activityBadge, setActivityBadge] = useState(false);
  const pastilles = usePastillesActives();

  useEffect(() => {
    if (!session) { setAvatarUrl(null); return; }
    supabase.from('profils').select('avatar_url').eq('id', session.user.id).single()
      .then(({ data }) => setAvatarUrl(data?.avatar_url ?? null));
    checkBadges(session.user.id);
    // Recalcule aussi au retour au premier plan (avant : seulement au demarrage)
    const sub = AppState.addEventListener('change', st => {
      if (st === 'active') checkBadges(session.user.id);
    });
    return () => sub.remove();
  }, [session?.user.id]);

  // Pastille d'onglet = du nouveau depuis la derniere visite de cet onglet
  // (borne a 14 jours). Avant : fenetre fixe (48 h / 7 j), la pastille
  // revenait a chaque ouverture meme deja vue.
  function marquerVu(tab: string) {
    if (session?.user.id) AsyncStorage.setItem(bottomTabSeenKey(tab, session.user.id), new Date().toISOString()).catch(() => {});
  }

  async function checkBadges(userId: string) {
    const since48h = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const borne14j = Date.now() - 14 * 86400 * 1000;
    const vuDepuis = async (tab: string, defaut: number) => {
      const v = await AsyncStorage.getItem(bottomTabSeenKey(tab, userId)).catch(() => null);
      const t = v ? new Date(v).getTime() : defaut;
      return new Date(Math.max(t, borne14j)).toISOString();
    };
    const [carteDepuis, meuteDepuis, eventsDepuis, partDepuis] = await Promise.all([
      vuDepuis('Carte', Date.now() - 7 * 86400 * 1000),
      vuDepuis('Meute', Date.now() - 48 * 3600 * 1000),
      vuDepuis('Events', Date.now() - 7 * 86400 * 1000),
      vuDepuis('Services', Date.now() - 7 * 86400 * 1000),
    ]);

    const { data: moi } = await supabase.from('profils').select('lat,lng').eq('id', userId).maybeSingle();
    const { data: follows } = await supabase
      .from('follows').select('following_id')
      .eq('follower_id', userId).eq('statut', 'accepte');
    const suivis = (follows || []).map((f: any) => f.following_id);

    // Carte : nouveaux lieux pres de chez moi (~50 km) ou nouvelles balades des gens
    // que je suis -- de quoi donner envie d'aller se balader
    {
      let lq = supabase.from('lieux').select('id', { count: 'exact', head: true })
        .eq('actif', true).gt('created_at', carteDepuis);
      if (moi?.lat && moi?.lng) {
        lq = lq.gte('lat', moi.lat - 0.45).lte('lat', moi.lat + 0.45).gte('lng', moi.lng - 0.65).lte('lng', moi.lng + 0.65);
      }
      const [{ count: nouveauxLieux }, baladesRes] = await Promise.all([
        lq,
        suivis.length
          ? supabase.from('balades').select('id', { count: 'exact', head: true })
            .in('user_id', suivis).neq('visibilite', 'prive').gt('created_at', carteDepuis)
          : Promise.resolve({ count: 0 } as any),
      ]);
      setCarteBadge(((nouveauxLieux ?? 0) + ((baladesRes as any).count ?? 0)) > 0);
    }

    // Events : nouveaux events valides, ou un event du jour ou je suis inscrit
    {
      const debutJour = new Date(); debutJour.setHours(0, 0, 0, 0);
      const finJour = new Date(debutJour); finJour.setDate(finJour.getDate() + 1);
      const [{ count: nouveaux }, { data: duJour }] = await Promise.all([
        supabase.from('evenements').select('id', { count: 'exact', head: true })
          .eq('valide', true).eq('actif', true).gt('created_at', eventsDepuis).gte('date_heure', new Date().toISOString()),
        supabase.from('participations').select('event_id, evenements!inner(date_heure)')
          .eq('user_id', userId)
          .gte('evenements.date_heure', debutJour.toISOString()).lt('evenements.date_heure', finJour.toISOString())
          .limit(1),
      ]);
      const vuAujourdhui = new Date(eventsDepuis) >= debutJour;
      setEventsBadge((nouveaux ?? 0) > 0 || (!vuAujourdhui && (duJour?.length ?? 0) > 0));
    }

    // Partenaires : nouvelles actus / avantages depuis la derniere visite
    const { count: partCount } = await supabase
      .from('partenaire_posts').select('id', { count: 'exact', head: true })
      .eq('actif', true).gt('created_at', partDepuis);
    setPartBadge((partCount ?? 0) > 0);

    // Profil : demandes d'abonnement en attente
    const { count: demandes } = await supabase.from('follows').select('id', { count: 'exact', head: true })
      .eq('following_id', userId).eq('statut', 'en_attente');
    setProfilBadge((demandes ?? 0) > 0);

    // Meute : avis/photos des gens suivis + messages recus, depuis la derniere visite
    let meuteHasActivity = false;
    if (suivis.length) {
      const ids = suivis;
      const [{ count: a }, { count: p }] = await Promise.all([
        supabase.from('avis').select('id', { count: 'exact', head: true }).in('user_id', ids).gt('created_at', meuteDepuis),
        supabase.from('photos').select('id', { count: 'exact', head: true }).in('user_id', ids).eq('validee', true).gt('created_at', meuteDepuis),
      ]);
      meuteHasActivity = ((a ?? 0) + (p ?? 0)) > 0;
    }

    // Messages des autres dans mes conversations depuis la derniere visite (24 h max)
    const since24h = new Date(Math.max(new Date(meuteDepuis).getTime(), Date.now() - 24 * 3600 * 1000)).toISOString();
    const { data: myConvs } = await supabase
      .from('conversation_members').select('conversation_id').eq('user_id', userId);
    if (myConvs?.length) {
      const convIds = myConvs.map((r: any) => r.conversation_id);
      const { count: msgCount } = await supabase
        .from('messages').select('id', { count: 'exact', head: true })
        .in('conversation_id', convIds)
        .neq('user_id', userId)
        .gte('created_at', since24h);
      if ((msgCount ?? 0) > 0) meuteHasActivity = true;
    }

    setMeuteBadge(meuteHasActivity);

    // Activité (cœur) : likes/commentaires reçus + nouveaux abonnés + anniversaire du jour
    const lastSeenActivity = await AsyncStorage.getItem(activityLastSeenKey(userId));
    const sinceActivity = lastSeenActivity || since48h;

    const [{ data: myPosts }, { data: myPhotos }] = await Promise.all([
      supabase.from('community_posts').select('id').eq('user_id', userId),
      supabase.from('photos').select('id').eq('user_id', userId),
    ]);
    const myPostIds = (myPosts || []).map((p: any) => p.id);
    const myPhotoIds = (myPhotos || []).map((p: any) => p.id);

    let activityCount = 0;
    if (myPostIds.length) {
      const [{ count: lp }, { count: cp }] = await Promise.all([
        supabase.from('community_post_likes').select('id', { count: 'exact', head: true }).in('post_id', myPostIds).neq('user_id', userId).gt('created_at', sinceActivity),
        supabase.from('community_post_comments').select('id', { count: 'exact', head: true }).in('post_id', myPostIds).neq('user_id', userId).gt('created_at', sinceActivity),
      ]);
      activityCount += (lp ?? 0) + (cp ?? 0);
    }
    if (myPhotoIds.length) {
      const [{ count: lph }, { count: cph }] = await Promise.all([
        supabase.from('photo_likes').select('id', { count: 'exact', head: true }).in('photo_id', myPhotoIds).neq('user_id', userId).gt('created_at', sinceActivity),
        supabase.from('photo_comments').select('id', { count: 'exact', head: true }).in('photo_id', myPhotoIds).neq('user_id', userId).gt('created_at', sinceActivity),
      ]);
      activityCount += (lph ?? 0) + (cph ?? 0);
    }
    const { count: newFollows } = await supabase
      .from('follows').select('id', { count: 'exact', head: true })
      .eq('following_id', userId).gt('created_at', sinceActivity);
    activityCount += newFollows ?? 0;

    let hasBirthdayToday = false;
    if (follows?.length) {
      const ids = follows.map((f: any) => f.following_id);
      const { data: dogs } = await supabase
        .from('chiens').select('user_id, date_naissance_parsed')
        .in('user_id', ids).not('date_naissance_parsed', 'is', null);
      const now = new Date();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      hasBirthdayToday = (dogs || []).some((d: any) => d.date_naissance_parsed?.slice(5, 7) === mm && d.date_naissance_parsed?.slice(8, 10) === dd);
    }

    setActivityBadge(activityCount > 0 || hasBirthdayToday);
  }

  return (
    <Tab.Navigator
      screenOptions={({ route, navigation }) => ({
        // Bulle Messages (avec compteur de non-lus) en haut a droite de chaque onglet
        headerRight: () => <BulleMessages navigation={navigation} />,
        headerStyle: { backgroundColor: colors.bordeaux },
        headerTitleStyle: { color: colors.ivory, fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18 },
        headerTintColor: colors.ivory,
        tabBarStyle: {
          backgroundColor: colors.bordeaux,
          borderTopColor: 'rgba(245,239,224,0.08)',
          // Hauteur fixe en dur : des qu'on personnalise `height`, @react-navigation/
          // bottom-tabs arrete d'ajouter automatiquement l'inset de securite du bas.
          // Depuis Expo SDK 54 / Android 15, l'edge-to-edge est impose par defaut --
          // l'app dessine derriere la barre systeme (3 boutons ou geste), donc sans
          // ce rattrapage manuel la barre d'onglets se retrouvait partiellement
          // recouverte par la barre systeme. Corrige uniquement pour Android : sur
          // iOS, insets.bottom vaut ~34 sur tout iPhone avec encoche/Dynamic Island
          // (donc quasiment tout le parc actuel), pas 0 comme suppose initialement --
          // appliquer ce meme calcul cote iOS gonflait la hauteur de la barre
          // (74 -> ~92) et la faisait paraitre remontee par rapport a avant.
          ...(Platform.OS === 'android'
            ? { paddingBottom: Math.max(insets.bottom, 8), paddingTop: 4, height: 58 + insets.bottom }
            : { paddingBottom: 8, paddingTop: 4, height: 74 }),
        },
        tabBarActiveTintColor: colors.terraPale,
        tabBarInactiveTintColor: 'rgba(245,239,224,0.45)',
        tabBarLabelStyle: { fontFamily: 'DMSans_500Medium', fontSize: 10, letterSpacing: 0.4 },
        tabBarBadgeStyle: { minWidth: 9, height: 9, borderRadius: 5, padding: 0, top: 2, right: 2, backgroundColor: '#E5484D' },
        tabBarIcon: ({ focused, color }) => {
          if (route.name === 'Profil' && avatarUrl) {
            return (
              <Image
                source={{ uri: avatarUrl }}
                style={{
                  width: 26, height: 26, borderRadius: 13,
                  borderWidth: focused ? 2 : 0,
                  borderColor: colors.terraPale,
                }}
              />
            );
          }
          const icons = TAB_ICONS[route.name];
          const name = icons ? (focused ? icons.active : icons.inactive) : 'ellipse-outline';
          return <Ionicons name={name} size={22} color={color} />;
        },
      })}
    >
      <Tab.Screen
        name="Carte" component={CarteScreen}
        options={{ title: 'Carte', tabBarBadge: pastilles && carteBadge ? ' ' : undefined }}
        listeners={{ focus: () => { setCarteBadge(false); marquerVu('Carte'); } }}
      />
      <Tab.Screen
        name="Meute"
        options={({ navigation }) => ({
          title: 'Meute',
          tabBarBadge: pastilles && meuteBadge ? ' ' : undefined,
          headerRight: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {renderMeuteHeartButton(navigation, pastilles && activityBadge, setActivityBadge)}
              <BulleMessages navigation={navigation} />
            </View>
          ),
        })}
        listeners={{ focus: () => { setMeuteBadge(false); marquerVu('Meute'); } }}
      >
        {() => <FeedScreen />}
      </Tab.Screen>
      <Tab.Screen
        name="Events" component={EvenementsScreen}
        options={{ title: 'Events', tabBarBadge: pastilles && eventsBadge ? ' ' : undefined }}
        listeners={{ focus: () => { setEventsBadge(false); marquerVu('Events'); } }}
      />
      <Tab.Screen
        name="Services" component={PartenairesScreen}
        options={{ title: 'Partenaires', tabBarBadge: pastilles && partBadge ? ' ' : undefined }}
        listeners={{ focus: () => { setPartBadge(false); marquerVu('Services'); } }}
      />
      <Tab.Screen
        name="Profil" component={ProfilScreen}
        options={{ title: 'Mon profil', tabBarBadge: pastilles && profilBadge ? ' ' : undefined }}
        listeners={{ focus: () => setProfilBadge(false) }}
      />
    </Tab.Navigator>
  );
}

const headerStyles = StyleSheet.create({
  heartBtn: { marginRight: 14, width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  heartDot: {
    position: 'absolute', top: 2, right: 2,
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: colors.terra, borderWidth: 1.5, borderColor: colors.bordeaux,
  },
});

function parseProfilLink(url: string): string | null {
  const m = url.match(/thepack:\/\/profil\?id=([^&]+)/);
  return m ? m[1] : null;
}

function HighlightBanner({
  highlight, topOffset, onDismiss,
}: { highlight: { title: string; body: string }; topOffset: number; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 6000);
    return () => clearTimeout(t);
  }, [highlight, onDismiss]);

  return (
    <View style={[highlightStyles.wrap, { top: topOffset + 8 }]} pointerEvents="box-none">
      <TouchableOpacity style={highlightStyles.card} activeOpacity={0.9} onPress={onDismiss}>
        {!!highlight.title && <Text style={highlightStyles.title} numberOfLines={2}>{highlight.title}</Text>}
        {!!highlight.body && <Text style={highlightStyles.body} numberOfLines={3}>{highlight.body}</Text>}
      </TouchableOpacity>
    </View>
  );
}

const highlightStyles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, zIndex: 999, elevation: 999 },
  card: {
    backgroundColor: colors.bordeaux, borderRadius: 14, padding: 14,
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
  },
  title: { color: colors.ivory, fontFamily: 'PlayfairDisplay_500Medium', fontSize: 15, marginBottom: 2 },
  body: { color: colors.ivory, fontSize: 13, opacity: 0.9 },
});

export default function Navigation() {
  const { session, loading } = useSession();

  useEffect(() => {
    setSentryUser(session?.user?.id ?? null);
  }, [session?.user?.id]);
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [missingFields, setMissingFields] = useState<MissingFields | null>(null);
  const [npsPending, setNpsPending] = useState<NpsPending | null>(null);
  // Stores a profil userId to navigate to once NavigationContainer is ready
  const [pendingProfilId, setPendingProfilId] = useState<string | null>(null);
  // Stores a notification's data payload to apply once NavigationContainer is ready
  // (ex: app ouverte a froid en tapant sur la notif, la nav n'est pas encore montee)
  const [pendingNotifData, setPendingNotifData] = useState<any | null>(null);
  // Bug trouve en recette (2026-10-24, vrai force-quit teste par Marine, pas juste
  // l'app en arriere-plan) : onReady de NavigationContainer ne se declenche qu'UNE
  // fois, avec la fermeture JSX capturee a CE moment-la -- si le tap a froid arrive
  // (setPendingNotifData) APRES que onReady se soit deja declenche, ce check
  // "if (pendingNotifData)" dans onReady lit a jamais sa valeur null d'origine, le
  // nouvel appel ne redeclenche pas onReady. Confirme via push_debug_logs :
  // navReady=false au moment du tap (donc pendingNotifData bien pose), mais jamais
  // applique. Remplace par un state + useEffect ci-dessous, qui reagit a la vraie
  // valeur courante a chaque fois, plutot que de compter sur la fermeture figee
  // d'un callback qui ne se re-declenche jamais.
  const [navReady, setNavReady] = useState(false);
  // Bannière rappelant le contenu du push une fois sur l'écran cible (demande de
  // Marine : le texte de la notif disparaît sinon complètement après le tap, sans
  // rien pour expliquer pourquoi on est arrivé là -- utile pour une fonctionnalité
  // pas encore vue, ex: le carnet de santé).
  const [highlight, setHighlight] = useState<{ title: string; body: string } | null>(null);
  const insets = useSafeAreaInsets();

  async function applyNotificationData(data: any) {
    if (!data) return;
    // data.lieu_id en secours : admin.html a longtemps envoye cette cle en snake_case
    // pour "suggestion_validee" (corrige cote emetteur), mais un ancien envoi en vol au
    // moment du deploiement, ou un futur oubli de convention, ne doit pas se traduire
    // par une notif qui ne fait rien au tap.
    const lieuId = data.lieuId || data.lieu_id;
    if (data.type === 'new_lieu' || data.type === 'suggestion_validee' || data.type === 'friend_lieu' || data.type === 'new_partner' || data.type === 'new_offer' || data.type === 'photo_like_lieu' || data.type === 'offre_locale' || data.type === 'avis_demande') {
      if (lieuId) {
        mapNavigation.setPendingLieu(lieuId);
        navigationRef.navigate('Tabs' as any, { screen: 'Carte' } as any);
      }
    } else if (data.type === 'photo_like' || data.type === 'new_post' || data.type === 'mention_comment') {
      if (data.postId) mapNavigation.setPendingPost(data.postId);
      navigationRef.navigate('Tabs' as any, { screen: 'Meute' } as any);
    } else if (data.type === 'new_event' || data.type === 'event_reminder' || data.type === 'event_reminder_today' || data.type === 'mention_event_comment' || data.type === 'event_validated' || data.type === 'event_refused' || data.type === 'event_cancelled') {
      if (data.eventId) mapNavigation.setPendingEvent(data.eventId);
      navigationRef.navigate('Tabs' as any, { screen: 'Events' } as any);
    } else if (data.type === 'mention_lieu_comment') {
      // Mention dans un commentaire de fiche lieu (web) : le mobile n'a pas encore
      // d'ecran pour afficher ce fil de commentaires precis, on ouvre au moins la fiche.
      if (lieuId) {
        mapNavigation.setPendingLieu(lieuId);
        navigationRef.navigate('Tabs' as any, { screen: 'Carte' } as any);
      }
    } else if (data.type === 'private_event_invite') {
      // N'a jamais eu de branche ici depuis l'ajout de ce type de notif : le tap ne
      // faisait litteralement rien. L'invitation elle-meme n'a pas d'id dans le payload
      // (seulement le type), donc on ouvre l'onglet "Mes events" ou elle apparait --
      // pas de fiche precise possible sans modifier aussi l'emetteur.
      mapNavigation.setPendingEventsFilter('mesEvents');
      navigationRef.navigate('Tabs' as any, { screen: 'Events' } as any);
    } else if (data.type === 'follow' || data.type === 'follow_accepted') {
      if (data.userId) {
        navigationRef.navigate('ProfilPublic', { userId: data.userId, prenom: '' });
      }
    } else if (data.type === 'dog_birthday') {
      navigationRef.navigate('Anniversaires' as any);
    } else if (data.type === 'carnet_rappel') {
      if (data.chienId) {
        navigationRef.navigate('CarnetSante' as any, { chienId: data.chienId, chienNom: data.chienNom || '' } as any);
      }
    } else if (data.type === 'reservation' || data.type === 'compte_rendu') {
      navigationRef.navigate('MesReservations' as any);
    } else if (data.type === 'ticket_reply') {
      if (data.ticketId) {
        navigationRef.navigate('ContactDetail' as any, { ticketId: data.ticketId } as any);
      }
    } else if (data.type === 'idee_livree') {
      navigationRef.navigate('Idees' as any);
    } else if (data.type === 'new_reservation') {
      // Pas d'ecran de gestion des reservations cote pro dans l'app mobile :
      // la gestion se fait sur l'espace pro web.
      Linking.openURL('https://thepacklameute.fr/espace-pro.html');
    } else if (data.type === 'message' || (!data.type && data.conversationId)) {
      // Le "|| (!data.type && data.conversationId)" gere les anciennes notifications
      // envoyees avant l'ajout du champ type, qui ne portaient que conversationId.
      if (data.conversationId) {
        supabase.from('push_debug_logs').insert({
          to_token: 'APPLY_MSG', title: 'applyNotificationData message branch',
          detail: JSON.stringify({ conversationId: data.conversationId }),
        }).then(() => {}, () => {});
        navigationRef.navigate('Messages' as any, { conversationId: data.conversationId, t: Date.now() } as any);
      }
    } else if (data.type === 'broadcast') {
      if (data.targetType === 'lieu' && lieuId) {
        mapNavigation.setPendingLieu(lieuId);
        navigationRef.navigate('Tabs' as any, { screen: 'Carte' } as any);
      } else if (data.targetType === 'event' && data.eventId) {
        mapNavigation.setPendingEvent(data.eventId);
        navigationRef.navigate('Tabs' as any, { screen: 'Events' } as any);
      } else if (data.targetType === 'conversation' && data.conversationId) {
        navigationRef.navigate('Messages' as any, { conversationId: data.conversationId, t: Date.now() } as any);
      } else if (data.targetType === 'url' && data.url) {
        Linking.openURL(data.url);
      } else if (data.targetType === 'partenaire' && data.partenaireId) {
        mapNavigation.setPendingPartenaire(data.partenaireId, data.postId);
        navigationRef.navigate('Tabs' as any, { screen: 'Services' } as any);
      } else if (data.targetType === 'partenaires') {
        navigationRef.navigate('Tabs' as any, { screen: 'Services' } as any);
      } else if (data.targetType === 'profil' && data.userId) {
        navigationRef.navigate('ProfilPublic' as any, { userId: data.userId, prenom: '' } as any);
      } else if (data.targetType === 'carnet_sante') {
        // Pas d'id de chien dans le payload (une campagne vise plusieurs
        // destinataires, chacun avec ses propres chiens) : on ouvre le carnet
        // du PREMIER chien du destinataire qui tape, meme logique que
        // ProfilScreen.goToCarnetSante().
        const { data: { user } } = await supabase.auth.getUser();
        const { data: chiens } = user
          ? await supabase.from('chiens').select('id,nom').eq('user_id', user.id).order('created_at', { ascending: true }).limit(1)
          : { data: null };
        if (chiens?.length) {
          navigationRef.navigate('CarnetSante' as any, { chienId: chiens[0].id, chienNom: chiens[0].nom } as any);
        } else {
          navigationRef.navigate('Tabs' as any, { screen: 'Profil' } as any);
        }
      }
    } else if (data.type === 'moderation_action' || data.type === 'moderation_report_resolved') {
      // Pas de lieu_id/post_id dans le payload (moderate-content-notify n'envoie
      // que contentType/contentId/action) -- on resout la cible a partir de la
      // table que content_reports.content_type designe, meme principe que le
      // lookup carnet_sante ci-dessus.
      const { contentType, contentId } = data;
      if (contentType === 'photo') {
        const { data: photo } = await supabase.from('photos').select('lieu_id').eq('id', contentId).maybeSingle();
        if (photo?.lieu_id) { mapNavigation.setPendingLieu(photo.lieu_id); navigationRef.navigate('Tabs' as any, { screen: 'Carte' } as any); }
      } else if (contentType === 'video') {
        const { data: video } = await supabase.from('videos').select('lieu_id').eq('id', contentId).maybeSingle();
        if (video?.lieu_id) { mapNavigation.setPendingLieu(video.lieu_id); navigationRef.navigate('Tabs' as any, { screen: 'Carte' } as any); }
      } else if (contentType === 'avis') {
        const { data: avis } = await supabase.from('avis').select('lieu_id').eq('id', contentId).maybeSingle();
        if (avis?.lieu_id) { mapNavigation.setPendingLieu(avis.lieu_id); navigationRef.navigate('Tabs' as any, { screen: 'Carte' } as any); }
      } else if (contentType === 'commentaire') {
        const { data: commentaire } = await supabase.from('commentaires').select('entity_type, entity_id').eq('id', contentId).maybeSingle();
        if (commentaire?.entity_type === 'lieu' && commentaire.entity_id) {
          mapNavigation.setPendingLieu(commentaire.entity_id);
          navigationRef.navigate('Tabs' as any, { screen: 'Carte' } as any);
        } else if (commentaire?.entity_type === 'event' && commentaire.entity_id) {
          mapNavigation.setPendingEvent(commentaire.entity_id);
          navigationRef.navigate('Tabs' as any, { screen: 'Events' } as any);
        }
      } else if (contentType === 'profil') {
        navigationRef.navigate('Tabs' as any, { screen: 'Profil' } as any);
      }
    }
  }

  function handleNotificationResponse(content: any) {
    clearBadge();
    const data = content?.data;
    supabase.from('push_debug_logs').insert({
      to_token: 'TAP', title: 'notif_tap',
      detail: JSON.stringify({ data, navReady: navigationRef.isReady() }),
    }).then(() => {}, () => {});
    if (!data) return;
    // Taux de clic par campagne (cf notifications_log / _shared/pushTracking.ts cote
    // edge functions) : notifLogId n'est present que sur les notifications envoyees via
    // le helper partage, les anciennes/non-instrumentees sont simplement ignorees ici.
    if (data.notifLogId) {
      supabase.auth.getSession().then(({ data: sess }) => {
        supabase.from('notification_opens').insert({
          notification_log_id: data.notifLogId,
          notification_type: data.type || null,
          user_id: sess?.session?.user?.id ?? null,
        }).then(() => {}, () => {});
      });
    }
    // Ouverture d'une campagne B2B (admin > Notifications push) : log dedie
    // (notification_campaign_sends.opened_at), notifLogId ci-dessus ne couvre
    // que les 7 notifs produit historiques, pas cet outil.
    if (data.type === 'broadcast' && data.campaignId) {
      supabase.rpc('mark_campaign_notification_opened', { p_campaign_id: data.campaignId }).then(() => {}, () => {});
    }
    // Bannière de rappel sur l'ecran cible -- seulement pour les campagnes
    // (broadcast), pas pour les 7 notifs produit qui ont deja leur propre
    // contexte visuel evident (une photo likee ouvre directement la photo).
    if (data.type === 'broadcast' && (content?.title || content?.body)) {
      setHighlight({ title: content.title || '', body: content.body || '' });
    }
    if (navigationRef.isReady()) applyNotificationData(data);
    else setPendingNotifData(data);
  }

  useEffect(() => {
    supabase.from('push_debug_logs').insert({
      to_token: 'MOUNT', title: 'listener_registered',
      detail: JSON.stringify({ at: new Date().toISOString() }),
    }).then(() => {}, () => {});

    // Cold start: store the URL, navigate in onReady
    Linking.getInitialURL().then(url => {
      if (url) { const id = parseProfilLink(url); if (id) setPendingProfilId(id); }
    });
    // App in foreground/background: nav is already ready
    const linkSub = Linking.addEventListener('url', ({ url }) => {
      const id = parseProfilLink(url);
      if (id && navigationRef.isReady()) {
        navigationRef.navigate('ProfilPublic', { userId: id, prenom: '' });
      }
    });

    // App ouverte a froid en tapant sur une notif : le listener ci-dessous ne recoit pas
    // toujours cet evenement de lancement, on le recupere explicitement.
    Notifications.getLastNotificationResponseAsync().then(response => {
      supabase.from('push_debug_logs').insert({
        to_token: 'LASTRESP', title: 'getLastNotificationResponseAsync',
        detail: JSON.stringify({ hasResponse: !!response, data: response?.notification?.request?.content?.data ?? null }),
      }).then(() => {}, () => {});
      if (response) handleNotificationResponse(response.notification.request.content as any);
    }, err => {
      supabase.from('push_debug_logs').insert({
        to_token: 'LASTRESP_ERR', title: 'getLastNotificationResponseAsync failed',
        detail: String(err),
      }).then(() => {}, () => {});
    });

    // Tap on push notification → deep link
    let notifSub: { remove: () => void } | null = null;
    try {
      notifSub = Notifications.addNotificationResponseReceivedListener(response => {
        handleNotificationResponse(response.notification.request.content as any);
      });
      supabase.from('push_debug_logs').insert({
        to_token: 'LISTENER_OK', title: 'addNotificationResponseReceivedListener registered',
        detail: '',
      }).then(() => {}, () => {});
    } catch (err) {
      supabase.from('push_debug_logs').insert({
        to_token: 'LISTENER_ERR', title: 'addNotificationResponseReceivedListener threw',
        detail: String(err),
      }).then(() => {}, () => {});
    }

    return () => { linkSub.remove(); notifSub?.remove(); };
  }, []);

  // Applique le profil/la notification en attente des que la navigation est
  // prete -- un effet reactif normal (relit toujours le state courant a chaque
  // declenchement) plutot que le callback onReady de NavigationContainer
  // (qui ne se declenche qu'une seule fois, avec sa fermeture figee au moment
  // ou il se declenche -- si pendingNotifData est pose APRES, onReady ne se
  // redeclenche jamais pour le lire). Voir le commentaire sur navReady plus haut.
  useEffect(() => {
    if (!navReady) return;
    if (pendingProfilId) {
      navigationRef.navigate('ProfilPublic', { userId: pendingProfilId, prenom: '' });
      setPendingProfilId(null);
    }
    if (pendingNotifData) {
      applyNotificationData(pendingNotifData);
      setPendingNotifData(null);
    }
  }, [navReady, pendingProfilId, pendingNotifData]);

  // Meme logique que ci-dessus, pour la redirection vers Onboarding : avant,
  // c'etait initialRouteName (plus bas) qui s'en chargeait, en etant evalue
  // une seule fois au montage de NavigationContainer -- correct tant que ce
  // montage etait retarde jusqu'a ce que session/onboarding soient connus (le
  // "if (loading...) return <SplashLoader/>" juste avant le JSX). Ce garde-fou
  // demontait/remontait NavigationContainer des que loading/onboardingChecked
  // changeaient APRES le premier montage (ex: un deuxieme evenement
  // onAuthStateChange juste apres le mount), ce qui redeclenchait onReady une
  // deuxieme fois et perdait la navigation d'un tap de notification deja
  // appliquee par le premier onReady (confirme via push_debug_logs : deux
  // NAV_READY a moins d'une seconde d'intervalle pour un seul MOUNT). Fixe en
  // montant NavigationContainer une bonne fois pour toutes (SplashLoader passe
  // en overlay plus bas) -- initialRouteName n'a donc plus les bonnes valeurs
  // au moment ou il compte, cette redirection explicite prend le relais.
  useEffect(() => {
    if (!navReady || !session || !onboardingChecked || !needsOnboarding) return;
    if (navigationRef.isReady() && navigationRef.getCurrentRoute()?.name !== 'Onboarding') {
      navigationRef.navigate('Onboarding' as any);
    }
  }, [navReady, session?.user.id, onboardingChecked, needsOnboarding]);

  useEffect(() => {
    if (!session) {
      setNeedsOnboarding(false);
      setOnboardingChecked(true);
      return;
    }
    // Enregistre le token dès la connexion, quel que soit l'écran ouvert
    savePushToken(session.user.id);
    clearBadge();

    // Verifie un prompt NPS en attente (Phase 6 lot 5) -- a la connexion et a
    // chaque retour au premier plan, pas seulement sur tap de notification
    // (plus fiable : ne depend pas de la livraison du push).
    async function checkNpsPrompt() {
      const { data } = await supabase.rpc('nps_prompt_pending');
      if (data?.[0]) setNpsPending(data[0]);
    }
    checkNpsPrompt();

    // Renouvelle le token et efface la pastille chaque fois que l'app revient au premier plan
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') { savePushToken(session.user.id); clearBadge(); checkNpsPrompt(); }
    });

    setOnboardingChecked(false);
    const userId = session.user.id;
    async function checkOnboarding(retriesLeft = 2) {
      const { data, error } = await supabase.from('profils')
        .select('prenom, nom, date_naissance_humain, nom_chien').eq('id', userId).maybeSingle();
      if (error) {
        if (retriesLeft > 0) {
          await new Promise(r => setTimeout(r, 800));
          return checkOnboarding(retriesLeft - 1);
        }
        // Erreur persistante (reseau, refresh de session en cours…) : on ne force pas
        // un utilisateur existant a tout resaisir, il vaut mieux rater un vrai cas
        // d'onboarding (rare) que de reafficher le formulaire a tout le monde.
        setNeedsOnboarding(false);
        setOnboardingChecked(true);
        return;
      }
      setNeedsOnboarding(!data?.prenom);
      if (data?.prenom) {
        const missing = { nom: !data.nom, dateNaissance: !data.date_naissance_humain, nomChien: !data.nom_chien };
        setMissingFields((missing.nom || missing.dateNaissance || missing.nomChien) ? missing : null);
      }
      setOnboardingChecked(true);
    }
    checkOnboarding();

    return () => sub.remove();
  }, [session?.user.id]);

  const showSplash = loading || !!(session && !onboardingChecked);

  return (
    <>
    <NavigationContainer ref={navigationRef} onStateChange={suivreEcran} onReady={() => {
        suivreEcran();
        supabase.from('push_debug_logs').insert({
          to_token: 'NAV_READY', title: 'NavigationContainer onReady',
          detail: JSON.stringify({ hasPendingNotifData: !!pendingNotifData, pendingNotifData }),
        }).then(() => {}, () => {});
        setNavReady(true);
      }}>
      <Stack.Navigator
        screenOptions={{ headerShown: false }}
        initialRouteName={session && needsOnboarding ? 'Onboarding' : 'Tabs'}
      >
        <Stack.Screen name="Tabs" component={MainTabs} />
        <Stack.Screen name="Onboarding" component={OnboardingScreen} options={{ gestureEnabled: false }} />
        <Stack.Screen
          name="Auth"
          component={AuthScreen}
          options={{ presentation: 'modal' }}
        />
        <Stack.Screen
          name="ProfilPublic"
          component={ProfilPublicScreen}
          options={{
            headerShown: true, presentation: 'card',
            headerStyle: { backgroundColor: colors.bordeaux },
            headerTintColor: colors.ivory,
            headerTitle: '', headerBackTitle: 'Retour',
          }}
        />
        <Stack.Screen
          name="Messages"
          component={MessagesScreen}
          options={{
            headerShown: true, presentation: 'card',
            headerStyle: { backgroundColor: colors.bordeaux },
            headerTintColor: colors.ivory,
            title: 'Messages',
            headerTitleStyle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: colors.ivory },
            headerBackTitle: 'Retour',
          }}
        />
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{
            headerShown: true, presentation: 'card',
            headerStyle: { backgroundColor: colors.bordeaux },
            headerTintColor: colors.ivory,
            headerTitle: 'Paramètres',
            headerTitleStyle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: colors.ivory },
            headerBackTitle: 'Retour',
          }}
        />
        <Stack.Screen
          name="Booking"
          component={BookingScreen}
          options={{
            headerShown: true, presentation: 'card',
            headerStyle: { backgroundColor: colors.bordeaux },
            headerTintColor: colors.ivory,
            headerTitle: 'Réserver',
            headerTitleStyle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: colors.ivory },
            headerBackTitle: 'Retour',
          }}
        />
        <Stack.Screen
          name="MesReservations"
          component={MesReservationsScreen}
          options={{
            headerShown: true, presentation: 'card',
            headerStyle: { backgroundColor: colors.bordeaux },
            headerTintColor: colors.ivory,
            headerTitle: 'Mes rendez-vous',
            headerTitleStyle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: colors.ivory },
            headerBackTitle: 'Retour',
          }}
        />
        <Stack.Screen
          name="Classement"
          component={ClassementScreen}
          options={{
            headerShown: true, presentation: 'card',
            headerStyle: { backgroundColor: colors.bordeaux },
            headerTintColor: colors.ivory,
            headerTitle: 'Balades',
            headerTitleStyle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: colors.ivory },
            headerBackTitle: 'Retour',
          }}
        />
        <Stack.Screen
          name="Anniversaires"
          component={AnniversairesScreen}
          options={{
            headerShown: true, presentation: 'card',
            headerStyle: { backgroundColor: colors.bordeaux },
            headerTintColor: colors.ivory,
            headerTitle: 'Anniversaires',
            headerTitleStyle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: colors.ivory },
            headerBackTitle: 'Retour',
          }}
        />
        <Stack.Screen
          name="CarnetSante"
          component={CarnetSanteScreen}
          options={({ route }) => ({
            headerShown: true, presentation: 'card',
            headerStyle: { backgroundColor: colors.bordeaux },
            headerTintColor: colors.ivory,
            headerTitle: (route.params as any)?.chienNom ? `Carnet de ${(route.params as any).chienNom}` : 'Carnet de santé',
            headerTitleStyle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: colors.ivory },
            headerBackTitle: 'Retour',
          })}
        />
        <Stack.Screen
          name="Activite"
          component={ActiviteScreen}
          options={{
            headerShown: true, presentation: 'card',
            headerStyle: { backgroundColor: colors.bordeaux },
            headerTintColor: colors.ivory,
            headerTitle: 'Activité',
            headerTitleStyle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: colors.ivory },
            headerBackTitle: 'Retour',
          }}
        />
        <Stack.Screen
          name="Contact"
          component={ContactScreen}
          options={{
            headerShown: true, presentation: 'card',
            headerStyle: { backgroundColor: colors.bordeaux },
            headerTintColor: colors.ivory,
            headerTitle: "Contacter l'équipe",
            headerTitleStyle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: colors.ivory },
            headerBackTitle: 'Retour',
          }}
        />
        <Stack.Screen
          name="ContactDetail"
          component={ContactDetailScreen}
          options={{
            headerShown: true, presentation: 'card',
            headerStyle: { backgroundColor: colors.bordeaux },
            headerTintColor: colors.ivory,
            headerTitle: 'Ma demande',
            headerTitleStyle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: colors.ivory },
            headerBackTitle: 'Retour',
          }}
        />
        <Stack.Screen
          name="Idees"
          component={IdeesScreen}
          options={{
            headerShown: true, presentation: 'card',
            headerStyle: { backgroundColor: colors.bordeaux },
            headerTintColor: colors.ivory,
            headerTitle: 'Idées de la communauté',
            headerTitleStyle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: colors.ivory },
            headerBackTitle: 'Retour',
          }}
        />
      </Stack.Navigator>
    </NavigationContainer>
    {session && !needsOnboarding && missingFields && (
      <CompleteProfileModal
        visible
        userId={session.user.id}
        missing={missingFields}
        onSaved={() => { setMissingFields(null); }}
      />
    )}
    {session && !needsOnboarding && !missingFields && npsPending && (
      <NpsPromptModal pending={npsPending} onDone={() => setNpsPending(null)} />
    )}
    {session && onboardingChecked && !needsOnboarding && !missingFields && !npsPending && (
      <NouveautesModal
        creeLe={session.user.created_at}
        onBalade={() => { if (navigationRef.isReady()) navigationRef.navigate('Tabs' as any, { screen: 'Carte' } as any); }}
      />
    )}
    {highlight && (
      <HighlightBanner highlight={highlight} topOffset={insets.top} onDismiss={() => setHighlight(null)} />
    )}
    {showSplash && (
      <View style={StyleSheet.absoluteFillObject}>
        <SplashLoader />
      </View>
    )}
    </>
  );
}
