import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Image, Linking, ActivityIndicator, RefreshControl,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import { useSession } from '../hooks/useSession';
import AuthGate from '../components/AuthGate';

const TYPE_CFG: Record<string, { label: string; bg: string; icon: string }> = {
  offre:     { label: 'Offre exclusive', bg: colors.terra,    icon: '✦' },
  news:      { label: 'Actualité',       bg: colors.bordeaux, icon: '·' },
  nouveaute: { label: 'Nouveauté',       bg: '#5A9E6F',       icon: '★' },
};

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

type Post = {
  id: string; partenaire_id: string; titre: string; contenu: string | null; type: string;
  image_url: string | null; lien: string | null;
  date_debut: string | null; date_expiration: string | null;
};
type Partenaire = { id: string; nom: string; description: string | null; logo_url: string | null; site_web: string | null };

export default function PartenairesScreen() {
  const navigation = useNavigation<any>();
  const { session, loading: sessionLoading } = useSession();
  const [partenaires, setPartenaires] = useState<Partenaire[]>([]);
  const [allPosts, setAllPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
  const [filterBrand, setFilterBrand] = useState<string | null>(null);

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
    if (!parts?.length) { setPartenaires([]); setAllPosts([]); setLoading(false); return; }
    const ids = parts.map((p: any) => p.id);
    const { data: posts } = await supabase.from('partenaire_posts').select('*').in('partenaire_id', ids).eq('actif', true).order('created_at', { ascending: false });
    setPartenaires(parts);
    setAllPosts(posts || []);
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

  const partMap: Record<string, Partenaire> = {};
  partenaires.forEach(p => { partMap[p.id] = p; });

  const filtered = filterBrand ? allPosts.filter(p => p.partenaire_id === filterBrand) : allPosts;
  const activeBrand = filterBrand ? partMap[filterBrand] : null;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.terra} />}
    >
      {/* Header compact */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Offres & actualités</Text>
        <Text style={styles.headerSub}>Sélectionnées pour la communauté dog-friendly</Text>
      </View>

      {/* Filtres marques */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtersScroll} contentContainerStyle={styles.filtersContent}>
        <TouchableOpacity style={[styles.chip, !filterBrand && styles.chipActive]} onPress={() => setFilterBrand(null)}>
          <Text style={[styles.chipText, !filterBrand && styles.chipTextActive]}>Tout</Text>
        </TouchableOpacity>
        {partenaires.map(p => (
          <TouchableOpacity
            key={p.id}
            style={[styles.chip, filterBrand === p.id && styles.chipActive]}
            onPress={() => setFilterBrand(filterBrand === p.id ? null : p.id)}
          >
            {p.logo_url ? <Image source={{ uri: p.logo_url }} style={styles.chipLogo} resizeMode="contain" /> : null}
            <Text style={[styles.chipText, filterBrand === p.id && styles.chipTextActive]} numberOfLines={1}>{p.nom}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Bandeau marque (visible uniquement si filtre actif) */}
      {activeBrand && (
        <View style={styles.brandBanner}>
          {activeBrand.logo_url
            ? <Image source={{ uri: activeBrand.logo_url }} style={styles.brandBannerLogo} resizeMode="contain" />
            : <View style={styles.brandBannerLogoFallback}><Text style={styles.brandBannerLogoFallbackText}>{activeBrand.nom[0]}</Text></View>}
          <View style={styles.brandBannerInfo}>
            <Text style={styles.brandBannerNom}>{activeBrand.nom}</Text>
            {activeBrand.description ? <Text style={styles.brandBannerDesc} numberOfLines={2}>{activeBrand.description}</Text> : null}
          </View>
          {activeBrand.site_web ? (
            <TouchableOpacity style={styles.brandBannerSiteBtn} onPress={() => Linking.openURL(activeBrand.site_web!)}>
              <Ionicons name="globe-outline" size={14} color={colors.bordeaux} />
            </TouchableOpacity>
          ) : null}
        </View>
      )}

      {/* Liste des offres */}
      {filtered.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="sparkles-outline" size={28} color={colors.border} />
          <Text style={styles.emptyText}>Aucune publication pour l'instant</Text>
        </View>
      ) : (
        <View style={styles.postsWrap}>
          {filtered.map(post => {
            const brand = partMap[post.partenaire_id];
            const cfg = TYPE_CFG[post.type] || TYPE_CFG.news;
            let periode = '';
            if (post.date_debut && post.date_expiration) periode = `${fmtDate(post.date_debut)} – ${fmtDate(post.date_expiration)}`;
            else if (post.date_debut) periode = `Dès le ${fmtDate(post.date_debut)}`;
            else if (post.date_expiration) periode = `Jusqu'au ${fmtDate(post.date_expiration)}`;

            if (post.image_url) {
              return (
                <View key={post.id} style={styles.postCard}>
                  <View style={styles.postImgWrap}>
                    <Image source={{ uri: post.image_url }} style={styles.postImg} resizeMode="cover" />
                    <LinearGradient colors={['rgba(0,0,0,0.04)', 'rgba(20,8,8,0.82)']} style={StyleSheet.absoluteFillObject} />

                    {/* Top: brand badge gauche + type badge droit */}
                    <View style={styles.postTopRow}>
                      {brand && (
                        <View style={styles.offerBrandBadge}>
                          {brand.logo_url
                            ? <Image source={{ uri: brand.logo_url }} style={styles.offerBrandLogo} resizeMode="contain" />
                            : <Text style={styles.offerBrandLogoFallback}>{brand.nom[0]}</Text>}
                          <Text style={styles.offerBrandName}>{brand.nom}</Text>
                        </View>
                      )}
                      <View style={[styles.typeBadge, { backgroundColor: cfg.bg }]}>
                        <Text style={styles.typeBadgeText}>{cfg.icon}  {cfg.label}</Text>
                      </View>
                    </View>

                    {/* Bottom: période + titre + bouton */}
                    <View style={styles.postImgBottom}>
                      {periode ? (
                        <View style={styles.periodeBadge}>
                          <Ionicons name="calendar-outline" size={10} color="rgba(255,255,255,0.8)" />
                          <Text style={styles.periodeText}>{periode}</Text>
                        </View>
                      ) : null}
                      <Text style={styles.postTitreOverlay} numberOfLines={2}>{post.titre}</Text>
                      {post.lien ? (
                        <TouchableOpacity style={styles.postBtnSmall} onPress={() => Linking.openURL(post.lien!)}>
                          <Text style={styles.postBtnSmallText}>Découvrir</Text>
                          <Ionicons name="arrow-forward" size={11} color={colors.ivory} />
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  </View>
                  {post.contenu ? (
                    <View style={styles.postBodyMini}>
                      <Text style={styles.postContenu}>{post.contenu}</Text>
                    </View>
                  ) : null}
                </View>
              );
            }

            // Sans image
            return (
              <View key={post.id} style={styles.postCard}>
                <View style={[styles.postNoImgTop, { backgroundColor: cfg.bg }]}>
                  <View style={styles.postNoImgTopRow}>
                    <Text style={styles.postNoImgTypeLabel}>{cfg.icon}  {cfg.label}</Text>
                    {brand && <Text style={styles.postNoImgBrand}>{brand.nom}</Text>}
                  </View>
                  {periode ? (
                    <View style={styles.periodeRow}>
                      <Ionicons name="calendar-outline" size={10} color="rgba(255,255,255,0.75)" />
                      <Text style={styles.periodeTextLight}>{periode}</Text>
                    </View>
                  ) : null}
                </View>
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ivoryPale },
  list: { paddingBottom: 56 },

  gate: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, backgroundColor: colors.ivoryPale, gap: 12 },
  gateTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 22, color: colors.bordeaux, textAlign: 'center' },
  gateText: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.textMuted, textAlign: 'center', lineHeight: 22 },

  // Header compact
  header: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 14 },
  headerTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 20, color: colors.bordeaux, marginBottom: 2 },
  headerSub: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted },

  // Filtres
  filtersScroll: { borderBottomWidth: 1, borderBottomColor: colors.border },
  filtersContent: { paddingHorizontal: 14, paddingVertical: 10, gap: 8, flexDirection: 'row' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 7, paddingLeft: 8, paddingRight: 13,
    borderRadius: 20, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.white,
  },
  chipActive: { backgroundColor: colors.bordeaux, borderColor: colors.bordeaux },
  chipLogo: { width: 20, height: 20, borderRadius: 4 },
  chipText: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.textMid },
  chipTextActive: { color: colors.ivory },

  // Bandeau marque (quand filtre actif)
  brandBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: 14, marginTop: 14, marginBottom: 2,
    backgroundColor: colors.white, borderRadius: 14,
    padding: 12,
    borderWidth: 1, borderColor: colors.border,
  },
  brandBannerLogo: { width: 40, height: 40, borderRadius: 10 },
  brandBannerLogoFallback: { width: 40, height: 40, borderRadius: 10, backgroundColor: colors.bordeaux + '12', alignItems: 'center', justifyContent: 'center' },
  brandBannerLogoFallbackText: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: colors.bordeaux },
  brandBannerInfo: { flex: 1, gap: 2 },
  brandBannerNom: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.bordeaux },
  brandBannerDesc: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted, lineHeight: 16 },
  brandBannerSiteBtn: {
    width: 32, height: 32, borderRadius: 10, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ivoryLight,
  },

  // Posts
  emptyWrap: { alignItems: 'center', gap: 10, paddingVertical: 48 },
  emptyText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted },
  postsWrap: { gap: 14, paddingHorizontal: 14, paddingTop: 16 },

  postCard: {
    borderRadius: 16, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.09, shadowRadius: 8, elevation: 3,
  },

  // Avec image
  postImgWrap: { width: '100%', height: 220 },
  postImg: { width: '100%', height: 220 },

  postTopRow: {
    position: 'absolute', top: 12, left: 12, right: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8,
  },
  offerBrandBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 20, paddingVertical: 4, paddingLeft: 4, paddingRight: 10,
  },
  offerBrandLogo: { width: 22, height: 22, borderRadius: 6 },
  offerBrandLogoFallback: { width: 22, height: 22, borderRadius: 6, backgroundColor: colors.bordeaux + '15', textAlign: 'center', lineHeight: 22, fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.bordeaux },
  offerBrandName: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.bordeaux },

  typeBadge: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 20, paddingHorizontal: 9, paddingVertical: 4,
  },
  typeBadgeText: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: '#fff' },

  postImgBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 14, gap: 5 },
  periodeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
    backgroundColor: 'rgba(0,0,0,0.32)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3,
  },
  periodeText: { fontFamily: 'DMSans_400Regular', fontSize: 10, color: 'rgba(255,255,255,0.9)' },
  postTitreOverlay: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: '#fff', lineHeight: 24 },
  postBtnSmall: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.18)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.32)',
    borderRadius: 18, paddingHorizontal: 12, paddingVertical: 6,
  },
  postBtnSmallText: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.ivory },

  postBodyMini: { backgroundColor: colors.white, paddingHorizontal: 14, paddingVertical: 10 },

  // Sans image
  postNoImgTop: { paddingHorizontal: 14, paddingVertical: 10 },
  postNoImgTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  postNoImgTypeLabel: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: '#fff' },
  postNoImgBrand: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: 'rgba(255,255,255,0.75)' },
  periodeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  periodeTextLight: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: 'rgba(255,255,255,0.8)' },

  postBody: { backgroundColor: colors.white, padding: 14, gap: 8 },
  postTitre: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 17, color: colors.bordeaux, lineHeight: 24 },
  postContenu: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMid, lineHeight: 19 },
  postBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.bordeaux, borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 9,
    alignSelf: 'flex-start', marginTop: 2,
  },
  postBtnText: { fontFamily: 'DMSans_500Medium', color: colors.ivory, fontSize: 13 },
});
