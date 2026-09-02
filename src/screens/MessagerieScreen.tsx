import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  View, Text, FlatList, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, Keyboard,
  Modal, Image, Alert, Share, Linking,
} from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import { useSession } from '../hooks/useSession';
import AuthGate from '../components/AuthGate';
import ErrorBoundary from '../components/ErrorBoundary';
import { sendPushNotification } from '../lib/notifications';

// ── Types ───────────────────────────────────────────────────────────────────

type ConvMember = { user_id: string; prenom: string; avatar_url: string | null };
type Conversation = {
  id: string; nom: string | null; created_by: string;
  members: ConvMember[];
  last_message: { contenu: string; image_url: string | null; created_at: string; user_id: string } | null;
};
type Message = {
  id: string; user_id: string; contenu: string; image_url: string | null; created_at: string;
  prenom: string; avatar_url: string | null;
  likeCount: number; likedByMe: boolean;
};
type Contact = { id: string; prenom: string; avatar_url: string | null; ville: string | null };
type GroupeType = 'balade' | 'education' | 'rencontre';
type Groupe = {
  id: string; nom: string; description: string | null; ville: string | null;
  image_url: string | null; created_by: string; conversation_id: string;
  type: GroupeType; membre_count?: number;
};

const GROUPE_TYPE_LABELS: Record<GroupeType, string> = { balade: 'Balade', education: 'Éducation', rencontre: 'Rencontre' };
const GROUPE_TYPES: GroupeType[] = ['balade', 'education', 'rencontre'];

