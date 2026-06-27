import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Image, Linking, ActivityIndicator, RefreshControl, Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import { useSession } from '../hooks/useSession';
import AuthGate from '../components/AuthGate';

const TYPE_CONFIG: Record<string, { label: string; bg: string; text: string; icon: string }> = {
  offre:     { label: 'Offre exclusive', bg: colors.terra,    text: '#fff', icon: '✦' },
  news:      { label: 'Actualité',       bg: colors.bordeaux, text: '#fff', icon: '·' },
  nouveaute: { label: 'Nouveauté',       bg: '#5A9E6F',       text: '#fff', icon: '★' },
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

function BrandChip({ p, selected, onPress }: { p: Partenaire; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.chip} onPress={onPress} activeOpacity={0.75}>
      <View style={[styles.chipLogo, selected && styles.chipLogoSelected]}>
        {p.logo_url
          ? <Image source={{ uri: p.logo_url }} style={styles.chipLogoImg} resizeMode="contain" />
          : <View style={styles.chipLogoFallback}><Text style={styles.chipLogoFallbackText}>{p.nom[0]}</Text></View>}
        {selected && <View style={styles.chipActiveDot} />}
      </View>
      <Text style={[styles.chipName, selected && styles.chipNameSelected]} numberOfLines={2}>{p.nom}</Text>
    </TouchableOpacity>
  );
}

