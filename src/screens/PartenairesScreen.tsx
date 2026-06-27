import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Image, Linking, ActivityIndicator, RefreshControl, Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import { useSession } from '../hooks/useSession';
import AuthGate from '../components/AuthGate';

const W = Dimensions.get('window').width;

const TYPE_CONFIG: Record<string, { label: string; bg: string; text: string; icon: string }> = {
  offre:     { label: 'Offre exclusive', bg: colors.terra,    text: '#fff',           icon: '✦' },
  news:      { label: 'Actualité',       bg: colors.bordeaux, text: '#fff',           icon: '·' },
  nouveaute: { label: 'Nouveauté',       bg: '#5A9E6F',       text: '#fff',           icon: '★' },
};

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

type Post = {
  id: string; titre: string; contenu: string | null; type: string;
  image_url: string | null; lien: string | null;
  date_debut: string | null; date_expiration: string | null;
};
type Partenaire = { id: string; nom: string; description: string | null; logo_url: string | null; site_web: string | null };

export default function PartenairesScreen() {
  const navigation = useNavigation<any>();
  const { session, loading: sessionLoading } = useSession();
  const [partenaires, setPartenaires] = useState<Partenaire[]>([]);
  const [postsMap, setPostsMap] = useState<Record<string, Post[]>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);

  useEffect(() => { init(); }, [session?.user?.id]);

  async function init() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setHasProfile(false); setLoading(false); return; }
    const { data: profil } = await supabase.from('profils').select('prenom').eq('id', session.user.id).single();
    if (!profil?.prenom) { setHasProfile(false); setLoading(false); return; }
    setHasProfile(true);
    await load();
  }

  async function load() {
    setLoading(true);
    const { data: parts } = await supabase.from('partenaires').select('*').eq('actif', true).order('created_at', { ascending: true });
    if (!parts?.length) { setPartenaires([]); setLoading(false); return; }
    const ids = parts.map(p => p.id);
    const { data: posts } = await supabase.from('partenaire_posts').select('*').in('partenaire_id', ids).eq('actif', true).order('created_at', { ascending: false });
    const map: Record<string, Post[]> = {};
    (posts || []).forEach((p: any) => {
      if (!map[p.partenaire_id]) map[p.partenaire_id] = [];
      map[p.partenaire_id].push(p);
    });
    setPartenaires(parts);
    setPostsMap(map);
    setLoading(false);
  }

  if (sessionLoading || loading) return <ActivityIndicator style={{ flex: 1 }} color={colors.terra} />;
  if (!session) return <AuthGate navigation={navigation} message="Connecte-toi pour accéder aux offres et actualités de nos partenaires dog-friendly." />;

  if (hasProfile === false) {
    return (
      <View style={styles.gate}>
        <Ionicons name="ribbon-outline" size={40} color={colors.border} />
        <Text style={styles.gateTitle}>Espace partenaires</Text>
        <Text style={styles.gateText}>Crée ton profil pour accéder aux offres exclusives de nos marques dog-friendly.</Text>
      </View>
    );
  }

  if (!partenaires.length) {
    return (
      <View style={styles.gate}>
        <Ionicons name="time-outline" size={40} color={colors.border} />
        <Text style={styles.gateTitle}>Arrive bientôt</Text>
        <Text style={styles.gateText}>Nous sélectionnons des marques dog-friendly pour partager leurs actualités avec la communauté.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.terra} />}
    >
      {/* Intro header */}
      <View style={styles.introWrap}>
        <Text style={styles.introLabel}>PARTENAIRES OFFICIELS</Text>
        <Text style={styles.introTitle}>Nos marques dog-friendly</Text>
        <Text style={styles.introSub}>Offres et actualités sélectionnées pour la communauté The Pack.</Text>
      </View>

      {partenaires.map(p => {
        const posts = postsMap[p.id] || [];
        return (
          <View key={p.id} style={styles.partSection}>

            {/* Partner header */}
            <View style={styles.partHeader}>
              <View style={styles.logoWrap}>
                {p.logo_url
                  ? <Image source={{ uri: p.logo_url }} style={styles.logoImg} resizeMode="contain" />
                  : <View style={styles.logoFallback}><Text style={styles.logoFallbackText}>{p.nom[0]}</Text></View>}
              </View>
              <View style={styles.partInfo}>
                <View style={styles.partBadgeRow}>
                  <View style={styles.partBadge}>
                    <Text style={styles.partBadgeText}>Partenaire</Text>
                  </View>
                </View>
                <Text style={styles.partNom}>{p.nom}</Text>
                {p.description ? <Text style={styles.partDesc} numberOfLines={2}>{p.description}</Text> : null}
              </View>
              {p.site_web ? (
                <TouchableOpacity style={styles.siteLinkBtn} onPress={() => Linking.openURL(p.site_web!)}>
                  <Ionicons name="globe-outline" size={16} color={colors.bordeaux} />
                </TouchableOpacity>
              ) : null}
            </View>

            {/* Separator */}
            <View style={styles.partSep} />

            {/* Posts */}
            {posts.length === 0 ? (
              <View style={styles.noPostWrap}>
                <Text style={styles.noPost}>Aucune publication pour l'instant</Text>
              </View>
            ) : (
              <View style={styles.postsWrap}>
                {posts.map(post => {
                  const cfg = TYPE_CONFIG[post.type] || TYPE_CONFIG.news;
                  let periode = '';
                  if (post.date_debut && post.date_expiration) periode = `${fmtDate(post.date_debut)} – ${fmtDate(post.date_expiration)}`;
                  else if (post.date_debut) periode = `Dès le ${fmtDate(post.date_debut)}`;
                  else if (post.date_expiration) periode = `Jusqu'au ${fmtDate(post.date_expiration)}`;

                  return (
                    <View key={post.id} style={styles.postCard}>
                      {/* Image avec badge type en overlay */}
                      {post.image_url ? (
                        <View style={styles.postImgWrap}>
                          <Image source={{ uri: post.image_url }} style={styles.postImg} resizeMode="cover" />
                          <LinearGradient
                            colors={['transparent', 'rgba(20,8,8,0.55)']}
                            style={styles.postImgGradient}
                          />
                          <View style={[styles.typeBadge, { backgroundColor: cfg.bg }]}>
                            <Text style={styles.typeBadgeIcon}>{cfg.icon}</Text>
                            <Text style={[styles.typeBadgeText, { color: cfg.text }]}>{cfg.label}</Text>
                          </View>
                          {periode ? (
                            <View style={styles.periodeBadge}>
                              <Ionicons name="calendar-outline" size={10} color="rgba(255,255,255,0.8)" />
                              <Text style={styles.periodeText}>{periode}</Text>
                            </View>
                          ) : null}
                        </View>
                      ) : (
                        <View style={styles.postNoImgHeader}>
                          <View style={[styles.typeBadge, { backgroundColor: cfg.bg }]}>
                            <Text style={styles.typeBadgeIcon}>{cfg.icon}</Text>
                            <Text style={[styles.typeBadgeText, { color: cfg.text }]}>{cfg.label}</Text>
                          </View>
                          {periode ? (
                            <View style={styles.periodeRowAlt}>
                              <Ionicons name="calendar-outline" size={10} color={colors.textMuted} />
                              <Text style={styles.periodeTextAlt}>{periode}</Text>
                            </View>
                          ) : null}
                        </View>
                      )}

                      {/* Contenu */}
                      <View style={styles.postBody}>
                        <Text style={styles.postTitre}>{post.titre}</Text>
                        {post.contenu ? <Text style={styles.postContenu}>{post.contenu}</Text> : null}
                        {post.lien ? (
                          <TouchableOpacity style={styles.postBtn} onPress={() => Linking.openURL(post.lien!)}>
                            <Text style={styles.postBtnText}>Découvrir</Text>
                            <Ionicons name="arrow-forward" size={13} color={colors.ivory} />
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ivoryPale },
  list: { paddingBottom: 48 },

  gate: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, backgroundColor: colors.ivoryPale, gap: 12 },
  gateTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 22, color: colors.bordeaux, textAlign: 'center' },
  gateText: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.textMuted, textAlign: 'center', lineHeight: 22 },

  introWrap: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 20 },
  introLabel: { fontFamily: 'DMSans_500Medium', fontSize: 10, color: colors.terra, letterSpacing: 2, marginBottom: 6 },
  introTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 26, color: colors.bordeaux, lineHeight: 32, marginBottom: 6 },
  introSub: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted, lineHeight: 20 },

  partSection: {
    backgroundColor: colors.white,
    marginHorizontal: 16, marginBottom: 24,
    borderRadius: 20, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 3,
  },

  partHeader: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18 },
  logoWrap: {
    width: 60, height: 60, borderRadius: 16, overflow: 'hidden',
    backgroundColor: colors.ivoryLight,
    borderWidth: 1, borderColor: colors.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 3, elevation: 2,
  },
  logoImg: { width: 60, height: 60 },
  logoFallback: { width: 60, height: 60, backgroundColor: colors.bordeaux + '10', alignItems: 'center', justifyContent: 'center' },
  logoFallbackText: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 24, color: colors.bordeaux },
  partInfo: { flex: 1, gap: 2 },
  partBadgeRow: { flexDirection: 'row', marginBottom: 4 },
  partBadge: { backgroundColor: colors.terra + '18', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  partBadgeText: { fontFamily: 'DMSans_500Medium', fontSize: 9, color: colors.terra, letterSpacing: 0.8, textTransform: 'uppercase' },
  partNom: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 17, color: colors.bordeaux },
  partDesc: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted, lineHeight: 17, marginTop: 2 },
  siteLinkBtn: {
    width: 36, height: 36, borderRadius: 12, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ivoryLight,
  },

  partSep: { height: 1, backgroundColor: colors.border, marginHorizontal: 18 },

  noPostWrap: { padding: 24, alignItems: 'center' },
  noPost: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted },

  postsWrap: { gap: 1 },

  postCard: { backgroundColor: colors.white },
  postImgWrap: { position: 'relative', width: '100%', height: 200 },
  postImg: { width: '100%', height: 200 },
  postImgGradient: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 80 },

  typeBadge: {
    position: 'absolute', top: 14, left: 14,
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 20, paddingHorizontal: 11, paddingVertical: 5,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.2, shadowRadius: 3, elevation: 3,
  },
  typeBadgeIcon: { fontSize: 10, color: '#fff' },
  typeBadgeText: { fontFamily: 'DMSans_500Medium', fontSize: 11 },

  periodeBadge: {
    position: 'absolute', bottom: 12, right: 14,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 12,
    paddingHorizontal: 9, paddingVertical: 4,
  },
  periodeText: { fontFamily: 'DMSans_400Regular', fontSize: 10, color: 'rgba(255,255,255,0.9)' },

  postNoImgHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 16, gap: 8,
  },
  periodeRowAlt: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  periodeTextAlt: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted },

  postBody: { padding: 16, gap: 8 },
  postTitre: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: colors.bordeaux, lineHeight: 25 },
  postContenu: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMid, lineHeight: 20 },
  postBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.bordeaux, borderRadius: 22,
    paddingHorizontal: 18, paddingVertical: 10,
    alignSelf: 'flex-start', marginTop: 4,
    shadowColor: colors.bordeaux, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.25, shadowRadius: 6, elevation: 4,
  },
  postBtnText: { fontFamily: 'DMSans_500Medium', color: colors.ivory, fontSize: 13 },
});
