import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl, Image, TextInput, Modal,
  ScrollView, Dimensions,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import { useSession } from '../hooks/useSession';
import AuthGate from '../components/AuthGate';
import { mapNavigation } from '../lib/mapNavigation';
import MessagerieScreen from './MessagerieScreen';

type Evenement = {
  id: string;
  titre: string;
  description: string | null;
  date_heure: string;
  adresse: string | null;
  ville: string;
  lat: number | null;
  lng: number | null;
  max_participants: number | null;
  payant: boolean;
  prix: number | null;
  image_url: string | null;
  profils: { username: string; avatar_url: string | null } | null;
  nb_inscrits?: number;
  je_suis_inscrit?: boolean;
};

type FeedItem = {
  id: string;
  type: 'avis' | 'favori' | 'membre' | 'photo' | 'lieu';
  lieuId?: string;
  isNew?: boolean;
  user: { id: string; prenom: string; avatar_url: string | null; username?: string | null };
  lieu: { nom: string; ville: string; cat: string };
  note?: number;
  commentaire?: string;
  photoUrl?: string;
  nomChien?: string | null;
  nbAvis?: number;
  created_at: string;
  extra?: string;
};

const CAT_EMOJI: Record<string, string> = {
  restaurant: '🍽️', cafe: '☕', hotel: '🏨', parc: '🌳',
  plage: '🌊', veto: '🩺', parc_chien: '🐾', toiletteur: '✂️', boutique: '🛍️',
  bar: '🍺', autre: '📍',
};

