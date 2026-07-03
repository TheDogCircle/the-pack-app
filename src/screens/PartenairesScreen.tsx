import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Image, Linking, ActivityIndicator, RefreshControl,
  Modal, StatusBar, useWindowDimensions, Clipboard,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import { useSession } from '../hooks/useSession';
import AuthGate from '../components/AuthGate';

const TYPE_LABEL: Record<string, string> = {
  offre: 'Offre exclusive',
  news: 'Actualité',
  nouveaute: 'Nouveauté',
};

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}
function buildPeriode(post: Post) {
  if (post.date_debut && post.date_expiration) return `Du ${fmtDate(post.date_debut)} au ${fmtDate(post.date_expiration)}`;
  if (post.date_debut) return `À partir du ${fmtDate(post.date_debut)}`;
  if (post.date_expiration) return `Jusqu'au ${fmtDate(post.date_expiration)}`;
  return '';
}

type Post = {
  id: string; partenaire_id: string; titre: string; contenu: string | null; type: string;
  image_url: string | null; lien: string | null; code_promo: string | null;
  disponibilite: string | null;
  date_debut: string | null; date_expiration: string | null;
};
type Partenaire = {
  id: string; nom: string; description: string | null;
  logo_url: string | null; banniere_url: string | null; site_web: string | null;
};

// ── Brand detail modal ──────────────────────────────────────────────────────

