import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, ActivityIndicator, RefreshControl, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { useSession } from '../hooks/useSession';
import { colors } from '../lib/theme';
import { lireCache, ecrireCache } from '../lib/cacheEcran';

type ActivityType = 'like_post' | 'like_photo' | 'comment_post' | 'comment_photo' | 'follow' | 'birthday';

type ActivityItem = {
  id: string;
  type: ActivityType;
  actorId: string;
  actorPrenom: string;
  actorAvatarUrl: string | null;
  createdAt: string;
  commentContent?: string;
  thumbnailUrl?: string | null;
  chienNom?: string;
  followStatut?: string;
};

function timeAgo(date: string): string {
  const m = Math.floor((Date.now() - new Date(date).getTime()) / 60000);
  if (m < 1) return "À l'instant";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}j`;
  return new Date(date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export function activityLastSeenKey(userId: string) {
  return `activity_last_seen_${userId}`;
}

const TYPE_ICON: Record<ActivityType, { name: React.ComponentProps<typeof Ionicons>['name']; color: string }> = {
  like_post:     { name: 'heart',          color: colors.terra },
  like_photo:    { name: 'heart',          color: colors.terra },
  comment_post:  { name: 'chatbubble',     color: colors.sage },
  comment_photo: { name: 'chatbubble',     color: colors.sage },
  follow:        { name: 'person-add',     color: colors.bordeauxMid },
  birthday:      { name: 'sparkles',       color: colors.terra },
};

function activityLabel(item: ActivityItem): string {
  switch (item.type) {
    case 'like_post':
    case 'like_photo':
      return `${item.actorPrenom} a aimé ta photo`;
    case 'comment_post':
    case 'comment_photo': {
      const content = (item.commentContent || '').slice(0, 60);
      return `${item.actorPrenom} a commenté : "${content}${(item.commentContent?.length || 0) > 60 ? '…' : ''}"`;
    }
    case 'follow':
      return item.followStatut === 'en_attente'
        ? `${item.actorPrenom} souhaite te suivre`
        : `${item.actorPrenom} a commencé à te suivre`;
    case 'birthday':
      return `C'est l'anniversaire de ${item.chienNom} (chez ${item.actorPrenom})`;
  }
}

export default function ActiviteScreen() {
  const navigation = useNavigation<any>();
  const { session } = useSession();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [items, setItems] = useState<ActivityItem[]>([]);

  const load = useCallback(async () => {
    const userId = session?.user?.id;
    if (!userId) { setLoading(false); return; }
    // Affichage immediat de la derniere activite connue, puis mise a jour
    if (!items.length) {
      const enCache = await lireCache<ActivityItem[]>(`activite:${userId}`);
      if (enCache?.length) { setItems(enCache); setLoading(false); }
    }

    // Une seule requete serveur par source (avant : 4 allers-retours, dont un
    // .in() avec tous les posts de l'utilisateur, tres lent pour un gros compte)
    const [{ data: evts, error }, { data: chiens }] = await Promise.all([
      supabase.rpc('mon_activite', { p_limite: 120 }),
      supabase.rpc('anniversaires_suivis'),
    ]);
    if (error) { setLoading(false); setRefreshing(false); return; }

    const merged: ActivityItem[] = (evts || []).map((r: any) => ({
      id: r.id, type: r.type as ActivityType, actorId: r.actor_id,
      actorPrenom: r.actor_prenom || 'Un membre', actorAvatarUrl: r.actor_avatar ?? null,
      createdAt: r.created_at, thumbnailUrl: r.thumbnail ?? null,
      commentContent: r.commentaire ?? undefined, followStatut: r.follow_statut ?? undefined,
    }));

    const now = new Date();
    const mmdd = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    (chiens || []).filter((d: any) => (d.date_naissance || '').slice(5, 10) === mmdd).forEach((d: any) => {
      merged.push({
        id: `birthday_${d.chien_id}`, type: 'birthday', actorId: d.user_id,
        actorPrenom: d.prenom || 'un copain', actorAvatarUrl: d.avatar_url ?? null,
        createdAt: new Date().toISOString(), chienNom: d.nom,
      });
    });

    merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    setItems(merged.slice(0, 80));
    ecrireCache(`activite:${userId}`, merged.slice(0, 80));
    setLoading(false);
    setRefreshing(false);

    AsyncStorage.setItem(activityLastSeenKey(userId), new Date().toISOString()).catch(() => {});
  }, [session?.user?.id]);

  useEffect(() => { load(); }, [load]);

  function onItemPress(item: ActivityItem) {
    navigation.navigate('ProfilPublic', { userId: item.actorId, prenom: item.actorPrenom });
  }

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
      <TouchableOpacity style={styles.birthdaysLink} onPress={() => navigation.navigate('Anniversaires')} activeOpacity={0.8}>
        <View style={[styles.birthdaysLinkIcon, { backgroundColor: TYPE_ICON.birthday.color }]}>
          <Ionicons name={TYPE_ICON.birthday.name} size={12} color="#fff" />
        </View>
        <Text style={styles.birthdaysLinkText}>Voir tous les anniversaires à venir</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      </TouchableOpacity>

      {!items.length ? (
        <View style={styles.emptyBox}>
          <Ionicons name="heart-outline" size={28} color={colors.textMuted} />
          <Text style={styles.emptyText}>Pas encore d'activité. Partage une photo pour commencer !</Text>
        </View>
      ) : (
        items.map(item => {
          const icon = TYPE_ICON[item.type];
          return (
            <TouchableOpacity key={item.id} style={styles.row} activeOpacity={0.75} onPress={() => onItemPress(item)}>
              {item.actorAvatarUrl ? (
                <Image source={{ uri: item.actorAvatarUrl }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarLetter}>{item.actorPrenom[0]?.toUpperCase() || '?'}</Text>
                </View>
              )}
              <View style={[styles.iconBadge, { backgroundColor: icon.color }]}>
                <Ionicons name={icon.name} size={10} color="#fff" />
              </View>
              <View style={{ flex: 1, marginLeft: 4 }}>
                <Text style={styles.rowLabel}>{activityLabel(item)}</Text>
                <Text style={styles.rowTime}>{timeAgo(item.createdAt)}</Text>
              </View>
              {item.thumbnailUrl ? <Image source={{ uri: item.thumbnailUrl }} style={styles.thumb} /> : null}
            </TouchableOpacity>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ivoryLight },
  content: { padding: 16, paddingBottom: 40, gap: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ivoryLight },
  birthdaysLink: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.border,
    padding: 12, marginBottom: 12,
  },
  birthdaysLinkIcon: {
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
  },
  birthdaysLinkText: { flex: 1, fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.bordeaux },
  emptyBox: { alignItems: 'center', gap: 10, padding: 40 },
  emptyText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  row: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.border,
    padding: 10, marginBottom: 8,
  },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  avatarFallback: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.bordeaux,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarLetter: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 14, color: colors.ivory },
  iconBadge: {
    width: 18, height: 18, borderRadius: 9, marginLeft: -12, marginTop: 22,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: colors.white,
  },
  rowLabel: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.textMid },
  rowTime: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted, marginTop: 2 },
  thumb: { width: 40, height: 40, borderRadius: 6, marginLeft: 8 },
});
