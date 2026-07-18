import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Image, ActivityIndicator, Dimensions, FlatList,
  Modal, TextInput, Linking, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import { mapNavigation } from '../lib/mapNavigation';

const SCREEN_W = Dimensions.get('window').width;
const CARD_W = SCREEN_W * 0.56;
const FEATURED_H = 200;

const GOOGLE_KEY = 'AIzaSyAvVkbdbfvP3Rkp59754kDfhyDYD0xLNvA';

const CAT_CHIPS: { key: string | null; label: string; emoji: string }[] = [
  { key: null,         label: 'Tous',          emoji: '✨' },
  { key: 'parc',       label: 'Parcs',         emoji: '🌿' },
  { key: 'parc_chien', label: 'Espaces canins',emoji: '🐾' },
  { key: 'restaurant', label: 'Restos',        emoji: '🍽️' },
  { key: 'cafe',       label: 'Cafés',         emoji: '☕' },
  { key: 'veto',       label: 'Vétos',         emoji: '🏥' },
  { key: 'toiletteur', label: 'Toilettage',    emoji: '✂️' },
  { key: 'plage',      label: 'Plages',        emoji: '🏖️' },
  { key: 'boutique',   label: 'Boutiques',     emoji: '🛍️' },
];

const CAT_COLOR: Record<string, string> = {
  restaurant: '#C4693A', cafe: '#A0522D', parc: '#5A9E6F', parc_chien: '#3D1A1A',
  plage: '#7ABFCC', veto: '#5A7FA5', toiletteur: '#7B7AAA', boutique: '#8B5A2B',
  hotel: '#4A7FA5', bar: '#8B5E3C', autre: '#7A7A7A',
};

const CAT_LABEL: Record<string, string> = {
  restaurant: 'Restaurant', cafe: 'Café', parc: 'Parc', parc_chien: 'Espace canin',
  plage: 'Plage', veto: 'Vétérinaire', toiletteur: 'Toiletteur', boutique: 'Boutique',
  hotel: 'Hôtel', bar: 'Bar', autre: 'Autre',
};

type LieuCard = {
  id: string; nom: string; cat: string; ville: string;
  note_moyenne?: number | null; photoUrl?: string | null;
  google_photo_url?: string | null;
};

type ExplorateurLieu = {
  lieu_id: string; nom: string; cat: string; ville: string;
  commentaire: string | null; photoUrl?: string | null;
};

type Explorateur = {
  id: string; nom: string; handle: string | null; bio: string | null;
  photo_profil_url: string | null; photo_banniere_url: string | null;
  instagram_url: string | null; tiktok_url: string | null;
  youtube_url: string | null; site_web: string | null;
  nb_abonnes: number | null; lieux?: ExplorateurLieu[];
};

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchPhotosForLieux(ids: string[]): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const { data } = await supabase
    .from('photos').select('lieu_id,url')
    .in('lieu_id', ids).eq('validee', true)
    .order('created_at', { ascending: false });
  const map: Record<string, string> = {};
  (data || []).forEach((p: any) => { if (!map[p.lieu_id]) map[p.lieu_id] = p.url; });
  return map;
}

async function fetchGooglePhoto(lieu: { id: string; nom: string; ville: string }): Promise<string | null> {
  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_KEY,
        'X-Goog-FieldMask': 'places.photos',
      },
      body: JSON.stringify({ textQuery: `${lieu.nom} ${lieu.ville} France`, languageCode: 'fr', maxResultCount: 1 }),
    });
    const json = await res.json();
    const photoName = json.places?.[0]?.photos?.[0]?.name;
    if (!photoName) return null;
    const photoUrl = `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=800&key=${GOOGLE_KEY}`;
    supabase.from('lieux').update({ google_photo_url: photoUrl }).eq('id', lieu.id);
    return photoUrl;
  } catch {
    return null;
  }
}