function PostCard({ post }: { post: Post }) {
  const cfg = TYPE_CONFIG[post.type] || TYPE_CONFIG.news;
  let periode = '';
  if (post.date_debut && post.date_expiration) periode = `${fmtDate(post.date_debut)} – ${fmtDate(post.date_expiration)}`;
  else if (post.date_debut) periode = `Dès le ${fmtDate(post.date_debut)}`;
  else if (post.date_expiration) periode = `Jusqu'au ${fmtDate(post.date_expiration)}`;

  return (
    <View style={styles.postCard}>
      {post.image_url ? (
        <View style={styles.postImgWrap}>
          <Image source={{ uri: post.image_url }} style={styles.postImg} resizeMode="cover" />
          <LinearGradient colors={['transparent', 'rgba(20,8,8,0.6)']} style={styles.postImgGradient} />
          <View style={[styles.typeBadge, { backgroundColor: cfg.bg }]}>
            <Text style={styles.typeBadgeIcon}>{cfg.icon}</Text>
            <Text style={[styles.typeBadgeText, { color: cfg.text }]}>{cfg.label}</Text>
          </View>
          {periode ? (
            <View style={styles.periodeBadge}>
              <Ionicons name="calendar-outline" size={10} color="rgba(255,255,255,0.85)" />
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
}

export default function PartenairesScreen() {
  const navigation = useNavigation<any>();
  const { session, loading: sessionLoading } = useSession();
  const [partenaires, setPartenaires] = useState<Partenaire[]>([]);
  const [postsMap, setPostsMap] = useState<Record<string, Post[]>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const fadeAnim = useRef(new Animated.Value(1)).current;

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
    setSelectedId(parts[0]?.id ?? null);
    setLoading(false);
  }

  function selectBrand(id: string) {
    if (id === selectedId) return;
    Animated.sequence([
      Animated.timing(fadeAnim, { toValue: 0, duration: 120, useNativeDriver: true }),
      Animated.timing(fadeAnim, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();
    setSelectedId(id);
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

  const selected = partenaires.find(p => p.id === selectedId) ?? partenaires[0];
  const posts = postsMap[selected.id] || [];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.terra} />}
    >
      {/* Intro */}
      <View style={styles.introWrap}>
        <Text style={styles.introLabel}>PARTENAIRES OFFICIELS</Text>
        <Text style={styles.introTitle}>Nos marques dog-friendly</Text>
        <Text style={styles.introSub}>Offres et actualités sélectionnées pour la communauté.</Text>
      </View>

      {/* Bannière marques */}
      <View style={styles.bannerWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bannerScroll}>
          {partenaires.map(p => (
            <BrandChip key={p.id} p={p} selected={p.id === selected.id} onPress={() => selectBrand(p.id)} />
          ))}
        </ScrollView>
      </View>

      {/* Fiche marque sélectionnée */}
      <Animated.View style={[styles.brandCard, { opacity: fadeAnim }]}>
        <View style={styles.brandCardInner}>
          <View style={styles.brandLogoWrap}>
            {selected.logo_url
              ? <Image source={{ uri: selected.logo_url }} style={styles.brandLogoImg} resizeMode="contain" />
              : <View style={styles.brandLogoFallback}><Text style={styles.brandLogoFallbackText}>{selected.nom[0]}</Text></View>}
          </View>
          <View style={styles.brandInfo}>
            <View style={styles.brandBadge}>
              <Text style={styles.brandBadgeText}>Partenaire officiel</Text>
            </View>
            <Text style={styles.brandNom}>{selected.nom}</Text>
            {selected.description ? <Text style={styles.brandDesc}>{selected.description}</Text> : null}
            {selected.site_web ? (
              <TouchableOpacity style={styles.siteBtn} onPress={() => Linking.openURL(selected.site_web!)}>
                <Ionicons name="globe-outline" size={13} color={colors.ivory} />
                <Text style={styles.siteBtnText}>Voir le site</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </Animated.View>

      {/* Section offres */}
      <View style={styles.offresHeader}>
        <View style={styles.offresHeaderLine} />
        <Text style={styles.offresHeaderLabel}>
          {posts.length > 0 ? `${posts.length} publication${posts.length > 1 ? 's' : ''}` : 'Publications'}
        </Text>
        <View style={styles.offresHeaderLine} />
      </View>

      {/* Posts */}
      {posts.length === 0 ? (
        <Animated.View style={[styles.noPostWrap, { opacity: fadeAnim }]}>
          <Ionicons name="sparkles-outline" size={28} color={colors.border} />
          <Text style={styles.noPost}>Aucune publication pour l'instant</Text>
        </Animated.View>
      ) : (
        <Animated.View style={[styles.postsWrap, { opacity: fadeAnim }]}>
          {posts.map(post => <PostCard key={post.id} post={post} />)}
        </Animated.View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ivoryPale },
  list: { paddingBottom: 56 },

  gate: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, backgroundColor: colors.ivoryPale, gap: 12 },
  gateTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 22, color: colors.bordeaux, textAlign: 'center' },
  gateText: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.textMuted, textAlign: 'center', lineHeight: 22 },

  introWrap: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 18 },
  introLabel: { fontFamily: 'DMSans_500Medium', fontSize: 10, color: colors.terra, letterSpacing: 2, marginBottom: 6 },
  introTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 26, color: colors.bordeaux, lineHeight: 32, marginBottom: 6 },
  introSub: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted, lineHeight: 20 },

  // Bannière
  bannerWrap: { borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.white },
  bannerScroll: { paddingHorizontal: 16, paddingVertical: 18, gap: 8, flexDirection: 'row' },

  chip: { alignItems: 'center', width: 76, gap: 6 },
  chipLogo: {
    width: 64, height: 64, borderRadius: 20, overflow: 'hidden',
    backgroundColor: colors.ivoryLight,
    borderWidth: 2, borderColor: 'transparent',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 4, elevation: 2,
  },
  chipLogoSelected: { borderColor: colors.terra },
  chipLogoImg: { width: 60, height: 60, margin: 2 },
  chipLogoFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bordeaux + '12' },
  chipLogoFallbackText: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 22, color: colors.bordeaux },
  chipActiveDot: {
    position: 'absolute', bottom: -1, alignSelf: 'center',
    width: 6, height: 6, borderRadius: 3, backgroundColor: colors.terra,
  },
  chipName: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted, textAlign: 'center', lineHeight: 14 },
  chipNameSelected: { fontFamily: 'DMSans_500Medium', color: colors.bordeaux },

  // Fiche marque
  brandCard: {
    marginHorizontal: 16, marginTop: 20,
    backgroundColor: colors.white,
    borderRadius: 20, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 3,
  },
  brandCardInner: { flexDirection: 'row', padding: 20, gap: 16, alignItems: 'flex-start' },
  brandLogoWrap: {
    width: 72, height: 72, borderRadius: 18, overflow: 'hidden',
    backgroundColor: colors.ivoryLight,
    borderWidth: 1, borderColor: colors.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3, elevation: 2,
  },
  brandLogoImg: { width: 72, height: 72 },
  brandLogoFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bordeaux + '10' },
  brandLogoFallbackText: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 28, color: colors.bordeaux },
  brandInfo: { flex: 1, gap: 6 },
  brandBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.terra + '18', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
  },
  brandBadgeText: { fontFamily: 'DMSans_500Medium', fontSize: 9, color: colors.terra, letterSpacing: 0.8, textTransform: 'uppercase' },
  brandNom: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 19, color: colors.bordeaux, lineHeight: 24 },
  brandDesc: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMid, lineHeight: 19 },
  siteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start', marginTop: 4,
    backgroundColor: colors.bordeaux, borderRadius: 16,
    paddingHorizontal: 14, paddingVertical: 7,
  },
  siteBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.ivory },

  // Séparateur offres
  offresHeader: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, marginTop: 28, marginBottom: 16, gap: 10 },
  offresHeaderLine: { flex: 1, height: 1, backgroundColor: colors.border },
  offresHeaderLabel: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.textMuted, letterSpacing: 1 },

  noPostWrap: { alignItems: 'center', gap: 10, paddingVertical: 32 },
  noPost: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted },

  postsWrap: { gap: 16, paddingHorizontal: 16 },

  // Post card
  postCard: {
    backgroundColor: colors.white,
    borderRadius: 18, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 3,
  },
  postImgWrap: { position: 'relative', width: '100%', height: 210 },
  postImg: { width: '100%', height: 210 },
  postImgGradient: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 90 },

  typeBadge: {
    position: 'absolute', top: 14, left: 14,
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 20, paddingHorizontal: 11, paddingVertical: 5,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.18, shadowRadius: 3, elevation: 3,
  },
  typeBadgeIcon: { fontSize: 10, color: '#fff' },
  typeBadgeText: { fontFamily: 'DMSans_500Medium', fontSize: 11 },

  periodeBadge: {
    position: 'absolute', bottom: 12, right: 14,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(0,0,0,0.38)', borderRadius: 12,
    paddingHorizontal: 9, paddingVertical: 4,
  },
  periodeText: { fontFamily: 'DMSans_400Regular', fontSize: 10, color: 'rgba(255,255,255,0.92)' },

  postNoImgHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 16, gap: 8,
  },
  periodeRowAlt: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  periodeTextAlt: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted },

  postBody: { padding: 18, gap: 8 },
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
