import React, { useEffect, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl, Image, TextInput, Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import { useSession } from '../hooks/useSession';
import AuthGate from '../components/AuthGate';
import { AmbassadeurBadge, ExplorateurBadge } from '../components/AmbassadeurBadge';
import MessagerieScreen from './MessagerieScreen';

type MembreItem = {
  id: string;
  type: 'membre';
  user: {
    id: string;
    prenom: string;
    avatar_url: string | null;
    ambassadeur?: boolean | null;
    explorateur?: boolean | null;
  };
  ville: string | null;
  nomChien: string | null;
};

export default function FeedScreen() {
  const navigation = useNavigation<any>();
  const { session, loading: sessionLoading } = useSession();
  const [membres, setMembres] = useState<MembreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'messages' | 'membres'>('messages');
  const [search, setSearch] = useState('');
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [following, setFollowing] = useState<Set<string>>(new Set());
  const [mutuals, setMutuals] = useState<Record<string, number>>({});

  useEffect(() => {
    if (tab !== 'messages') loadMembres();
  }, [tab, session?.user?.id]);

  useEffect(() => {
    if (tab !== 'messages') {
      navigation.setOptions({ title: 'Meute', headerLeft: undefined });
    }
  }, [tab]);

  async function loadMembres() {
    setLoading(true);
    const { data: { session: s } } = await supabase.auth.getSession();
    if (!s) { setLoading(false); return; }
    const myId = s.user.id;
    setMyUserId(myId);

    const [{ data: membresData }, { data: myFollowsData }, { data: explorateurRows }] = await Promise.all([
      supabase.from('profils').select('id,prenom,avatar_url,ville,nom_chien,ambassadeur')
        .neq('id', myId).not('prenom', 'is', null).limit(50),
      supabase.from('follows').select('following_id').eq('follower_id', myId).eq('statut', 'accepte'),
      supabase.from('explorateurs').select('user_id').eq('statut', 'actif').not('user_id', 'is', null),
    ]);
    const expIds = new Set((explorateurRows || []).map((e: any) => e.user_id));
    if (!membresData?.length) { setMembres([]); setLoading(false); return; }

    const myFollowingSet = new Set((myFollowsData || []).map((f: any) => f.following_id));
    const memberIds = membresData.map((m: any) => m.id);

    const { data: memberFollowsData } = await supabase.from('follows')
      .select('follower_id,following_id').in('follower_id', memberIds).eq('statut', 'accepte');

    const mutualMap: Record<string, number> = {};
    (memberFollowsData || []).forEach((f: any) => {
      if (myFollowingSet.has(f.following_id))
        mutualMap[f.follower_id] = (mutualMap[f.follower_id] || 0) + 1;
    });

    setFollowing(new Set(memberIds.filter((id: string) => myFollowingSet.has(id))));
    setMutuals(mutualMap);
    setMembres(membresData.map((p: any) => ({
      id: p.id, type: 'membre' as const,
      user: { id: p.id, prenom: p.prenom || 'Membre', avatar_url: p.avatar_url, ambassadeur: p.ambassadeur || null, explorateur: expIds.has(p.id) },
      ville: p.ville || null,
      nomChien: p.nom_chien || null,
    })));
    setLoading(false);
  }

  async function toggleFollow(memberId: string) {
    if (!myUserId) return;
    if (following.has(memberId)) {
      const { error } = await supabase.from('follows').delete().eq('follower_id', myUserId).eq('following_id', memberId);
      if (error) { Alert.alert('Erreur', error.message); return; }
      setFollowing(prev => { const s = new Set(prev); s.delete(memberId); return s; });
    } else {
      const { error } = await supabase.from('follows').insert({ follower_id: myUserId, following_id: memberId, statut: 'accepte' });
      if (error) { Alert.alert('Erreur', error.message); return; }
      setFollowing(prev => new Set([...prev, memberId]));
    }
  }

  function Avatar({ user }: { user: MembreItem['user'] }) {
    return user.avatar_url ? (
      <Image source={{ uri: user.avatar_url }} style={styles.avatarImg} />
    ) : (
      <View style={styles.avatarFallback}>
        <Text style={styles.avatarLetter}>{(user.prenom || '?')[0].toUpperCase()}</Text>
      </View>
    );
  }

  const filtered = search.length > 0
    ? membres.filter(m =>
        m.user.prenom.toLowerCase().includes(search.toLowerCase()) ||
        (m.ville || '').toLowerCase().includes(search.toLowerCase())
      )
    : membres;

  if (sessionLoading) return <ActivityIndicator style={{ flex: 1 }} color={colors.terra} />;
  if (!session) return (
    <AuthGate navigation={navigation} message="Connecte-toi pour rejoindre la meute, chatter et découvrir d'autres membres." />
  );

  return (
    <View style={styles.container}>
      <View style={styles.tabsWrap}>
        {([
          { key: 'messages', label: 'Chat' },
          { key: 'membres',  label: 'Membres' },
        ] as const).map(t => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, tab === t.key && styles.tabActive]}
            onPress={() => setTab(t.key)}
          >
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'messages' ? (
        <MessagerieScreen />
      ) : loading ? (
        <ActivityIndicator style={{ flex: 1 }} color={colors.terra} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={m => m.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => { setRefreshing(true); await loadMembres(); setRefreshing(false); }}
              tintColor={colors.terra}
            />
          }
          ListHeaderComponent={
            <View style={styles.searchBar}>
              <Ionicons name="search" size={15} color={colors.textMuted} />
              <TextInput
                style={styles.searchInput}
                placeholder="Rechercher un membre…"
                placeholderTextColor={colors.textMuted}
                value={search}
                onChangeText={setSearch}
              />
              {search.length > 0 && (
                <TouchableOpacity onPress={() => setSearch('')}>
                  <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>🐾</Text>
              <Text style={styles.emptyText}>Aucun membre pour l'instant.</Text>
            </View>
          }
          renderItem={({ item: m }) => (
            <TouchableOpacity
              style={styles.card}
              activeOpacity={0.85}
              onPress={() => navigation.navigate('ProfilPublic', {
                userId: m.user.id, prenom: m.user.prenom, avatarUrl: m.user.avatar_url,
              })}
            >
              <Avatar user={m.user} />

              <View style={styles.body}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text style={styles.memberName}>{m.user.prenom}</Text>
                  {m.user.ambassadeur ? <AmbassadeurBadge /> : null}
                  {m.user.explorateur ? <ExplorateurBadge /> : null}
                </View>
                {m.ville ? <Text style={styles.ville}>{m.ville}</Text> : null}
                {m.nomChien ? <Text style={styles.dogInfo}>🐾 {m.nomChien}</Text> : null}
                {(mutuals[m.user.id] || 0) > 0 && (
                  <View style={styles.mutualRow}>
                    <Ionicons name="people-outline" size={12} color={colors.terra} />
                    <Text style={styles.mutualText}>
                      {mutuals[m.user.id]} ami{mutuals[m.user.id] > 1 ? 's' : ''} en commun
                    </Text>
                  </View>
                )}
              </View>

              <TouchableOpacity
                style={[styles.followBtn, following.has(m.user.id) && styles.followBtnActive]}
                onPress={e => { e.stopPropagation?.(); toggleFollow(m.user.id); }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={[styles.followBtnText, following.has(m.user.id) && styles.followBtnTextActive]}>
                  {following.has(m.user.id) ? 'Suivi ✓' : 'Suivre'}
                </Text>
              </TouchableOpacity>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ivoryPale },
  tabsWrap: {
    flexDirection: 'row', backgroundColor: colors.white,
    borderRadius: 12, padding: 4, borderWidth: 1, borderColor: colors.border,
    marginHorizontal: 16, marginVertical: 12,
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
    flexDirection: 'row', gap: 12, alignItems: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  avatarImg: { width: 44, height: 44, borderRadius: 22 },
  avatarFallback: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.bordeaux, alignItems: 'center', justifyContent: 'center',
  },
  avatarLetter: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: colors.ivory },
  body: { flex: 1 },
  memberName: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.bordeaux },
  ville: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted, marginTop: 1 },
  dogInfo: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted, marginTop: 1 },
  mutualRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  mutualText: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.terra },
  followBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: colors.bordeaux },
  followBtnActive: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.bordeaux },
  followBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: '#fff' },
  followBtnTextActive: { color: colors.bordeaux },
  empty: { alignItems: 'center', padding: 48 },
  emptyIcon: { fontSize: 40, marginBottom: 12 },
  emptyText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted, textAlign: 'center', lineHeight: 20 },
});
