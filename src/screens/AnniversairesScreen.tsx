import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, ActivityIndicator, RefreshControl, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { useSession } from '../hooks/useSession';
import { colors } from '../lib/theme';

type BirthdayRow = {
  chienId: string;
  nomChien: string;
  ownerId: string;
  ownerPrenom: string;
  ownerAvatarUrl: string | null;
  daysUntil: number;
};

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function nextOccurrence(dateNaissanceParsed: string): Date {
  const [, mm, dd] = dateNaissanceParsed.split('-').map(Number);
  const now = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // Anniversaire un 29 fevrier : sur une annee non bissextile, on le fete le 28
  // (sinon `new Date(year, 1, 29)` deborde silencieusement sur le 1er mars).
  const dayFor = (year: number) => (mm === 2 && dd === 29 && !isLeapYear(year)) ? 28 : dd;
  let next = new Date(now.getFullYear(), mm - 1, dayFor(now.getFullYear()));
  if (next < todayMidnight) next = new Date(now.getFullYear() + 1, mm - 1, dayFor(now.getFullYear() + 1));
  return next;
}

function daysUntilLabel(daysUntil: number): string {
  if (daysUntil === 0) return "Aujourd'hui";
  if (daysUntil === 1) return 'Demain';
  return `Dans ${daysUntil} jours`;
}

export default function AnniversairesScreen() {
  const navigation = useNavigation<any>();
  const { session } = useSession();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState<BirthdayRow[]>([]);

  const load = useCallback(async () => {
    const userId = session?.user?.id;
    if (!userId) { setLoading(false); return; }

    const { data: followRows } = await supabase
      .from('follows').select('following_id')
      .eq('follower_id', userId).eq('statut', 'accepte');
    const followingIds = (followRows || []).map((f: any) => f.following_id);

    if (!followingIds.length) {
      setRows([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const { data: dogs } = await supabase
      .from('chiens').select('id, nom, user_id, date_naissance_parsed')
      .in('user_id', followingIds).not('date_naissance_parsed', 'is', null);

    if (!dogs?.length) {
      setRows([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const ownerIds = Array.from(new Set(dogs.map((d: any) => d.user_id)));
    const { data: profils } = await supabase
      .from('profils').select('id, prenom, avatar_url').in('id', ownerIds);
    const profilMap = new Map((profils || []).map((p: any) => [p.id, p]));

    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);

    const computed: BirthdayRow[] = dogs.map((d: any) => {
      const next = nextOccurrence(d.date_naissance_parsed);
      const daysUntil = Math.round((next.getTime() - todayMidnight.getTime()) / 86_400_000);
      const owner = profilMap.get(d.user_id);
      return {
        chienId: d.id,
        nomChien: d.nom,
        ownerId: d.user_id,
        ownerPrenom: owner?.prenom || 'un copain',
        ownerAvatarUrl: owner?.avatar_url ?? null,
        daysUntil,
      };
    });

    computed.sort((a, b) => a.daysUntil - b.daysUntil);
    setRows(computed);
    setLoading(false);
    setRefreshing(false);
  }, [session?.user?.id]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.terra} size="large" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.terra} />}
    >
      {!rows.length ? (
        <View style={styles.emptyBox}>
          <Ionicons name="sparkles-outline" size={28} color={colors.textMuted} />
          <Text style={styles.emptyText}>
            Aucun anniversaire à venir parmi les copains que tu suis.
          </Text>
          <Text style={styles.emptySubText}>
            Les chiens dont l'âge est renseigné en années (et non en date) n'apparaissent pas ici.
          </Text>
        </View>
      ) : (
        rows.map(row => (
          <TouchableOpacity
            key={row.chienId}
            style={[styles.card, row.daysUntil === 0 && styles.cardToday]}
            activeOpacity={0.75}
            onPress={() => navigation.navigate('ProfilPublic', { userId: row.ownerId, prenom: row.ownerPrenom, avatarUrl: row.ownerAvatarUrl })}
          >
            {row.ownerAvatarUrl ? (
              <Image source={{ uri: row.ownerAvatarUrl }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarLetter}>{row.ownerPrenom[0]?.toUpperCase() || '?'}</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.dogName}>{row.nomChien}</Text>
              <Text style={styles.ownerName}>chez {row.ownerPrenom}</Text>
            </View>
            <View style={[styles.badge, row.daysUntil === 0 && styles.badgeToday]}>
              <Text style={[styles.badgeText, row.daysUntil === 0 && styles.badgeTextToday]}>
                {daysUntilLabel(row.daysUntil)}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ivoryLight },
  content: { padding: 16, paddingBottom: 40, gap: 10 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ivoryLight },
  emptyBox: { alignItems: 'center', gap: 10, padding: 40 },
  emptyText: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.textMid, textAlign: 'center' },
  emptySubText: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted, textAlign: 'center' },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.border,
    padding: 14,
  },
  cardToday: { borderColor: colors.terra, borderWidth: 1.5 },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarFallback: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.bordeaux,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarLetter: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 16, color: colors.ivory },
  dogName: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 16, color: colors.bordeaux },
  ownerName: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted, marginTop: 1 },
  badge: {
    paddingVertical: 5, paddingHorizontal: 10, borderRadius: 20,
    backgroundColor: colors.ivoryPale, borderWidth: 1, borderColor: colors.border,
  },
  badgeToday: { backgroundColor: colors.terra, borderColor: colors.terra },
  badgeText: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.textMid },
  badgeTextToday: { color: '#fff' },
});
