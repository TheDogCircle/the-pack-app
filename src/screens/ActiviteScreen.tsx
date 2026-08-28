import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, ActivityIndicator, RefreshControl, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { useSession } from '../hooks/useSession';
import { colors } from '../lib/theme';

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

    const [{ data: myPosts }, { data: myPhotos }] = await Promise.all([
      supabase.from('community_posts').select('id, image_url, images').eq('user_id', userId),
      supabase.from('photos').select('id, url').eq('user_id', userId),
    ]);

    const postThumb = new Map((myPosts || []).map((p: any) => [p.id, (p.images && p.images[0]) || p.image_url || null]));
    const photoThumb = new Map((myPhotos || []).map((p: any) => [p.id, p.url]));
    const myPostIds = Array.from(postThumb.keys());
    const myPhotoIds = Array.from(photoThumb.keys());

    const [
      { data: postLikes },
      { data: photoLikes },
      { data: postComments },
      { data: photoComments },
      { data: followRows },
      { data: followingRows },
    ] = await Promise.all([
      myPostIds.length
        ? supabase.from('community_post_likes').select('id, post_id, user_id, created_at').in('post_id', myPostIds).neq('user_id', userId)
        : Promise.resolve({ data: [] as any[] }),
      myPhotoIds.length
        ? supabase.from('photo_likes').select('id, photo_id, user_id, created_at').in('photo_id', myPhotoIds).neq('user_id', userId)
        : Promise.resolve({ data: [] as any[] }),
      myPostIds.length
        ? supabase.from('community_post_comments').select('id, post_id, user_id, content, created_at').in('post_id', myPostIds).neq('user_id', userId)
        : Promise.resolve({ data: [] as any[] }),
      myPhotoIds.length
        ? supabase.from('photo_comments').select('id, photo_id, user_id, content, created_at').in('photo_id', myPhotoIds).neq('user_id', userId)
        : Promise.resolve({ data: [] as any[] }),
      supabase.from('follows').select('id, follower_id, statut, created_at').eq('following_id', userId),
      supabase.from('follows').select('following_id').eq('follower_id', userId).eq('statut', 'accepte'),
    ]);

    const followingIds = (followingRows || []).map((f: any) => f.following_id);
    let birthdayDogs: { user_id: string; nom: string }[] = [];
    if (followingIds.length) {
      const { data: dogs } = await supabase
        .from('chiens').select('user_id, nom, date_naissance_parsed')
        .in('user_id', followingIds).not('date_naissance_parsed', 'is', null);
      const now = new Date();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      birthdayDogs = (dogs || [])
        .filter((d: any) => d.date_naissance_parsed?.slice(5, 7) === mm && d.date_naissance_parsed?.slice(8, 10) === dd)
        .map((d: any) => ({ user_id: d.user_id, nom: d.nom }));
    }

    const actorIds = new Set<string>();
    (postLikes || []).forEach((r: any) => actorIds.add(r.user_id));
    (photoLikes || []).forEach((r: any) => actorIds.add(r.user_id));
    (postComments || []).forEach((r: any) => actorIds.add(r.user_id));
    (photoComments || []).forEach((r: any) => actorIds.add(r.user_id));
    (followRows || []).forEach((r: any) => actorIds.add(r.follower_id));
    birthdayDogs.forEach(d => actorIds.add(d.user_id));

    const { data: profils } = actorIds.size
      ? await supabase.from('profils').select('id, prenom, avatar_url').in('id', Array.from(actorIds))
      : { data: [] as any[] };
    const profilMap = new Map((profils || []).map((p: any) => [p.id, p]));

    const merged: ActivityItem[] = [];

    (postLikes || []).forEach((r: any) => {
      const p = profilMap.get(r.user_id);
      merged.push({
        id: `like_post_${r.id}`, type: 'like_post', actorId: r.user_id,
        actorPrenom: p?.prenom || 'Un membre', actorAvatarUrl: p?.avatar_url ?? null,
        createdAt: r.created_at, thumbnailUrl: postThumb.get(r.post_id) || null,
      });
    });
    (photoLikes || []).forEach((r: any) => {
      const p = profilMap.get(r.user_id);
      merged.push({
        id: `like_photo_${r.id}`, type: 'like_photo', actorId: r.user_id,
        actorPrenom: p?.prenom || 'Un membre', actorAvatarUrl: p?.avatar_url ?? null,
        createdAt: r.created_at, thumbnailUrl: photoThumb.get(r.photo_id) || null,
      });
    });
    (postComments || []).forEach((r: any) => {
      const p = profilMap.get(r.user_id);
      merged.push({
        id: `comment_post_${r.id}`, type: 'comment_post', actorId: r.user_id,
        actorPrenom: p?.prenom || 'Un membre', actorAvatarUrl: p?.avatar_url ?? null,
        createdAt: r.created_at, thumbnailUrl: postThumb.get(r.post_id) || null, commentContent: r.content,
      });
    });
    (photoComments || []).forEach((r: any) => {
      const p = profilMap.get(r.user_id);
      merged.push({
        id: `comment_photo_${r.id}`, type: 'comment_photo', actorId: r.user_id,
        actorPrenom: p?.prenom || 'Un membre', actorAvatarUrl: p?.avatar_url ?? null,
        createdAt: r.created_at, thumbnailUrl: photoThumb.get(r.photo_id) || null, commentContent: r.content,
      });
    });
    (followRows || []).forEach((r: any) => {
      const p = profilMap.get(r.follower_id);
      merged.push({
        id: `follow_${r.id}`, type: 'follow', actorId: r.follower_id,
        actorPrenom: p?.prenom || 'Un membre', actorAvatarUrl: p?.avatar_url ?? null,
        createdAt: r.created_at, followStatut: r.statut,
      });
    });
    birthdayDogs.forEach(d => {
      const p = profilMap.get(d.user_id);
      merged.push({
        id: `birthday_${d.user_id}_${d.nom}`, type: 'birthday', actorId: d.user_id,
        actorPrenom: p?.prenom || 'un copain', actorAvatarUrl: p?.avatar_url ?? null,
        createdAt: new Date().toISOString(), chienNom: d.nom,
      });
    });

    merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    setItems(merged.slice(0, 80));
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
