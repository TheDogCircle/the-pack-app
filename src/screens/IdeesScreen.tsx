import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { useSession } from '../hooks/useSession';
import { colors } from '../lib/theme';

type Idee = { id: string; subject: string; idee_statut: string | null; votes_count: number; created_at: string; deja_vote: boolean };

const STATUT_META: Record<string, { label: string; color: string }> = {
  a_etudier: { label: 'À étudier', color: colors.textMuted },
  prevu: { label: 'Prévu', color: colors.terra },
  en_cours: { label: 'En cours', color: colors.sage },
  livre: { label: 'Livré 🎉', color: colors.bordeaux },
};

export default function IdeesScreen() {
  const { session } = useSession();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [idees, setIdees] = useState<Idee[]>([]);
  const [votingId, setVotingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('idees_publiques');
    setIdees((data as any) || []);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function toggleVote(idee: Idee) {
    if (!session || votingId) return;
    setVotingId(idee.id);
    if (idee.deja_vote) {
      await supabase.from('idee_votes').delete().eq('ticket_id', idee.id).eq('user_id', session.user.id);
    } else {
      await supabase.from('idee_votes').insert({ ticket_id: idee.id, user_id: session.user.id });
    }
    await load();
    setVotingId(null);
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={colors.terra} size="large" /></View>;
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.terra} />}
    >
      {!idees.length ? (
        <View style={styles.emptyBox}>
          <Ionicons name="bulb-outline" size={28} color={colors.textMuted} />
          <Text style={styles.emptyText}>Aucune idée proposée pour le moment.</Text>
        </View>
      ) : idees.map(idee => {
        const statut = STATUT_META[idee.idee_statut || 'a_etudier'];
        return (
          <View key={idee.id} style={styles.card}>
            <TouchableOpacity
              style={[styles.voteBtn, idee.deja_vote && styles.voteBtnActive]}
              disabled={votingId === idee.id}
              onPress={() => toggleVote(idee)}
            >
              {votingId === idee.id
                ? <ActivityIndicator size="small" color={idee.deja_vote ? colors.ivory : colors.terra} />
                : <>
                    <Ionicons name="caret-up" size={16} color={idee.deja_vote ? colors.ivory : colors.terra} />
                    <Text style={[styles.voteCount, idee.deja_vote && styles.voteCountActive]}>{idee.votes_count}</Text>
                  </>}
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={styles.subject}>{idee.subject}</Text>
              <Text style={[styles.statutBadge, { color: statut.color }]}>{statut.label}</Text>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ivoryLight },
  content: { padding: 16, paddingBottom: 40, gap: 10 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ivoryLight },
  emptyBox: { alignItems: 'center', gap: 10, padding: 40 },
  emptyText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.border,
    padding: 14,
  },
  voteBtn: {
    alignItems: 'center', justifyContent: 'center', gap: 2,
    width: 52, height: 52, borderRadius: 12,
    borderWidth: 1.5, borderColor: colors.terra, backgroundColor: colors.white,
  },
  voteBtnActive: { backgroundColor: colors.terra },
  voteCount: { fontFamily: 'DMSans_600SemiBold', fontSize: 13, color: colors.terra },
  voteCountActive: { color: colors.ivory },
  subject: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 15, color: colors.bordeaux },
  statutBadge: { fontFamily: 'DMSans_500Medium', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 4 },
});
