import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  View, Text, FlatList, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, Keyboard,
  Modal, Image, Alert, Share, Linking, LayoutAnimation, Animated,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import { useSession } from '../hooks/useSession';
import AuthGate from '../components/AuthGate';
import ErrorBoundary from '../components/ErrorBoundary';
import { sendPushNotification } from '../lib/notifications';
import { usePastillesActives } from '../lib/pastilles';

// ── Types ───────────────────────────────────────────────────────────────────

type ConvMember = { user_id: string; prenom: string; avatar_url: string | null };
type Conversation = {
  id: string; nom: string | null; created_by: string; type?: string | null; created_at?: string;
  members: ConvMember[];
  last_message: { contenu: string; image_url: string | null; created_at: string; user_id: string } | null;
  // Messages d'autres membres plus recents que ma derniere lecture (conversation_members.last_read_at)
  unread?: number;
};

// last_read_at vaut l'heure d'arrivee dans la conversation tant qu'elle n'a jamais ete
// mise a jour : sans plancher, toutes les vieilles conversations s'allumeraient d'un coup.
const NON_LU_MAX_AGE_MS = 14 * 86400000;
type Message = {
  id: string; user_id: string; contenu: string; image_url: string | null; created_at: string;
  prenom: string; avatar_url: string | null;
  // Reactions emoji : nombre par emoji, et la mienne (une par personne)
  reactions: Record<string, number>; maReaction: string | null;
  // Message cite (reponse a un message precis)
  reply_to_id?: string | null;
};
// Message cite introuvable dans les messages charges (plus ancien, ou supprime)
type Citation = { id: string; user_id: string; contenu: string; image_url: string | null; prenom: string; supprime: boolean };
type Contact = { id: string; prenom: string; avatar_url: string | null; ville: string | null };
type GroupeType = 'balade' | 'education' | 'rencontre';
type Groupe = {
  id: string; nom: string; description: string | null; ville: string | null;
  image_url: string | null; created_by: string; conversation_id: string;
  type: GroupeType; membre_count?: number;
};

const REACTIONS = ['❤️', '😂', '😮', '😢', '👍', '🐶'];

const GROUPE_TYPE_LABELS: Record<GroupeType, string> = { balade: 'Balade', education: 'Éducation', rencontre: 'Rencontre' };
const GROUPE_TYPES: GroupeType[] = ['balade', 'education', 'rencontre'];

function fmtTime(dateStr: string) {
  const d = new Date(dateStr);
  const diff = Date.now() - d.getTime();
  if (diff < 86400000) return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (diff < 604800000) return d.toLocaleDateString('fr-FR', { weekday: 'short' });
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

// ── Liens cliquables ─────────────────────────────────────────────────────────

// Domaines "nus" (exemple.fr) reconnus uniquement avec ces extensions, pour ne pas
// transformer en lien un "ok.merci" tape sans espace.
const TLDS = 'fr|com|org|net|io|app|co|be|ch|eu|info|dev|me|ly|gg|tv|shop|store|club|pet|dog|bzh|paris|ca|uk|de|es|it|lu';
const URL_RE = new RegExp(
  `(?:https?:\\/\\/|www\\.)[^\\s<>"]+|[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9-]+)*\\.(?:${TLDS})\\b(?:\\/[^\\s<>"]*)?`,
  'gi',
);

type Morceau = { texte: string; url?: string };

export function decouperLiens(texte: string): Morceau[] {
  const out: Morceau[] = [];
  let dernier = 0;
  URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(texte))) {
    const debut = m.index;
    let brut = m[0];
    const avant = debut > 0 ? texte[debut - 1] : '';
    // Morceau d'adresse e-mail (marine@exemple.fr) ou de mot plus long : pas un lien
    if (avant && /[\w@.\-\/]/.test(avant)) continue;
    if (texte[debut + brut.length] === '@') continue;
    // Ponctuation finale ("va voir exemple.fr !", "(www.site.fr)")
    const fin = brut.match(/[.,!?;:)\]'"»…]+$/);
    if (fin) brut = brut.slice(0, brut.length - fin[0].length);
    if (!brut) continue;
    if (debut > dernier) out.push({ texte: texte.slice(dernier, debut) });
    out.push({ texte: brut, url: /^https?:\/\//i.test(brut) ? brut : `https://${brut}` });
    dernier = debut + brut.length;
    URL_RE.lastIndex = dernier;
  }
  if (dernier < texte.length) out.push({ texte: texte.slice(dernier) });
  return out;
}

function ouvrirLien(url: string) {
  Linking.openURL(url).catch(() => Alert.alert('Lien', "Impossible d'ouvrir ce lien."));
}

function TexteAvecLiens({ texte, style, lienStyle }: { texte: string; style: any; lienStyle: any }) {
  const morceaux = useMemo(() => decouperLiens(texte), [texte]);
  if (!morceaux.some(x => x.url)) return <Text style={style}>{texte}</Text>;
  return (
    <Text style={style}>
      {morceaux.map((x, i) => x.url
        ? <Text key={i} style={lienStyle} onPress={() => ouvrirLien(x.url!)} suppressHighlighting={false}>{x.texte}</Text>
        : <Text key={i}>{x.texte}</Text>)}
    </Text>
  );
}

// ── Swipe vers la droite pour repondre ──────────────────────────────────────

function SwipeRepondre({ actif, onRepondre, children }: { actif: boolean; onRepondre: () => void; children: React.ReactNode }) {
  const ref = useRef<Swipeable>(null);
  if (!actif) return <>{children}</>;
  return (
    <Swipeable
      ref={ref}
      friction={2}
      leftThreshold={50}
      overshootLeft={false}
      // Ne demarre qu'apres un vrai mouvement horizontal, et abandonne des que le doigt
      // part a la verticale : le defilement de la conversation reste prioritaire
      dragOffsetFromLeftEdge={14}
      failOffsetY={[-12, 12]}
      renderLeftActions={(progress) => (
        <Animated.View style={[s.swipeReplyAction, { opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }) }]}>
          <View style={s.swipeReplyIcon}><Ionicons name="arrow-undo" size={16} color={colors.bordeaux} /></View>
        </Animated.View>
      )}
      onSwipeableOpen={() => { onRepondre(); ref.current?.close(); }}
    >
      {children}
    </Swipeable>
  );
}

// ── Groupe card ──────────────────────────────────────────────────────────────

