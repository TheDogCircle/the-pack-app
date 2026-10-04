import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, RefreshControl, Modal, TextInput,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import Constants from 'expo-constants';
import { supabase } from '../lib/supabase';
import { useSession } from '../hooks/useSession';
import { track } from '../lib/tracking';
import { colors } from '../lib/theme';

const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
const appVersion = Constants.expoConfig?.version || null;

const CATEGORIES = [
  { key: 'question', label: 'Question', icon: 'help-circle-outline' as const },
  { key: 'bug', label: 'Signaler un bug', icon: 'bug-outline' as const },
  { key: 'idee', label: "Proposer une idée", icon: 'bulb-outline' as const },
];

const TYPE_LABELS: Record<string, string> = {
  question: 'Question', bug: 'Bug', idee: 'Idée', litige: 'Litige', reclamation_pro: 'Réclamation',
};
const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  nouveau: { label: 'Nouveau', color: colors.terra },
  en_cours: { label: 'En cours', color: colors.sage },
  en_attente_client: { label: 'En attente de ta réponse', color: '#C62828' },
  resolu: { label: 'Résolu', color: colors.textMuted },
  ferme: { label: 'Fermé', color: colors.textMuted },
};

type Ticket = { id: string; type: string; subject: string; status: string; created_at: string };