export default function FeedScreen() {
  const navigation = useNavigation<any>();
  const { session, loading: sessionLoading } = useSession();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'activite' | 'explorer' | 'membres' | 'messages'>('activite');
  const [searchMembre, setSearchMembre] = useState('');
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [photoLikesCount, setPhotoLikesCount] = useState<Record<string, number>>({});
  const [photoLikedByMe, setPhotoLikedByMe] = useState<Set<string>>(new Set());
  const [membresFollowing, setMembresFollowing] = useState<Set<string>>(new Set());
  const [membresMutual, setMembresMutual] = useState<Record<string, number>>({});

  useEffect(() => { load(); }, [tab, session?.user?.id]);

  useEffect(() => {
    if (tab !== 'messages') {
      navigation.setOptions({ title: 'Meute', headerLeft: undefined });
    }
  }, [tab]);

  async function load() {
    if (tab === 'messages') return;
    setLoading(true);
    if (tab === 'activite') await loadActivite();
    else if (tab === 'explorer') await loadExplorer();
    else if (tab === 'membres') await loadMembres();
    setLoading(false);
  }

  async function loadActivite() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    setMyUserId(session.user.id);

    const { data: follows } = await supabase.from('follows').select('following_id')
      .eq('follower_id', session.user.id).eq('statut', 'accepte');
    const ids = [...(follows?.map((f: any) => f.following_id) || []), session.user.id];

    // Étape 1 : récupérer les données brutes (sans joins PostgREST)
    const since30days = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const [{ data: avis }, { data: favoris }, { data: photoData }, { data: newLieux }] = await Promise.all([
      supabase.from('avis').select('id,note,commentaire,created_at,user_id,lieu_id')
        .in('user_id', ids).order('created_at', { ascending: false }).limit(30),
      supabase.from('favoris').select('id,created_at,user_id,lieu_id')
        .in('user_id', ids).order('created_at', { ascending: false }).limit(30),
      supabase.from('photos').select('id,url,created_at,user_id,lieu_id,nom_chien')
        .in('user_id', ids).eq('validee', true).order('created_at', { ascending: false }).limit(20),
      supabase.from('lieux').select('id,nom,ville,cat,note_moyenne,nb_avis,created_at')
        .eq('actif', true).gte('created_at', since30days)
        .order('created_at', { ascending: false }).limit(10),
    ]);

    // Étape 2 : récupérer profils et lieux séparément
    const allUserIds = [...new Set([
      ...(avis || []).map((a: any) => a.user_id),
      ...(favoris || []).map((f: any) => f.user_id),
      ...(photoData || []).map((p: any) => p.user_id),
    ].filter(Boolean))];
    const allLieuIds = [...new Set([
      ...(avis || []).map((a: any) => a.lieu_id),
      ...(favoris || []).map((f: any) => f.lieu_id),
      ...(photoData || []).map((p: any) => p.lieu_id),
    ].filter(Boolean))];

    const [{ data: profils }, { data: lieux }] = await Promise.all([
      allUserIds.length > 0 ? supabase.from('profils').select('id,prenom,avatar_url,username').in('id', allUserIds) : Promise.resolve({ data: [] }),
      allLieuIds.length > 0 ? supabase.from('lieux').select('id,nom,ville,cat').in('id', allLieuIds) : Promise.resolve({ data: [] }),
    ]);

    const profilMap: Record<string, any> = {};
    (profils || []).forEach((p: any) => { profilMap[p.id] = p; });
    const lieuMap: Record<string, any> = {};
    (lieux || []).forEach((l: any) => { lieuMap[l.id] = l; });

    const merged: FeedItem[] = [
      ...(avis || []).map((a: any) => ({
        id: 'a-' + a.id, type: 'avis' as const,
        lieuId: a.lieu_id,
        user: { id: a.user_id, prenom: profilMap[a.user_id]?.prenom || 'Membre', avatar_url: profilMap[a.user_id]?.avatar_url || null, username: profilMap[a.user_id]?.username || null },
        lieu: lieuMap[a.lieu_id] || { nom: '?', ville: '', cat: 'autre' },
        note: a.note, commentaire: a.commentaire, created_at: a.created_at,
      })),
      ...(favoris || []).map((f: any) => ({
        id: 'f-' + f.id, type: 'favori' as const,
        lieuId: f.lieu_id,
        user: { id: f.user_id, prenom: profilMap[f.user_id]?.prenom || 'Membre', avatar_url: profilMap[f.user_id]?.avatar_url || null },
        lieu: lieuMap[f.lieu_id] || { nom: '?', ville: '', cat: 'autre' },
        created_at: f.created_at,
      })),
      ...(photoData || []).map((p: any) => ({
        id: 'p-' + p.id, type: 'photo' as const,
        lieuId: p.lieu_id,
        user: { id: p.user_id, prenom: profilMap[p.user_id]?.prenom || 'Membre', avatar_url: profilMap[p.user_id]?.avatar_url || null, username: profilMap[p.user_id]?.username || null },
        lieu: lieuMap[p.lieu_id] || { nom: '?', ville: '', cat: 'autre' },
        photoUrl: p.url, nomChien: p.nom_chien || null, created_at: p.created_at,
      })),
      ...(newLieux || []).map((l: any) => ({
        id: 'l-' + l.id, type: 'lieu' as const,
        lieuId: l.id, isNew: true,
        user: { id: l.id, prenom: 'Nouveau lieu', avatar_url: null },
        lieu: { nom: l.nom, ville: l.ville || '', cat: l.cat || 'autre' },
        note: l.note_moyenne ?? undefined,
        nbAvis: l.nb_avis ?? undefined,
        created_at: l.created_at,
      })),
    ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    setItems(merged);

    const photoIds = (photoData || []).map((p: any) => p.id);
    if (photoIds.length > 0) {
      const [{ data: allLikes }, { data: myLikes }] = await Promise.all([
        supabase.from('photo_likes').select('photo_id').in('photo_id', photoIds),
        supabase.from('photo_likes').select('photo_id').in('photo_id', photoIds).eq('user_id', session.user.id),
      ]);
      const countMap: Record<string, number> = {};
      (allLikes || []).forEach((l: any) => countMap[l.photo_id] = (countMap[l.photo_id] || 0) + 1);
      setPhotoLikesCount(countMap);
      setPhotoLikedByMe(new Set((myLikes || []).map((l: any) => l.photo_id)));
    }
  }

  async function togglePhotoLike(photoId: string) {
    if (!myUserId) return;
    const isLiked = photoLikedByMe.has(photoId);
    if (isLiked) {
      await supabase.from('photo_likes').delete().eq('photo_id', photoId).eq('user_id', myUserId);
      setPhotoLikedByMe(prev => { const s = new Set(prev); s.delete(photoId); return s; });
      setPhotoLikesCount(prev => ({ ...prev, [photoId]: Math.max(0, (prev[photoId] || 0) - 1) }));
    } else {
      await supabase.from('photo_likes').insert({ photo_id: photoId, user_id: myUserId });
      setPhotoLikedByMe(prev => { const s = new Set(prev); s.add(photoId); return s; });
      setPhotoLikesCount(prev => ({ ...prev, [photoId]: (prev[photoId] || 0) + 1 }));
    }
  }

  async function loadExplorer() {
    const { data } = await supabase.from('lieux')
      .select('id,nom,ville,cat,note_moyenne,nb_avis')
      .eq('actif', true)
      .not('nb_avis', 'is', null)
      .order('nb_avis', { ascending: false })
      .limit(30);
    setItems((data || []).map((l: any) => ({
      id: 'e-' + l.id, type: 'lieu' as const,
      lieuId: l.id,
      user: { id: l.id, prenom: l.nom, avatar_url: null },
      lieu: { nom: l.nom, ville: l.ville || '', cat: l.cat || 'autre' },
      note: l.note_moyenne ?? undefined,
      nbAvis: l.nb_avis ?? undefined,
      created_at: new Date().toISOString(),
    })));
  }

  async function loadMembres() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const myId = session.user.id;
    setMyUserId(myId);

    const [{ data: membresData }, { data: myFollowsData }] = await Promise.all([
      supabase.from('profils').select('id,prenom,avatar_url,ville,nom_chien')
        .neq('id', myId).not('prenom', 'is', null).limit(50),
      supabase.from('follows').select('following_id').eq('follower_id', myId).eq('statut', 'accepte'),
    ]);

    if (!membresData?.length) { setItems([]); return; }

    const myFollowingSet = new Set((myFollowsData || []).map((f: any) => f.following_id));
    const memberIds = membresData.map((m: any) => m.id);

    const { data: memberFollowsData } = await supabase.from('follows')
      .select('follower_id,following_id').in('follower_id', memberIds).eq('statut', 'accepte');

    const mutualMap: Record<string, number> = {};
    (memberFollowsData || []).forEach((f: any) => {
      if (myFollowingSet.has(f.following_id)) {
        mutualMap[f.follower_id] = (mutualMap[f.follower_id] || 0) + 1;
      }
    });

    setMembresFollowing(new Set(memberIds.filter((id: string) => myFollowingSet.has(id))));
    setMembresMutual(mutualMap);
    setItems(membresData.map((p: any) => ({
      id: 'm-' + p.id, type: 'membre' as const,
      user: { id: p.id, prenom: p.prenom || 'Membre', avatar_url: p.avatar_url },
      lieu: { nom: p.nom_chien || '', ville: p.ville || '', cat: 'autre' },
      created_at: new Date().toISOString(),
      extra: p.ville,
    })));
  }

  async function toggleMemberFollow(memberId: string) {
    if (!myUserId) return;
    const isFollowing = membresFollowing.has(memberId);
    if (isFollowing) {
      await supabase.from('follows').delete().eq('follower_id', myUserId).eq('following_id', memberId);
      setMembresFollowing(prev => { const s = new Set(prev); s.delete(memberId); return s; });
    } else {
      await supabase.from('follows').insert({ follower_id: myUserId, following_id: memberId, statut: 'accepte' });
      setMembresFollowing(prev => new Set([...prev, memberId]));
    }
  }

  function timeAgo(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const h = Math.floor(diff / 3600000);
    if (h < 1) return "À l'instant";
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}j`;
    return new Date(dateStr).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  }

  function Avatar({ user }: { user: FeedItem['user'] }) {
    return (
      <View style={styles.avatarWrap}>
        {user.avatar_url ? (
          <Image source={{ uri: user.avatar_url }} style={styles.avatarImg} />
        ) : (
          <View style={styles.avatarFallback}>
            <Text style={styles.avatarLetter}>{(user.prenom || '?')[0].toUpperCase()}</Text>
          </View>
        )}
      </View>
    );
  }

  const BADGE_CONFIG: Record<string, { color: string; icon: React.ComponentProps<typeof Ionicons>['name'] }> = {
    avis:   { color: colors.terra,   icon: 'star' },
    favori: { color: '#E91E63',       icon: 'heart' },
    photo:  { color: '#0288D1',       icon: 'camera' },
  };

  function renderItem({ item }: { item: FeedItem }) {
    const isMembre = item.type === 'membre';
    const isPhoto = item.type === 'photo';
    const isLieu = item.type === 'lieu';
    const badgeCfg = BADGE_CONFIG[item.type];

    if (isLieu) {
      return (
        <TouchableOpacity
          style={[styles.card, styles.lieuCard]}
          activeOpacity={0.8}
          onPress={() => {
            if (item.lieuId) {
              mapNavigation.setPendingLieu(item.lieuId);
              navigation.navigate('Tabs', { screen: 'Carte' });
            }
          }}
        >
          <View style={styles.lieuEmoji}>
            <Text style={{ fontSize: 22 }}>{CAT_EMOJI[item.lieu.cat] || '📍'}</Text>
          </View>
          <View style={styles.body}>
            {item.isNew && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <View style={styles.newLieuBadge}>
                  <Ionicons name="add-circle-outline" size={11} color={colors.terra} />
                  <Text style={styles.newLieuBadgeText}>Nouveau lieu</Text>
                </View>
                <Text style={styles.time}>{timeAgo(item.created_at)}</Text>
              </View>
            )}
            <Text style={styles.lieuCardName} numberOfLines={1}>{item.lieu.nom}</Text>
            <Text style={styles.ville}>{item.lieu.ville}</Text>
            {item.note ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                {[1,2,3,4,5].map(i => (
                  <Ionicons key={i} name={i <= Math.round(item.note!) ? 'star' : 'star-outline'} size={11} color={colors.terra} />
                ))}
                <Text style={styles.lieuAvisCount}>{item.note.toFixed(1)}</Text>
                {item.nbAvis ? <Text style={styles.lieuAvisCount}>· {item.nbAvis} avis</Text> : null}
              </View>
            ) : null}
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      );
    }

    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.85}
        onPress={() => navigation.navigate('ProfilPublic', {
          userId: item.user.id, prenom: item.user.prenom, avatarUrl: item.user.avatar_url,
        })}
      >
        <View style={styles.avatarContainer}>
          <Avatar user={item.user} />
          {!isMembre && badgeCfg && (
            <View style={[styles.badge, { backgroundColor: badgeCfg.color }]}>
              <Ionicons name={badgeCfg.icon} size={9} color="#fff" />
            </View>
          )}
        </View>

        <View style={styles.body}>
          {isMembre ? (
            <>
              <Text style={styles.memberName}>{item.user.prenom}</Text>
              {item.lieu.ville ? <Text style={styles.ville}>{item.lieu.ville}</Text> : null}
              {item.lieu.nom ? <Text style={styles.dogInfo}>🐾 {item.lieu.nom}</Text> : null}
              {(membresMutual[item.user.id] || 0) > 0 && (
                <View style={styles.mutualRow}>
                  <Ionicons name="people-outline" size={12} color={colors.terra} />
                  <Text style={styles.mutualText}>
                    {membresMutual[item.user.id]} ami{membresMutual[item.user.id] > 1 ? 's' : ''} en commun
                  </Text>
                </View>
              )}
            </>
          ) : (
            <>
              <Text style={styles.text}>
                <Text style={styles.bold}>{item.user.prenom}</Text>
                {item.user.username ? <Text style={styles.username}> @{item.user.username}</Text> : null}
                {item.type === 'avis' ? ' a noté ' : item.type === 'photo' ? ' a partagé une photo de ' : ' a ajouté aux favoris '}
                <Text
                  style={[styles.lieuName, item.lieuId && { textDecorationLine: 'underline' }]}
                  onPress={() => { if (item.lieuId) { mapNavigation.setPendingLieu(item.lieuId); navigation.navigate('Tabs', { screen: 'Carte' }); } }}
                >
                  {CAT_EMOJI[item.lieu.cat] || '📍'} {item.lieu.nom}
                </Text>
              </Text>
              {item.lieu.ville ? <Text style={styles.ville}>{item.lieu.ville}</Text> : null}
              {item.note ? (
                <View style={styles.starsRow}>
                  {[1,2,3,4,5].map(i => (
                    <Ionicons key={i} name={i <= item.note! ? 'star' : 'star-outline'} size={12} color={colors.terra} />
                  ))}
                </View>
              ) : null}
              {item.commentaire ? (
                <Text style={styles.comment} numberOfLines={2}>{item.commentaire}</Text>
              ) : null}
              {isPhoto && item.photoUrl ? (
                <>
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={(e) => {
                      e.stopPropagation?.();
                      if (item.lieuId) { mapNavigation.setPendingLieu(item.lieuId); navigation.navigate('Tabs', { screen: 'Carte' }); }
                    }}
                  >
                    <Image source={{ uri: item.photoUrl }} style={styles.feedPhoto} />
                  </TouchableOpacity>
                  {item.nomChien && (
                    <View style={styles.feedDogTag}>
                      <Text style={styles.feedDogTagText}>🐾 {item.nomChien}</Text>
                    </View>
                  )}
                  <TouchableOpacity
                    style={styles.likeBtn}
                    onPress={(e) => { e.stopPropagation?.(); togglePhotoLike(item.id.replace('p-', '')); }}
                  >
                    <Ionicons
                      name={photoLikedByMe.has(item.id.replace('p-', '')) ? 'heart' : 'heart-outline'}
                      size={16}
                      color={photoLikedByMe.has(item.id.replace('p-', '')) ? '#E05070' : colors.textMuted}
                    />
                    {(photoLikesCount[item.id.replace('p-', '')] || 0) > 0 && (
                      <Text style={[styles.likeCount, photoLikedByMe.has(item.id.replace('p-', '')) && { color: '#E05070' }]}>
                        {photoLikesCount[item.id.replace('p-', '')]}
                      </Text>
                    )}
                  </TouchableOpacity>
                </>
              ) : null}
              <Text style={styles.time}>{timeAgo(item.created_at)}</Text>
            </>
          )}
        </View>

        {isMembre && (
          <TouchableOpacity
            style={[styles.followBtn, membresFollowing.has(item.user.id) && styles.followBtnActive]}
            onPress={e => { e.stopPropagation?.(); toggleMemberFollow(item.user.id); }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[styles.followBtnText, membresFollowing.has(item.user.id) && styles.followBtnTextActive]}>
              {membresFollowing.has(item.user.id) ? 'Suivi ✓' : 'Suivre'}
            </Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  }

  if (sessionLoading) return <ActivityIndicator style={{ flex: 1 }} color={colors.terra} />;
  if (!session) return <AuthGate navigation={navigation} message="Connecte-toi pour voir les activités de la meute, explorer les lieux et suivre d'autres membres." />;

  return (
    <View style={styles.container}>
      <View style={styles.tabsWrap}>
        {([
          { key: 'activite', label: 'Activité' },
          { key: 'explorer', label: 'Explorer' },
          { key: 'membres',  label: 'Membres' },
          { key: 'messages', label: 'Chat' },
        ] as const).map(t => (
          <TouchableOpacity key={t.key} style={[styles.tab, tab === t.key && styles.tabActive]} onPress={() => setTab(t.key as any)}>
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]} numberOfLines={1}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'messages' ? (
        <MessagerieScreen />
      ) : loading ? (
        <ActivityIndicator style={{ flex: 1 }} color={colors.terra} />
      ) : (
        <FlatList
          data={tab === 'membres' && searchMembre.length > 0
            ? items.filter(i => i.user.prenom.toLowerCase().includes(searchMembre.toLowerCase()) || (i.extra || '').toLowerCase().includes(searchMembre.toLowerCase()))
            : items
          }
          keyExtractor={i => i.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.terra} />
          }
          ListHeaderComponent={tab === 'membres' ? (
            <View style={styles.searchBar}>
              <Ionicons name="search" size={15} color={colors.textMuted} />
              <TextInput
                style={styles.searchInput}
                placeholder="Rechercher un membre…"
                placeholderTextColor={colors.textMuted}
                value={searchMembre}
                onChangeText={setSearchMembre}
              />
              {searchMembre.length > 0 && (
                <TouchableOpacity onPress={() => setSearchMembre('')}>
                  <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>
          ) : null}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>🐾</Text>
              <Text style={styles.emptyText}>
                {tab === 'activite' ? "Suis des membres pour voir leur activité ici." : tab === 'explorer' ? "Aucun lieu à afficher pour l'instant." : "Aucun membre pour l'instant."}
              </Text>
            </View>
          }
        />
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ivoryPale },
  header: { backgroundColor: colors.bordeaux, paddingHorizontal: 20, paddingTop: 56, paddingBottom: 16 },
  title: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 24, color: colors.ivory },
  tabsScroll: { maxHeight: 56, marginHorizontal: 16, marginVertical: 12 },
  tabsWrap: {
    flexDirection: 'row', backgroundColor: colors.white,
    borderRadius: 12, padding: 4, borderWidth: 1, borderColor: colors.border,
    marginHorizontal: 16, marginVertical: 12,
  },
  tabs: {
    flexDirection: 'row', backgroundColor: colors.white,
    borderRadius: 12, padding: 4, borderWidth: 1, borderColor: colors.border,
  },
  tab: { flex: 1, paddingVertical: 9, paddingHorizontal: 4, borderRadius: 8, alignItems: 'center' },
  tabActive: { backgroundColor: colors.bordeaux },
  tabText: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.textMuted },
  tabTextActive: { color: colors.ivory },
  list: { paddingHorizontal: 16, gap: 10, paddingBottom: 20 },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.white, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: colors.border, marginBottom: 4,
  },
  searchInput: { flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.bordeaux },
  card: {
    backgroundColor: colors.white, borderRadius: 14, padding: 14,
    flexDirection: 'row', gap: 12, alignItems: 'flex-start',
    borderWidth: 1, borderColor: colors.border,
  },
  lieuCard: { alignItems: 'center' },
  lieuEmoji: {
    width: 44, height: 44, borderRadius: 10, backgroundColor: colors.ivoryPale,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  lieuCardName: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.bordeaux, marginBottom: 2 },
  lieuAvisCount: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted },
  avatarContainer: { position: 'relative' },
  avatarWrap: {},
  avatarImg: { width: 44, height: 44, borderRadius: 22 },
  avatarFallback: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.bordeaux, alignItems: 'center', justifyContent: 'center',
  },
  avatarLetter: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: colors.ivory },
  badge: {
    position: 'absolute', bottom: -2, right: -2,
    width: 18, height: 18, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: colors.white,
  },
  body: { flex: 1 },
  memberName: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.bordeaux, marginBottom: 2 },
  text: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMid, lineHeight: 19, marginBottom: 3 },
  bold: { fontFamily: 'DMSans_500Medium', color: colors.bordeaux },
  username: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.terra },
  lieuName: { fontFamily: 'DMSans_500Medium', color: colors.terra },
  ville: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted, marginBottom: 2 },
  dogInfo: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted },
  mutualRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  mutualText: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.terra },
  followBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: colors.bordeaux },
  followBtnActive: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.bordeaux },
  followBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: '#fff' },
  followBtnTextActive: { color: colors.bordeaux },
  starsRow: { flexDirection: 'row', gap: 2, marginVertical: 3 },
  comment: {
    fontFamily: 'DMSans_300Light', fontSize: 12, color: colors.textMid, fontStyle: 'italic',
    backgroundColor: colors.ivoryPale, padding: 8, borderRadius: 6, marginBottom: 4, lineHeight: 17,
  },
  feedPhoto: { width: '100%', height: 180, borderRadius: 10, marginTop: 6, backgroundColor: colors.border },
  feedDogTag: {
    alignSelf: 'flex-start', marginTop: 5,
    backgroundColor: colors.bordeaux + '12', borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: colors.bordeaux + '25',
  },
  feedDogTagText: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.bordeaux },
  likeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2, marginTop: 4 },
  likeCount: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted },
  time: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted, marginTop: 2 },
  newLieuBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.terra + '15', borderRadius: 10,
    paddingHorizontal: 7, paddingVertical: 2,
  },
  newLieuBadgeText: { fontFamily: 'DMSans_500Medium', fontSize: 10, color: colors.terra },
  empty: { alignItems: 'center', padding: 48 },
  emptyIcon: { fontSize: 40, marginBottom: 12 },
  emptyText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted, textAlign: 'center', lineHeight: 20 },

  // Events
  eventCard: { backgroundColor: colors.white, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  eventImage: { width: '100%', height: 150, resizeMode: 'cover' },
  eventImagePlaceholder: { width: '100%', height: 80, backgroundColor: colors.bordeaux + '15', alignItems: 'center', justifyContent: 'center' },
  eventBody: { padding: 14 },
  eventTitle: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: colors.bordeaux, flex: 1, lineHeight: 21 },
  eventDate: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted, marginBottom: 3 },
  eventLocation: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted },
  eventOrga: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.terra },
  eventCount: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted },
  urgencyBadge: { backgroundColor: '#fff3e0', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  urgencyText: { fontFamily: 'DMSans_500Medium', fontSize: 10, color: '#e65100' },
  paidBadge: { backgroundColor: '#fce4ec', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  paidText: { fontFamily: 'DMSans_500Medium', fontSize: 10, color: '#c62828' },
  freeBadge: { backgroundColor: '#e8f5e9', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  freeText: { fontFamily: 'DMSans_500Medium', fontSize: 10, color: '#2e7d32' },
  countBadge: { backgroundColor: colors.ivoryPale, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  countBadgeText: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted },

  // Event Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '90%' },
  modalClose: { position: 'absolute', top: 14, right: 14, zIndex: 10, padding: 4 },
  modalImage: { width: '100%', height: 200, resizeMode: 'cover' },
  modalContent: { padding: 20, paddingBottom: 40 },
  modalTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 20, color: colors.bordeaux, marginBottom: 10, lineHeight: 28 },
  modalInfoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  modalInfoIcon: { fontSize: 18, lineHeight: 22 },
  modalInfoMain: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.textMid },
  modalInfoSub: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted },
  modalDesc: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.textMid, lineHeight: 22, marginBottom: 20 },
  joinBtn: { backgroundColor: colors.bordeaux, borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 8 },
  joinBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: colors.ivory },
  cancelBtn: { backgroundColor: '#fff3e0', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 8, borderWidth: 1, borderColor: '#ffcc80' },
  cancelBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: '#e65100' },
  fullBadge: { backgroundColor: colors.ivoryPale, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 8 },
  fullText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted },
});
