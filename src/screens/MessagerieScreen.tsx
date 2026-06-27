import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, KeyboardAvoidingView, Platform,
  Modal, Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import { useSession } from '../hooks/useSession';
import AuthGate from '../components/AuthGate';

type ConvMember = { user_id: string; prenom: string; avatar_url: string | null };

type Conversation = {
  id: string;
  nom: string | null;
  created_by: string;
  members: ConvMember[];
  last_message: { contenu: string; created_at: string; user_id: string } | null;
};

type Message = {
  id: string;
  user_id: string;
  contenu: string;
  created_at: string;
  prenom: string;
  avatar_url: string | null;
};

type Follow = { id: string; prenom: string; avatar_url: string | null };

function fmtTime(dateStr: string) {
  const d = new Date(dateStr);
  const diff = Date.now() - d.getTime();
  if (diff < 86400000) return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (diff < 604800000) return d.toLocaleDateString('fr-FR', { weekday: 'short' });
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export default function MessagerieScreen() {
  const navigation = useNavigation<any>();
  const { session, loading: sessionLoading } = useSession();
  const myUserId = session?.user?.id ?? null;

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [msgLoading, setMsgLoading] = useState(false);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);

  const [createModal, setCreateModal] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [follows, setFollows] = useState<Follow[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const flatListRef = useRef<FlatList>(null);
  const channelRef = useRef<any>(null);

  function convDisplayName(conv: Conversation): string {
    if (conv.nom) return conv.nom;
    const others = conv.members.filter(m => m.user_id !== myUserId);
    if (!others.length) return 'Groupe';
    if (others.length <= 2) return others.map(m => m.prenom).join(', ');
    return `${others.slice(0, 2).map(m => m.prenom).join(', ')} +${others.length - 2}`;
  }

  useEffect(() => {
    if (myUserId) loadConversations();
  }, [myUserId]);

  useEffect(() => {
    if (selectedConv) {
      navigation.setOptions({
        title: convDisplayName(selectedConv),
        headerLeft: () => (
          <TouchableOpacity onPress={closeConversation} style={{ marginLeft: 4, padding: 4 }}>
            <Ionicons name="chevron-back" size={26} color={colors.ivory} />
          </TouchableOpacity>
        ),
      });
    } else {
      navigation.setOptions({ title: 'Messages', headerLeft: undefined });
    }
  }, [selectedConv]);

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
        user_id: m.user_id,
        prenom: pm[m.user_id]?.prenom || 'Membre',
        avatar_url: pm[m.user_id]?.avatar_url || null,
      });
    });

    const lastMsgResults = await Promise.all(
      convIds.map((cid: string) =>
        supabase.from('messages').select('contenu,created_at,user_id')
          .eq('conversation_id', cid).eq('actif', true)
          .order('created_at', { ascending: false }).limit(1)
      )
    );
    const lastMessages: Record<string, any> = {};
    convIds.forEach((cid: string, i: number) => {
      if (lastMsgResults[i].data?.[0]) lastMessages[cid] = lastMsgResults[i].data![0];
    });

    const list: Conversation[] = (convData || []).map((c: any) => ({
      id: c.id, nom: c.nom, created_by: c.created_by,
      members: membersByConv[c.id] || [],
      last_message: lastMessages[c.id] || null,
    })).sort((a: Conversation, b: Conversation) => {
      const ta = a.last_message?.created_at || '0';
      const tb = b.last_message?.created_at || '0';
      return tb.localeCompare(ta);
    });

    setConversations(list);
    setLoading(false);
  }

  async function openConversation(conv: Conversation) {
    setSelectedConv(conv);
    setMsgLoading(true);
    await loadMessages(conv.id);
    setMsgLoading(false);

    if (channelRef.current) channelRef.current.unsubscribe();
    channelRef.current = supabase.channel(`conv:${conv.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: `conversation_id=eq.${conv.id}`,
      }, async (payload) => {
        const m = payload.new as any;
        const { data: p } = await supabase.from('profils').select('prenom,avatar_url').eq('id', m.user_id).single();
        const newMsg: Message = { ...m, prenom: p?.prenom || 'Membre', avatar_url: p?.avatar_url || null };
        setMessages(prev => [...prev, newMsg]);
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 80);
      })
      .subscribe();
  }

  function closeConversation() {
    channelRef.current?.unsubscribe();
    channelRef.current = null;
    setSelectedConv(null);
    setMessages([]);
    setInputText('');
    loadConversations();
  }

  async function loadMessages(convId: string) {
    const { data } = await supabase.from('messages')
      .select('id,user_id,contenu,created_at')
      .eq('conversation_id', convId).eq('actif', true)
      .order('created_at', { ascending: true }).limit(100);
    if (!data?.length) { setMessages([]); return; }
    const userIds = [...new Set(data.map((m: any) => m.user_id))];
    const { data: profils } = await supabase.from('profils').select('id,prenom,avatar_url').in('id', userIds);
    const pm: Record<string, any> = {};
    (profils || []).forEach((p: any) => { pm[p.id] = p; });
    setMessages(data.map((m: any) => ({
      ...m, prenom: pm[m.user_id]?.prenom || 'Membre', avatar_url: pm[m.user_id]?.avatar_url || null,
    })));
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 60);
  }

  async function sendMessage() {
    if (!inputText.trim() || !selectedConv || !myUserId || sending) return;
    const text = inputText.trim();
    setInputText('');
    setSending(true);
    await supabase.from('messages').insert({
      conversation_id: selectedConv.id, user_id: myUserId, contenu: text, actif: true,
    });
    setSending(false);
  }

  async function openCreateModal() {
    if (!myUserId) return;
    const { data: followsData } = await supabase.from('follows')
      .select('following_id').eq('follower_id', myUserId).eq('statut', 'accepte');
    const ids = (followsData || []).map((f: any) => f.following_id);
    if (ids.length) {
      const { data } = await supabase.from('profils').select('id,prenom,avatar_url').in('id', ids);
      setFollows((data || []).map((p: any) => ({ id: p.id, prenom: p.prenom || 'Membre', avatar_url: p.avatar_url })));
    } else {
      setFollows([]);
    }
    setSelectedMembers([]);
    setGroupName('');
    setCreateModal(true);
  }

  async function createGroup() {
    if (!myUserId || !selectedMembers.length) return;
    setCreating(true);
    const { data: conv } = await supabase.from('conversations').insert({
      nom: groupName.trim() || null, type: 'groupe', created_by: myUserId, actif: true,
    }).select().single();
    if (!conv) { setCreating(false); return; }
    const memberIds = [...new Set([myUserId, ...selectedMembers])];
    await supabase.from('conversation_members').insert(
      memberIds.map(uid => ({ conversation_id: conv.id, user_id: uid }))
    );
    setCreating(false);
    setCreateModal(false);
    await loadConversations();
  }

  function renderAvatar(conv: Conversation) {
    const others = conv.members.filter(m => m.user_id !== myUserId);
    const first = others[0];
    if (first?.avatar_url) return <Image source={{ uri: first.avatar_url }} style={styles.convAvatar} />;
    const letter = (convDisplayName(conv)[0] || '?').toUpperCase();
    return (
      <View style={[styles.convAvatar, styles.convAvatarFallback]}>
        <Text style={styles.convAvatarLetter}>{letter}</Text>
      </View>
    );
  }

  if (sessionLoading) return <ActivityIndicator style={{ flex: 1 }} color={colors.terra} />;
  if (!session) return <AuthGate navigation={navigation} message="Connecte-toi pour accéder à la messagerie et organiser des balades avec la meute." />;

  // ── CHAT VIEW ──
  if (selectedConv) {
    return (
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {msgLoading ? (
          <ActivityIndicator style={{ flex: 1 }} color={colors.terra} />
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={m => m.id}
            contentContainerStyle={[styles.messagesList, messages.length === 0 && { flex: 1 }]}
            ListEmptyComponent={
              <View style={styles.emptyChat}>
                <Ionicons name="chatbubbles-outline" size={44} color={colors.border} />
                <Text style={styles.emptyChatText}>Commencez la conversation !</Text>
              </View>
            }
            renderItem={({ item: m, index }) => {
              const isMe = m.user_id === myUserId;
              const prevMsg = messages[index - 1];
              const showSender = !isMe && m.user_id !== prevMsg?.user_id;
              const nextMsg = messages[index + 1];
              const showTime = !nextMsg || new Date(nextMsg.created_at).getTime() - new Date(m.created_at).getTime() > 300000;
              return (
                <View style={[styles.msgRow, isMe && styles.msgRowMe]}>
                  {!isMe && (
                    <View style={styles.msgAvatarWrap}>
                      {showSender ? (
                        m.avatar_url
                          ? <Image source={{ uri: m.avatar_url }} style={styles.msgAvatar} />
                          : <View style={[styles.msgAvatar, styles.msgAvatarFallback]}>
                              <Text style={styles.msgAvatarLetter}>{(m.prenom[0] || '?').toUpperCase()}</Text>
                            </View>
                      ) : <View style={styles.msgAvatarSpacer} />}
                    </View>
                  )}
                  <View style={[styles.msgBubbleWrap, isMe && styles.msgBubbleWrapMe]}>
                    {showSender && <Text style={styles.msgSender}>{m.prenom}</Text>}
                    <View style={[styles.msgBubble, isMe ? styles.msgBubbleMe : styles.msgBubbleThem]}>
                      <Text style={[styles.msgText, isMe && styles.msgTextMe]}>{m.contenu}</Text>
                    </View>
                    {showTime && <Text style={[styles.msgTime, isMe && styles.msgTimeMe]}>{fmtTime(m.created_at)}</Text>}
                  </View>
                </View>
              );
            }}
          />
        )}
        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Message…"
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={1000}
            returnKeyType="send"
            blurOnSubmit={false}
            onSubmitEditing={sendMessage}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!inputText.trim() || sending) && styles.sendBtnDisabled]}
            onPress={sendMessage}
            disabled={!inputText.trim() || sending}
          >
            {sending
              ? <ActivityIndicator size="small" color={colors.ivory} />
              : <Ionicons name="send" size={18} color={colors.ivory} />}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // ── LIST VIEW ──
  return (
    <View style={styles.container}>
      {loading ? (
        <ActivityIndicator style={{ flex: 1 }} color={colors.terra} />
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={c => c.id}
          contentContainerStyle={[styles.list, conversations.length === 0 && { flex: 1 }]}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="chatbubbles-outline" size={44} color={colors.border} />
              <Text style={styles.emptyTitle}>Aucune conversation</Text>
              <Text style={styles.emptyText}>Crée un groupe pour organiser une balade avec la meute !</Text>
            </View>
          }
          renderItem={({ item: conv }) => {
            const lastMsg = conv.last_message;
            const sender = lastMsg ? conv.members.find(m => m.user_id === lastMsg.user_id) : null;
            const preview = lastMsg
              ? `${lastMsg.user_id === myUserId ? 'Moi' : (sender?.prenom || 'Membre')} : ${lastMsg.contenu}`
              : 'Aucun message';
            return (
              <TouchableOpacity style={styles.convRow} onPress={() => openConversation(conv)} activeOpacity={0.7}>
                {renderAvatar(conv)}
                <View style={styles.convInfo}>
                  <View style={styles.convTopRow}>
                    <Text style={styles.convName} numberOfLines={1}>{convDisplayName(conv)}</Text>
                    {lastMsg && <Text style={styles.convTime}>{fmtTime(lastMsg.created_at)}</Text>}
                  </View>
                  <Text style={styles.convPreview} numberOfLines={1}>{preview}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.border} />
              </TouchableOpacity>
            );
          }}
        />
      )}

      <TouchableOpacity style={styles.fab} onPress={openCreateModal} activeOpacity={0.85}>
        <Ionicons name="add" size={26} color={colors.ivory} />
      </TouchableOpacity>

      {/* Create group modal */}
      <Modal visible={createModal} animationType="slide" transparent onRequestClose={() => setCreateModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <View style={styles.createOverlay}>
            <View style={styles.createSheet}>
              <View style={styles.createHeader}>
                <Text style={styles.createTitle}>Nouveau groupe</Text>
                <TouchableOpacity onPress={() => setCreateModal(false)}>
                  <Ionicons name="close" size={22} color={colors.textMuted} />
                </TouchableOpacity>
              </View>

              <TextInput
                style={styles.groupNameInput}
                value={groupName}
                onChangeText={setGroupName}
                placeholder="Nom du groupe (optionnel)"
                placeholderTextColor={colors.textMuted}
              />

              <Text style={styles.membersLabel}>Ajouter des membres *</Text>
              {follows.length === 0 ? (
                <View style={styles.noFollowsWrap}>
                  <Ionicons name="people-outline" size={32} color={colors.border} />
                  <Text style={styles.noFollowsText}>Suis des membres pour les ajouter à un groupe.</Text>
                </View>
              ) : (
                <FlatList
                  data={follows}
                  keyExtractor={f => f.id}
                  style={{ maxHeight: 260 }}
                  renderItem={({ item: f }) => {
                    const selected = selectedMembers.includes(f.id);
                    return (
                      <TouchableOpacity
                        style={[styles.memberRow, selected && styles.memberRowSelected]}
                        onPress={() => setSelectedMembers(prev =>
                          selected ? prev.filter(id => id !== f.id) : [...prev, f.id]
                        )}
                      >
                        {f.avatar_url
                          ? <Image source={{ uri: f.avatar_url }} style={styles.memberAvatar} />
                          : <View style={[styles.memberAvatar, styles.memberAvatarFallback]}>
                              <Text style={styles.memberAvatarLetter}>{(f.prenom[0] || '?').toUpperCase()}</Text>
                            </View>}
                        <Text style={[styles.memberName, selected && styles.memberNameSelected]}>{f.prenom}</Text>
                        {selected && <Ionicons name="checkmark-circle" size={20} color={colors.terra} style={{ marginLeft: 'auto' as any }} />}
                      </TouchableOpacity>
                    );
                  }}
                />
              )}

              <TouchableOpacity
                style={[styles.createBtn, (!selectedMembers.length || creating) && styles.createBtnDisabled]}
                onPress={createGroup}
                disabled={!selectedMembers.length || creating}
              >
                {creating
                  ? <ActivityIndicator color={colors.ivory} />
                  : <Text style={styles.createBtnText}>Créer le groupe</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ivoryPale },

  list: { paddingBottom: 100 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 48 },
  emptyTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: colors.bordeaux },
  emptyText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted, textAlign: 'center', lineHeight: 20 },

  convRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    backgroundColor: colors.white,
  },
  convAvatar: { width: 48, height: 48, borderRadius: 24 },
  convAvatarFallback: { backgroundColor: colors.bordeaux, alignItems: 'center', justifyContent: 'center' },
  convAvatarLetter: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 20, color: colors.ivory },
  convInfo: { flex: 1 },
  convTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 },
  convName: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: colors.bordeaux, flex: 1, marginRight: 8 },
  convTime: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted },
  convPreview: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted },

  fab: {
    position: 'absolute', bottom: 28, right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.bordeaux, alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.bordeaux, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10, elevation: 8,
  },

  // Chat
  messagesList: { padding: 12, paddingBottom: 16 },
  emptyChat: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 48 },
  emptyChatText: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.textMuted, textAlign: 'center' },

  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginVertical: 2 },
  msgRowMe: { flexDirection: 'row-reverse' },
  msgAvatarWrap: { width: 28, flexShrink: 0 },
  msgAvatar: { width: 28, height: 28, borderRadius: 14 },
  msgAvatarFallback: { backgroundColor: colors.bordeaux, alignItems: 'center', justifyContent: 'center' },
  msgAvatarLetter: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.ivory },
  msgAvatarSpacer: { width: 28, height: 28 },
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

  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    paddingBottom: Platform.OS === 'ios' ? 28 : 10,
    backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.border,
  },
  input: {
    flex: 1, minHeight: 40, maxHeight: 110,
    borderWidth: 1, borderColor: colors.border, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 10,
    fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.bordeaux,
    backgroundColor: colors.ivoryPale,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.bordeaux, alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  sendBtnDisabled: { backgroundColor: colors.border },

  // Create modal
  createOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  createSheet: {
    backgroundColor: colors.ivoryPale, borderTopLeftRadius: 22, borderTopRightRadius: 22,
    padding: 20, paddingBottom: 40, gap: 14,
  },
  createHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  createTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 20, color: colors.bordeaux },
  groupNameInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12,
    fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.bordeaux, backgroundColor: colors.white,
  },
  membersLabel: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  noFollowsWrap: { alignItems: 'center', gap: 8, paddingVertical: 20 },
  noFollowsText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  memberRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12,
    backgroundColor: colors.white, marginBottom: 6, borderWidth: 1, borderColor: colors.border,
  },
  memberRowSelected: { borderColor: colors.terra, backgroundColor: colors.terra + '10' },
  memberAvatar: { width: 40, height: 40, borderRadius: 20 },
  memberAvatarFallback: { backgroundColor: colors.bordeaux, alignItems: 'center', justifyContent: 'center' },
  memberAvatarLetter: { fontFamily: 'DMSans_500Medium', fontSize: 16, color: colors.ivory },
  memberName: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.bordeaux },
  memberNameSelected: { fontFamily: 'DMSans_500Medium', color: colors.terra },
  createBtn: { backgroundColor: colors.bordeaux, borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 4 },
  createBtnDisabled: { opacity: 0.45 },
  createBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: colors.ivory },
});