function GroupeCard({
  groupe, joined, isOwner, onJoin, onOpen, onWhatsApp, onStory, onEdit,
}: {
  groupe: Groupe; joined: boolean; isOwner: boolean;
  onJoin: () => void; onOpen: () => void; onWhatsApp: () => void; onStory: () => void; onEdit: () => void;
}) {
  return (
    <TouchableOpacity style={g.card} onPress={joined ? onOpen : undefined} activeOpacity={joined ? 0.7 : 1}>
      {groupe.image_url ? (
        <View style={g.cardCover}>
          <Image source={{ uri: groupe.image_url }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
          <View style={g.cardCoverGrad} />
          {groupe.ville ? (
            <View style={g.villeBadge}>
              <Ionicons name="location" size={10} color={colors.ivory} />
              <Text style={g.villeBadgeText}>{groupe.ville}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      <View style={g.cardBody}>
        <View style={g.cardTopRow}>
          <View style={g.cardIcon}>
            <Ionicons name="people" size={20} color={colors.ivory} />
          </View>
          <View style={{ flex: 1 }}>
            {groupe.type ? (
              <View style={g.typePill}>
                <Text style={g.typePillText}>{GROUPE_TYPE_LABELS[groupe.type]}</Text>
              </View>
            ) : null}
            <Text style={g.cardNom} numberOfLines={1}>{groupe.nom}</Text>
            {groupe.ville ? (
              <View style={g.villeInline}>
                <Ionicons name="location-outline" size={11} color={colors.textMuted} />
                <Text style={g.villeInlineText}>{groupe.ville}</Text>
              </View>
            ) : null}
          </View>
          {isOwner ? (
            <TouchableOpacity style={g.editBtn} onPress={onEdit} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="pencil" size={15} color={colors.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>
        <View style={g.cardFooter}>
          {groupe.membre_count != null ? (
            <View style={g.memberCount}>
              <Ionicons name="people-outline" size={13} color={colors.textMuted} />
              <Text style={g.memberCountText}>{groupe.membre_count} membre{groupe.membre_count > 1 ? 's' : ''}</Text>
            </View>
          ) : null}
          <View style={g.cardActions}>
            <TouchableOpacity style={g.shareBtn} onPress={() => Alert.alert(
              'Partager le groupe',
              undefined,
              [
                { text: 'Story / Image', onPress: onStory },
                { text: 'WhatsApp', onPress: onWhatsApp },
                { text: 'Annuler', style: 'cancel' },
              ]
            )}>
              <Ionicons name="share-social-outline" size={15} color={colors.ivory} />
              <Text style={g.shareBtnText}>Partager</Text>
            </TouchableOpacity>
            {joined ? (
              <TouchableOpacity style={g.joinedBtn} onPress={onOpen}>
                <Ionicons name="chatbubble-outline" size={13} color={colors.terra} />
                <Text style={g.joinedBtnText}>Ouvrir</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={g.joinBtn} onPress={onJoin}>
                <Text style={g.joinBtnText}>Rejoindre</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ── Main screen ──────────────────────────────────────────────────────────────

export default function MessagerieScreen({
  pendingConversationId, onConsumedPendingConversation, defaultHeaderRight, actif = true,
}: { pendingConversationId?: string | null; onConsumedPendingConversation?: () => void; defaultHeaderRight?: () => React.ReactNode; actif?: boolean } = {}) {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { session, loading: sessionLoading } = useSession();
  const myUserId = session?.user?.id ?? null;
  const pastilles = usePastillesActives();

  // ── Clavier ──
  // KeyboardAvoidingView ne marchait pas ici : sur iOS son calcul suppose que son parent
  // commence juste sous l'en-tete (keyboardVerticalOffset = headerHeight), or il est rendu
  // sous les sous-onglets Feed / Messages / Membres de FeedScreen -> il manquait leur
  // hauteur et le clavier mangeait la barre de saisie. Sur Android (edge-to-edge impose
  // depuis SDK 54), la fenetre n'est plus redimensionnee et le behavior etait `undefined`
  // -> aucune compensation. On mesure donc directement ou se trouve le bas de la zone de
  // chat a l'ecran et on ajoute juste ce qui depasse sous le haut du clavier.
  const [kbPad, setKbPad] = useState(0);
  const [kbVisible, setKbVisible] = useState(false);
  const kbTopRef = useRef<number | null>(null);
  const chatZoneRef = useRef<View>(null);
  const recalcKbPad = useCallback((animDuration?: number) => {
    const kbTop = kbTopRef.current;
    const apply = (v: number) => {
      if (Platform.OS === 'ios' && animDuration) {
        LayoutAnimation.configureNext({ duration: animDuration, update: { duration: animDuration, type: 'keyboard' } });
      }
      setKbPad(prev => (prev === v ? prev : v));
    };
    if (kbTop == null) { apply(0); return; }
    const zone = chatZoneRef.current;
    if (!zone) return;
    zone.measureInWindow((_x, y, _w, h) => {
      // Zone cachee (autre sous-onglet affiche) : mesures a 0
      if (!h) return;
      apply(Math.max(0, Math.round(y + h - kbTop)));
    });
  }, []);

  useEffect(() => {
    const onShow = (e: any) => {
      kbTopRef.current = e?.endCoordinates?.screenY ?? null;
      setKbVisible(true);
      recalcKbPad(e?.duration);
    };
    const onHide = (e: any) => {
      kbTopRef.current = null;
      setKbVisible(false);
      recalcKbPad(e?.duration);
    };
    const subs = Platform.OS === 'ios'
      ? [
          Keyboard.addListener('keyboardWillShow', onShow),
          // Barre de suggestions qui apparait/disparait, changement de clavier...
          Keyboard.addListener('keyboardWillChangeFrame', e => { if (kbTopRef.current != null) onShow(e); }),
          Keyboard.addListener('keyboardWillHide', onHide),
        ]
      : [
          Keyboard.addListener('keyboardDidShow', onShow),
          Keyboard.addListener('keyboardDidHide', onHide),
        ];
    return () => subs.forEach(sub => sub.remove());
  }, [recalcKbPad]);

  // Une seule boite "Discussions" (messages directs + groupes rejoints, triee par
  // activite) ; le catalogue des groupes publics est une vue a part ("Decouvrir")
  const [vue, setVue] = useState<'discussions' | 'decouvrir'>('discussions');

  // ── Messages state ──
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  // Cache memoire des messages par conversation (reouverture instantanee) et id de
  // la conversation ouverte, lu par loadMessages apres l'appel reseau
  const messagesCacheRef = useRef(new Map<string, Message[]>());
  const selectedConvIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedConv && messages.length) messagesCacheRef.current.set(selectedConv.id, messages);
  }, [messages]);
  const [msgLoading, setMsgLoading] = useState(false);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [createModal, setCreateModal] = useState(false);
  const [convMode, setConvMode] = useState<'direct' | 'groupe'>('direct');
  const [groupName, setGroupName] = useState('');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  // Recherche parmi tous les membres (pas seulement ceux que l'on suit)
  const [resultatsRecherche, setResultatsRecherche] = useState<Contact[]>([]);
  const [rechercheEnCours, setRechercheEnCours] = useState(false);
  // Fenetre de selection ouverte pour ajouter des membres a ce groupe (sinon : creation)
  const [ajoutConv, setAjoutConv] = useState<Conversation | null>(null);
  const profilsVusRef = useRef(new Map<string, Contact>());
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [sendingPhoto, setSendingPhoto] = useState(false);
  const [groupMenuVisible, setGroupMenuVisible] = useState(false);
  const [membersModalVisible, setMembersModalVisible] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const channelRef = useRef<any>(null);
  const inputRef = useRef<TextInput>(null);

  // ── Reponse a un message ──
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  // Faux tant que la colonne messages.reply_to_id n'existe pas en base (OTA publiee
  // avant la migration) : on masque alors la fonction au lieu de casser la messagerie
  const [replyDispo, setReplyDispo] = useState(true);
  const replyDispoRef = useRef(true);
  // Notifications envoyees par le serveur (colonne messages.notif_serveur). Faux si la
  // migration n'est pas encore en base : l'app envoie alors elle-meme, comme avant.
  const notifServeurRef = useRef(true);
  const [citesExtra, setCitesExtra] = useState<Record<string, Citation>>({});
  const [surbrillanceId, setSurbrillanceId] = useState<string | null>(null);

  // ── Reactions / vu / en train d'ecrire ──
  const [menuMessage, setMenuMessage] = useState<Message | null>(null);
  // Faux tant que la colonne message_likes.emoji n'existe pas (OTA avant migration) :
  // seul le coeur est alors propose
  const reactionsDispoRef = useRef(true);
  const [reactionsDispo, setReactionsDispo] = useState(true);
  // Derniere lecture des autres membres de la conversation ouverte
  const [lectures, setLectures] = useState<Record<string, number>>({});
  // Qui ecrit en ce moment (user_id -> fin d'affichage)
  const [ecrivent, setEcrivent] = useState<Record<string, number>>({});
  const dernierEcritEnvoyeRef = useRef(0);
  // Conversation a laquelle le canal temps reel ouvert appartient
  const canalConvIdRef = useRef<string | null>(null);

  // ── Groupes state ──
  const [groupes, setGroupes] = useState<Groupe[]>([]);
  const [myConvIds, setMyConvIds] = useState<Set<string>>(new Set());
  const [groupesLoading, setGroupesLoading] = useState(false);
  const [createGroupeModal, setCreateGroupeModal] = useState(false);
  const [groupeForm, setGroupeForm] = useState<{ nom: string; description: string; ville: string; type: GroupeType; photoUri: string | null }>({ nom: '', description: '', ville: '', type: 'balade', photoUri: null });
  const [creatingGroupe, setCreatingGroupe] = useState(false);
  const [storyGroupe, setStoryGroupe] = useState<Groupe | null>(null);
  const [myMuted, setMyMuted] = useState(false);
  const storyCardRef = useRef<View>(null);
  const [pendingGroupeId, setPendingGroupeId] = useState<string | null>(null);

  // ── Groupe edit state ──
  const [editGroupeModal, setEditGroupeModal] = useState(false);
  const [editForm, setEditForm] = useState<{ id: string; nom: string; ville: string; type: GroupeType; photoUri: string | null; existingImageUrl: string | null }>({ id: '', nom: '', ville: '', type: 'balade', photoUri: null, existingImageUrl: null });
  const [savingEditGroupe, setSavingEditGroupe] = useState(false);

  // ── Derived ──
  function convDisplayName(conv: Conversation): string {
    if (conv.nom) return conv.nom;
    const others = conv.members.filter(m => m.user_id !== myUserId);
    if (!others.length) return 'Groupe';
    if (others.length <= 2) return others.map(m => m.prenom).join(', ');
    return `${others.slice(0, 2).map(m => m.prenom).join(', ')} +${others.length - 2}`;
  }

  const filteredGroupes = groupes;
  const groupeParConv = useMemo(() => new Map(groupes.map(g => [g.conversation_id, g])), [groupes]);
  const estMessageDirect = (c: Conversation) => c.type === 'direct' || (!c.type && !c.nom && c.members.length <= 2);
  const estGroupeAjoutable = (c: Conversation) => c.type === 'groupe';

  // ── Effects ──
  useEffect(() => { if (myUserId) { loadConversations(); loadGroupes(); } }, [myUserId]);

  // Ouvre directement une conversation quand on arrive via une notification push
  useEffect(() => {
    if (!pendingConversationId) return;
    supabase.from('push_debug_logs').insert({
      to_token: 'MSG_EFFECT', title: 'MessagerieScreen pendingConversationId effect',
      detail: JSON.stringify({ pendingConversationId, conversationsCount: conversations.length, ids: conversations.map(c => c.id) }),
    }).then(() => {}, () => {});
    if (!conversations.length) return;
    const conv = conversations.find(c => c.id === pendingConversationId);
    if (conv) {
      openConversation(conv);
      onConsumedPendingConversation?.();
    }
  }, [pendingConversationId, conversations]);

  // Deep link: thepack://groupe?id=xxx
  useEffect(() => {
    const handle = (url: string) => {
      const m = url.match(/thepack:\/\/groupe\?id=([^&]+)/);
      if (m) { setVue('decouvrir'); setPendingGroupeId(m[1]); }
    };
    Linking.getInitialURL().then(url => { if (url) handle(url); });
    const sub = Linking.addEventListener('url', ({ url }) => handle(url));
    return () => sub.remove();
  }, []);

  // Auto-join prompt when group data is ready
  useEffect(() => {
    if (!pendingGroupeId || groupes.length === 0) return;
    const g = groupes.find(gr => gr.id === pendingGroupeId);
    if (!g) return;
    setPendingGroupeId(null);
    if (myConvIds.has(g.conversation_id)) {
      openGroupeChat(g);
    } else {
      Alert.alert(
        `Rejoindre "${g.nom}" ?`,
        g.description || `Groupe The Pack${g.ville ? ` · ${g.ville}` : ''}`,
        [
          { text: 'Rejoindre', onPress: () => joinGroupe(g) },
          { text: 'Annuler', style: 'cancel' },
        ]
      );
    }
  }, [pendingGroupeId, groupes]);

  useEffect(() => {
    // Onglet garde monte mais cache (FeedScreen) : il ne doit pas piloter l'en-tete
    if (!actif) {
      navigation.setOptions({ title: 'Meute', headerLeft: undefined, headerRight: defaultHeaderRight });
      return;
    }
    if (selectedConv) {
      navigation.setOptions({
        title: convDisplayName(selectedConv),
        headerLeft: () => (
          <TouchableOpacity onPress={closeConversation} style={{ marginLeft: 4, padding: 4 }}>
            <Ionicons name="chevron-back" size={26} color={colors.ivory} />
          </TouchableOpacity>
        ),
        headerRight: () => (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 8 }}>
            {!estMessageDirect(selectedConv) ? (
              // Sourdine visible dans l'en-tete des groupes (avant : cachee dans le menu)
              <TouchableOpacity onPress={toggleMute} style={{ padding: 6 }} accessibilityLabel={myMuted ? 'Réactiver les notifications' : 'Mettre en sourdine'}>
                <Ionicons name={myMuted ? 'notifications-off-outline' : 'notifications-outline'} size={21} color={colors.ivory} />
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity onPress={() => setGroupMenuVisible(true)} style={{ padding: 6 }}>
              <Ionicons name="ellipsis-vertical" size={22} color={colors.ivory} />
            </TouchableOpacity>
          </View>
        ),
      });
    } else {
      // Cette navigation est en realite celle de l'onglet Meute parent (MessagerieScreen
      // n'est pas sa propre Screen, juste un composant rendu dans FeedScreen) -- remettre
      // headerRight a undefined ici effacait silencieusement le coeur d'activite du header
      // Meute des qu'on revenait a la liste des conversations, sans jamais le restaurer.
      navigation.setOptions({ title: 'La Meute', headerLeft: undefined, headerRight: defaultHeaderRight });
    }
    // Demonte quand on quitte l'onglet Chat de FeedScreen (rendu conditionnel) : sans ce
    // cleanup, le header restait bloque sur l'etat "conversation fermee" (donc sans coeur)
    // meme apres avoir quitte cet onglet.
    return () => {
      navigation.setOptions({ title: 'Meute', headerLeft: undefined, headerRight: defaultHeaderRight });
    };
  }, [selectedConv, myMuted, actif]);

  // L'indicateur "en train d'ecrire" s'efface 4 s apres le dernier signal
  useEffect(() => {
    const ids = Object.keys(ecrivent);
    if (!ids.length) return;
    const t = setInterval(() => {
      const now = Date.now();
      setEcrivent(prev => {
        const next: Record<string, number> = {};
        Object.entries(prev).forEach(([k, v]) => { if (v > now) next[k] = v; });
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [ecrivent]);

  // Retour sur l'onglet : rafraichissement discret (sans roue de chargement)
  const dejaActifRef = useRef(false);
  useEffect(() => {
    if (!actif) return;
    if (dejaActifRef.current && myUserId) loadConversations(true);
    dejaActifRef.current = true;
  }, [actif]);

  // ── Conversations ──
  async function loadConversations(silencieux = false) {
    if (!myUserId) return;
    if (!silencieux) setLoading(true);
    const { data: memberRows } = await supabase
      .from('conversation_members').select('conversation_id,last_read_at').eq('user_id', myUserId);
    if (!memberRows?.length) { setConversations([]); setLoading(false); return; }
    const convIds = memberRows.map((r: any) => r.conversation_id);
    const plancher = Date.now() - NON_LU_MAX_AGE_MS;
    const luDepuis: Record<string, number> = {};
    memberRows.forEach((r: any) => {
      const lu = r.last_read_at ? Date.parse(r.last_read_at) : NaN;
      luDepuis[r.conversation_id] = Number.isFinite(lu) && lu > plancher ? lu : plancher;
    });
    const [{ data: convData }, { data: allMembers }, { data: recentMsgs }] = await Promise.all([
      supabase.from('conversations').select('id,nom,created_by,type,created_at').in('id', convIds).eq('actif', true),
      supabase.from('conversation_members').select('conversation_id,user_id').in('conversation_id', convIds),
      // Dernier message de chaque conversation, en parallele (cf. commentaire plus bas)
      supabase.from('messages')
        .select('conversation_id,contenu,image_url,created_at,user_id')
        .in('conversation_id', convIds).eq('actif', true)
        .order('created_at', { ascending: false }).limit(500),
    ]);
    if (!convData?.length) { setConversations([]); setLoading(false); return; }
    const allUserIds = [...new Set((allMembers || []).map((m: any) => m.user_id))];
    const { data: profils } = await supabase.from('profils').select('id,prenom,avatar_url').in('id', allUserIds);
    const pm: Record<string, any> = {};
    (profils || []).forEach((p: any) => { pm[p.id] = p; });
    const membersByConv: Record<string, ConvMember[]> = {};
    (allMembers || []).forEach((m: any) => {
      if (!membersByConv[m.conversation_id]) membersByConv[m.conversation_id] = [];
      membersByConv[m.conversation_id].push({
        user_id: m.user_id, prenom: pm[m.user_id]?.prenom || 'Membre', avatar_url: pm[m.user_id]?.avatar_url || null,
      });
    });
    // Une requete par conversation ici tirait autant de requetes reseau sequentielles/
    // paralleles que de conversations (N+1), ralentissant fortement le chargement de la
    // liste des qu'on est dans plusieurs groupes. Une seule requete batchee sur les
    // messages recents de toutes les conversations, groupee cote client, suffit tant que
    // chaque conversation a au moins un message parmi les 500 plus recents (largement
    // le cas en pratique).
    const lastMessages: Record<string, any> = {};
    const nonLus: Record<string, number> = {};
    (recentMsgs || []).forEach((m: any) => {
      if (!lastMessages[m.conversation_id]) lastMessages[m.conversation_id] = m;
      // Conversation ouverte en ce moment : deja lue
      if (m.user_id !== myUserId && m.conversation_id !== selectedConvIdRef.current
          && Date.parse(m.created_at) > (luDepuis[m.conversation_id] ?? plancher)) {
        nonLus[m.conversation_id] = (nonLus[m.conversation_id] || 0) + 1;
      }
    });
    const list: Conversation[] = (convData || []).map((c: any) => ({
      id: c.id, nom: c.nom, created_by: c.created_by, type: c.type, created_at: c.created_at,
      members: membersByConv[c.id] || [],
      last_message: lastMessages[c.id] || null,
      unread: nonLus[c.id] || 0,
    })).sort((a, b) => {
      // Pas de localeCompare (cf. villeRegion.ts / normalizeText) : comparaison
      // simple, suffisante pour des dates ISO 8601.
      // Conversation sans message : rangee a sa date de creation
      const ad = a.last_message?.created_at || a.created_at || '0', bd = b.last_message?.created_at || b.created_at || '0';
      return ad < bd ? 1 : ad > bd ? -1 : 0;
    });
    setConversations(list);
    setLoading(false);
  }

  // ── Liste en direct ──
  // Un message arrive dans une de mes conversations (la RLS de Realtime ne
  // m'envoie que celles dont je suis membre) : aperçu, compteur et ordre mis a jour
  // sans attendre de revenir sur l'onglet. Conversation inconnue (on vient de
  // m'ajouter a un groupe, nouveau message direct) : rechargement discret.
  const loadConversationsRef = useRef(loadConversations);
  loadConversationsRef.current = loadConversations;
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  useEffect(() => {
    if (!myUserId) return;
    const ch = supabase.channel(`boite:${myUserId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const m = payload.new as any;
        if (!m?.conversation_id || m.actif === false) return;
        if (!conversationsRef.current.some(c => c.id === m.conversation_id)) {
          loadConversationsRef.current(true);
          return;
        }
        setConversations(prev => {
          const i = prev.findIndex(c => c.id === m.conversation_id);
          if (i < 0) return prev;
          const c = prev[i];
          const ouverte = selectedConvIdRef.current === c.id;
          const maj: Conversation = {
            ...c,
            last_message: { contenu: m.contenu || '', image_url: m.image_url || null, created_at: m.created_at, user_id: m.user_id },
            unread: m.user_id !== myUserId && !ouverte ? (c.unread || 0) + 1 : c.unread,
          };
          return [maj, ...prev.slice(0, i), ...prev.slice(i + 1)];
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [myUserId]);

  // Marque la conversation comme lue (en base + pastille de la liste)
  function markConversationRead(convId: string, dernierMessageAt?: string | null) {
    if (!myUserId) return;
    // Horloge du telephone en retard sur le serveur : on prend au moins la date du
    // dernier message vu, sinon il resterait "non lu"
    const msgMs = dernierMessageAt ? Date.parse(dernierMessageAt) : NaN;
    const lu = new Date(Number.isFinite(msgMs) && msgMs + 1 > Date.now() ? msgMs + 1 : Date.now()).toISOString();
    setConversations(prev => prev.map(c => (c.id === convId && c.unread ? { ...c, unread: 0 } : c)));
    supabase.from('conversation_members').update({ last_read_at: lu })
      .eq('conversation_id', convId).eq('user_id', myUserId)
      .then(() => {}, () => {});
    // Previent les autres membres en direct (affichage "Vu")
    if (selectedConvIdRef.current === convId) envoyerSignal('lu', { at: lu });
  }

  async function openConversation(conv: Conversation) {
    selectedConvIdRef.current = conv.id;
    setSelectedConv(conv);
    setReplyTo(null);
    setLectures({});
    setEcrivent({});
    supabase.from('conversation_members').select('user_id,last_read_at').eq('conversation_id', conv.id)
      .then(({ data }) => {
        if (selectedConvIdRef.current !== conv.id) return;
        const l: Record<string, number> = {};
        (data || []).forEach((r: any) => { if (r.user_id !== myUserId && r.last_read_at) l[r.user_id] = Date.parse(r.last_read_at); });
        setLectures(l);
      }, () => {});
    markConversationRead(conv.id, conv.last_message?.created_at);
    // Reouverture : messages deja vus affiches tout de suite, rafraichis en arriere-plan
    const enCache = messagesCacheRef.current.get(conv.id);
    if (enCache?.length) setMessages(enCache);
    else { setMessages([]); setMsgLoading(true); }
    if (myUserId) {
      supabase.from('conversation_members').select('muted').eq('conversation_id', conv.id).eq('user_id', myUserId).maybeSingle()
        .then(({ data: memberRow }) => setMyMuted(memberRow?.muted ?? false));
    }
    try {
      await loadMessages(conv.id);
    } catch (e: any) {
      // Sans ce catch, la moindre erreur reseau ici (timeout, connexion coupee...)
      // laissait msgLoading bloque a true pour toujours -- roulette infinie sans
      // aucun moyen de s'en sortir a part relancer l'app.
      Alert.alert('Erreur', "Impossible de charger la conversation. Vérifie ta connexion et réessaie.");
    } finally {
      setMsgLoading(false);
    }
    if (channelRef.current) channelRef.current.unsubscribe();
    canalConvIdRef.current = conv.id;
    let premierAbonnement = true;
    channelRef.current = supabase.channel(`conv:${conv.id}`, { config: { broadcast: { self: false } } })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conv.id}` },
        async (payload) => {
          const m = payload.new as any;
          const { data: p } = await supabase.from('profils').select('prenom,avatar_url').eq('id', m.user_id).single();
          const newMsg: Message = { ...m, prenom: p?.prenom || 'Membre', avatar_url: p?.avatar_url || null, reactions: {}, maReaction: null };
          setMessages(prev => prev.some(x => x.id === newMsg.id) ? prev : [...prev, newMsg]);
          // Son message est arrive : il n'ecrit plus
          setEcrivent(prev => { if (!(m.user_id in prev)) return prev; const n = { ...prev }; delete n[m.user_id]; return n; });
          // Recu pendant que la conversation est ouverte : lu
          if (m.user_id !== myUserId && selectedConvIdRef.current === conv.id) markConversationRead(conv.id, m.created_at);
        })
      // Reactions : on relit celles du message concerne (ou de tous les messages
      // affiches pour une suppression, dont Realtime ne donne pas le message)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_likes' },
        (payload) => {
          const id = (payload.new as any)?.message_id;
          rafraichirReactions(conv.id, id ? [id] : null);
        })
      .on('broadcast', { event: 'ecrit' }, ({ payload }) => {
        const uid = payload?.user_id;
        if (!uid || uid === myUserId) return;
        setEcrivent(prev => ({ ...prev, [uid]: Date.now() + 4000 }));
      })
      .on('broadcast', { event: 'lu' }, ({ payload }) => {
        const uid = payload?.user_id;
        const at = payload?.at ? Date.parse(payload.at) : NaN;
        if (!uid || uid === myUserId || !Number.isFinite(at)) return;
        setLectures(prev => (prev[uid] && prev[uid] >= at ? prev : { ...prev, [uid]: at }));
      })
      .subscribe((status) => {
        // A l'ouverture : je signale ma lecture une fois le canal pret
        if (status === 'SUBSCRIBED' && premierAbonnement) {
          premierAbonnement = false;
          envoyerSignal('lu', { at: new Date().toISOString() });
        }
      });
  }

  function envoyerSignal(event: 'ecrit' | 'lu', payload: Record<string, any> = {}) {
    if (!myUserId || !channelRef.current || canalConvIdRef.current !== selectedConvIdRef.current) return;
    channelRef.current.send({ type: 'broadcast', event, payload: { ...payload, user_id: myUserId } }).catch?.(() => {});
  }

  function onSaisie(texte: string) {
    setInputText(texte);
    // Signal "en train d'ecrire", au plus toutes les 2,5 s
    const now = Date.now();
    if (texte.trim() && now - dernierEcritEnvoyeRef.current > 2500) {
      dernierEcritEnvoyeRef.current = now;
      envoyerSignal('ecrit');
    }
  }

  // Relit les reactions (petit delai pour regrouper les evenements rapproches)
  const reactionsTimerRef = useRef<any>(null);
  const reactionsIdsRef = useRef<Set<string> | null>(new Set());
  function rafraichirReactions(convId: string, ids: string[] | null) {
    if (ids === null) reactionsIdsRef.current = null;
    else if (reactionsIdsRef.current) ids.forEach(i => reactionsIdsRef.current!.add(i));
    clearTimeout(reactionsTimerRef.current);
    reactionsTimerRef.current = setTimeout(async () => {
      const cibles = reactionsIdsRef.current;
      reactionsIdsRef.current = new Set();
      if (selectedConvIdRef.current !== convId) return;
      const affiches = (messagesCacheRef.current.get(convId) || []).map(m => m.id).filter(id => !id.startsWith('tmp-'));
      const liste = cibles ? [...cibles].filter(id => affiches.includes(id)) : affiches;
      if (!liste.length) return;
      const { data } = await chargerReactions(liste);
      if (!data || selectedConvIdRef.current !== convId) return;
      const parMessage = regrouperReactions(data);
      setMessages(prev => prev.map(m => liste.includes(m.id)
        ? { ...m, reactions: parMessage.compte[m.id] || {}, maReaction: parMessage.mienne[m.id] || null }
        : m));
    }, 400);
  }

  async function chargerReactions(messageIds: string[]) {
    let res: any = await supabase.from('message_likes')
      .select(reactionsDispoRef.current ? 'message_id,user_id,emoji' : 'message_id,user_id').in('message_id', messageIds);
    if (res.error && reactionsDispoRef.current && (res.error.code === '42703' || /emoji/.test(res.error.message || ''))) {
      reactionsDispoRef.current = false;
      setReactionsDispo(false);
      res = await supabase.from('message_likes').select('message_id,user_id').in('message_id', messageIds);
    }
    return res as { data: any[] | null };
  }

  function regrouperReactions(rows: any[]) {
    const compte: Record<string, Record<string, number>> = {};
    const mienne: Record<string, string> = {};
    rows.forEach((l: any) => {
      const e = l.emoji || '❤️';
      compte[l.message_id] = compte[l.message_id] || {};
      compte[l.message_id][e] = (compte[l.message_id][e] || 0) + 1;
      if (l.user_id === myUserId) mienne[l.message_id] = e;
    });
    return { compte, mienne };
  }

  function closeConversation() {
    channelRef.current?.unsubscribe();
    channelRef.current = null;
    canalConvIdRef.current = null;
    setMenuMessage(null);
    setEcrivent({});
    selectedConvIdRef.current = null;
    setSelectedConv(null);
    setMessages([]);
    setInputText('');
    setReplyTo(null);
    setMyMuted(false);
    loadConversations();
  }

  async function loadMessages(convId: string) {
    // Les 100 plus RECENTS, remis dans l'ordre chronologique. Avant : tri croissant +
    // limit 100 = les 100 plus anciens, donc au-dela de 100 messages les derniers
    // n'apparaissaient pas.
    const charger = (avecReponse: boolean) => supabase.from('messages')
      .select(avecReponse ? 'id,user_id,contenu,image_url,created_at,reply_to_id' : 'id,user_id,contenu,image_url,created_at')
      .eq('conversation_id', convId).eq('actif', true)
      .order('created_at', { ascending: false }).limit(100);
    let res: any = await charger(replyDispoRef.current);
    if (res.error && replyDispoRef.current && (res.error.code === '42703' || /reply_to_id/.test(res.error.message || ''))) {
      replyDispoRef.current = false;
      setReplyDispo(false);
      res = await charger(false);
    }
    if (res.error) throw res.error;
    const data: any[] = (res.data || []).reverse();
    if (!data.length) { setMessages([]); messagesCacheRef.current.set(convId, []); return; }
    // Messages cites absents des 100 charges (plus anciens ou supprimes)
    const chargesIds = new Set(data.map((m: any) => m.id));
    const citesManquants = [...new Set(data.map((m: any) => m.reply_to_id).filter((id: any) => id && !chargesIds.has(id)))] as string[];
    const { data: citesRows } = citesManquants.length
      ? await supabase.from('messages').select('id,user_id,contenu,image_url,actif').in('id', citesManquants)
      : { data: [] as any[] };
    const userIds = [...new Set([...data.map((m: any) => m.user_id), ...(citesRows || []).map((c: any) => c.user_id)])];
    const messageIds = data.map((m: any) => m.id);
    const [{ data: profils }, { data: likes }] = await Promise.all([
      supabase.from('profils').select('id,prenom,avatar_url').in('id', userIds),
      chargerReactions(messageIds),
    ]);
    const pm: Record<string, any> = {};
    (profils || []).forEach((p: any) => { pm[p.id] = p; });
    const { compte, mienne } = regrouperReactions(likes || []);
    const liste: Message[] = data.map((m: any) => ({
      ...m,
      prenom: pm[m.user_id]?.prenom || 'Membre',
      avatar_url: pm[m.user_id]?.avatar_url || null,
      reactions: compte[m.id] || {},
      maReaction: mienne[m.id] || null,
    }));
    if (citesRows?.length) {
      setCitesExtra(prev => {
        const next = { ...prev };
        citesRows.forEach((c: any) => {
          next[c.id] = { id: c.id, user_id: c.user_id, contenu: c.contenu || '', image_url: c.image_url, prenom: pm[c.user_id]?.prenom || 'Membre', supprime: c.actif === false };
        });
        return next;
      });
    }
    messagesCacheRef.current.set(convId, liste);
    // Ne pas ecraser une autre conversation ouverte entre-temps
    if (selectedConvIdRef.current === convId) setMessages(liste);
  }

  // Reagir a un message : meme emoji = retirer, autre emoji = changer
  async function reagir(message: Message, emoji: string) {
    if (!myUserId || message.id.startsWith('tmp-')) return;
    const avant = message.maReaction;
    const apres = avant === emoji ? null : emoji;
    const appliquer = (m: Message, de: string | null, vers: string | null): Message => {
      const r = { ...m.reactions };
      if (de) { r[de] = (r[de] || 1) - 1; if (r[de] <= 0) delete r[de]; }
      if (vers) r[vers] = (r[vers] || 0) + 1;
      return { ...m, reactions: r, maReaction: vers };
    };
    setMessages(prev => prev.map(m => (m.id === message.id ? appliquer(m, avant, apres) : m)));
    let error: any = null;
    if (!apres) {
      ({ error } = await supabase.from('message_likes').delete().eq('message_id', message.id).eq('user_id', myUserId));
    } else if (avant) {
      ({ error } = await supabase.from('message_likes').update({ emoji: apres }).eq('message_id', message.id).eq('user_id', myUserId));
    } else {
      ({ error } = await supabase.from('message_likes').insert(
        reactionsDispoRef.current ? { message_id: message.id, user_id: myUserId, emoji: apres } : { message_id: message.id, user_id: myUserId }));
      // Contrainte unique : deja une reaction (double tap rapide) -> on relit l'etat reel
      if (error?.code === '23505') error = null;
    }
    if (error) {
      setMessages(prev => prev.map(m => (m.id === message.id ? appliquer(m, apres, avant) : m)));
    }
    if (selectedConvIdRef.current) rafraichirReactions(selectedConvIdRef.current, [message.id]);
  }

  // Insere un message en demandant au serveur d'envoyer les notifications ; si la
  // colonne n'existe pas encore (OTA publiee avant la migration), reessaie sans.
  async function insererMessage(champs: Record<string, any>) {
    const essai = (serveur: boolean) => supabase.from('messages')
      .insert(serveur ? { ...champs, notif_serveur: true } : champs)
      .select('id,created_at').single();
    let res = await essai(notifServeurRef.current);
    if (res.error && notifServeurRef.current && (res.error.code === 'PGRST204' || res.error.code === '42703' || /notif_serveur/.test(res.error.message || ''))) {
      notifServeurRef.current = false;
      res = await essai(false);
    }
    return { ...res, notifParServeur: notifServeurRef.current };
  }

  async function pickAndSendPhoto() {
    if (!selectedConv || !myUserId || sendingPhoto) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], allowsEditing: true, quality: 0.8,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    if (result.canceled || !result.assets[0]) return;
    setSendingPhoto(true);
    try {
      const uri = result.assets[0].uri;
      const ext = uri.split('.').pop() || 'jpg';
      const path = `messages/${myUserId}-${Date.now()}.${ext}`;
      const formData = new FormData();
      formData.append('file', { uri, name: path, type: `image/${ext}` } as any);
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, formData, { upsert: true });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
      const reponseA = replyDispo ? replyTo : null;
      const { data, error, notifParServeur } = await insererMessage({
        conversation_id: selectedConv.id, user_id: myUserId, contenu: '', image_url: pub.publicUrl,
        ...(reponseA ? { reply_to_id: reponseA.id } : {}),
      });
      if (error) throw error;
      if (reponseA) setReplyTo(null);
      const optimistic: Message = {
        id: data?.id ?? `tmp-${Date.now()}`, user_id: myUserId, contenu: '', image_url: pub.publicUrl,
        created_at: data?.created_at ?? new Date().toISOString(), prenom: 'Moi', avatar_url: null,
        reactions: {}, maReaction: null, reply_to_id: reponseA?.id ?? null,
      };
      setMessages(prev => prev.some(m => m.id === optimistic.id) ? prev : [...prev, optimistic]);
      if (!notifParServeur) notifyOtherMembers('📷 Photo', selectedConv);
    } catch (e: any) {
      Alert.alert('Erreur', e.message || "Impossible d'envoyer la photo.");
    } finally {
      setSendingPhoto(false);
    }
  }

  async function sendMessage() {
    if (!inputText.trim() || !selectedConv || !myUserId || sending) return;
    const text = inputText.trim();
    const reponseA = replyDispo ? replyTo : null;
    setInputText('');
    setReplyTo(null);
    setSending(true);
    const { data, error, notifParServeur } = await insererMessage({
      conversation_id: selectedConv.id, user_id: myUserId, contenu: text,
      ...(reponseA ? { reply_to_id: reponseA.id } : {}),
    });
    if (!error) {
      const optimistic: Message = { id: data?.id ?? `tmp-${Date.now()}`, user_id: myUserId, contenu: text, image_url: null, created_at: data?.created_at ?? new Date().toISOString(), prenom: 'Moi', avatar_url: null, reactions: {}, maReaction: null, reply_to_id: reponseA?.id ?? null };
      setMessages(prev => prev.some(m => m.id === optimistic.id) ? prev : [...prev, optimistic]);
      if (!notifParServeur) notifyOtherMembers(text, selectedConv);
    } else {
      Alert.alert('Erreur', `Message non envoyé : ${error.message}`);
      setInputText(text);
      setReplyTo(reponseA);
    }
    setSending(false);
  }

  async function leaveConversation() {
    if (!myUserId || !selectedConv) return;
    await supabase.from('conversation_members').delete().eq('conversation_id', selectedConv.id).eq('user_id', myUserId);
    closeConversation();
  }

  async function deleteConversation() {
    if (!myUserId || !selectedConv) return;
    const { error, count } = await supabase.from('conversations').update({ actif: false }, { count: 'exact' }).eq('id', selectedConv.id);
    if (error || !count) {
      Alert.alert('Erreur', error?.message || 'Suppression impossible (droits insuffisants).');
      return;
    }
    // La conversation d'un groupe a une ligne miroir dans `groupes` : il faut aussi la désactiver
    // sinon le groupe reste visible dans l'onglet Groupes malgré la conversation supprimée.
    await supabase.from('groupes').update({ actif: false }).eq('conversation_id', selectedConv.id);
    setGroupes(prev => prev.filter(g => g.conversation_id !== selectedConv.id));
    closeConversation();
  }

  async function toggleMute() {
    if (!myUserId || !selectedConv) return;
    const newMuted = !myMuted;
    setMyMuted(newMuted);
    const { error } = await supabase.from('conversation_members').update({ muted: newMuted }).eq('conversation_id', selectedConv.id).eq('user_id', myUserId);
    if (error) { setMyMuted(!newMuted); Alert.alert('Erreur', "Réglage non enregistré, réessaie."); return; }
    Alert.alert(newMuted ? 'Sourdine activée' : 'Notifications réactivées', newMuted ? "Tu ne recevras plus de notification pour ce groupe." : "Tu seras de nouveau prévenu·e des nouveaux messages.");
  }

  // Ancien circuit (envoi depuis le telephone), garde uniquement en secours tant que
  // la migration des notifications serveur n'est pas en base.
  async function notifyOtherMembers(text: string, conv: Conversation) {
    const otherIds = conv.members.filter(m => m.user_id !== myUserId).map(m => m.user_id);
    if (!otherIds.length) return;
    const [{ data: prefs }, { data: mutedRows }] = await Promise.all([
      supabase.from('profils').select('id,push_token,notif_messages').in('id', otherIds),
      supabase.from('conversation_members').select('user_id').eq('conversation_id', conv.id).eq('muted', true).in('user_id', otherIds),
    ]);
    const mutedSet = new Set((mutedRows || []).map((r: any) => r.user_id));
    const myPrenom = conv.members.find(m => m.user_id === myUserId)?.prenom || 'Quelqu\'un';
    const convName = conv.nom || conv.members.filter(m => m.user_id !== myUserId).map(m => m.prenom).slice(0, 2).join(', ') || 'Message';
    for (const p of (prefs || [])) {
      if (!p.push_token) continue;
      if (p.notif_messages === false) continue;
      if (mutedSet.has(p.id)) continue;
      sendPushNotification(p.push_token, convName, `${myPrenom} : ${text}`, { type: 'message', conversationId: conv.id });
    }
  }

  // Recherche de membres (prenom ou pseudo), avec un petit delai pendant la frappe
  useEffect(() => {
    const q = memberSearch.trim().replace(/[,()%*\\]/g, ' ').trim();
    if (!createModal || q.length < 2 || !myUserId) { setResultatsRecherche([]); setRechercheEnCours(false); return; }
    setRechercheEnCours(true);
    let annule = false;
    const t = setTimeout(async () => {
      const { data } = await supabase.from('profils').select('id,prenom,avatar_url,ville')
        .or(`prenom.ilike.%${q}%,username.ilike.%${q}%`).neq('id', myUserId).limit(20);
      if (annule) return;
      const liste: Contact[] = (data || []).map((p: any) => ({ id: p.id, prenom: p.prenom || 'Membre', avatar_url: p.avatar_url, ville: p.ville || null }));
      liste.forEach(c => profilsVusRef.current.set(c.id, c));
      setResultatsRecherche(liste);
      setRechercheEnCours(false);
    }, 300);
    return () => { annule = true; clearTimeout(t); };
  }, [memberSearch, createModal, myUserId]);

  async function openCreateModal(ajout: Conversation | null = null) {
    if (!myUserId) return;
    setAjoutConv(ajout);
    const { data: followsData } = await supabase.from('follows').select('following_id').eq('follower_id', myUserId).eq('statut', 'accepte');
    const ids = (followsData || []).map((f: any) => f.following_id);
    if (ids.length) {
      const { data } = await supabase.from('profils').select('id,prenom,avatar_url,ville').in('id', ids);
      const liste: Contact[] = (data || []).map((p: any) => ({ id: p.id, prenom: p.prenom || 'Membre', avatar_url: p.avatar_url, ville: p.ville || null }));
      liste.forEach(c => profilsVusRef.current.set(c.id, c));
      setContacts(liste);
    } else { setContacts([]); }
    setSelectedMembers([]); setGroupName(''); setConvMode(ajout ? 'groupe' : 'direct'); setMemberSearch('');
    setCreateModal(true);
  }

  async function ajouterMembres() {
    if (!ajoutConv || !selectedMembers.length) return;
    setCreating(true);
    const { data: n, error } = await supabase.rpc('ajouter_membres_conversation', {
      p_conversation: ajoutConv.id, p_user_ids: selectedMembers,
    });
    setCreating(false);
    if (error) { Alert.alert('Erreur', error.message); return; }
    const nouveaux: ConvMember[] = selectedMembers
      .filter(id => !ajoutConv.members.some(m => m.user_id === id))
      .map(id => { const c = profilsVusRef.current.get(id); return { user_id: id, prenom: c?.prenom || 'Membre', avatar_url: c?.avatar_url || null }; });
    const maj = (c: Conversation) => (c.id === ajoutConv.id ? { ...c, members: [...c.members, ...nouveaux] } : c);
    setSelectedConv(prev => (prev ? maj(prev) : prev));
    setConversations(prev => prev.map(maj));
    setCreateModal(false);
    setAjoutConv(null);
    Alert.alert('C’est fait', `${n ?? nouveaux.length} membre${(n ?? nouveaux.length) > 1 ? 's' : ''} ajouté${(n ?? nouveaux.length) > 1 ? 's' : ''} au groupe.`);
  }

  async function createConversation() {
    if (!myUserId || !selectedMembers.length) return;
    setCreating(true);
    if (convMode === 'direct') {
      // find_or_create_dm (audit de securite) : l'ancienne version lisait
      // directement conversation_members.user_id = l'autre utilisateur pour
      // trouver un DM existant en commun -- plus possible depuis que la RLS
      // (totalement absente avant) protege correctement ces tables.
      const { data: convId, error } = await supabase.rpc('find_or_create_dm', { p_other_id: selectedMembers[0] });
      setCreating(false); setCreateModal(false);
      if (error || !convId) { Alert.alert('Erreur', error?.message || ''); return; }
      const match = conversations.find(c => c.id === convId);
      if (match) { openConversation(match); return; }
      const otherContact = profilsVusRef.current.get(selectedMembers[0]);
      openConversation({
        id: convId, nom: null, created_by: myUserId, type: 'direct',
        members: [
          { user_id: myUserId, prenom: 'Moi', avatar_url: null },
          { user_id: selectedMembers[0], prenom: otherContact?.prenom || 'Membre', avatar_url: otherContact?.avatar_url || null },
        ],
        last_message: null,
      });
      await loadConversations();
      return;
    }
    const { data: conv, error } = await supabase.from('conversations').insert({
      nom: groupName.trim() || null, created_by: myUserId, actif: true,
    }).select().single();
    if (error || !conv) { Alert.alert('Erreur', error?.message || ''); setCreating(false); return; }
    await supabase.from('conversation_members').insert([...new Set([myUserId, ...selectedMembers])].map(uid => ({ conversation_id: conv.id, user_id: uid })));
    setCreating(false); setCreateModal(false);
    await loadConversations();
    openConversation({ id: conv.id, nom: conv.nom, created_by: myUserId, type: conv.type || 'groupe', members: [...new Set([myUserId, ...selectedMembers])].map(uid => { const c = profilsVusRef.current.get(uid); return { user_id: uid, prenom: c?.prenom || 'Moi', avatar_url: c?.avatar_url || null }; }), last_message: null });
  }

  // ── Groupes ──
  async function loadGroupes() {
    if (!myUserId) return;
    setGroupesLoading(true);
    const [{ data: gData }, { data: memberRows }] = await Promise.all([
      supabase.from('groupes').select('*').eq('actif', true).order('created_at', { ascending: false }),
      supabase.from('conversation_members').select('conversation_id').eq('user_id', myUserId),
    ]);
    setMyConvIds(new Set((memberRows || []).map((m: any) => m.conversation_id)));

    if (gData?.length) {
      // Nombre de membres de tous les groupes en une requete (avant : une par groupe)
      const { data: membresGroupes } = await supabase.from('conversation_members')
        .select('conversation_id').in('conversation_id', gData.map((gr: any) => gr.conversation_id));
      const compte: Record<string, number> = {};
      (membresGroupes || []).forEach((m: any) => { compte[m.conversation_id] = (compte[m.conversation_id] || 0) + 1; });
      setGroupes(gData.map((gr: any) => ({ ...gr, membre_count: compte[gr.conversation_id] ?? 0 })));
    } else { setGroupes([]); }
    setGroupesLoading(false);
  }

  async function joinGroupe(groupe: Groupe) {
    if (!myUserId) return;
    const { error } = await supabase.from('conversation_members').insert({ conversation_id: groupe.conversation_id, user_id: myUserId });
    if (error) { Alert.alert('Erreur', error.message); return; }
    setMyConvIds(prev => new Set([...prev, groupe.conversation_id]));
    setGroupes(prev => prev.map(g => g.id === groupe.id ? { ...g, membre_count: (g.membre_count ?? 0) + 1 } : g));
    // Directement dans la discussion (avant : fenetre "Bienvenue" puis retaper "Ouvrir")
    await openGroupeChat(groupe);
    loadConversations(true);
  }

  async function openGroupeChat(groupe: Groupe) {
    const { data: convData } = await supabase.from('conversations').select('id,nom,created_by').eq('id', groupe.conversation_id).single();
    if (!convData) return;
    const { data: members } = await supabase.from('conversation_members').select('user_id').eq('conversation_id', groupe.conversation_id);
    const userIds = (members || []).map((m: any) => m.user_id);
    const { data: profils } = await supabase.from('profils').select('id,prenom,avatar_url').in('id', userIds);
    const pm: Record<string, any> = {};
    (profils || []).forEach((p: any) => { pm[p.id] = p; });
    openConversation({
      id: convData.id, nom: groupe.nom, created_by: convData.created_by, type: 'groupe',
      members: userIds.map(uid => ({ user_id: uid, prenom: pm[uid]?.prenom || 'Membre', avatar_url: pm[uid]?.avatar_url || null })),
      last_message: null,
    });
  }

  async function pickGroupePhoto(target: 'create' | 'edit') {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], allowsEditing: true, aspect: [16, 9], quality: 0.85,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    if (result.canceled || !result.assets[0]) return;
    const uri = result.assets[0].uri;
    if (target === 'create') setGroupeForm(f => ({ ...f, photoUri: uri }));
    else setEditForm(f => ({ ...f, photoUri: uri }));
  }

  async function uploadGroupePhoto(uri: string): Promise<string | null> {
    if (!myUserId) return null;
    const ext = uri.split('.').pop() || 'jpg';
    const path = `groupes/${myUserId}-${Date.now()}.${ext}`;
    const formData = new FormData();
    formData.append('file', { uri, name: path, type: `image/${ext}` } as any);
    const { error } = await supabase.storage.from('avatars').upload(path, formData, { upsert: true });
    if (error) { Alert.alert('Erreur upload photo', error.message); return null; }
    const { data } = supabase.storage.from('avatars').getPublicUrl(path);
    return data.publicUrl;
  }

  async function createGroupe() {
    if (!myUserId || !groupeForm.nom.trim()) { Alert.alert('Donne un nom au groupe'); return; }
    setCreatingGroupe(true);
    let image_url: string | null = null;
    if (groupeForm.photoUri) image_url = await uploadGroupePhoto(groupeForm.photoUri);
    const { data: conv, error: convErr } = await supabase.from('conversations').insert({ nom: groupeForm.nom.trim(), type: 'groupe', created_by: myUserId, actif: true }).select().single();
    if (convErr || !conv) { Alert.alert('Erreur', convErr?.message || ''); setCreatingGroupe(false); return; }
    await supabase.from('groupes').insert({ nom: groupeForm.nom.trim(), description: groupeForm.description.trim() || null, ville: groupeForm.ville.trim() || null, type: groupeForm.type, image_url, conversation_id: conv.id, created_by: myUserId });
    await supabase.from('conversation_members').insert({ conversation_id: conv.id, user_id: myUserId });
    setCreatingGroupe(false);
    setCreateGroupeModal(false);
    setGroupeForm({ nom: '', description: '', ville: '', type: 'balade', photoUri: null });
    await loadGroupes();
  }

  function openEditGroupe(groupe: Groupe) {
    setEditForm({ id: groupe.id, nom: groupe.nom, ville: groupe.ville || '', type: groupe.type, photoUri: null, existingImageUrl: groupe.image_url });
    setEditGroupeModal(true);
  }

  async function submitEditGroupe() {
    if (!editForm.nom.trim()) { Alert.alert('Donne un nom au groupe'); return; }
    setSavingEditGroupe(true);
    const update: any = { nom: editForm.nom.trim(), type: editForm.type, ville: editForm.ville.trim() || null };
    if (editForm.photoUri) {
      const url = await uploadGroupePhoto(editForm.photoUri);
      if (url) update.image_url = url;
    }
    const { error } = await supabase.from('groupes').update(update).eq('id', editForm.id);
    setSavingEditGroupe(false);
    if (error) { Alert.alert('Erreur', error.message); return; }
    setEditGroupeModal(false);
    await loadGroupes();
  }

  function shareWhatsApp(groupe: Groupe) {
    const link = `https://thepacklameute.fr/groupe/${groupe.id}`;
    const text = `🐾 Rejoins le groupe "${groupe.nom}" sur The Pack La Meute !${groupe.description ? `\n${groupe.description}` : ''}${groupe.ville ? `\n📍 ${groupe.ville}` : ''}\n\n👉 ${link}`;
    Linking.openURL(`whatsapp://send?text=${encodeURIComponent(text)}`).catch(() => {
      Share.share({ message: text });
    });
  }

  function shareStory(groupe: Groupe) {
    setStoryGroupe(groupe);
    setTimeout(async () => {
      try {
        const uri = await captureRef(storyCardRef, { format: 'png', quality: 0.95 });
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: `Groupe ${groupe.nom}` });
        } else {
          await Share.share({ url: uri, title: groupe.nom });
        }
      } catch {
        Alert.alert('Erreur', 'Impossible de créer l\'image.');
      }
      setStoryGroupe(null);
    }, 500);
  }

  // ── Render helpers ──
  function renderConvAvatar(conv: Conversation) {
    const groupePublic = groupeParConv.get(conv.id);
    if (groupePublic || conv.type === 'evenement_prive' || (conv.nom && !estMessageDirect(conv))) {
      return (
        <View style={s.convAvatarWrap}>
          {groupePublic?.image_url
            ? <Image source={{ uri: groupePublic.image_url }} style={s.convAvatar} />
            : <View style={[s.convAvatar, s.convAvatarGroupe]}><Ionicons name={conv.type === 'evenement_prive' ? 'calendar' : 'people'} size={20} color={colors.ivory} /></View>}
          {groupePublic ? <View style={s.groupBadge}><Ionicons name="globe-outline" size={10} color={colors.ivory} /></View> : null}
        </View>
      );
    }
    const others = conv.members.filter(m => m.user_id !== myUserId);
    const first = others[0];
    const letter = (convDisplayName(conv)[0] || '?').toUpperCase();
    return (
      <View style={s.convAvatarWrap}>
        {first?.avatar_url
          ? <Image source={{ uri: first.avatar_url }} style={s.convAvatar} />
          : <View style={[s.convAvatar, s.convAvatarFallback]}><Text style={s.convAvatarLetter}>{letter}</Text></View>}
        {conv.members.length > 2 && <View style={s.groupBadge}><Ionicons name="people" size={10} color={colors.ivory} /></View>}
      </View>
    );
  }

  function renderConvRow(conv: Conversation) {
    const lastMsg = conv.last_message;
    const sender = lastMsg ? conv.members.find(m => m.user_id === lastMsg.user_id) : null;
    const contenu = lastMsg ? (lastMsg.image_url ? '📷 Photo' : lastMsg.contenu) : '';
    const auteur = !lastMsg ? '' : lastMsg.user_id === myUserId ? 'Toi : ' : estMessageDirect(conv) ? '' : `${sender?.prenom || 'Membre'} : `;
    const preview = lastMsg ? auteur + contenu : estMessageDirect(conv) ? 'Dis bonjour 👋' : 'Aucun message pour l’instant';
    const nonLu = pastilles && !!conv.unread;
    return (
      <TouchableOpacity style={s.convRow} onPress={() => openConversation(conv)} activeOpacity={0.7}>
        {renderConvAvatar(conv)}
        <View style={s.convInfo}>
          <View style={s.convTopRow}>
            <Text style={[s.convName, nonLu && s.convNameUnread]} numberOfLines={1}>{convDisplayName(conv)}</Text>
            {lastMsg && <Text style={[s.convTime, nonLu && s.convTimeUnread]}>{fmtTime(lastMsg.created_at)}</Text>}
          </View>
          <Text style={[s.convPreview, nonLu && s.convPreviewUnread]} numberOfLines={1}>{preview}</Text>
        </View>
        {renderUnreadBadge(conv)}
      </TouchableOpacity>
    );
  }

  function renderUnreadBadge(conv: Conversation) {
    if (!pastilles || !conv.unread) return <Ionicons name="chevron-forward" size={16} color={colors.border} />;
    return (
      <View style={s.unreadBadge}>
        <Text style={s.unreadBadgeText}>{conv.unread > 9 ? '9+' : conv.unread}</Text>
      </View>
    );
  }

  // Pour la liste inversee (cf. plus bas) : ordre du plus recent au plus ancien.
  // Memoise pour ne pas recalculer a chaque frappe dans le champ de saisie.
  const reversedMessages = useMemo(() => [...messages].reverse(), [messages]);
  const messagesParId = useMemo(() => new Map(messages.map(m => [m.id, m])), [messages]);

  function nomPour(userId: string, prenom: string) {
    return userId === myUserId ? 'toi' : prenom;
  }

  function repondreA(m: Message) {
    setReplyTo(m);
    inputRef.current?.focus();
  }

  function allerAuMessage(id: string) {
    const index = reversedMessages.findIndex(x => x.id === id);
    if (index < 0) return;
    flatListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
    setSurbrillanceId(id);
    setTimeout(() => setSurbrillanceId(cur => (cur === id ? null : cur)), 1600);
  }

  // "Vu" sous mon dernier message (s'il est le plus recent de la conversation)
  function renderVu(m: Message) {
    if (!selectedConv || m.id.startsWith('tmp-')) return null;
    const envoyeA = Date.parse(m.created_at);
    const autres = selectedConv.members.filter(x => x.user_id !== myUserId);
    const ontVu = autres.filter(x => (lectures[x.user_id] || 0) >= envoyeA);
    let texte: string;
    if (estMessageDirect(selectedConv)) texte = ontVu.length ? 'Vu' : 'Envoyé';
    else if (!ontVu.length) return null;
    else if (ontVu.length === autres.length && autres.length > 1) texte = 'Vu par tout le monde';
    else texte = ontVu.length === 1 ? `Vu par ${ontVu[0].prenom}` : `Vu par ${ontVu.length}`;
    return <Text style={s.vuText}>{texte}</Text>;
  }

  function renderEcrivent() {
    if (!selectedConv) return null;
    const ids = Object.keys(ecrivent);
    if (!ids.length) return null;
    const noms = ids.map(id => selectedConv.members.find(x => x.user_id === id)?.prenom || 'Quelqu’un');
    const texte = noms.length === 1 ? `${noms[0]} est en train d’écrire…`
      : noms.length === 2 ? `${noms[0]} et ${noms[1]} écrivent…`
      : 'Plusieurs personnes écrivent…';
    return <Text style={s.ecritText} numberOfLines={1}>{texte}</Text>;
  }

  function renderCitation(m: Message, isMe: boolean) {
    if (!m.reply_to_id) return null;
    const charge = messagesParId.get(m.reply_to_id);
    const extra = citesExtra[m.reply_to_id];
    const cite = charge
      ? { user_id: charge.user_id, prenom: charge.prenom, contenu: charge.contenu, image_url: charge.image_url, supprime: false }
      : extra;
    const apercu = !cite ? 'Message précédent'
      : cite.supprime ? 'Message supprimé'
      : cite.image_url ? '📷 Photo' : cite.contenu;
    return (
      <TouchableOpacity
        activeOpacity={charge ? 0.6 : 1}
        onPress={charge ? () => allerAuMessage(charge.id) : undefined}
        style={[s.quote, isMe && s.quoteMe]}
      >
        <Text style={s.quoteTitle} numberOfLines={1}>
          <Ionicons name="arrow-undo" size={11} color={colors.textMuted} />{' '}
          {isMe ? 'Tu as répondu' : `${m.prenom} a répondu`}{cite ? ` à ${nomPour(cite.user_id, cite.prenom)}` : ''}
        </Text>
        <Text style={s.quoteText} numberOfLines={2}>{apercu}</Text>
      </TouchableOpacity>
    );
  }

  // Fenetre de choix des membres : nouvelle discussion (message direct / groupe prive)
  // ou ajout de membres a un groupe existant (ajoutConv)
  function renderModalMembres() {
    const fermer = () => { setCreateModal(false); setAjoutConv(null); };
    const dejaMembres = new Set(ajoutConv?.members.map(m => m.user_id) || []);
    const q = memberSearch.trim().toLowerCase();
    const suivisFiltres = q ? contacts.filter(f => f.prenom.toLowerCase().includes(q)) : contacts;
    const vus = new Set<string>();
    const liste = [...suivisFiltres, ...(q.length >= 2 ? resultatsRecherche : [])]
      .filter(c => { if (vus.has(c.id) || dejaMembres.has(c.id)) return false; vus.add(c.id); return true; });
    const modeDirect = !ajoutConv && convMode === 'direct';
    const titre = ajoutConv ? 'Ajouter des membres' : 'Nouvelle discussion';
    const boutonTexte = ajoutConv
      ? (selectedMembers.length > 1 ? `Ajouter ${selectedMembers.length} membres` : 'Ajouter au groupe')
      : modeDirect ? 'Écrire un message' : 'Créer le groupe privé';
    return (
      <Modal visible={createModal} animationType="slide" transparent onRequestClose={fermer}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <View style={s.createOverlay}>
            <View style={s.createSheet}>
              <View style={s.createHeader}>
                <Text style={s.createTitle}>{titre}</Text>
                <TouchableOpacity onPress={fermer}><Ionicons name="close" size={22} color={colors.textMuted} /></TouchableOpacity>
              </View>
              {!ajoutConv && (
                <View style={s.modeToggle}>
                  <TouchableOpacity style={[s.modeBtn, convMode === 'direct' && s.modeBtnActive]} onPress={() => { setConvMode('direct'); setSelectedMembers([]); }}>
                    <Ionicons name="person" size={14} color={convMode === 'direct' ? colors.ivory : colors.textMuted} />
                    <Text style={[s.modeBtnText, convMode === 'direct' && s.modeBtnTextActive]}>Message direct</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.modeBtn, convMode === 'groupe' && s.modeBtnActive]} onPress={() => { setConvMode('groupe'); setSelectedMembers([]); }}>
                    <Ionicons name="people" size={14} color={convMode === 'groupe' ? colors.ivory : colors.textMuted} />
                    <Text style={[s.modeBtnText, convMode === 'groupe' && s.modeBtnTextActive]}>Groupe privé</Text>
                  </TouchableOpacity>
                </View>
              )}
              {!ajoutConv && convMode === 'groupe' && (
                <TextInput style={s.groupNameInput} value={groupName} onChangeText={setGroupName} placeholder="Nom du groupe" placeholderTextColor={colors.textMuted} />
              )}
              <View style={s.memberSearchWrap}>
                <Ionicons name="search" size={16} color={colors.textMuted} />
                <TextInput
                  style={s.memberSearchInput}
                  value={memberSearch}
                  onChangeText={setMemberSearch}
                  placeholder="Rechercher un membre (prénom, pseudo)…"
                  placeholderTextColor={colors.textMuted}
                  autoCorrect={false}
                />
                {rechercheEnCours ? <ActivityIndicator size="small" color={colors.terra} /> : memberSearch.length > 0 && (
                  <TouchableOpacity onPress={() => setMemberSearch('')}>
                    <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                  </TouchableOpacity>
                )}
              </View>
              <Text style={s.membersLabel}>{q.length >= 2 ? 'Résultats' : contacts.length ? 'Les membres que tu suis' : ''}</Text>
              {liste.length === 0 ? (
                <View style={s.noFollowsWrap}>
                  <Ionicons name="search-outline" size={28} color={colors.border} />
                  <Text style={s.noFollowsText}>
                    {q.length >= 2 ? (rechercheEnCours ? 'Recherche…' : 'Aucun membre trouvé.') : 'Tape le prénom d’un membre pour le trouver.'}
                  </Text>
                </View>
              ) : (
                <FlatList
                  data={liste} keyExtractor={f => f.id} style={{ maxHeight: 280 }}
                  keyboardShouldPersistTaps="handled"
                  renderItem={({ item: f }) => {
                    const selected = selectedMembers.includes(f.id);
                    const disabledDM = modeDirect && selectedMembers.length === 1 && !selected;
                    return (
                      <TouchableOpacity style={[s.memberRow, selected && s.memberRowSelected, disabledDM && s.memberRowDisabled]} activeOpacity={disabledDM ? 1 : 0.7} onPress={() => { if (disabledDM) return; setSelectedMembers(modeDirect ? (selected ? [] : [f.id]) : (selected ? selectedMembers.filter(id => id !== f.id) : [...selectedMembers, f.id])); }}>
                        {f.avatar_url ? <Image source={{ uri: f.avatar_url }} style={s.memberAvatar} /> : <View style={[s.memberAvatar, s.memberAvatarFallback]}><Text style={s.memberAvatarLetter}>{(f.prenom[0] || '?').toUpperCase()}</Text></View>}
                        <View style={{ flex: 1 }}>
                          <Text style={[s.memberName, selected && s.memberNameSelected]}>{f.prenom}</Text>
                          {f.ville ? <Text style={s.memberVille}>{f.ville}</Text> : null}
                        </View>
                        {selected && <Ionicons name="checkmark-circle" size={20} color={colors.terra} />}
                      </TouchableOpacity>
                    );
                  }}
                />
              )}
              <TouchableOpacity style={[s.createBtn, (!selectedMembers.length || creating) && s.createBtnDisabled]} onPress={ajoutConv ? ajouterMembres : createConversation} disabled={!selectedMembers.length || creating}>
                {creating ? <ActivityIndicator color={colors.ivory} /> : <Text style={s.createBtnText}>{boutonTexte}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    );
  }

  if (sessionLoading) return <ActivityIndicator style={{ flex: 1 }} color={colors.terra} />;
  if (!session) return <AuthGate navigation={navigation} message="Connecte-toi pour accéder à la messagerie et organiser des balades avec la meute." />;

  // ── Chat view ──
  if (selectedConv) {
    const isCreator = selectedConv.created_by === myUserId;
    return (
      <ErrorBoundary label="chat_view" onClose={closeConversation}>
      <View ref={chatZoneRef} style={s.container} onLayout={() => recalcKbPad()}>
      <View style={{ flex: 1, paddingBottom: kbPad }}>
        {msgLoading ? <ActivityIndicator style={{ flex: 1 }} color={colors.terra} /> : (
          <FlatList
            ref={flatListRef}
            // Liste inversee (comme WhatsApp/Instagram) : index 0 = message le plus recent,
            // affiche tout en bas. Plus besoin de scrollToEnd/onLayout/onContentSizeChange —
            // ces approches se sont averees peu fiables (elles ne scrollaient qu'apres le
            // premier rendu, ou seulement jusqu'a la fin des ~10 premiers items rendus par
            // defaut par FlatList). Une liste inversee demarre "en bas" par construction.
            inverted
            data={reversedMessages}
            keyExtractor={m => m.id}
            contentContainerStyle={[s.messagesList, messages.length === 0 && { flex: 1 }]}
            keyboardShouldPersistTaps="handled"
            // Message cite pas encore rendu : on s'en approche puis on reessaie
            onScrollToIndexFailed={info => {
              flatListRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true });
              setTimeout(() => {
                if (info.index < reversedMessages.length) flatListRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.5 });
              }, 350);
            }}
            // scaleY(-1) contre-inverse : sur une liste inverted, le ListEmptyComponent
            // s'affiche autrement a l'envers (aucune donnee pour compenser le flip de liste).
            ListEmptyComponent={<View style={[s.emptyChat, { transform: [{ scaleY: -1 }] }]}><Ionicons name="chatbubbles-outline" size={44} color={colors.border} /><Text style={s.emptyChatText}>Commencez la conversation !</Text></View>}
            renderItem={({ item: m, index }) => {
              const isMe = m.user_id === myUserId;
              // Dans le tableau inverse, l'element suivant (index+1) est chronologiquement
              // ANTERIEUR, et l'element precedent (index-1) est chronologiquement POSTERIEUR.
              const showSender = !isMe && m.user_id !== reversedMessages[index + 1]?.user_id;
              const showTime = !reversedMessages[index - 1] || new Date(reversedMessages[index - 1].created_at).getTime() - new Date(m.created_at).getTime() > 300000;
              return (
                <SwipeRepondre actif={replyDispo && !m.id.startsWith('tmp-')} onRepondre={() => repondreA(m)}>
                <View style={[s.msgRow, isMe && s.msgRowMe, surbrillanceId === m.id && s.msgRowHighlight]}>
                  {!isMe && (
                    <View style={s.msgAvatarWrap}>
                      {m.avatar_url ? <Image source={{ uri: m.avatar_url }} style={s.msgAvatar} /> : <View style={[s.msgAvatar, s.msgAvatarFallback]}><Text style={s.msgAvatarLetter}>{(m.prenom[0] || '?').toUpperCase()}</Text></View>}
                    </View>
                  )}
                  <View style={[s.msgBubbleWrap, isMe && s.msgBubbleWrapMe]}>
                    {showSender && <Text style={s.msgSender}>{m.prenom}</Text>}
                    {renderCitation(m, isMe)}
                    <TouchableOpacity activeOpacity={0.85} delayLongPress={300} onLongPress={() => { if (!m.id.startsWith('tmp-')) { Keyboard.dismiss(); setMenuMessage(m); } }}>
                      {m.image_url ? (
                        <Image source={{ uri: m.image_url }} style={s.msgImage} resizeMode="cover" />
                      ) : (
                        <View style={[s.msgBubble, isMe ? s.msgBubbleMe : s.msgBubbleThem]}>
                          <TexteAvecLiens texte={m.contenu} style={[s.msgText, isMe && s.msgTextMe]} lienStyle={[s.msgLink, isMe && s.msgLinkMe]} />
                        </View>
                      )}
                    </TouchableOpacity>
                    <View style={[s.msgFooterRow, isMe && s.msgFooterRowMe]}>
                      {showTime && <Text style={[s.msgTime, isMe && s.msgTimeMe]}>{fmtTime(m.created_at)}</Text>}
                      {Object.keys(m.reactions).length ? (
                        (Object.entries(m.reactions) as [string, number][]).sort((x, y) => y[1] - x[1]).map(([emoji, n]) => (
                          <TouchableOpacity key={emoji} style={[s.reactionChip, m.maReaction === emoji && s.reactionChipMine]} onPress={() => reagir(m, emoji)} hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}>
                            <Text style={s.reactionEmoji}>{emoji}</Text>
                            {n > 1 ? <Text style={s.likeCount}>{n}</Text> : null}
                          </TouchableOpacity>
                        ))
                      ) : (
                        <TouchableOpacity style={s.likeBtn} onPress={() => reagir(m, '❤️')} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }} accessibilityLabel="Aimer">
                          <Ionicons name="heart-outline" size={14} color={colors.textMuted} />
                        </TouchableOpacity>
                      )}
                    </View>
                    {index === 0 && isMe ? renderVu(m) : null}
                  </View>
                </View>
                </SwipeRepondre>
              );
            }}
          />
        )}
        {renderEcrivent()}
        {replyTo ? (
          <View style={s.replyBar}>
            <View style={s.replyBarAccent} />
            <View style={{ flex: 1 }}>
              <Text style={s.replyBarTitle} numberOfLines={1}>Réponse à {nomPour(replyTo.user_id, replyTo.prenom)}</Text>
              <Text style={s.replyBarText} numberOfLines={1}>{replyTo.image_url ? '📷 Photo' : replyTo.contenu}</Text>
            </View>
            <TouchableOpacity onPress={() => setReplyTo(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        ) : null}
        <View style={[s.inputBar, { paddingBottom: kbVisible ? 10 : Math.max(insets.bottom, 10) }]}>
          <TouchableOpacity style={s.photoBtn} onPress={pickAndSendPhoto} disabled={sendingPhoto}>
            {sendingPhoto ? <ActivityIndicator size="small" color={colors.terra} /> : <Ionicons name="image-outline" size={22} color={colors.terra} />}
          </TouchableOpacity>
          <TextInput ref={inputRef} style={s.input} value={inputText} onChangeText={onSaisie} placeholder="Message…" placeholderTextColor={colors.textMuted} multiline maxLength={1000} returnKeyType="send" blurOnSubmit={false} onSubmitEditing={sendMessage} />
          <TouchableOpacity style={[s.sendBtn, (!inputText.trim() || sending) && s.sendBtnDisabled]} onPress={sendMessage} disabled={!inputText.trim() || sending}>
            {sending ? <ActivityIndicator size="small" color={colors.ivory} /> : <Ionicons name="send" size={18} color={colors.ivory} />}
          </TouchableOpacity>
        </View>

        {/* Menu du groupe (façon Instagram) */}
        <Modal visible={groupMenuVisible} animationType="slide" transparent onRequestClose={() => setGroupMenuVisible(false)}>
          <TouchableOpacity style={s.groupMenuOverlay} activeOpacity={1} onPress={() => setGroupMenuVisible(false)}>
            <View style={s.groupMenuSheet}>
              <View style={s.groupMenuHandle} />
              <Text style={s.groupMenuTitle}>{convDisplayName(selectedConv)}</Text>
              <TouchableOpacity style={s.groupMenuRow} onPress={() => { setGroupMenuVisible(false); setMembersModalVisible(true); }}>
                <Ionicons name="people-outline" size={20} color={colors.bordeaux} />
                <Text style={s.groupMenuRowText}>Voir les membres ({selectedConv.members.length})</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </TouchableOpacity>
              {estGroupeAjoutable(selectedConv) && (
                <TouchableOpacity style={s.groupMenuRow} onPress={() => { setGroupMenuVisible(false); openCreateModal(selectedConv); }}>
                  <Ionicons name="person-add-outline" size={20} color={colors.bordeaux} />
                  <Text style={s.groupMenuRowText}>Ajouter des membres</Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              )}
              <TouchableOpacity style={s.groupMenuRow} onPress={() => { setGroupMenuVisible(false); toggleMute(); }}>
                <Ionicons name={myMuted ? 'notifications-outline' : 'notifications-off-outline'} size={20} color={colors.bordeaux} />
                <Text style={s.groupMenuRowText}>{myMuted ? 'Activer les notifications' : 'Mettre en sourdine'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.groupMenuRow}
                onPress={() => {
                  setGroupMenuVisible(false);
                  Alert.alert('Quitter ?', 'Tu ne recevras plus les messages.', [
                    { text: 'Annuler', style: 'cancel' },
                    { text: 'Quitter', style: 'destructive', onPress: leaveConversation },
                  ]);
                }}
              >
                <Ionicons name="exit-outline" size={20} color="#C62828" />
                <Text style={[s.groupMenuRowText, { color: '#C62828' }]}>Quitter la discussion</Text>
              </TouchableOpacity>
              {isCreator && (
                <TouchableOpacity
                  style={[s.groupMenuRow, { borderBottomWidth: 0 }]}
                  onPress={() => {
                    setGroupMenuVisible(false);
                    Alert.alert('Supprimer ?', 'Supprimée définitivement pour tous.', [
                      { text: 'Annuler', style: 'cancel' },
                      { text: 'Supprimer', style: 'destructive', onPress: deleteConversation },
                    ]);
                  }}
                >
                  <Ionicons name="trash-outline" size={20} color="#C62828" />
                  <Text style={[s.groupMenuRowText, { color: '#C62828' }]}>Supprimer pour tout le monde</Text>
                </TouchableOpacity>
              )}
            </View>
          </TouchableOpacity>
        </Modal>

        {/* Liste des membres */}
        <Modal visible={membersModalVisible} animationType="slide" transparent onRequestClose={() => setMembersModalVisible(false)}>
          <View style={s.groupMenuOverlay}>
            <View style={s.groupMenuSheet}>
              <View style={s.groupMenuHandle} />
              <View style={s.membersHeader}>
                <Text style={s.groupMenuTitle}>Membres</Text>
                <TouchableOpacity onPress={() => setMembersModalVisible(false)}><Ionicons name="close" size={22} color={colors.textMuted} /></TouchableOpacity>
              </View>
              <ScrollView style={{ maxHeight: 420 }}>
                {selectedConv.members.map(m => {
                  const isMe = m.user_id === myUserId;
                  const row = (
                    <View key={m.user_id} style={s.memberListRow}>
                      {m.avatar_url ? <Image source={{ uri: m.avatar_url }} style={s.memberAvatar} /> : <View style={[s.memberAvatar, s.memberAvatarFallback]}><Text style={s.memberAvatarLetter}>{(m.prenom[0] || '?').toUpperCase()}</Text></View>}
                      <Text style={s.memberName}>{isMe ? 'Moi' : m.prenom}</Text>
                      {m.user_id === selectedConv.created_by && <Text style={s.memberOwnerTag}>Créateur</Text>}
                      {!isMe && <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />}
                    </View>
                  );
                  if (isMe) return row;
                  return (
                    <TouchableOpacity
                      key={m.user_id}
                      onPress={() => {
                        setMembersModalVisible(false);
                        navigation.navigate('ProfilPublic', { userId: m.user_id, prenom: m.prenom, avatarUrl: m.avatar_url });
                      }}
                    >
                      {row}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        </Modal>
        {renderModalMembres()}

        {/* Appui long sur un message : reactions + repondre */}
        <Modal visible={!!menuMessage} animationType="fade" transparent onRequestClose={() => setMenuMessage(null)}>
          <TouchableOpacity style={s.reactOverlay} activeOpacity={1} onPress={() => setMenuMessage(null)}>
            {menuMessage ? (
              <View style={s.reactSheet}>
                <Text style={s.reactApercu} numberOfLines={3}>{menuMessage.image_url ? '📷 Photo' : menuMessage.contenu}</Text>
                <View style={s.reactBar}>
                  {(reactionsDispo ? REACTIONS : ['❤️']).map(e => (
                    <TouchableOpacity key={e} style={[s.reactBtn, menuMessage.maReaction === e && s.reactBtnMine]} onPress={() => { const m = menuMessage; setMenuMessage(null); reagir(m, e); }}>
                      <Text style={s.reactBtnEmoji}>{e}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {replyDispo ? (
                  <TouchableOpacity style={s.reactAction} onPress={() => { const m = menuMessage; setMenuMessage(null); repondreA(m); }}>
                    <Ionicons name="arrow-undo-outline" size={18} color={colors.bordeaux} />
                    <Text style={s.reactActionText}>Répondre</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}
          </TouchableOpacity>
        </Modal>
      </View>
      </View>
      </ErrorBoundary>
    );
  }

  // ── List view ──
  return (
    <View style={s.container}>

      {vue === 'discussions' ? (
        <>
          {loading ? <ActivityIndicator style={{ flex: 1 }} color={colors.terra} /> : (
            <FlatList
              data={conversations}
              keyExtractor={c => c.id}
              contentContainerStyle={[s.list, conversations.length === 0 && { flexGrow: 1 }]}
              onRefresh={() => { loadConversations(); loadGroupes(); }}
              refreshing={loading}
              ListHeaderComponent={
                <TouchableOpacity style={s.discoverCard} activeOpacity={0.8} onPress={() => { setVue('decouvrir'); if (!groupes.length) loadGroupes(); }}>
                  <View style={s.discoverIcon}><Ionicons name="compass-outline" size={20} color={colors.ivory} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.discoverTitle}>Découvrir des groupes</Text>
                    <Text style={s.discoverSub}>Balades, éducation, rencontres{groupes.length ? ` · ${groupes.length} groupe${groupes.length > 1 ? 's' : ''}` : ''}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              }
              ListEmptyComponent={
                <View style={s.empty}>
                  <Ionicons name="chatbubbles-outline" size={44} color={colors.border} />
                  <Text style={s.emptyTitle}>Aucune discussion</Text>
                  <Text style={s.emptyText}>Écris à un membre avec le bouton +, ou rejoins un groupe près de chez toi.</Text>
                </View>
              }
              renderItem={({ item: conv }) => renderConvRow(conv)}
            />
          )}
          <TouchableOpacity style={s.fab} onPress={() => openCreateModal()} activeOpacity={0.85} accessibilityLabel="Nouvelle discussion">
            <Ionicons name="create-outline" size={24} color={colors.ivory} />
          </TouchableOpacity>
        </>
      ) : (
        <>
          <View style={s.decouvrirHeader}>
            <TouchableOpacity onPress={() => setVue('discussions')} style={s.decouvrirBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="chevron-back" size={22} color={colors.bordeaux} />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={s.decouvrirTitle}>Découvrir des groupes</Text>
              <Text style={s.discoverSub}>Rejoins un groupe pour discuter avec la meute</Text>
            </View>
          </View>
          {groupesLoading ? <ActivityIndicator style={{ flex: 1, marginTop: 40 }} color={colors.terra} /> : (
            <FlatList
              data={filteredGroupes}
              keyExtractor={g => g.id}
              contentContainerStyle={[s.groupesList, filteredGroupes.length === 0 && { flexGrow: 1 }]}
              onRefresh={loadGroupes}
              refreshing={groupesLoading}
              ListEmptyComponent={
                <View style={s.empty}>
                  <Ionicons name="people-outline" size={44} color={colors.border} />
                  <Text style={s.emptyTitle}>Pas encore de groupe</Text>
                  <Text style={s.emptyText}>Crée le premier groupe pour ta ville !</Text>
                </View>
              }
              renderItem={({ item: groupe }) => (
                <GroupeCard
                  groupe={groupe}
                  joined={myConvIds.has(groupe.conversation_id)}
                  isOwner={groupe.created_by === myUserId}
                  onJoin={() => joinGroupe(groupe)}
                  onOpen={() => openGroupeChat(groupe)}
                  onWhatsApp={() => shareWhatsApp(groupe)}
                  onStory={() => shareStory(groupe)}
                  onEdit={() => openEditGroupe(groupe)}
                />
              )}
            />
          )}
          <TouchableOpacity style={s.fab} onPress={() => setCreateGroupeModal(true)} activeOpacity={0.85} accessibilityLabel="Créer un groupe">
            <Ionicons name="add" size={26} color={colors.ivory} />
          </TouchableOpacity>
        </>
      )}

      {renderModalMembres()}

      {/* ── Story card (off-screen, pour capture) ── */}
      {storyGroupe && (
        <View ref={storyCardRef} collapsable={false} style={sc.card}>
          {storyGroupe.image_url
            ? <Image source={{ uri: storyGroupe.image_url }} style={sc.bgImage} resizeMode="cover" />
            : <View style={sc.bgFallback} />}
          <View style={sc.overlay} />
          <View style={sc.topBrand}>
            <Ionicons name="paw" size={22} color={colors.terra} />
            <Text style={sc.brandName}>The Pack La Meute</Text>
          </View>
          <View style={sc.content}>
            {storyGroupe.ville ? (
              <View style={sc.villePill}>
                <Ionicons name="location" size={12} color={colors.terra} />
                <Text style={sc.villeText}>{storyGroupe.ville}</Text>
              </View>
            ) : null}
            <Text style={sc.nom}>{storyGroupe.nom}</Text>
            {storyGroupe.description ? <Text style={sc.desc}>{storyGroupe.description}</Text> : null}
            <View style={sc.cta}>
              <Text style={sc.ctaText}>Rejoins le groupe sur</Text>
              <Text style={sc.ctaUrl}>thepacklameute.fr</Text>
            </View>
          </View>
          <View style={sc.bottomBar} />
        </View>
      )}

      {/* ── Modal créer groupe ── */}
      <Modal visible={createGroupeModal} animationType="slide" transparent onRequestClose={() => setCreateGroupeModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <View style={s.createOverlay}>
            <View style={s.createSheet}>
              <View style={s.createHeader}>
                <Text style={s.createTitle}>Créer un groupe</Text>
                <TouchableOpacity onPress={() => setCreateGroupeModal(false)}><Ionicons name="close" size={22} color={colors.textMuted} /></TouchableOpacity>
              </View>
              <TouchableOpacity style={s.photoPicker} onPress={() => pickGroupePhoto('create')}>
                {groupeForm.photoUri ? (
                  <Image source={{ uri: groupeForm.photoUri }} style={s.photoPickerImage} resizeMode="cover" />
                ) : (
                  <>
                    <Ionicons name="image-outline" size={20} color={colors.textMuted} />
                    <Text style={s.photoPickerText}>Ajouter une photo</Text>
                  </>
                )}
              </TouchableOpacity>
              <TextInput style={s.groupNameInput} value={groupeForm.nom} onChangeText={t => setGroupeForm(f => ({ ...f, nom: t }))} placeholder="Nom du groupe (ex: Balade Paris 15e)" placeholderTextColor={colors.textMuted} />
              <View style={s.modeToggle}>
                {GROUPE_TYPES.map(t => (
                  <TouchableOpacity key={t} style={[s.modeBtn, groupeForm.type === t && s.modeBtnActive]} onPress={() => setGroupeForm(f => ({ ...f, type: t }))}>
                    <Text style={[s.modeBtnText, groupeForm.type === t && s.modeBtnTextActive]}>{GROUPE_TYPE_LABELS[t]}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput style={[s.groupNameInput, { minHeight: 80, textAlignVertical: 'top' }]} value={groupeForm.description} onChangeText={t => setGroupeForm(f => ({ ...f, description: t }))} placeholder="Description (optionnel)" placeholderTextColor={colors.textMuted} multiline />
              <TextInput style={s.groupNameInput} value={groupeForm.ville} onChangeText={t => setGroupeForm(f => ({ ...f, ville: t }))} placeholder="Ville (ex: Paris, Lyon…)" placeholderTextColor={colors.textMuted} />
              <TouchableOpacity style={[s.createBtn, (!groupeForm.nom.trim() || creatingGroupe) && s.createBtnDisabled]} onPress={createGroupe} disabled={!groupeForm.nom.trim() || creatingGroupe}>
                {creatingGroupe ? <ActivityIndicator color={colors.ivory} /> : <Text style={s.createBtnText}>Créer le groupe</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Modal modifier groupe ── */}
      <Modal visible={editGroupeModal} animationType="slide" transparent onRequestClose={() => setEditGroupeModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <View style={s.createOverlay}>
            <View style={s.createSheet}>
              <View style={s.createHeader}>
                <Text style={s.createTitle}>Modifier le groupe</Text>
                <TouchableOpacity onPress={() => setEditGroupeModal(false)}><Ionicons name="close" size={22} color={colors.textMuted} /></TouchableOpacity>
              </View>
              <TouchableOpacity style={s.photoPicker} onPress={() => pickGroupePhoto('edit')}>
                {(editForm.photoUri || editForm.existingImageUrl) ? (
                  <Image source={{ uri: editForm.photoUri || editForm.existingImageUrl! }} style={s.photoPickerImage} resizeMode="cover" />
                ) : (
                  <>
                    <Ionicons name="image-outline" size={20} color={colors.textMuted} />
                    <Text style={s.photoPickerText}>Ajouter une photo</Text>
                  </>
                )}
              </TouchableOpacity>
              <TextInput style={s.groupNameInput} value={editForm.nom} onChangeText={t => setEditForm(f => ({ ...f, nom: t }))} placeholder="Nom du groupe" placeholderTextColor={colors.textMuted} />
              <View style={s.modeToggle}>
                {GROUPE_TYPES.map(t => (
                  <TouchableOpacity key={t} style={[s.modeBtn, editForm.type === t && s.modeBtnActive]} onPress={() => setEditForm(f => ({ ...f, type: t }))}>
                    <Text style={[s.modeBtnText, editForm.type === t && s.modeBtnTextActive]}>{GROUPE_TYPE_LABELS[t]}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput style={s.groupNameInput} value={editForm.ville} onChangeText={t => setEditForm(f => ({ ...f, ville: t }))} placeholder="Ville (ex: Paris, Lyon…)" placeholderTextColor={colors.textMuted} />
              <TouchableOpacity style={[s.createBtn, (!editForm.nom.trim() || savingEditGroupe) && s.createBtnDisabled]} onPress={submitEditGroupe} disabled={!editForm.nom.trim() || savingEditGroupe}>
                {savingEditGroupe ? <ActivityIndicator color={colors.ivory} /> : <Text style={s.createBtnText}>Enregistrer</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ivoryPale },

  tabs: { flexDirection: 'row', gap: 10, padding: 14, paddingBottom: 10, backgroundColor: colors.ivoryPale },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 16, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.white },
  tabActive: { borderColor: colors.bordeaux, backgroundColor: colors.bordeaux },
  tabIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.ivoryPale, alignItems: 'center', justifyContent: 'center' },
  tabIconActive: { backgroundColor: 'rgba(245,239,224,0.15)' },
  tabTitle: { fontFamily: 'DMSans_500Medium', fontSize: 14, fontWeight: '600', color: colors.bordeaux },
  tabTitleActive: { color: colors.ivory },
  tabSub: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted, marginTop: 1 },
  tabSubActive: { color: 'rgba(245,239,224,0.65)' },

  list: { paddingBottom: 100 },
  groupesList: { padding: 14, paddingBottom: 100, gap: 14 },
  groupChatSectionTitle: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 48 },
  emptyTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: colors.bordeaux },
  emptyText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted, textAlign: 'center', lineHeight: 20 },

  villeScroll: { flexGrow: 0, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border },
  villeScrollContent: { paddingHorizontal: 14, paddingVertical: 12, gap: 10, flexDirection: 'row', alignItems: 'center' },
  villeChip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, height: 38, paddingHorizontal: 18, borderRadius: 19, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.white },
  villeChipActive: { backgroundColor: colors.bordeaux, borderColor: colors.bordeaux },
  villeChipText: { fontFamily: 'DMSans_500Medium', fontSize: 14, fontWeight: '600', color: colors.textMuted, lineHeight: 18 },
  villeChipTextActive: { color: colors.ivory },

  convRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.white },
  convAvatarWrap: { position: 'relative' },
  convAvatar: { width: 48, height: 48, borderRadius: 24 },
  convAvatarFallback: { backgroundColor: colors.bordeaux, alignItems: 'center', justifyContent: 'center' },
  convAvatarLetter: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 20, color: colors.ivory },
  groupBadge: { position: 'absolute', bottom: -2, right: -2, width: 18, height: 18, borderRadius: 9, backgroundColor: colors.terra, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.white },
  convInfo: { flex: 1 },
  convTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 },
  convName: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: colors.bordeaux, flex: 1, marginRight: 8 },
  convTime: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted },
  convPreview: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted },
  convAvatarGroupe: { backgroundColor: colors.bordeaux, alignItems: 'center', justifyContent: 'center' },
  discoverCard: { flexDirection: 'row', alignItems: 'center', gap: 12, margin: 14, marginBottom: 8, padding: 14, borderRadius: 16, backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.border },
  discoverIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.terra, alignItems: 'center', justifyContent: 'center' },
  discoverTitle: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: colors.bordeaux },
  discoverSub: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted, marginTop: 1 },
  decouvrirHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: colors.ivoryPale, borderBottomWidth: 1, borderBottomColor: colors.border },
  decouvrirBack: { padding: 2 },
  decouvrirTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: colors.bordeaux },
  convNameUnread: { fontFamily: 'DMSans_500Medium', fontWeight: '700' },
  convTimeUnread: { color: '#E5484D', fontFamily: 'DMSans_500Medium' },
  convPreviewUnread: { color: colors.bordeaux, fontFamily: 'DMSans_500Medium' },
  unreadBadge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, backgroundColor: '#E5484D', alignItems: 'center', justifyContent: 'center' },
  unreadBadgeText: { color: '#FFFFFF', fontFamily: 'DMSans_500Medium', fontSize: 11 },
  tabUnreadDot: { position: 'absolute', top: -2, right: -2, width: 10, height: 10, borderRadius: 5, backgroundColor: '#E5484D', borderWidth: 1.5, borderColor: colors.white },

  fab: { position: 'absolute', bottom: 28, right: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.bordeaux, alignItems: 'center', justifyContent: 'center', shadowColor: colors.bordeaux, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10, elevation: 8 },

  // paddingTop (pas paddingBottom) car la liste est inversee : le "haut" du contenu
  // non-inverse correspond visuellement au bas de l'ecran, pres de la barre de saisie.
  messagesList: { padding: 12, paddingTop: 16 },
  emptyChat: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 48 },
  emptyChatText: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.textMuted, textAlign: 'center' },
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginVertical: 2 },
  msgRowMe: { flexDirection: 'row-reverse' },
  msgAvatarWrap: { width: 28, flexShrink: 0 },
  msgAvatar: { width: 28, height: 28, borderRadius: 14 },
  msgAvatarFallback: { backgroundColor: colors.bordeaux, alignItems: 'center', justifyContent: 'center' },
  msgAvatarLetter: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.ivory },
  msgBubbleWrap: { maxWidth: '72%', gap: 2 },
  msgBubbleWrapMe: { alignItems: 'flex-end' },
  msgSender: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.terra, marginLeft: 12, marginBottom: 1 },
  msgBubble: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9 },
  msgBubbleMe: { backgroundColor: colors.bordeaux, borderBottomRightRadius: 4 },
  msgBubbleThem: { backgroundColor: colors.white, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: colors.border },
  msgText: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.textMid, lineHeight: 20 },
  msgTextMe: { color: colors.ivory },
  msgLink: { color: colors.terra, textDecorationLine: 'underline' },
  msgLinkMe: { color: colors.ivory },
  msgRowHighlight: { backgroundColor: 'rgba(229,72,77,0.10)', borderRadius: 12 },
  quote: { alignSelf: 'flex-start', maxWidth: '100%', marginBottom: 2, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderLeftWidth: 3, borderLeftColor: colors.terra, backgroundColor: 'rgba(0,0,0,0.05)' },
  quoteMe: { alignSelf: 'flex-end' },
  quoteTitle: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.textMuted, marginBottom: 1 },
  quoteText: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMid, lineHeight: 16 },
  swipeReplyAction: { width: 56, justifyContent: 'center', alignItems: 'center' },
  swipeReplyIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.ivoryPale, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  replyBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.border },
  replyBarAccent: { width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: colors.terra },
  replyBarTitle: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.bordeaux },
  replyBarText: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted },
  msgTime: { fontFamily: 'DMSans_400Regular', fontSize: 10, color: colors.textMuted, marginLeft: 12, marginTop: 2 },
  msgTimeMe: { marginLeft: 0, marginRight: 12 },
  msgImage: { width: 200, height: 200, borderRadius: 16 },
  msgFooterRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  msgFooterRowMe: { flexDirection: 'row-reverse' },
  likeBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 2 },
  likeCount: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted },
  reactionChip: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 10, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border },
  reactionChipMine: { borderColor: colors.terra, backgroundColor: colors.ivoryPale },
  reactionEmoji: { fontSize: 12 },
  vuText: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted, alignSelf: 'flex-end', marginTop: 1 },
  ecritText: { fontFamily: 'DMSans_400Regular', fontStyle: 'italic', fontSize: 12, color: colors.textMuted, paddingHorizontal: 16, paddingVertical: 4 },
  reactOverlay: { flex: 1, backgroundColor: 'rgba(30,10,10,0.35)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  reactSheet: { width: '100%', maxWidth: 360, backgroundColor: colors.white, borderRadius: 20, padding: 14, gap: 12 },
  reactApercu: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.textMid, paddingHorizontal: 4 },
  reactBar: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: colors.ivoryPale, borderRadius: 24, paddingHorizontal: 8, paddingVertical: 6 },
  reactBtn: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  reactBtnMine: { backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.terra },
  reactBtnEmoji: { fontSize: 24 },
  reactAction: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 4 },
  reactActionText: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: colors.bordeaux },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.border },
  photoBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  input: { flex: 1, minHeight: 40, maxHeight: 110, borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.bordeaux, backgroundColor: colors.ivoryPale },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.bordeaux, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  sendBtnDisabled: { backgroundColor: colors.border },

  createOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  createSheet: { backgroundColor: colors.ivoryPale, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 40, gap: 14 },
  createHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  createTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 20, color: colors.bordeaux },
  modeToggle: { flexDirection: 'row', backgroundColor: colors.white, borderRadius: 12, padding: 4, borderWidth: 1, borderColor: colors.border },
  modeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 8 },
  modeBtnActive: { backgroundColor: colors.bordeaux },
  modeBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.textMuted },
  modeBtnTextActive: { color: colors.ivory },
  groupNameInput: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.bordeaux, backgroundColor: colors.white },
  photoPicker: { height: 100, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, borderStyle: 'dashed', backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', gap: 6, overflow: 'hidden' },
  photoPickerImage: { width: '100%', height: '100%' },
  photoPickerText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted },
  membersLabel: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  memberSearchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.white, marginTop: 8, marginBottom: 4,
  },
  memberSearchInput: { flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.bordeaux, padding: 0 },
  noFollowsWrap: { alignItems: 'center', gap: 8, paddingVertical: 20 },
  noFollowsText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: colors.white, marginBottom: 6, borderWidth: 1, borderColor: colors.border },
  memberRowSelected: { borderColor: colors.terra, backgroundColor: colors.terra + '10' },
  memberRowDisabled: { opacity: 0.35 },
  memberAvatar: { width: 40, height: 40, borderRadius: 20 },
  memberAvatarFallback: { backgroundColor: colors.bordeaux, alignItems: 'center', justifyContent: 'center' },
  memberAvatarLetter: { fontFamily: 'DMSans_500Medium', fontSize: 16, color: colors.ivory },
  memberName: { flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.bordeaux },
  memberNameSelected: { fontFamily: 'DMSans_500Medium', color: colors.terra },
  memberVille: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted, marginTop: 1 },
  createBtn: { backgroundColor: colors.bordeaux, borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 4 },
  createBtnDisabled: { opacity: 0.45 },
  createBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: colors.ivory },

  groupMenuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  groupMenuSheet: { backgroundColor: colors.ivoryPale, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 36 },
  groupMenuHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 14 },
  groupMenuTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: colors.bordeaux, marginBottom: 8 },
  groupMenuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  groupMenuRowText: { flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.bordeaux },
  membersHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  memberListRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  memberOwnerTag: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.terra, backgroundColor: colors.terra + '15', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
});