function fmtTime(dateStr: string) {
  const d = new Date(dateStr);
  const diff = Date.now() - d.getTime();
  if (diff < 86400000) return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (diff < 604800000) return d.toLocaleDateString('fr-FR', { weekday: 'short' });
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
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
  pendingConversationId, onConsumedPendingConversation,
}: { pendingConversationId?: string | null; onConsumedPendingConversation?: () => void } = {}) {
  const navigation = useNavigation<any>();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const { session, loading: sessionLoading } = useSession();
  const myUserId = session?.user?.id ?? null;
  const [kbVisible, setKbVisible] = useState(false);

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvt, () => setKbVisible(true));
    const hideSub = Keyboard.addListener(hideEvt, () => setKbVisible(false));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  const [activeTab, setActiveTab] = useState<'messages' | 'groupes'>('groupes');

  // ── Messages state ──
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [msgLoading, setMsgLoading] = useState(false);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [createModal, setCreateModal] = useState(false);
  const [convMode, setConvMode] = useState<'direct' | 'groupe'>('direct');
  const [groupName, setGroupName] = useState('');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [sendingPhoto, setSendingPhoto] = useState(false);
  const [groupMenuVisible, setGroupMenuVisible] = useState(false);
  const [membersModalVisible, setMembersModalVisible] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const channelRef = useRef<any>(null);

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
  // Les conversations de groupe (nom renseigne = cree via "Groupe prive") vont dans l'onglet Groupes, pas Messages
  const directConversations = conversations.filter(c => !c.nom);
  const groupChatConversations = conversations.filter(c => !!c.nom);

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
      if (m) { setActiveTab('groupes'); setPendingGroupeId(m[1]); }
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
    if (selectedConv) {
      navigation.setOptions({
        title: convDisplayName(selectedConv),
        headerLeft: () => (
          <TouchableOpacity onPress={closeConversation} style={{ marginLeft: 4, padding: 4 }}>
            <Ionicons name="chevron-back" size={26} color={colors.ivory} />
          </TouchableOpacity>
        ),
        headerRight: () => (
          <TouchableOpacity onPress={() => setGroupMenuVisible(true)} style={{ marginRight: 12, padding: 4 }}>
            <Ionicons name="ellipsis-vertical" size={22} color={colors.ivory} />
          </TouchableOpacity>
        ),
      });
    } else {
      navigation.setOptions({ title: 'La Meute', headerLeft: undefined, headerRight: undefined });
    }
  }, [selectedConv, myMuted]);

  // ── Conversations ──
  async function loadConversations() {
    if (!myUserId) return;
    setLoading(true);
    const { data: memberRows } = await supabase
      .from('conversation_members').select('conversation_id').eq('user_id', myUserId);
    if (!memberRows?.length) { setConversations([]); setLoading(false); return; }
    const convIds = memberRows.map((r: any) => r.conversation_id);
    const [{ data: convData }, { data: allMembers }] = await Promise.all([
      supabase.from('conversations').select('id,nom,created_by').in('id', convIds).eq('actif', true),
      supabase.from('conversation_members').select('conversation_id,user_id').in('conversation_id', convIds),
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
    const { data: recentMsgs } = await supabase.from('messages')
      .select('conversation_id,contenu,image_url,created_at,user_id')
      .in('conversation_id', convIds).eq('actif', true)
      .order('created_at', { ascending: false }).limit(500);
    const lastMessages: Record<string, any> = {};
    (recentMsgs || []).forEach((m: any) => { if (!lastMessages[m.conversation_id]) lastMessages[m.conversation_id] = m; });
    const list: Conversation[] = (convData || []).map((c: any) => ({
      id: c.id, nom: c.nom, created_by: c.created_by,
      members: membersByConv[c.id] || [],
      last_message: lastMessages[c.id] || null,
    })).sort((a, b) => {
      // Pas de localeCompare (cf. villeRegion.ts / normalizeText) : comparaison
      // simple, suffisante pour des dates ISO 8601.
      const ad = a.last_message?.created_at || '0', bd = b.last_message?.created_at || '0';
      return ad < bd ? 1 : ad > bd ? -1 : 0;
    });
    setConversations(list);
    setLoading(false);
  }

  async function openConversation(conv: Conversation) {
    setSelectedConv(conv);
    setMsgLoading(true);
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
    channelRef.current = supabase.channel(`conv:${conv.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conv.id}` },
        async (payload) => {
          const m = payload.new as any;
          const { data: p } = await supabase.from('profils').select('prenom,avatar_url').eq('id', m.user_id).single();
          const newMsg: Message = { ...m, prenom: p?.prenom || 'Membre', avatar_url: p?.avatar_url || null, likeCount: 0, likedByMe: false };
          setMessages(prev => prev.some(x => x.id === newMsg.id) ? prev : [...prev, newMsg]);
        })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_likes' },
        (payload) => {
          const l = payload.new as any;
          setMessages(prev => prev.map(m => m.id === l.message_id
            ? { ...m, likeCount: m.likeCount + (l.user_id === myUserId ? 0 : 1) }
            : m));
        })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'message_likes' },
        (payload) => {
          const l = payload.old as any;
          setMessages(prev => prev.map(m => m.id === l.message_id
            ? { ...m, likeCount: Math.max(0, m.likeCount - (l.user_id === myUserId ? 0 : 1)) }
            : m));
        })
      .subscribe();
    if (myUserId) {
      const { data: memberRow } = await supabase.from('conversation_members').select('muted').eq('conversation_id', conv.id).eq('user_id', myUserId).maybeSingle();
      setMyMuted(memberRow?.muted ?? false);
    }
  }

  function closeConversation() {
    channelRef.current?.unsubscribe();
    channelRef.current = null;
    setSelectedConv(null);
    setMessages([]);
    setInputText('');
    setMyMuted(false);
    loadConversations();
  }

  async function loadMessages(convId: string) {
    const { data } = await supabase.from('messages')
      .select('id,user_id,contenu,image_url,created_at').eq('conversation_id', convId).eq('actif', true)
      .order('created_at', { ascending: true }).limit(100);
    if (!data?.length) { setMessages([]); return; }
    const userIds = [...new Set(data.map((m: any) => m.user_id))];
    const messageIds = data.map((m: any) => m.id);
    const [{ data: profils }, { data: likes }] = await Promise.all([
      supabase.from('profils').select('id,prenom,avatar_url').in('id', userIds),
      supabase.from('message_likes').select('message_id,user_id').in('message_id', messageIds),
    ]);
    const pm: Record<string, any> = {};
    (profils || []).forEach((p: any) => { pm[p.id] = p; });
    const likeCounts: Record<string, number> = {};
    const likedByMeSet = new Set<string>();
    (likes || []).forEach((l: any) => {
      likeCounts[l.message_id] = (likeCounts[l.message_id] || 0) + 1;
      if (l.user_id === myUserId) likedByMeSet.add(l.message_id);
    });
    setMessages(data.map((m: any) => ({
      ...m,
      prenom: pm[m.user_id]?.prenom || 'Membre',
      avatar_url: pm[m.user_id]?.avatar_url || null,
      likeCount: likeCounts[m.id] || 0,
      likedByMe: likedByMeSet.has(m.id),
    })));
  }

  async function toggleLike(message: Message) {
    if (!myUserId) return;
    const wasLiked = message.likedByMe;
    setMessages(prev => prev.map(m => m.id === message.id
      ? { ...m, likedByMe: !wasLiked, likeCount: m.likeCount + (wasLiked ? -1 : 1) }
      : m));
    if (wasLiked) {
      await supabase.from('message_likes').delete().eq('message_id', message.id).eq('user_id', myUserId);
    } else {
      const { error } = await supabase.from('message_likes').insert({ message_id: message.id, user_id: myUserId });
      // Contrainte unique : si deja like (course entre deux taps rapides), on ignore l'erreur.
      if (error && error.code !== '23505') {
        setMessages(prev => prev.map(m => m.id === message.id ? { ...m, likedByMe: false, likeCount: Math.max(0, m.likeCount - 1) } : m));
      }
    }
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
      const { data, error } = await supabase.from('messages').insert({
        conversation_id: selectedConv.id, user_id: myUserId, contenu: '', image_url: pub.publicUrl,
      }).select('id,created_at').single();
      if (error) throw error;
      const optimistic: Message = {
        id: data?.id ?? `tmp-${Date.now()}`, user_id: myUserId, contenu: '', image_url: pub.publicUrl,
        created_at: data?.created_at ?? new Date().toISOString(), prenom: 'Moi', avatar_url: null,
        likeCount: 0, likedByMe: false,
      };
      setMessages(prev => prev.some(m => m.id === optimistic.id) ? prev : [...prev, optimistic]);
      notifyOtherMembers('📷 Photo', selectedConv);
    } catch (e: any) {
      Alert.alert('Erreur', e.message || "Impossible d'envoyer la photo.");
    } finally {
      setSendingPhoto(false);
    }
  }

  async function sendMessage() {
    if (!inputText.trim() || !selectedConv || !myUserId || sending) return;
    const text = inputText.trim();
    setInputText('');
    setSending(true);
    const { data, error } = await supabase.from('messages').insert({
      conversation_id: selectedConv.id, user_id: myUserId, contenu: text,
    }).select('id,created_at').single();
    if (!error) {
      const optimistic: Message = { id: data?.id ?? `tmp-${Date.now()}`, user_id: myUserId, contenu: text, image_url: null, created_at: data?.created_at ?? new Date().toISOString(), prenom: 'Moi', avatar_url: null, likeCount: 0, likedByMe: false };
      setMessages(prev => prev.some(m => m.id === optimistic.id) ? prev : [...prev, optimistic]);
      notifyOtherMembers(text, selectedConv);
    } else {
      Alert.alert('Erreur', `Message non envoyé : ${error.message}`);
      setInputText(text);
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
    await supabase.from('conversation_members').update({ muted: newMuted }).eq('conversation_id', selectedConv.id).eq('user_id', myUserId);
  }

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

  async function openCreateModal() {
    if (!myUserId) return;
    const { data: followsData } = await supabase.from('follows').select('following_id').eq('follower_id', myUserId).eq('statut', 'accepte');
    const ids = (followsData || []).map((f: any) => f.following_id);
    if (ids.length) {
      const { data } = await supabase.from('profils').select('id,prenom,avatar_url,ville').in('id', ids);
      setContacts((data || []).map((p: any) => ({ id: p.id, prenom: p.prenom || 'Membre', avatar_url: p.avatar_url, ville: p.ville || null })));
    } else { setContacts([]); }
    setSelectedMembers([]); setGroupName(''); setConvMode('direct'); setMemberSearch('');
    setCreateModal(true);
  }

  async function findExistingDM(otherId: string): Promise<Conversation | null> {
    const [{ data: mine }, { data: theirs }] = await Promise.all([
      supabase.from('conversation_members').select('conversation_id').eq('user_id', myUserId!),
      supabase.from('conversation_members').select('conversation_id').eq('user_id', otherId),
    ]);
    const mySet = new Set((mine || []).map((r: any) => r.conversation_id));
    const shared = (theirs || []).map((r: any) => r.conversation_id).filter((id: string) => mySet.has(id));
    for (const cid of shared) {
      const { count } = await supabase.from('conversation_members').select('*', { count: 'exact', head: true }).eq('conversation_id', cid);
      if (count === 2) return conversations.find(c => c.id === cid) ?? null;
    }
    return null;
  }

  async function createConversation() {
    if (!myUserId || !selectedMembers.length) return;
    setCreating(true);
    if (convMode === 'direct') {
      const existing = await findExistingDM(selectedMembers[0]);
      if (existing) { setCreating(false); setCreateModal(false); openConversation(existing); return; }
    }
    const { data: conv, error } = await supabase.from('conversations').insert({
      nom: convMode === 'groupe' ? (groupName.trim() || null) : null, created_by: myUserId, actif: true,
    }).select().single();
    if (error || !conv) { Alert.alert('Erreur', error?.message || ''); setCreating(false); return; }
    await supabase.from('conversation_members').insert([...new Set([myUserId, ...selectedMembers])].map(uid => ({ conversation_id: conv.id, user_id: uid })));
    setCreating(false); setCreateModal(false);
    await loadConversations();
    openConversation({ id: conv.id, nom: conv.nom, created_by: myUserId, members: [...new Set([myUserId, ...selectedMembers])].map(uid => { const c = contacts.find(x => x.id === uid); return { user_id: uid, prenom: c?.prenom || 'Moi', avatar_url: c?.avatar_url || null }; }), last_message: null });
  }

  // ── Groupes ──
  async function loadGroupes() {
    if (!myUserId) return;
    setGroupesLoading(true);
    const { data: gData } = await supabase.from('groupes').select('*').eq('actif', true).order('created_at', { ascending: false });
    const { data: memberRows } = await supabase.from('conversation_members').select('conversation_id').eq('user_id', myUserId);
    setMyConvIds(new Set((memberRows || []).map((m: any) => m.conversation_id)));

    if (gData?.length) {
      const counts = await Promise.all(gData.map((gr: any) =>
        supabase.from('conversation_members').select('*', { count: 'exact', head: true }).eq('conversation_id', gr.conversation_id)
      ));
      setGroupes(gData.map((gr: any, i: number) => ({ ...gr, membre_count: counts[i].count ?? 0 })));
    } else { setGroupes([]); }
    setGroupesLoading(false);
  }

  async function joinGroupe(groupe: Groupe) {
    if (!myUserId) return;
    const { error } = await supabase.from('conversation_members').insert({ conversation_id: groupe.conversation_id, user_id: myUserId });
    if (error) { Alert.alert('Erreur', error.message); return; }
    setMyConvIds(prev => new Set([...prev, groupe.conversation_id]));
    setGroupes(prev => prev.map(g => g.id === groupe.id ? { ...g, membre_count: (g.membre_count ?? 0) + 1 } : g));
    Alert.alert('Bienvenue !', `Tu as rejoint le groupe "${groupe.nom}".`);
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
      id: convData.id, nom: groupe.nom, created_by: convData.created_by,
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
    const link = `https://thepackclub.fr/groupe/${groupe.id}`;
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

  // Pour la liste inversee (cf. plus bas) : ordre du plus recent au plus ancien.
  // Memoise pour ne pas recalculer a chaque frappe dans le champ de saisie.
  const reversedMessages = useMemo(() => [...messages].reverse(), [messages]);

  if (sessionLoading) return <ActivityIndicator style={{ flex: 1 }} color={colors.terra} />;
  if (!session) return <AuthGate navigation={navigation} message="Connecte-toi pour accéder à la messagerie et organiser des balades avec la meute." />;

  // ── Chat view ──
  if (selectedConv) {
    const isCreator = selectedConv.created_by === myUserId;
    return (
      <ErrorBoundary label="chat_view" onClose={closeConversation}>
      <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}>
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
                <View style={[s.msgRow, isMe && s.msgRowMe]}>
                  {!isMe && (
                    <View style={s.msgAvatarWrap}>
                      {m.avatar_url ? <Image source={{ uri: m.avatar_url }} style={s.msgAvatar} /> : <View style={[s.msgAvatar, s.msgAvatarFallback]}><Text style={s.msgAvatarLetter}>{(m.prenom[0] || '?').toUpperCase()}</Text></View>}
                    </View>
                  )}
                  <View style={[s.msgBubbleWrap, isMe && s.msgBubbleWrapMe]}>
                    {showSender && <Text style={s.msgSender}>{m.prenom}</Text>}
                    <TouchableOpacity activeOpacity={0.85} onLongPress={() => toggleLike(m)}>
                      {m.image_url ? (
                        <Image source={{ uri: m.image_url }} style={s.msgImage} resizeMode="cover" />
                      ) : (
                        <View style={[s.msgBubble, isMe ? s.msgBubbleMe : s.msgBubbleThem]}>
                          <Text style={[s.msgText, isMe && s.msgTextMe]}>{m.contenu}</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                    <View style={[s.msgFooterRow, isMe && s.msgFooterRowMe]}>
                      {showTime && <Text style={[s.msgTime, isMe && s.msgTimeMe]}>{fmtTime(m.created_at)}</Text>}
                      <TouchableOpacity style={s.likeBtn} onPress={() => toggleLike(m)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                        <Ionicons name={m.likedByMe ? 'heart' : 'heart-outline'} size={14} color={m.likedByMe ? colors.terra : colors.textMuted} />
                        {m.likeCount > 0 && <Text style={s.likeCount}>{m.likeCount}</Text>}
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              );
            }}
          />
        )}
        <View style={[s.inputBar, { paddingBottom: kbVisible ? 10 : Math.max(insets.bottom, 10) }]}>
          <TouchableOpacity style={s.photoBtn} onPress={pickAndSendPhoto} disabled={sendingPhoto}>
            {sendingPhoto ? <ActivityIndicator size="small" color={colors.terra} /> : <Ionicons name="image-outline" size={22} color={colors.terra} />}
          </TouchableOpacity>
          <TextInput style={s.input} value={inputText} onChangeText={setInputText} placeholder="Message…" placeholderTextColor={colors.textMuted} multiline maxLength={1000} returnKeyType="send" blurOnSubmit={false} onSubmitEditing={sendMessage} />
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
                {selectedConv.members.map(m => (
                  <View key={m.user_id} style={s.memberListRow}>
                    {m.avatar_url ? <Image source={{ uri: m.avatar_url }} style={s.memberAvatar} /> : <View style={[s.memberAvatar, s.memberAvatarFallback]}><Text style={s.memberAvatarLetter}>{(m.prenom[0] || '?').toUpperCase()}</Text></View>}
                    <Text style={s.memberName}>{m.user_id === myUserId ? 'Moi' : m.prenom}</Text>
                    {m.user_id === selectedConv.created_by && <Text style={s.memberOwnerTag}>Créateur</Text>}
                  </View>
                ))}
              </ScrollView>
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
      </ErrorBoundary>
    );
  }

  // ── List view ──
  return (
    <View style={s.container}>

      {/* Tabs */}
      <View style={s.tabs}>
        <TouchableOpacity style={[s.tab, activeTab === 'groupes' && s.tabActive]} onPress={() => { setActiveTab('groupes'); if (!groupes.length) loadGroupes(); }}>
          <View style={[s.tabIcon, activeTab === 'groupes' && s.tabIconActive]}>
            <Ionicons name="people-outline" size={18} color={activeTab === 'groupes' ? colors.ivory : colors.textMuted} />
          </View>
          <View>
            <Text style={[s.tabTitle, activeTab === 'groupes' && s.tabTitleActive]}>Groupes</Text>
            <Text style={[s.tabSub, activeTab === 'groupes' && s.tabSubActive]}>Balades, éducation, rencontres</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity style={[s.tab, activeTab === 'messages' && s.tabActive]} onPress={() => setActiveTab('messages')}>
          <View style={[s.tabIcon, activeTab === 'messages' && s.tabIconActive]}>
            <Ionicons name="chatbubbles-outline" size={18} color={activeTab === 'messages' ? colors.ivory : colors.textMuted} />
          </View>
          <View>
            <Text style={[s.tabTitle, activeTab === 'messages' && s.tabTitleActive]}>Messages</Text>
            <Text style={[s.tabSub, activeTab === 'messages' && s.tabSubActive]}>Tes conversations</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* ── Messages tab ── */}
      {activeTab === 'messages' && (
        <>
          {loading ? <ActivityIndicator style={{ flex: 1 }} color={colors.terra} /> : (
            <FlatList
              data={directConversations}
              keyExtractor={c => c.id}
              contentContainerStyle={[s.list, directConversations.length === 0 && { flex: 1 }]}
              onRefresh={loadConversations}
              refreshing={loading}
              ListEmptyComponent={
                <View style={s.empty}>
                  <Ionicons name="chatbubbles-outline" size={44} color={colors.border} />
                  <Text style={s.emptyTitle}>Aucune conversation</Text>
                  <Text style={s.emptyText}>Envoie un message direct ou crée un groupe !</Text>
                </View>
              }
              renderItem={({ item: conv }) => {
                const lastMsg = conv.last_message;
                const sender = lastMsg ? conv.members.find(m => m.user_id === lastMsg.user_id) : null;
                const preview = lastMsg ? `${lastMsg.user_id === myUserId ? 'Moi' : (sender?.prenom || 'Membre')} : ${lastMsg.image_url ? '📷 Photo' : lastMsg.contenu}` : 'Aucun message';
                return (
                  <TouchableOpacity style={s.convRow} onPress={() => openConversation(conv)} activeOpacity={0.7}>
                    {renderConvAvatar(conv)}
                    <View style={s.convInfo}>
                      <View style={s.convTopRow}>
                        <Text style={s.convName} numberOfLines={1}>{convDisplayName(conv)}</Text>
                        {lastMsg && <Text style={s.convTime}>{fmtTime(lastMsg.created_at)}</Text>}
                      </View>
                      <Text style={s.convPreview} numberOfLines={1}>{preview}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={colors.border} />
                  </TouchableOpacity>
                );
              }}
            />
          )}
          <TouchableOpacity style={s.fab} onPress={openCreateModal} activeOpacity={0.85}>
            <Ionicons name="add" size={26} color={colors.ivory} />
          </TouchableOpacity>
        </>
      )}

      {/* ── Groupes tab ── */}
      {activeTab === 'groupes' && (
        <>

          {groupesLoading ? <ActivityIndicator style={{ flex: 1, marginTop: 40 }} color={colors.terra} /> : (
            <FlatList
              data={filteredGroupes}
              keyExtractor={g => g.id}
              contentContainerStyle={[s.groupesList, filteredGroupes.length === 0 && { flex: 1 }]}
              onRefresh={loadGroupes}
              refreshing={groupesLoading}
              ListHeaderComponent={
                groupChatConversations.length > 0 ? (
                  <View style={{ marginBottom: 16 }}>
                    <Text style={s.groupChatSectionTitle}>Mes discussions de groupe</Text>
                    {groupChatConversations.map(conv => {
                      const lastMsg = conv.last_message;
                      const sender = lastMsg ? conv.members.find(m => m.user_id === lastMsg.user_id) : null;
                      const preview = lastMsg ? `${lastMsg.user_id === myUserId ? 'Moi' : (sender?.prenom || 'Membre')} : ${lastMsg.image_url ? '📷 Photo' : lastMsg.contenu}` : 'Aucun message';
                      return (
                        <TouchableOpacity key={conv.id} style={s.convRow} onPress={() => openConversation(conv)} activeOpacity={0.7}>
                          {renderConvAvatar(conv)}
                          <View style={s.convInfo}>
                            <View style={s.convTopRow}>
                              <Text style={s.convName} numberOfLines={1}>{convDisplayName(conv)}</Text>
                              {lastMsg && <Text style={s.convTime}>{fmtTime(lastMsg.created_at)}</Text>}
                            </View>
                            <Text style={s.convPreview} numberOfLines={1}>{preview}</Text>
                          </View>
                          <Ionicons name="chevron-forward" size={16} color={colors.border} />
                        </TouchableOpacity>
                      );
                    })}
                    {filteredGroupes.length > 0 && <Text style={[s.groupChatSectionTitle, { marginTop: 16 }]}>Groupes publics</Text>}
                  </View>
                ) : null
              }
              ListEmptyComponent={
                groupChatConversations.length === 0 ? (
                  <View style={s.empty}>
                    <Ionicons name="people-outline" size={44} color={colors.border} />
                    <Text style={s.emptyTitle}>Pas encore de groupe</Text>
                    <Text style={s.emptyText}>Crée le premier groupe pour ta ville !</Text>
                  </View>
                ) : null
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

          <TouchableOpacity style={s.fab} onPress={() => setCreateGroupeModal(true)} activeOpacity={0.85}>
            <Ionicons name="add" size={26} color={colors.ivory} />
          </TouchableOpacity>
        </>
      )}

      {/* ── Modal nouvelle conv (messages) ── */}
      <Modal visible={createModal} animationType="slide" transparent onRequestClose={() => setCreateModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <View style={s.createOverlay}>
            <View style={s.createSheet}>
              <View style={s.createHeader}>
                <Text style={s.createTitle}>Nouvelle conversation</Text>
                <TouchableOpacity onPress={() => setCreateModal(false)}><Ionicons name="close" size={22} color={colors.textMuted} /></TouchableOpacity>
              </View>
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
              {convMode === 'groupe' && (
                <TextInput style={s.groupNameInput} value={groupName} onChangeText={setGroupName} placeholder="Nom du groupe" placeholderTextColor={colors.textMuted} />
              )}
              <Text style={s.membersLabel}>{convMode === 'direct' ? 'Choisir un membre' : 'Ajouter des membres'}</Text>
              {contacts.length === 0 ? (
                <View style={s.noFollowsWrap}><Ionicons name="people-outline" size={32} color={colors.border} /><Text style={s.noFollowsText}>Suis des membres pour leur envoyer un message.</Text></View>
              ) : (
                <>
                  <View style={s.memberSearchWrap}>
                    <Ionicons name="search" size={16} color={colors.textMuted} />
                    <TextInput
                      style={s.memberSearchInput}
                      value={memberSearch}
                      onChangeText={setMemberSearch}
                      placeholder="Rechercher un membre..."
                      placeholderTextColor={colors.textMuted}
                    />
                    {memberSearch.length > 0 && (
                      <TouchableOpacity onPress={() => setMemberSearch('')}>
                        <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                      </TouchableOpacity>
                    )}
                  </View>
                  {(() => {
                    const filteredContacts = memberSearch.trim()
                      ? contacts.filter(f => f.prenom.toLowerCase().includes(memberSearch.trim().toLowerCase()))
                      : contacts;
                    if (filteredContacts.length === 0) {
                      return <View style={s.noFollowsWrap}><Text style={s.noFollowsText}>Aucun membre trouvé.</Text></View>;
                    }
                    return (
                <FlatList
                  data={filteredContacts} keyExtractor={f => f.id} style={{ maxHeight: 260 }}
                  renderItem={({ item: f }) => {
                    const selected = selectedMembers.includes(f.id);
                    const disabledDM = convMode === 'direct' && selectedMembers.length === 1 && !selected;
                    return (
                      <TouchableOpacity style={[s.memberRow, selected && s.memberRowSelected, disabledDM && s.memberRowDisabled]} activeOpacity={disabledDM ? 1 : 0.7} onPress={() => { if (disabledDM) return; setSelectedMembers(convMode === 'direct' ? (selected ? [] : [f.id]) : (selected ? selectedMembers.filter(id => id !== f.id) : [...selectedMembers, f.id])); }}>
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
                    );
                  })()}
                </>
              )}
              <TouchableOpacity style={[s.createBtn, (!selectedMembers.length || creating) && s.createBtnDisabled]} onPress={createConversation} disabled={!selectedMembers.length || creating}>
                {creating ? <ActivityIndicator color={colors.ivory} /> : <Text style={s.createBtnText}>{convMode === 'direct' ? 'Démarrer la conversation' : 'Créer le groupe privé'}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

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
              <Text style={sc.ctaUrl}>thepackclub.fr</Text>
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
  msgTime: { fontFamily: 'DMSans_400Regular', fontSize: 10, color: colors.textMuted, marginLeft: 12, marginTop: 2 },
  msgTimeMe: { marginLeft: 0, marginRight: 12 },
  msgImage: { width: 200, height: 200, borderRadius: 16 },
  msgFooterRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  msgFooterRowMe: { flexDirection: 'row-reverse' },
  likeBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 2 },
  likeCount: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted },
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
  memberName: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.bordeaux },
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
