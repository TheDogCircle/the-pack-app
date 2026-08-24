import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Image, Linking, ActivityIndicator, RefreshControl,
  Modal, StatusBar, useWindowDimensions, Clipboard,
  Alert, TextInput, KeyboardAvoidingView, Platform,
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
  instagram_url: string | null; tiktok_url: string | null;
};

const SECTEURS = [
  'Alimentation', 'Accessoires', 'Bien-être', 'Toilettage',
  'Vétérinaire', 'Mode', 'Tech', 'Voyage', 'Autre',
];

// ── Candidature marque modal ────────────────────────────────────────────────

function CandidatureMarqueModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [nomMarque, setNomMarque] = useState('');
  const [contactNom, setContactNom] = useState('');
  const [email, setEmail] = useState('');
  const [telephone, setTelephone] = useState('');
  const [secteur, setSecteur] = useState('');
  const [description, setDescription] = useState('');
  const [siteWeb, setSiteWeb] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [showSecteurPicker, setShowSecteurPicker] = useState(false);

  function reset() {
    setNomMarque(''); setContactNom(''); setEmail(''); setTelephone('');
    setSecteur(''); setDescription(''); setSiteWeb('');
    setSending(false); setSent(false); setShowSecteurPicker(false);
  }

  async function submit() {
    if (!nomMarque.trim() || !contactNom.trim() || !email.trim()) {
      Alert.alert('Champs requis', 'Merci de renseigner le nom de la marque, le contact et l\'email.');
      return;
    }
    setSending(true);
    const { error } = await supabase.from('candidatures_partenaires').insert({
      nom_marque: nomMarque.trim(),
      contact_nom: contactNom.trim(),
      email: email.trim(),
      telephone: telephone.trim() || null,
      secteur: secteur || null,
      description: description.trim() || null,
      site_web: siteWeb.trim() || null,
    });
    setSending(false);
    if (error) { Alert.alert('Erreur', 'Impossible d\'envoyer la candidature. Réessaie plus tard.'); return; }
    setSent(true);
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { reset(); onClose(); }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView style={s.candidContainer} contentContainerStyle={{ paddingBottom: 50 }} keyboardShouldPersistTaps="handled">
          <View style={s.candidHeader}>
            <Text style={s.candidTitle}>Devenir partenaire</Text>
            <TouchableOpacity onPress={() => { reset(); onClose(); }}>
              <Ionicons name="close" size={22} color={colors.bordeaux} />
            </TouchableOpacity>
          </View>

          {sent ? (
            <View style={{ alignItems: 'center', paddingVertical: 48, gap: 14 }}>
              <Ionicons name="checkmark-circle" size={60} color={colors.terra} />
              <Text style={s.candidSentTitle}>Candidature envoyée !</Text>
              <Text style={s.candidSentText}>On revient vers toi très vite 🐾</Text>
              <TouchableOpacity style={s.candidBtn} onPress={() => { reset(); onClose(); }}>
                <Text style={s.candidBtnLabel}>Fermer</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text style={s.candidIntro}>
                Tu es une marque dog-friendly et tu souhaites partager tes offres avec la communauté The Pack Club ? Remplis ce formulaire et on reviendra vers toi rapidement.
              </Text>

              <Text style={s.candidLabel}>Nom de la marque *</Text>
              <TextInput style={s.candidInput} value={nomMarque} onChangeText={setNomMarque} placeholder="Ex : Woofood" placeholderTextColor={colors.textMuted} />

              <Text style={s.candidLabel}>Nom / prénom contact *</Text>
              <TextInput style={s.candidInput} value={contactNom} onChangeText={setContactNom} placeholder="Ex : Sophie Martin" placeholderTextColor={colors.textMuted} />

              <Text style={s.candidLabel}>Email *</Text>
              <TextInput style={s.candidInput} value={email} onChangeText={setEmail} placeholder="contact@mamarque.fr" placeholderTextColor={colors.textMuted} keyboardType="email-address" autoCapitalize="none" />

              <Text style={s.candidLabel}>Téléphone</Text>
              <TextInput style={s.candidInput} value={telephone} onChangeText={setTelephone} placeholder="06 00 00 00 00" placeholderTextColor={colors.textMuted} keyboardType="phone-pad" />

              <Text style={s.candidLabel}>Secteur d'activité</Text>
              <TouchableOpacity style={s.candidSelect} onPress={() => setShowSecteurPicker(true)}>
                <Text style={[s.candidSelectText, !secteur && { color: colors.textMuted }]}>
                  {secteur || 'Choisir un secteur'}
                </Text>
                <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
              </TouchableOpacity>

              <Text style={s.candidLabel}>Description du partenariat souhaité</Text>
              <TextInput
                style={[s.candidInput, { height: 100, textAlignVertical: 'top', paddingTop: 12 }]}
                value={description} onChangeText={setDescription}
                placeholder="Décris ton offre, tes valeurs, ce que tu souhaites proposer à la communauté..."
                placeholderTextColor={colors.textMuted} multiline numberOfLines={4}
              />

              <Text style={s.candidLabel}>Site web</Text>
              <TextInput style={s.candidInput} value={siteWeb} onChangeText={setSiteWeb} placeholder="https://mamarque.fr" placeholderTextColor={colors.textMuted} keyboardType="url" autoCapitalize="none" />

              <TouchableOpacity
                style={[s.candidBtn, (sending || !nomMarque.trim() || !contactNom.trim() || !email.trim()) && { opacity: 0.5 }]}
                onPress={submit}
                disabled={sending || !nomMarque.trim() || !contactNom.trim() || !email.trim()}
              >
                <Text style={s.candidBtnLabel}>{sending ? 'Envoi en cours…' : 'Envoyer ma candidature'}</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Secteur picker */}
      <Modal visible={showSecteurPicker} animationType="slide" presentationStyle="formSheet" transparent onRequestClose={() => setShowSecteurPicker(false)}>
        <View style={s.pickerOverlay}>
          <View style={s.pickerSheet}>
            <View style={s.pickerHeader}>
              <Text style={s.pickerTitle}>Secteur d'activité</Text>
              <TouchableOpacity onPress={() => setShowSecteurPicker(false)}>
                <Ionicons name="close" size={20} color={colors.bordeaux} />
              </TouchableOpacity>
            </View>
            {SECTEURS.map(sec => (
              <TouchableOpacity
                key={sec}
                style={[s.pickerItem, secteur === sec && s.pickerItemActive]}
                onPress={() => { setSecteur(sec); setShowSecteurPicker(false); }}
              >
                <Text style={[s.pickerItemText, secteur === sec && s.pickerItemTextActive]}>{sec}</Text>
                {secteur === sec && <Ionicons name="checkmark" size={16} color={colors.terra} />}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>
    </Modal>
  );
}

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
          <View style={s.linksRow}>
            {partenaire.site_web ? (
              <TouchableOpacity style={s.siteLink} onPress={() => Linking.openURL(partenaire.site_web!)}>
                <Ionicons name="globe-outline" size={14} color={colors.terra} />
                <Text style={s.siteLinkText}>Site web</Text>
              </TouchableOpacity>
            ) : null}
            {partenaire.instagram_url ? (
              <TouchableOpacity style={s.siteLink} onPress={() => Linking.openURL(partenaire.instagram_url!)}>
                <Ionicons name="logo-instagram" size={14} color={colors.terra} />
                <Text style={s.siteLinkText}>Instagram</Text>
              </TouchableOpacity>
            ) : null}
            {partenaire.tiktok_url ? (
              <TouchableOpacity style={s.siteLink} onPress={() => Linking.openURL(partenaire.tiktok_url!)}>
                <Ionicons name="logo-tiktok" size={14} color={colors.terra} />
                <Text style={s.siteLinkText}>TikTok</Text>
              </TouchableOpacity>
            ) : null}
          </View>

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

          {/* Actualités */}
          {otherPosts.length > 0 ? (
            <>
              <Text style={s.sectionTitle}>Actualités</Text>
              {otherPosts.map(post => {
                const periode = buildPeriode(post);
                const isRevealed = revealed[post.id];
                return (
                  <View key={post.id} style={s.postItem}>
                    {post.image_url
                      ? <Image source={{ uri: post.image_url }} style={s.postItemImg} resizeMode="cover" />
                      : null}
                    <View style={s.postItemBody}>
                      <Text style={s.postItemTitle}>{post.titre}</Text>
                      {post.contenu ? <Text style={s.postItemDesc}>{post.contenu}</Text> : null}

                      <View style={s.postItemFooter}>
                        {periode ? <Text style={s.postItemMeta}>{periode}</Text> : null}
                        {post.lien ? (
                          <TouchableOpacity style={s.ctaBtn} onPress={() => Linking.openURL(post.lien!)}>
                            <Text style={s.ctaBtnText}>Voir</Text>
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

          {/* Offres du moment */}
          {offerPosts.length > 0 ? (
            <>
              <View style={s.offerSectionHeader}>
                <Ionicons name="pricetag" size={14} color={colors.terra} />
                <Text style={s.offerSectionTitle}>Offres du moment</Text>
              </View>
              {offerPosts.map(post => {
                const periode = buildPeriode(post);
                return (
                  <View key={post.id} style={s.offerCard}>
                    {post.image_url
                      ? <Image source={{ uri: post.image_url }} style={s.offerCardImg} resizeMode="cover" />
                      : null}
                    <View style={s.offerCardBody}>
                      <Text style={s.offerCardTitle}>{post.titre}</Text>
                      {post.contenu ? <Text style={s.postItemDesc}>{post.contenu}</Text> : null}

                      {post.code_promo ? (
                        revealed[post.id] ? (
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
                            onPress={() => setRevealed(prev => ({ ...prev, [post.id]: true }))}
                          >
                            <Ionicons name="lock-open-outline" size={14} color={colors.ivory} />
                            <Text style={s.revealBtnText}>Voir le code</Text>
                          </TouchableOpacity>
                        )
                      ) : null}

                      <View style={s.postItemFooter}>
                        {periode ? <Text style={s.postItemMeta}>{periode}</Text> : null}
                        {post.lien ? (
                          <TouchableOpacity style={s.ctaBtn} onPress={() => Linking.openURL(post.lien!)}>
                            <Text style={s.ctaBtnText}>Profiter de l'offre</Text>
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

// ── Actualité card (horizontal scroll) ──────────────────────────────────────

function ActuCard({
  post, partenaire, onPress,
}: {
  post: Post; partenaire: Partenaire; onPress: () => void;
}) {
  const periode = buildPeriode(post);
  return (
    <TouchableOpacity style={s.actuCard} onPress={onPress} activeOpacity={0.88}>
      <View style={s.actuCardImg}>
        {post.image_url
          ? <Image source={{ uri: post.image_url }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
          : <View style={[StyleSheet.absoluteFillObject, s.actuCardImgFallback]} />}
        <LinearGradient
          colors={['transparent', 'rgba(61,26,26,0.75)']}
          style={StyleSheet.absoluteFillObject}
        />
        <View style={s.actuCardTypeBadge}>
          <Text style={s.actuCardTypeBadgeText}>{TYPE_LABEL[post.type] || post.type}</Text>
        </View>
        <View style={s.actuCardBrandRow}>
          <View style={s.actuCardBrandLogo}>
            {partenaire.logo_url
              ? <Image source={{ uri: partenaire.logo_url }} style={s.actuCardBrandLogoImg} resizeMode="contain" />
              : <Text style={s.actuCardBrandLogoFallback}>{partenaire.nom[0]}</Text>}
          </View>
          <Text style={s.actuCardBrandName} numberOfLines={1}>{partenaire.nom}</Text>
        </View>
      </View>
      <View style={s.actuCardBody}>
        <Text style={s.actuCardTitle} numberOfLines={2}>{post.titre}</Text>
        {periode ? <Text style={s.actuCardMeta} numberOfLines={1}>{periode}</Text> : null}
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
  const [showCandidature, setShowCandidature] = useState(false);

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

        {allPosts.length > 0 ? (
          <View style={s.actuSection}>
            <Text style={s.actuSectionTitle}>Actualités du moment</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.actuList}
            >
              {allPosts.map(post => {
                const partenaire = partenaires.find(p => p.id === post.partenaire_id);
                if (!partenaire) return null;
                return (
                  <ActuCard
                    key={post.id}
                    post={post}
                    partenaire={partenaire}
                    onPress={() => setSelectedBrand(partenaire)}
                  />
                );
              })}
            </ScrollView>
          </View>
        ) : null}

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

        {/* CTA marques */}
        <View style={s.brandCta}>
          <Ionicons name="storefront-outline" size={28} color={colors.terra} />
          <Text style={s.brandCtaTitle}>Vous êtes une marque dog-friendly ?</Text>
          <Text style={s.brandCtaText}>Rejoignez nos partenaires et partagez vos offres avec toute la communauté.</Text>
          <TouchableOpacity style={s.brandCtaBtn} onPress={() => setShowCandidature(true)}>
            <Text style={s.brandCtaBtnLabel}>Postuler comme partenaire</Text>
            <Ionicons name="arrow-forward" size={14} color={colors.ivory} />
          </TouchableOpacity>
        </View>
      </ScrollView>

      <BrandModal
        partenaire={selectedBrand}
        posts={selectedBrand ? postsFor(selectedBrand.id) : []}
        visible={!!selectedBrand}
        onClose={() => setSelectedBrand(null)}
      />

      <CandidatureMarqueModal
        visible={showCandidature}
        onClose={() => setShowCandidature(false)}
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

  // Actualités du moment (horizontal scroll)
  actuSection: { marginBottom: 22 },
  actuSectionTitle: {
    fontFamily: 'PlayfairDisplay_500Medium', fontSize: 16, color: colors.bordeaux,
    paddingHorizontal: 28, marginBottom: 12,
  },
  actuList: { paddingHorizontal: 28, gap: 12 },
  actuCard: {
    width: 172, borderRadius: 16, overflow: 'hidden', backgroundColor: colors.white,
    borderWidth: 1, borderColor: colors.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 2,
  },
  actuCardImg: { width: '100%', height: 104, backgroundColor: colors.bordeaux, position: 'relative' },
  actuCardImgFallback: { backgroundColor: colors.bordeaux },
  actuCardTypeBadge: {
    position: 'absolute', top: 8, left: 8,
    backgroundColor: 'rgba(245,239,224,0.92)', borderRadius: 20,
    paddingHorizontal: 7, paddingVertical: 3,
  },
  actuCardTypeBadgeText: { fontFamily: 'DMSans_500Medium', fontSize: 8, color: colors.terra, letterSpacing: 0.4, textTransform: 'uppercase' },
  actuCardBrandRow: {
    position: 'absolute', bottom: 8, left: 8, right: 8,
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  actuCardBrandLogo: {
    width: 22, height: 22, borderRadius: 6, backgroundColor: colors.white, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.white,
  },
  actuCardBrandLogoImg: { width: '100%', height: '100%', padding: 2 },
  actuCardBrandLogoFallback: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 11, color: colors.bordeaux },
  actuCardBrandName: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: '#fff', flex: 1 },
  actuCardBody: { padding: 11, gap: 3, minHeight: 66 },
  actuCardTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 13, color: colors.bordeaux, lineHeight: 17 },
  actuCardMeta: { fontFamily: 'DMSans_400Regular', fontSize: 10, color: colors.textMuted, marginTop: 2 },

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
  linksRow: { flexDirection: 'row', gap: 16, marginBottom: 14 },
  siteLink: { flexDirection: 'row', alignItems: 'center', gap: 6 },
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

  // Offres section
  offerSectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    marginTop: 28, marginBottom: 14,
    paddingTop: 20, borderTopWidth: 1, borderTopColor: colors.border,
  },
  offerSectionTitle: {
    fontFamily: 'DMSans_500Medium', fontSize: 13, letterSpacing: 0.4,
    textTransform: 'uppercase', color: colors.terra,
  },
  offerCard: {
    backgroundColor: colors.white, borderRadius: 16, overflow: 'hidden',
    borderWidth: 1.5, borderColor: colors.terra,
    marginBottom: 14,
    shadowColor: colors.terra, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 8, elevation: 3,
  },
  offerCardImg: { width: '100%', height: 180 },
  offerCardBody: { padding: 16, gap: 6 },
  offerCardTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: colors.bordeaux, lineHeight: 24 },

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
  mailBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start',
    backgroundColor: colors.bordeaux, borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 9, marginTop: 6,
  },

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

  // Brand CTA section
  brandCta: {
    margin: 28, marginTop: 20, padding: 24,
    backgroundColor: colors.white, borderRadius: 20,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', gap: 10,
    marginBottom: 12,
  },
  brandCtaTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: colors.bordeaux, textAlign: 'center' },
  brandCtaText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted, textAlign: 'center', lineHeight: 20 },
  brandCtaBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: colors.bordeaux, borderRadius: 20,
    paddingHorizontal: 18, paddingVertical: 11, marginTop: 4,
  },
  brandCtaBtnLabel: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.ivory },

  // Candidature modal
  candidContainer: { flex: 1, backgroundColor: colors.ivoryPale },
  candidHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 24, paddingBottom: 12,
  },
  candidTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 22, color: colors.bordeaux },
  candidIntro: {
    fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMid,
    lineHeight: 20, paddingHorizontal: 20, marginBottom: 20,
  },
  candidLabel: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.bordeaux, paddingHorizontal: 20, marginBottom: 6, marginTop: 14 },
  candidInput: {
    marginHorizontal: 20, backgroundColor: colors.white, borderRadius: 10,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 14, paddingVertical: 11,
    fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.bordeaux,
  },
  candidSelect: {
    marginHorizontal: 20, backgroundColor: colors.white, borderRadius: 10,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 14, paddingVertical: 13,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  candidSelectText: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.bordeaux },
  candidBtn: {
    marginHorizontal: 20, marginTop: 24, backgroundColor: colors.bordeaux,
    borderRadius: 12, paddingVertical: 15, alignItems: 'center',
  },
  candidBtnLabel: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: colors.ivory },
  candidSentTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 22, color: colors.bordeaux },
  candidSentText: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.textMuted },

  // Secteur picker
  pickerOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  pickerSheet: { backgroundColor: colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 32 },
  pickerHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  pickerTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: colors.bordeaux },
  pickerItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  pickerItemActive: { backgroundColor: 'rgba(196,105,58,0.06)' },
  pickerItemText: { fontFamily: 'DMSans_400Regular', fontSize: 15, color: colors.bordeaux },
  pickerItemTextActive: { fontFamily: 'DMSans_500Medium', color: colors.terra },
});