function ExplorateurCard({ exp, onPress }: { exp: Explorateur; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.expCard} onPress={onPress} activeOpacity={0.88}>
      {exp.photo_banniere_url ? (
        <Image source={{ uri: exp.photo_banniere_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bordeaux }]} />
      )}
      <View style={styles.expCardOverlay}>
        <View style={styles.expStarBadge}>
          <Ionicons name="star" size={10} color={colors.terra} />
          <Text style={styles.expStarLabel}>Explorateur</Text>
        </View>
        <View style={styles.expCardBottom}>
          {exp.photo_profil_url ? (
            <Image source={{ uri: exp.photo_profil_url }} style={styles.expCardAvatar} />
          ) : (
            <View style={[styles.expCardAvatar, { backgroundColor: colors.terra, alignItems: 'center', justifyContent: 'center' }]}>
              <Ionicons name="person" size={18} color={colors.ivory} />
            </View>
          )}
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={styles.expCardNom}>{exp.nom}</Text>
            {exp.handle ? <Text style={styles.expCardHandle}>{exp.handle}</Text> : null}
          </View>
          <Ionicons name="chevron-forward" size={16} color="rgba(245,239,224,0.5)" />
        </View>
      </View>
    </TouchableOpacity>
  );
}

function ExplorateurModal({
  exp, onClose, onLieuPress,
}: { exp: Explorateur; onClose: () => void; onLieuPress: (id: string) => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.expModalContainer, { paddingTop: insets.top }]}>
        {/* Banner */}
        <View style={styles.expModalBanner}>
          {exp.photo_banniere_url ? (
            <Image source={{ uri: exp.photo_banniere_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bordeaux }]} />
          )}
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(61,26,26,0.35)' }]} />
          <TouchableOpacity style={styles.expModalCloseBtn} onPress={onClose}>
            <Ionicons name="close" size={20} color={colors.ivory} />
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
          {/* Avatar + infos */}
          <View style={styles.expModalHeader}>
            {exp.photo_profil_url ? (
              <Image source={{ uri: exp.photo_profil_url }} style={styles.expModalAvatar} />
            ) : (
              <View style={[styles.expModalAvatar, { backgroundColor: colors.terra, alignItems: 'center', justifyContent: 'center' }]}>
                <Ionicons name="person" size={26} color={colors.ivory} />
              </View>
            )}
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={styles.expModalNom}>{exp.nom}</Text>
              {exp.handle ? <Text style={styles.expModalHandle}>{exp.handle}</Text> : null}
              {exp.nb_abonnes ? (
                <Text style={styles.expModalAbonnes}>{exp.nb_abonnes.toLocaleString('fr-FR')} abonnés</Text>
              ) : null}
            </View>
          </View>

          {/* Bio */}
          {exp.bio ? <Text style={styles.expModalBio}>{exp.bio}</Text> : null}

          {/* Liens sociaux */}
          <View style={styles.expModalLinks}>
            {exp.instagram_url ? (
              <TouchableOpacity style={styles.expLink} onPress={() => Linking.openURL(exp.instagram_url!)}>
                <Ionicons name="logo-instagram" size={15} color={colors.ivory} />
                <Text style={styles.expLinkLabel}>Instagram</Text>
              </TouchableOpacity>
            ) : null}
            {exp.tiktok_url ? (
              <TouchableOpacity style={styles.expLink} onPress={() => Linking.openURL(exp.tiktok_url!)}>
                <Ionicons name="musical-notes-outline" size={15} color={colors.ivory} />
                <Text style={styles.expLinkLabel}>TikTok</Text>
              </TouchableOpacity>
            ) : null}
            {exp.youtube_url ? (
              <TouchableOpacity style={styles.expLink} onPress={() => Linking.openURL(exp.youtube_url!)}>
                <Ionicons name="logo-youtube" size={15} color={colors.ivory} />
                <Text style={styles.expLinkLabel}>YouTube</Text>
              </TouchableOpacity>
            ) : null}
            {exp.site_web ? (
              <TouchableOpacity style={styles.expLink} onPress={() => Linking.openURL(exp.site_web!)}>
                <Ionicons name="globe-outline" size={15} color={colors.ivory} />
                <Text style={styles.expLinkLabel}>Site</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Coups de cœur */}
          {exp.lieux && exp.lieux.length > 0 && (
            <View style={styles.expModalSection}>
              <Text style={styles.expModalSectionTitle}>Ses coups de cœur</Text>
              {exp.lieux.map(l => (
                <TouchableOpacity key={l.lieu_id} style={styles.expLieuRow} onPress={() => { onClose(); onLieuPress(l.lieu_id); }}>
                  {l.photoUrl ? (
                    <Image source={{ uri: l.photoUrl }} style={styles.expLieuThumb} resizeMode="cover" />
                  ) : (
                    <View style={[styles.expLieuThumb, { backgroundColor: (CAT_COLOR[l.cat] || colors.textMuted) + '18', alignItems: 'center', justifyContent: 'center' }]}>
                      <Ionicons name="location-outline" size={16} color={colors.textMuted} />
                    </View>
                  )}
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.expLieuNom}>{l.nom}</Text>
                    <Text style={styles.expLieuVille}>{l.ville}</Text>
                    {l.commentaire ? <Text style={styles.expLieuComment} numberOfLines={2}>"{l.commentaire}"</Text> : null}
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              ))}
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function CandidatureModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const [nom, setNom] = useState('');
  const [instagram, setInstagram] = useState('');
  const [tiktok, setTiktok] = useState('');
  const [nbAbonnes, setNbAbonnes] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit() {
    if (!nom.trim()) return;
    setSending(true);
    await supabase.from('explorateur_candidatures').insert({
      user_id: userId,
      nom: nom.trim(),
      instagram_url: instagram.trim() || null,
      tiktok_url: tiktok.trim() || null,
      nb_abonnes: nbAbonnes ? parseInt(nbAbonnes, 10) : null,
      message: message.trim() || null,
    });
    setSending(false);
    setSent(true);
  }

  return (
    <Modal visible animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView style={styles.candidContainer} contentContainerStyle={{ paddingBottom: 40 }}>
          <View style={styles.candidHeader}>
            <Text style={styles.candidTitle}>Devenir Explorateur</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={22} color={colors.bordeaux} />
            </TouchableOpacity>
          </View>
          {sent ? (
            <View style={{ alignItems: 'center', paddingVertical: 40, gap: 12 }}>
              <Ionicons name="checkmark-circle" size={56} color={colors.terra} />
              <Text style={styles.candidSentText}>Candidature envoyée !</Text>
              <Text style={[styles.candidLabel, { textAlign: 'center' }]}>On revient vers toi très vite 🐾</Text>
              <TouchableOpacity style={styles.candidBtn} onPress={onClose}>
                <Text style={styles.candidBtnLabel}>Fermer</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text style={styles.candidIntro}>
                Rejoins les Explorateurs The Pack Club et partage tes adresses dog-friendly préférées avec toute la communauté.
              </Text>
              <Text style={styles.candidLabel}>Ton nom ou pseudo *</Text>
              <TextInput style={styles.candidInput} value={nom} onChangeText={setNom} placeholder="Ex: Bella & Moi" placeholderTextColor={colors.textMuted} />
              <Text style={styles.candidLabel}>Compte Instagram</Text>
              <TextInput style={styles.candidInput} value={instagram} onChangeText={setInstagram} placeholder="https://instagram.com/..." placeholderTextColor={colors.textMuted} autoCapitalize="none" keyboardType="url" />
              <Text style={styles.candidLabel}>Compte TikTok</Text>
              <TextInput style={styles.candidInput} value={tiktok} onChangeText={setTiktok} placeholder="https://tiktok.com/@..." placeholderTextColor={colors.textMuted} autoCapitalize="none" keyboardType="url" />
              <Text style={styles.candidLabel}>Nombre d'abonnés (approx.)</Text>
              <TextInput style={styles.candidInput} value={nbAbonnes} onChangeText={setNbAbonnes} placeholder="Ex: 5000" placeholderTextColor={colors.textMuted} keyboardType="number-pad" />
              <Text style={styles.candidLabel}>Dis-nous en plus</Text>
              <TextInput
                style={[styles.candidInput, { height: 90, textAlignVertical: 'top', paddingTop: 10 }]}
                value={message} onChangeText={setMessage}
                placeholder="Ta passion pour les chiens, tes adresses coups de cœur..."
                placeholderTextColor={colors.textMuted} multiline numberOfLines={4}
              />
              <TouchableOpacity style={[styles.candidBtn, (!nom.trim() || sending) && { opacity: 0.5 }]} onPress={submit} disabled={!nom.trim() || sending}>
                <Text style={styles.candidBtnLabel}>{sending ? 'Envoi en cours...' : 'Envoyer ma candidature'}</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SmallCard({ lieu, onPress }: { lieu: LieuCard; onPress: () => void }) {
  const color = CAT_COLOR[lieu.cat] || colors.textMuted;
  const label = CAT_LABEL[lieu.cat] || lieu.cat;
  return (
    <TouchableOpacity style={styles.smallCard} onPress={onPress} activeOpacity={0.85}>
      {lieu.photoUrl ? (
        <Image source={{ uri: lieu.photoUrl }} style={styles.smallCardPhoto} resizeMode="cover" />
      ) : (
        <View style={[styles.smallCardPhoto, { backgroundColor: color + '18', alignItems: 'center', justifyContent: 'center' }]}>
          <Ionicons name="image-outline" size={28} color={color + '55'} />
        </View>
      )}
      <View style={styles.smallCardBody}>
        <Text style={styles.smallCardNom} numberOfLines={2}>{lieu.nom}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <View style={[styles.catDot, { backgroundColor: color }]} />
          <Text style={styles.smallCardCat}>{label}</Text>
        </View>
        <Text style={styles.smallCardVille} numberOfLines={1}>{lieu.ville}</Text>
        {lieu.note_moyenne ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 }}>
            <Ionicons name="star" size={10} color={colors.terra} />
            <Text style={styles.smallCardRating}>{lieu.note_moyenne.toFixed(1)}</Text>
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

function FeaturedCard({ lieu, onPress }: { lieu: LieuCard; onPress: () => void }) {
  const color = CAT_COLOR[lieu.cat] || colors.textMuted;
  const label = CAT_LABEL[lieu.cat] || lieu.cat;
  return (
    <TouchableOpacity style={styles.featuredCard} onPress={onPress} activeOpacity={0.88}>
      {lieu.photoUrl ? (
        <Image source={{ uri: lieu.photoUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: color + '22', alignItems: 'center', justifyContent: 'center' }]}>
          <Ionicons name="image-outline" size={48} color={color + '55'} />
        </View>
      )}
      <View style={styles.featuredGradient}>
        <View style={[styles.featuredCatBadge, { backgroundColor: color }]}>
          <Text style={styles.featuredCatLabel}>{label}</Text>
        </View>
        <Text style={styles.featuredNom} numberOfLines={2}>{lieu.nom}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="location-outline" size={12} color="rgba(245,239,224,0.8)" />
          <Text style={styles.featuredVille}>{lieu.ville}</Text>
          {lieu.note_moyenne ? (
            <>
              <Ionicons name="star" size={11} color={colors.terraPale} />
              <Text style={styles.featuredRating}>{lieu.note_moyenne.toFixed(1)}</Text>
            </>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function ExplorerScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();

  const [userId, setUserId] = useState<string | null>(null);
  const [prenom, setPrenom] = useState<string | null>(null);
  const [nomChien, setNomChien] = useState<string | null>(null);
  const [activeCat, setActiveCat] = useState<string | null>(null);

  const [favorisLieux, setFavorisLieux] = useState<LieuCard[]>([]);
  const [nearbyLieux, setNearbyLieux] = useState<LieuCard[]>([]);
  const [topLieux, setTopLieux] = useState<LieuCard[]>([]);
  const [featuredLieu, setFeaturedLieu] = useState<LieuCard | null>(null);
  const [loading, setLoading] = useState(true);

  const [explorateurs, setExplorateurs] = useState<Explorateur[]>([]);
  const [selectedExplorateur, setSelectedExplorateur] = useState<Explorateur | null>(null);
  const [showCandidature, setShowCandidature] = useState(false);

  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLng, setUserLng] = useState<number | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user.id) {
        setUserId(session.user.id);
        supabase.from('profils').select('prenom,nom_chien').eq('id', session.user.id).single()
          .then(({ data }) => { setPrenom(data?.prenom || null); setNomChien(data?.nom_chien || null); });
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user.id ?? null);
      if (session?.user.id) {
        supabase.from('profils').select('prenom,nom_chien').eq('id', session.user.id).single()
          .then(({ data }) => { setPrenom(data?.prenom || null); setNomChien(data?.nom_chien || null); });
      } else { setPrenom(null); setNomChien(null); }
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({});
        setUserLat(loc.coords.latitude);
        setUserLng(loc.coords.longitude);
      }
    })();
  }, []);

  useFocusEffect(useCallback(() => {
    loadAll();
  }, [userId, userLat, userLng, activeCat]));

  async function loadAll() {
    setLoading(true);
    await Promise.all([
      loadNearby(),
      loadTopLieux(),
      loadExplorateurs(),
      userId ? loadFavoris() : Promise.resolve(),
    ]);
    setLoading(false);
  }

  async function loadExplorateurs() {
    const { data } = await supabase
      .from('explorateurs')
      .select('id,nom,handle,bio,photo_profil_url,photo_banniere_url,instagram_url,tiktok_url,youtube_url,site_web,nb_abonnes')
      .eq('statut', 'actif')
      .order('ordre', { ascending: true });
    setExplorateurs(data || []);
  }

  async function openExplorateur(exp: Explorateur) {
    setSelectedExplorateur(exp);
    const { data: elData } = await supabase
      .from('explorateur_lieux')
      .select('lieu_id,commentaire,ordre,lieux(nom,cat,ville,google_photo_url)')
      .eq('explorateur_id', exp.id)
      .order('ordre', { ascending: true });
    if (!elData?.length) { setSelectedExplorateur({ ...exp, lieux: [] }); return; }
    const lieuIds = elData.map((r: any) => r.lieu_id);
    const photos = await fetchPhotosForLieux(lieuIds);
    const lieux: ExplorateurLieu[] = elData.map((r: any) => ({
      lieu_id: r.lieu_id,
      nom: r.lieux?.nom || '',
      cat: r.lieux?.cat || '',
      ville: r.lieux?.ville || '',
      commentaire: r.commentaire,
      photoUrl: photos[r.lieu_id] || r.lieux?.google_photo_url || null,
    }));
    setSelectedExplorateur({ ...exp, lieux });
  }

  async function loadFavoris() {
    if (!userId) return;
    const { data: favs } = await supabase
      .from('favoris').select('lieu_id').eq('user_id', userId).eq('liste', 'favori').limit(10);
    const ids = (favs || []).map((f: any) => f.lieu_id);
    if (!ids.length) { setFavorisLieux([]); return; }
    let q = supabase.from('lieux').select('id,nom,cat,ville,note_moyenne,google_photo_url').in('id', ids).eq('actif', true);
    if (activeCat) q = (q as any).eq('cat', activeCat);
    const { data } = await q;
    const lieux = data || [];
    const photos = await fetchPhotosForLieux(lieux.map((l: any) => l.id));
    const mapped = lieux.map((l: any) => ({ ...l, photoUrl: photos[l.id] || l.google_photo_url || null }));
    setFavorisLieux(mapped);
    mapped.filter((l: LieuCard) => !l.photoUrl).forEach((l: LieuCard) =>
      fetchGooglePhoto(l).then(url => { if (url) setFavorisLieux(prev => prev.map(p => p.id === l.id ? { ...p, photoUrl: url } : p)); })
    );
  }

  async function loadNearby() {
    let q = supabase.from('lieux').select('id,nom,cat,ville,lat,lng,note_moyenne,google_photo_url').eq('actif', true);
    if (activeCat) q = (q as any).eq('cat', activeCat);
    if (userLat && userLng) {
      const delta = 0.12;
      q = (q as any)
        .gte('lat', userLat - delta).lte('lat', userLat + delta)
        .gte('lng', userLng - delta).lte('lng', userLng + delta);
    }
    q = (q as any).limit(20);
    const { data } = await q;
    let lieux = data || [];
    if (userLat && userLng) {
      lieux = lieux
        .sort((a: any, b: any) => haversine(userLat!, userLng!, a.lat, a.lng) - haversine(userLat!, userLng!, b.lat, b.lng))
        .slice(0, 10);
    } else {
      lieux = lieux.slice(0, 10);
    }
    const photos = await fetchPhotosForLieux(lieux.map((l: any) => l.id));
    const withPhotos = lieux.map((l: any) => ({ ...l, photoUrl: photos[l.id] || l.google_photo_url || null }));
    setNearbyLieux(withPhotos);
    const featured = withPhotos.find((l: LieuCard) => l.photoUrl) || withPhotos[0] || null;
    setFeaturedLieu(featured);
    withPhotos.filter((l: LieuCard) => !l.photoUrl).forEach((l: LieuCard) =>
      fetchGooglePhoto(l).then(url => {
        if (!url) return;
        setNearbyLieux(prev => prev.map(p => p.id === l.id ? { ...p, photoUrl: url } : p));
        setFeaturedLieu(prev => prev?.id === l.id ? { ...prev, photoUrl: url } : prev);
      })
    );
  }

  async function loadTopLieux() {
    let q = supabase.from('lieux').select('id,nom,cat,ville,note_moyenne,google_photo_url')
      .eq('actif', true).not('note_moyenne', 'is', null)
      .order('note_moyenne', { ascending: false }).limit(10);
    if (activeCat) q = (q as any).eq('cat', activeCat);
    const { data } = await q;
    const lieux = data || [];
    const photos = await fetchPhotosForLieux(lieux.map((l: any) => l.id));
    const mapped = lieux.map((l: any) => ({ ...l, photoUrl: photos[l.id] || l.google_photo_url || null }));
    setTopLieux(mapped);
    mapped.filter((l: LieuCard) => !l.photoUrl).forEach((l: LieuCard) =>
      fetchGooglePhoto(l).then(url => { if (url) setTopLieux(prev => prev.map(p => p.id === l.id ? { ...p, photoUrl: url } : p)); })
    );
  }

  function openLieu(lieuId: string) {
    mapNavigation.setPendingLieu(lieuId);
    navigation.navigate('Carte');
  }

  const greeting = prenom ? `Bonjour, ${prenom} 🐾` : 'Bonjour 🐾';
  const nearbyTitle = nomChien ? `Près de ${nomChien}` : 'Près de toi';
  const favorisTitle = prenom ? `Les coups de cœur de ${prenom}` : 'Mes coups de cœur';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>{greeting}</Text>
            <Text style={styles.subtitle}>
              {nomChien ? `Où sortir avec ${nomChien} ?` : 'Où sortir avec ton chien ?'}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.searchBtn}
            onPress={() => navigation.navigate('Carte')}
            activeOpacity={0.8}
          >
            <Ionicons name="search-outline" size={19} color={colors.bordeaux} />
          </TouchableOpacity>
        </View>

        {/* Category chips */}
        <ScrollView
          horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
        >
          {CAT_CHIPS.map(c => {
            const active = activeCat === c.key;
            return (
              <TouchableOpacity
                key={String(c.key)}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setActiveCat(activeCat === c.key ? null : c.key)}
              >
                <Text style={styles.chipEmoji}>{c.emoji}</Text>
                <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{c.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {loading ? (
          <ActivityIndicator color={colors.terra} style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* Featured card */}
            {featuredLieu && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>À découvrir</Text>
                <FeaturedCard lieu={featuredLieu} onPress={() => openLieu(featuredLieu.id)} />
              </View>
            )}

            {/* Explorateurs */}
            {explorateurs.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Les Explorateurs</Text>
                  {userId && (
                    <TouchableOpacity onPress={() => setShowCandidature(true)}>
                      <Text style={styles.seeAll}>Rejoindre →</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <FlatList
                  data={explorateurs}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyExtractor={e => e.id}
                  contentContainerStyle={styles.cardsRow}
                  renderItem={({ item }) => (
                    <ExplorateurCard exp={item} onPress={() => openExplorateur(item)} />
                  )}
                />
              </View>
            )}

            {/* Nearby */}
            {nearbyLieux.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>{nearbyTitle}</Text>
                  <TouchableOpacity onPress={() => navigation.navigate('Carte')}>
                    <Text style={styles.seeAll}>Voir la carte →</Text>
                  </TouchableOpacity>
                </View>
                <FlatList
                  data={nearbyLieux.filter(l => l.id !== featuredLieu?.id)}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyExtractor={i => i.id}
                  contentContainerStyle={styles.cardsRow}
                  renderItem={({ item }) => (
                    <SmallCard lieu={item} onPress={() => openLieu(item.id)} />
                  )}
                />
              </View>
            )}

            {/* Favoris */}
            {userId && favorisLieux.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>{favorisTitle}</Text>
                <FlatList
                  data={favorisLieux}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyExtractor={i => i.id}
                  contentContainerStyle={styles.cardsRow}
                  renderItem={({ item }) => (
                    <SmallCard lieu={item} onPress={() => openLieu(item.id)} />
                  )}
                />
              </View>
            )}

            {/* Top rated */}
            {topLieux.length > 0 && (
              <View style={[styles.section, { marginBottom: 40 }]}>
                <Text style={styles.sectionTitle}>Les mieux notés</Text>
                <FlatList
                  data={topLieux}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyExtractor={i => i.id}
                  contentContainerStyle={styles.cardsRow}
                  renderItem={({ item }) => (
                    <SmallCard lieu={item} onPress={() => openLieu(item.id)} />
                  )}
                />
              </View>
            )}
          </>
        )}
      </ScrollView>

      {selectedExplorateur && (
        <ExplorateurModal
          exp={selectedExplorateur}
          onClose={() => setSelectedExplorateur(null)}
          onLieuPress={openLieu}
        />
      )}

      {showCandidature && userId && (
        <CandidatureModal userId={userId} onClose={() => setShowCandidature(false)} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ivoryLight },

  header: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
  },
  greeting: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted, marginBottom: 2 },
  subtitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 22, color: colors.bordeaux, lineHeight: 28, maxWidth: SCREEN_W - 80 },
  searchBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2,
    marginTop: 4,
  },

  chipsRow: { paddingHorizontal: 16, paddingBottom: 4, gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 13, paddingVertical: 7,
    backgroundColor: '#fff', borderRadius: 20,
    borderWidth: 1, borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.bordeaux, borderColor: colors.bordeaux },
  chipEmoji: { fontSize: 13 },
  chipLabel: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.bordeaux },
  chipLabelActive: { color: colors.ivory },

  section: { paddingHorizontal: 20, marginTop: 26 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  sectionTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 19, color: colors.bordeaux, marginBottom: 14 },
  seeAll: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.terra },

  // Featured card
  featuredCard: {
    width: '100%', height: FEATURED_H, borderRadius: 16,
    overflow: 'hidden', backgroundColor: colors.border,
  },
  featuredGradient: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: 14,
    backgroundColor: 'rgba(61,26,26,0.62)',
    gap: 4,
  },
  featuredCatBadge: {
    alignSelf: 'flex-start', borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 3, marginBottom: 4,
  },
  featuredCatLabel: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: '#fff', textTransform: 'uppercase', letterSpacing: 0.5 },
  featuredNom: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: '#fff', lineHeight: 22 },
  featuredVille: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: 'rgba(245,239,224,0.8)' },
  featuredRating: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.terraPale },

  // Explorateur cards
  expCard: {
    width: SCREEN_W * 0.70, height: 158, borderRadius: 16, overflow: 'hidden',
    backgroundColor: colors.bordeaux,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 5,
  },
  expCardOverlay: {
    flex: 1, justifyContent: 'space-between', padding: 14,
    backgroundColor: 'rgba(61,26,26,0.55)',
  },
  expStarBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(245,239,224,0.15)',
    borderWidth: 1, borderColor: 'rgba(245,239,224,0.25)',
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20,
  },
  expStarLabel: { fontFamily: 'DMSans_500Medium', fontSize: 10, color: colors.ivory, letterSpacing: 0.5 },
  expCardBottom: { flexDirection: 'row', alignItems: 'center' },
  expCardAvatar: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: colors.terraPale },
  expCardNom: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 14, color: colors.ivory },
  expCardHandle: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: 'rgba(245,239,224,0.65)', marginTop: 1 },

  // Explorateur modal
  expModalContainer: { flex: 1, backgroundColor: colors.ivoryLight },
  expModalBanner: { width: '100%', height: 220, backgroundColor: colors.bordeaux },
  expModalCloseBtn: {
    position: 'absolute', top: 16, right: 16,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(61,26,26,0.5)', alignItems: 'center', justifyContent: 'center',
  },
  expModalHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12,
  },
  expModalAvatar: {
    width: 64, height: 64, borderRadius: 32,
    borderWidth: 3, borderColor: colors.ivory,
    marginTop: -32,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 6, elevation: 4,
  },
  expModalNom: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 20, color: colors.bordeaux },
  expModalHandle: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted, marginTop: 2 },
  expModalAbonnes: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.terra, marginTop: 3 },
  expModalBio: {
    fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.textMid,
    lineHeight: 21, paddingHorizontal: 20, marginBottom: 16,
  },
  expModalLinks: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    paddingHorizontal: 20, marginBottom: 24,
  },
  expLink: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.bordeaux, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  expLinkLabel: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.ivory },
  expModalSection: { paddingHorizontal: 20 },
  expModalSectionTitle: {
    fontFamily: 'PlayfairDisplay_500Medium', fontSize: 17, color: colors.bordeaux,
    marginBottom: 14,
  },
  expLieuRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  expLieuThumb: { width: 52, height: 52, borderRadius: 10 },
  expLieuNom: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.bordeaux, marginBottom: 2 },
  expLieuVille: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted },
  expLieuComment: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.terra, marginTop: 3, fontStyle: 'italic' },

  // Candidature modal
  candidContainer: { flex: 1, backgroundColor: colors.ivoryLight },
  candidHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 24, paddingBottom: 8,
  },
  candidTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 22, color: colors.bordeaux },
  candidIntro: {
    fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.textMid,
    lineHeight: 21, paddingHorizontal: 20, marginBottom: 20,
  },
  candidLabel: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.bordeaux, paddingHorizontal: 20, marginBottom: 6, marginTop: 14 },
  candidInput: {
    marginHorizontal: 20, backgroundColor: '#fff', borderRadius: 10,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 14, paddingVertical: 11,
    fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.bordeaux,
  },
  candidBtn: {
    marginHorizontal: 20, marginTop: 24, backgroundColor: colors.bordeaux,
    borderRadius: 12, paddingVertical: 15, alignItems: 'center',
  },
  candidBtnLabel: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: colors.ivory },
  candidSentText: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 20, color: colors.bordeaux },

  // Small cards
  cardsRow: { gap: 12, paddingRight: 4, paddingBottom: 4 },
  smallCard: {
    width: CARD_W, backgroundColor: '#fff', borderRadius: 14, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 6, elevation: 3,
  },
  smallCardPhoto: { width: CARD_W, height: CARD_W * 0.62 },
  smallCardBody: { padding: 10, gap: 3 },
  smallCardNom: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.bordeaux, lineHeight: 18 },
  catDot: { width: 7, height: 7, borderRadius: 4 },
  smallCardCat: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted },
  smallCardVille: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted },
  smallCardRating: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.terra },
});