function BrandModal({
  partenaire, posts, visible, onClose,
}: {
  partenaire: Partenaire | null; posts: Post[]; visible: boolean; onClose: () => void;
}) {
  const { width } = useWindowDimensions();
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  useEffect(() => { if (!visible) setRevealed({}); }, [visible]);

  if (!partenaire) return null;

  const galleryImgs = [
    ...posts.filter(p => p.image_url && p.type !== 'offre').map(p => p.image_url!),
    ...posts.filter(p => p.image_url && p.type === 'offre').map(p => p.image_url!),
  ].filter((v, i, a) => a.indexOf(v) === i).slice(0, 3);

  const otherPosts = posts.filter(p => p.type !== 'offre');
  const offerPosts = posts.filter(p => p.type === 'offre');
  const orderedPosts = [...otherPosts, ...offerPosts];

  const imgW = width - 32;
  const halfW = (imgW - 8) / 2;

  function copyCode(code: string) {
    Clipboard.setString(code);
    Alert.alert('Copié !', `Code "${code}" copié dans le presse-papier.`);
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <StatusBar barStyle="light-content" />
      <ScrollView style={s.modalContainer} contentContainerStyle={s.modalContent} bounces>

        {/* Hero */}
        <View style={s.hero}>
          {partenaire.banniere_url
            ? <Image source={{ uri: partenaire.banniere_url }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
            : null}
          <LinearGradient
            colors={['rgba(0,0,0,0.08)', 'rgba(61,26,26,0.82)']}
            style={StyleSheet.absoluteFillObject}
          />
          <TouchableOpacity style={s.closeBtn} onPress={onClose}>
            <Ionicons name="close" size={20} color="#fff" />
          </TouchableOpacity>
          <View style={s.heroInfo}>
            <View style={s.heroLogo}>
              {partenaire.logo_url
                ? <Image source={{ uri: partenaire.logo_url }} style={s.heroLogoImg} resizeMode="contain" />
                : <Text style={s.heroLogoFallback}>{partenaire.nom[0]}</Text>}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.heroName}>{partenaire.nom}</Text>
              {partenaire.site_web
                ? <Text style={s.heroSite}>{partenaire.site_web.replace(/^https?:\/\//, '').replace(/\/$/, '')}</Text>
                : null}
            </View>
          </View>
        </View>

        {/* Body */}
        <View style={s.body}>
          {partenaire.site_web ? (
            <TouchableOpacity style={s.siteLink} onPress={() => Linking.openURL(partenaire.site_web!)}>
              <Ionicons name="globe-outline" size={14} color={colors.terra} />
              <Text style={s.siteLinkText}>Visiter le site →</Text>
            </TouchableOpacity>
          ) : null}

          {partenaire.description ? (
            <Text style={s.story}>{partenaire.description}</Text>
          ) : null}

          {/* Gallery */}
          {galleryImgs.length === 1 && (
            <Image source={{ uri: galleryImgs[0] }} style={[s.galleryFull, { width: imgW }]} resizeMode="cover" />
          )}
          {galleryImgs.length === 2 && (
            <View style={s.galleryRow}>
              {galleryImgs.map(img => (
                <Image key={img} source={{ uri: img }} style={[s.galleryHalf, { width: halfW }]} resizeMode="cover" />
              ))}
            </View>
          )}
          {galleryImgs.length >= 3 && (
            <View style={s.galleryThree}>
              <Image source={{ uri: galleryImgs[0] }} style={[s.galleryThreeMain, { width: imgW * 0.6 - 4 }]} resizeMode="cover" />
              <View style={[s.galleryThreeSide, { width: imgW * 0.4 - 4 }]}>
                <Image source={{ uri: galleryImgs[1] }} style={[s.galleryThreeSmall, { width: '100%' }]} resizeMode="cover" />
                <Image source={{ uri: galleryImgs[2] }} style={[s.galleryThreeSmall, { width: '100%' }]} resizeMode="cover" />
              </View>
            </View>
          )}

          {/* Posts & offers */}
          {orderedPosts.length > 0 ? (
            <>
              <Text style={s.sectionTitle}>À découvrir</Text>
              {orderedPosts.map(post => {
                const periode = buildPeriode(post);
                const isRevealed = revealed[post.id];
                return (
                  <View key={post.id} style={s.postItem}>
                    {post.image_url
                      ? <Image source={{ uri: post.image_url }} style={s.postItemImg} resizeMode="cover" />
                      : null}
                    <View style={s.postItemBody}>
                      <Text style={s.postItemType}>{TYPE_LABEL[post.type] || post.type}</Text>
                      <Text style={s.postItemTitle}>{post.titre}</Text>
                      {post.contenu ? <Text style={s.postItemDesc}>{post.contenu}</Text> : null}

                      {post.code_promo ? (
                        isRevealed ? (
                          <View style={s.codeBox}>
                            <View style={{ flex: 1 }}>
                              <Text style={s.codeLabel}>Code promo</Text>
                              <Text style={s.codeValue}>{post.code_promo}</Text>
                            </View>
                            <TouchableOpacity style={s.codeCopyBtn} onPress={() => copyCode(post.code_promo!)}>
                              <Text style={s.codeCopyText}>Copier</Text>
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <TouchableOpacity
                            style={s.revealBtn}
                            onPress={() => setRevealed(r => ({ ...r, [post.id]: true }))}
                          >
                            <Ionicons name="lock-closed-outline" size={13} color={colors.ivory} />
                            <Text style={s.revealBtnText}>Voir le code</Text>
                          </TouchableOpacity>
                        )
                      ) : null}

                      <View style={s.postItemFooter}>
                        {periode ? <Text style={s.postItemMeta}>{periode}</Text> : null}
                        {post.lien ? (
                          <TouchableOpacity style={s.ctaBtn} onPress={() => Linking.openURL(post.lien!)}>
                            <Text style={s.ctaBtnText}>Découvrir</Text>
                            <Ionicons name="arrow-forward" size={12} color={colors.ivory} />
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    </View>
                  </View>
                );
              })}
            </>
          ) : null}
        </View>
      </ScrollView>
    </Modal>
  );
}

// ── Brand card ──────────────────────────────────────────────────────────────

function BrandCard({
  partenaire, posts, onPress, cardWidth,
}: {
  partenaire: Partenaire; posts: Post[]; onPress: () => void; cardWidth: number;
}) {
  const hasOffer = posts.some(p => p.type === 'offre');
  const coverImg = partenaire.banniere_url || posts.find(p => p.image_url)?.image_url || null;

  return (
    <TouchableOpacity style={[s.card, { width: cardWidth }]} onPress={onPress} activeOpacity={0.88}>
      <View style={s.cardCover}>
        {coverImg
          ? <Image source={{ uri: coverImg }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
          : null}
        <LinearGradient
          colors={['transparent', 'rgba(61,26,26,0.7)']}
          style={StyleSheet.absoluteFillObject}
        />
        <View style={s.cardLogo}>
          {partenaire.logo_url
            ? <Image source={{ uri: partenaire.logo_url }} style={s.cardLogoImg} resizeMode="contain" />
            : <Text style={s.cardLogoFallback}>{partenaire.nom[0]}</Text>}
        </View>
        {hasOffer ? (
          <View style={s.offerBadge}>
            <Text style={s.offerBadgeText}>Offre dispo</Text>
          </View>
        ) : null}
      </View>
      <View style={s.cardBody}>
        <Text style={s.cardName} numberOfLines={1}>{partenaire.nom}</Text>
        {partenaire.description
          ? <Text style={s.cardDesc} numberOfLines={2}>{partenaire.description}</Text>
          : null}
        <View style={s.cardArrow}>
          <Text style={s.cardArrowText}>Découvrir</Text>
          <Ionicons name="arrow-forward" size={12} color={colors.terra} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ── Screen ──────────────────────────────────────────────────────────────────

export default function PartenairesScreen() {
  const navigation = useNavigation<any>();
  const { width } = useWindowDimensions();
  const { session, loading: sessionLoading } = useSession();
  const [partenaires, setPartenaires] = useState<Partenaire[]>([]);
  const [allPosts, setAllPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
  const [selectedBrand, setSelectedBrand] = useState<Partenaire | null>(null);

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

  const cardGap = 12;
  const cardWidth = (width - 28 * 2 - cardGap) / 2;

  const postsFor = useCallback((id: string) => allPosts.filter(p => p.partenaire_id === id), [allPosts]);

  if (sessionLoading || loading) return <ActivityIndicator style={{ flex: 1 }} color={colors.terra} />;
  if (!session) return <AuthGate navigation={navigation} message="Connecte-toi pour accéder aux offres et actualités de nos partenaires dog-friendly." />;

  if (hasProfile === false) {
    return (
      <View style={s.gate}>
        <Ionicons name="ribbon-outline" size={40} color={colors.border} />
        <Text style={s.gateTitle}>Espace partenaires</Text>
        <Text style={s.gateText}>Crée ton profil pour accéder aux offres exclusives de nos marques dog-friendly.</Text>
      </View>
    );
  }

  if (!partenaires.length) {
    return (
      <View style={s.gate}>
        <Ionicons name="time-outline" size={40} color={colors.border} />
        <Text style={s.gateTitle}>Arrive bientôt</Text>
        <Text style={s.gateText}>Nous sélectionnons des marques dog-friendly pour partager leurs avantages exclusifs avec la communauté.</Text>
      </View>
    );
  }

  // Build 2-column rows
  const rows: Partenaire[][] = [];
  for (let i = 0; i < partenaires.length; i += 2) {
    rows.push(partenaires.slice(i, i + 2));
  }

  return (
    <>
      <ScrollView
        style={s.container}
        contentContainerStyle={s.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.terra} />
        }
      >
        <View style={s.header}>
          <Text style={s.headerTitle}>Nos partenaires</Text>
          <Text style={s.headerSub}>Des marques dog-friendly sélectionnées pour la meute</Text>
        </View>

        <View style={s.grid}>
          {rows.map((row, ri) => (
            <View key={ri} style={[s.row, { gap: cardGap }]}>
              {row.map(p => (
                <BrandCard
                  key={p.id}
                  partenaire={p}
                  posts={postsFor(p.id)}
                  cardWidth={cardWidth}
                  onPress={() => setSelectedBrand(p)}
                />
              ))}
            </View>
          ))}
        </View>
      </ScrollView>

      <BrandModal
        partenaire={selectedBrand}
        posts={selectedBrand ? postsFor(selectedBrand.id) : []}
        visible={!!selectedBrand}
        onClose={() => setSelectedBrand(null)}
      />
    </>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ivoryPale },
  list: { paddingBottom: 56 },

  gate: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, backgroundColor: colors.ivoryPale, gap: 12 },
  gateTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 22, color: colors.bordeaux, textAlign: 'center' },
  gateText: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.textMuted, textAlign: 'center', lineHeight: 22 },

  header: { paddingHorizontal: 28, paddingTop: 20, paddingBottom: 16 },
  headerTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 22, color: colors.bordeaux, marginBottom: 3 },
  headerSub: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted },

  // Grid
  grid: { paddingHorizontal: 28, gap: 12 },
  row: { flexDirection: 'row' },

  // Brand card
  card: {
    borderRadius: 18, overflow: 'hidden', backgroundColor: colors.white,
    borderWidth: 1, borderColor: colors.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 2,
  },
  cardCover: { width: '100%', height: 160, backgroundColor: colors.bordeaux, position: 'relative' },
  cardLogo: {
    position: 'absolute', bottom: 10, left: 10,
    width: 42, height: 42, borderRadius: 10,
    backgroundColor: colors.white, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.white,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.18, shadowRadius: 6, elevation: 3,
  },
  cardLogoImg: { width: '100%', height: '100%', padding: 4 },
  cardLogoFallback: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: colors.bordeaux },
  offerBadge: {
    position: 'absolute', bottom: 14, right: 10,
    backgroundColor: colors.terra, borderRadius: 20,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  offerBadgeText: { fontFamily: 'DMSans_500Medium', fontSize: 9, color: '#fff', letterSpacing: 0.5 },
  cardBody: { padding: 11, gap: 3 },
  cardName: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 14, color: colors.bordeaux },
  cardDesc: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted, lineHeight: 15 },
  cardArrow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5 },
  cardArrowText: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.terra },

  // Modal
  modalContainer: { flex: 1, backgroundColor: colors.ivoryPale },
  modalContent: { paddingBottom: 60 },

  hero: { width: '100%', height: 280, backgroundColor: colors.bordeaux, position: 'relative' },
  closeBtn: {
    position: 'absolute', top: 50, right: 16, zIndex: 10,
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center', justifyContent: 'center',
  },
  heroInfo: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'flex-end', gap: 14,
    padding: 18,
  },
  heroLogo: {
    width: 58, height: 58, borderRadius: 14, backgroundColor: colors.white,
    overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
    borderWidth: 2.5, borderColor: colors.white,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.22, shadowRadius: 8, elevation: 4,
    flexShrink: 0,
  },
  heroLogoImg: { width: '100%', height: '100%', padding: 6 },
  heroLogoFallback: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 22, color: colors.bordeaux },
  heroName: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 22, color: '#fff', lineHeight: 28, flex: 1 },
  heroSite: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: 'rgba(245,239,224,0.65)', marginTop: 3 },

  body: { padding: 20 },
  siteLink: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 },
  siteLinkText: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.terra },
  story: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.textMid, lineHeight: 24, marginBottom: 4 },

  // Gallery
  galleryFull: { height: 220, borderRadius: 12, marginVertical: 16 },
  galleryRow: { flexDirection: 'row', gap: 8, marginVertical: 16 },
  galleryHalf: { height: 160, borderRadius: 12 },
  galleryThree: { flexDirection: 'row', gap: 8, marginVertical: 16 },
  galleryThreeMain: { height: 210, borderRadius: 12 },
  galleryThreeSide: { flex: 1, gap: 8 },
  galleryThreeSmall: { height: 101, borderRadius: 12 },

  // Section title
  sectionTitle: {
    fontFamily: 'DMSans_500Medium', fontSize: 10, letterSpacing: 1.2,
    textTransform: 'uppercase', color: colors.textMuted,
    marginTop: 24, marginBottom: 14,
    paddingTop: 20, borderTopWidth: 1, borderTopColor: colors.border,
  },

  // Post item
  postItem: {
    backgroundColor: colors.white, borderRadius: 14, overflow: 'hidden',
    borderWidth: 1, borderColor: colors.border, marginBottom: 12,
  },
  postItemImg: { width: '100%', height: 140 },
  postItemBody: { padding: 14, gap: 5 },
  postItemType: { fontFamily: 'DMSans_500Medium', fontSize: 10, color: colors.terra, letterSpacing: 0.8, textTransform: 'uppercase' },
  postItemTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 16, color: colors.bordeaux, lineHeight: 22 },
  postItemDesc: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted, lineHeight: 18 },
  postItemFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, flexWrap: 'wrap', gap: 6 },
  postItemMeta: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted },

  revealBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    backgroundColor: colors.bordeaux, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8, marginTop: 4,
  },
  revealBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.ivory },

  codeBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(196,105,58,0.07)',
    borderWidth: 1.5, borderColor: colors.terra, borderStyle: 'dashed',
    borderRadius: 10, padding: 12, marginTop: 6,
  },
  codeLabel: { fontFamily: 'DMSans_500Medium', fontSize: 9, color: colors.terra, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 3 },
  codeValue: { fontFamily: 'DMSans_500Medium', fontSize: 17, color: colors.bordeaux, letterSpacing: 1.5 },
  codeCopyBtn: { backgroundColor: 'rgba(196,105,58,0.12)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  codeCopyText: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.terra },

  ctaBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: colors.bordeaux, borderRadius: 18,
    paddingHorizontal: 14, paddingVertical: 7,
  },
  ctaBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.ivory },
});