export default function ContactScreen() {
  const navigation = useNavigation();
  const { session } = useSession();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [category, setCategory] = useState('question');
  const [message, setMessage] = useState('');
  const [attachmentUri, setAttachmentUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!session) return;
    const { data } = await supabase
      .from('tickets').select('id, type, subject, status, created_at')
      .order('created_at', { ascending: false });
    setTickets((data as any) || []);
    setLoading(false);
    setRefreshing(false);
  }, [session?.user.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function pickAttachment() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (result.canceled || !result.assets[0]) return;
    setAttachmentUri(result.assets[0].uri);
  }

  async function submitTicket() {
    if (!session || !message.trim()) return;
    setSubmitting(true);
    try {
      let pieceJointeUrl: string | null = null;
      if (attachmentUri) {
        const ext = attachmentUri.split('.').pop() || 'jpg';
        const path = `${session.user.id}/${Date.now()}.${ext}`;
        const formData = new FormData();
        formData.append('file', { uri: attachmentUri, name: `capture.${ext}`, type: `image/${ext}` } as any);
        const { error: upErr } = await supabase.storage.from('ticket-attachments').upload(path, formData);
        if (!upErr) pieceJointeUrl = path;
      }

      const catMeta = CATEGORIES.find(c => c.key === category)!;
      const { data: ticket, error } = await supabase.from('tickets').insert({
        type: category,
        source: 'app',
        requester_id: session.user.id,
        subject: `${catMeta.label} : ${message.trim().slice(0, 60)}`,
        platform,
        app_version: appVersion,
      }).select('id').single();
      if (error) throw error;

      await supabase.from('ticket_messages').insert({
        ticket_id: ticket.id,
        auteur_id: session.user.id,
        visibilite: 'client',
        contenu: message.trim(),
        pieces_jointes: pieceJointeUrl ? [pieceJointeUrl] : [],
      });

      track('ticket_created', { type: category });
      setModalVisible(false);
      setMessage(''); setAttachmentUri(null); setCategory('question');
      await load();
      (navigation as any).navigate('ContactDetail', { ticketId: ticket.id });
    } catch (e: any) {
      Alert.alert('Erreur', e.message || "Impossible d'envoyer ta demande.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={colors.terra} size="large" /></View>;
  }

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.terra} />}
      >
        <TouchableOpacity style={styles.newBtn} onPress={() => setModalVisible(true)}>
          <Ionicons name="add-circle" size={18} color={colors.ivory} />
          <Text style={styles.newBtnText}>Nouvelle demande</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.ideesBtn} onPress={() => (navigation as any).navigate('Idees')}>
          <Ionicons name="bulb-outline" size={18} color={colors.terra} />
          <Text style={styles.ideesBtnText}>Voir et voter pour les idées de la communauté</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>

        {!tickets.length ? (
          <View style={styles.emptyBox}>
            <Ionicons name="chatbubble-ellipses-outline" size={28} color={colors.textMuted} />
            <Text style={styles.emptyText}>Aucune demande pour le moment.</Text>
          </View>
        ) : tickets.map(t => {
          const statusInfo = STATUS_LABELS[t.status] || { label: t.status, color: colors.textMuted };
          const dateLabel = new Date(t.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
          return (
            <TouchableOpacity key={t.id} style={styles.card} onPress={() => (navigation as any).navigate('ContactDetail', { ticketId: t.id })}>
              <View style={styles.cardHeader}>
                <Text style={styles.subject} numberOfLines={1}>{t.subject}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.typeTag}>{TYPE_LABELS[t.type] || t.type}</Text>
                <Text style={[styles.statutBadge, { color: statusInfo.color }]}>{statusInfo.label}</Text>
              </View>
              <Text style={styles.dateText}>{dateLabel}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <Modal visible={modalVisible} animationType="slide" transparent onRequestClose={() => setModalVisible(false)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Contacter l'équipe</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}><Ionicons name="close" size={22} color={colors.textMuted} /></TouchableOpacity>
            </View>

            <ScrollView>
              <View style={styles.catRow}>
                {CATEGORIES.map(c => (
                  <TouchableOpacity key={c.key} style={[styles.catPill, category === c.key && styles.catPillActive]} onPress={() => setCategory(c.key)}>
                    <Ionicons name={c.icon} size={16} color={category === c.key ? colors.ivory : colors.bordeaux} />
                    <Text style={[styles.catPillText, category === c.key && styles.catPillTextActive]}>{c.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TextInput
                style={styles.messageInput}
                value={message}
                onChangeText={setMessage}
                placeholder="Décris ta demande…"
                placeholderTextColor={colors.textMuted}
                multiline
                maxLength={2000}
              />

              <TouchableOpacity style={styles.attachBtn} onPress={pickAttachment}>
                <Ionicons name="camera-outline" size={16} color={colors.bordeaux} />
                <Text style={styles.attachBtnText}>{attachmentUri ? 'Capture jointe ✓' : 'Joindre une capture (optionnel)'}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.submitBtn, (!message.trim() || submitting) && styles.submitBtnDisabled]}
                disabled={!message.trim() || submitting}
                onPress={submitTicket}
              >
                {submitting ? <ActivityIndicator color={colors.ivory} /> : <Text style={styles.submitBtnText}>Envoyer</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ivoryLight },
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ivoryLight },
  emptyBox: { alignItems: 'center', gap: 10, padding: 40 },
  emptyText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted },
  newBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.terra, borderRadius: 12, paddingVertical: 13,
  },
  newBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.ivory },
  ideesBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.border,
    paddingVertical: 12, paddingHorizontal: 14,
  },
  ideesBtnText: { flex: 1, fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.bordeaux },
  card: {
    backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.border,
    padding: 16, gap: 6,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  subject: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 15, color: colors.bordeaux, flex: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 },
  typeTag: {
    fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.textMid,
    backgroundColor: colors.ivoryLight, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6,
  },
  statutBadge: { fontFamily: 'DMSans_500Medium', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3 },
  dateText: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted, marginTop: 2 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(20,10,8,0.4)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, maxHeight: '85%',
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  modalTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: colors.bordeaux },
  catRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  catPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1.5, borderColor: colors.border, borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  catPillActive: { backgroundColor: colors.terra, borderColor: colors.terra },
  catPillText: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.bordeaux },
  catPillTextActive: { color: colors.ivory },
  messageInput: {
    borderWidth: 1.5, borderColor: colors.border, borderRadius: 12,
    padding: 14, minHeight: 110, textAlignVertical: 'top',
    fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.bordeaux, marginBottom: 12,
  },
  attachBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 18 },
  attachBtnText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.bordeaux },
  submitBtn: { backgroundColor: colors.terra, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.ivory },
});