// ── Groupe card styles ───────────────────────────────────────────────────────

const g = StyleSheet.create({
  card: { backgroundColor: colors.white, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 2 },
  cardCover: { width: '100%', height: 160, position: 'relative' },
  cardCoverGrad: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(61,26,26,0.35)' },
  villeBadge: { position: 'absolute', bottom: 12, left: 12, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  villeBadgeText: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.ivory },
  cardBody: { padding: 14, gap: 6 },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.bordeaux, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  typePill: { alignSelf: 'flex-start', backgroundColor: colors.bordeaux + '10', borderRadius: 20, paddingHorizontal: 9, paddingVertical: 2, marginBottom: 3 },
  typePillText: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.bordeaux },
  editBtn: { padding: 4, alignSelf: 'flex-start' },
  cardNom: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 17, color: colors.bordeaux },
  villeInline: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  villeInlineText: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, flexWrap: 'wrap', gap: 8 },
  memberCount: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  memberCountText: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  shareBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: colors.bordeaux },
  shareBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.ivory },
  joinBtn: { backgroundColor: colors.bordeaux, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  joinBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.ivory },
  joinedBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: colors.terra, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7 },
  joinedBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.terra },
});

// ── Story card styles (9:16, off-screen capture) ─────────────────────────────

const sc = StyleSheet.create({
  card: { position: 'absolute', left: -1000, top: 0, width: 360, height: 640, backgroundColor: colors.bordeaux, overflow: 'hidden' },
  bgImage: { ...StyleSheet.absoluteFillObject as any, width: '100%', height: '100%' },
  bgFallback: { ...StyleSheet.absoluteFillObject as any, backgroundColor: colors.bordeaux },
  overlay: { ...StyleSheet.absoluteFillObject as any, backgroundColor: 'rgba(30,10,10,0.65)' },
  topBrand: { position: 'absolute', top: 44, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  brandName: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: colors.ivory, letterSpacing: 1 },
  content: { position: 'absolute', bottom: 80, left: 36, right: 36, gap: 14 },
  villePill: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  villeText: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.ivory },
  nom: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 36, color: colors.ivory, lineHeight: 44 },
  desc: { fontFamily: 'DMSans_400Regular', fontSize: 15, color: 'rgba(245,239,224,0.8)', lineHeight: 22 },
  cta: { marginTop: 8, gap: 2 },
  ctaText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: 'rgba(245,239,224,0.6)' },
  ctaUrl: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: colors.terra },
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 4, backgroundColor: colors.terra },
});
