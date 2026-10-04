import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, TextInput, KeyboardAvoidingView, Platform, Image,
} from 'react-native';
import { useRoute, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { useSession } from '../hooks/useSession';
import { colors } from '../lib/theme';

type Ticket = { id: string; subject: string; status: string; requester_id: string };
type Message = { id: string; auteur_id: string | null; contenu: string; pieces_jointes: string[]; created_at: string };

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  nouveau: { label: 'Nouveau', color: colors.terra },
  en_cours: { label: 'En cours', color: colors.sage },
  en_attente_client: { label: 'En attente de ta réponse', color: '#C62828' },
  resolu: { label: 'Résolu', color: colors.textMuted },
  ferme: { label: 'Fermé', color: colors.textMuted },
};

export default function ContactDetailScreen() {
  const route = useRoute();
  const { ticketId } = route.params as { ticketId: string };
  const { session } = useSession();
  const [loading, setLoading] = useState(true);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [satisfaction, setSatisfaction] = useState<number | null>(null);
  const [satisfactionSent, setSatisfactionSent] = useState(false);

  const load = useCallback(async () => {
    const [{ data: t }, { data: msgs }, { data: satis }] = await Promise.all([
      supabase.from('tickets').select('id, subject, status, requester_id').eq('id', ticketId).maybeSingle(),
      supabase.from('ticket_messages').select('id, auteur_id, contenu, pieces_jointes, created_at').eq('ticket_id', ticketId).order('created_at', { ascending: true }),
      supabase.from('ticket_satisfaction').select('score').eq('ticket_id', ticketId).maybeSingle(),
    ]);
    setTicket(t as any);
    setMessages((msgs as any) || []);
    setSatisfactionSent(!!satis);
    setLoading(false);

    const withAttachments = (msgs || []).filter((m: any) => m.pieces_jointes?.length);
    for (const m of withAttachments) {
      for (const path of m.pieces_jointes) {
        const { data } = await supabase.storage.from('ticket-attachments').createSignedUrl(path, 3600);
        if (data?.signedUrl) setAttachmentUrls(prev => ({ ...prev, [path]: data.signedUrl }));
      }
    }
  }, [ticketId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function sendReply() {
    if (!session || !replyText.trim() || !ticket) return;
    setSending(true);
    const { error } = await supabase.from('ticket_messages').insert({
      ticket_id: ticket.id,
      auteur_id: session.user.id,
      visibilite: 'client',
      contenu: replyText.trim(),
    });
    if (!error) {
      setReplyText('');
      await load();
    }
    setSending(false);
  }

  async function sendSatisfaction(score: number) {
    setSatisfaction(score);
    const { error } = await supabase.from('ticket_satisfaction').insert({ ticket_id: ticketId, score });
    if (!error) setSatisfactionSent(true);
  }

  if (loading || !ticket) {
    return <View style={styles.center}><ActivityIndicator color={colors.terra} size="large" /></View>;
  }

  const statusInfo = STATUS_LABELS[ticket.status] || { label: ticket.status, color: colors.textMuted };
  const canReply = !['resolu', 'ferme'].includes(ticket.status);

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <View style={styles.header}>
        <Text style={styles.subject} numberOfLines={2}>{ticket.subject}</Text>
        <Text style={[styles.statutBadge, { color: statusInfo.color }]}>{statusInfo.label}</Text>
      </View>

      <ScrollView style={styles.thread} contentContainerStyle={styles.threadContent}>
        {messages.map(m => {
          const isMine = m.auteur_id === session?.user.id;
          return (
            <View key={m.id} style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
              <Text style={[styles.bubbleText, isMine && styles.bubbleTextMine]}>{m.contenu}</Text>
              {m.pieces_jointes?.map(path => attachmentUrls[path] && (
                <Image key={path} source={{ uri: attachmentUrls[path] }} style={styles.attachmentImg} />
              ))}
              <Text style={[styles.bubbleDate, isMine && styles.bubbleDateMine]}>
                {new Date(m.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
          );
        })}

        {ticket.status === 'resolu' && !satisfactionSent && (
          <View style={styles.satisBox}>
            <Text style={styles.satisTitle}>Es-tu satisfait de la résolution ?</Text>
            <View style={styles.satisStars}>
              {[1, 2, 3, 4, 5].map(n => (
                <TouchableOpacity key={n} onPress={() => sendSatisfaction(n)}>
                  <Ionicons name={satisfaction && n <= satisfaction ? 'star' : 'star-outline'} size={28} color={colors.terra} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
        {satisfactionSent && <Text style={styles.satisThanks}>Merci pour ton retour !</Text>}
      </ScrollView>

      {canReply && (
        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            value={replyText}
            onChangeText={setReplyText}
            placeholder="Répondre…"
            placeholderTextColor={colors.textMuted}
            multiline
          />
          <TouchableOpacity style={styles.sendBtn} disabled={!replyText.trim() || sending} onPress={sendReply}>
            {sending ? <ActivityIndicator color={colors.ivory} size="small" /> : <Ionicons name="send" size={18} color={colors.ivory} />}
          </TouchableOpacity>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ivoryLight },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ivoryLight },
  header: { padding: 16, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 4 },
  subject: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 16, color: colors.bordeaux },
  statutBadge: { fontFamily: 'DMSans_500Medium', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3 },
  thread: { flex: 1 },
  threadContent: { padding: 16, gap: 10 },
  bubble: { maxWidth: '85%', borderRadius: 14, padding: 12 },
  bubbleTheirs: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, alignSelf: 'flex-start' },
  bubbleMine: { backgroundColor: colors.terra, alignSelf: 'flex-end' },
  bubbleText: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.bordeaux, lineHeight: 20 },
  bubbleTextMine: { color: colors.ivory },
  bubbleDate: { fontFamily: 'DMSans_400Regular', fontSize: 10, color: colors.textMuted, marginTop: 4 },
  bubbleDateMine: { color: 'rgba(255,255,255,0.7)' },
  attachmentImg: { width: 160, height: 160, borderRadius: 10, marginTop: 8 },
  satisBox: { alignItems: 'center', gap: 10, padding: 20, backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.border, marginTop: 8 },
  satisTitle: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.bordeaux },
  satisStars: { flexDirection: 'row', gap: 8 },
  satisThanks: { textAlign: 'center', fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted, marginTop: 8 },
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.border,
  },
  input: {
    flex: 1, backgroundColor: colors.ivoryLight, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10,
    fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.bordeaux, maxHeight: 100,
  },
  sendBtn: { backgroundColor: colors.terra, borderRadius: 18, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});
