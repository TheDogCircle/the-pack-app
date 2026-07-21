import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Image, ActivityIndicator, Dimensions, FlatList,
  Modal, TextInput, Linking, KeyboardAvoidingView, Platform, Alert,
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

const CAT_CHIPS: { key: string | null; label: string; icon: string }[] = [
  { key: null,         label: 'Tous',          icon: 'apps-outline' },
  { key: 'parc',       label: 'Parcs',         icon: 'leaf-outline' },
  { key: 'parc_chien', label: 'Espaces canins',icon: 'paw-outline' },
  { key: 'restaurant', label: 'Restos',        icon: 'restaurant-outline' },
  { key: 'cafe',       label: 'Cafés',         icon: 'cafe-outline' },
  { key: 'veto',       label: 'Vétos',         icon: 'medical-outline' },
  { key: 'toiletteur', label: 'Toilettage',    icon: 'cut-outline' },
  { key: 'plage',      label: 'Plages',        icon: 'water-outline' },
  { key: 'boutique',   label: 'Boutiques',     icon: 'bag-outline' },
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
  distance?: number; // km, only for nearby section
};

type ExplorateurLieu = {
  lieu_id: string; nom: string; cat: string; ville: string;
  commentaire: string | null; photoUrl?: string | null;
};

type RecentPhoto = {
  id: string; url: string;
  lieuId: string; lieu: { nom: string; cat: string; ville: string };
  nomChien: string | null;
  authorDisplay: string | null;
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
    await supabase.from('lieux').update({ google_photo_url: photoUrl }).eq('id', lieu.id);
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
    const { error } = await supabase.from('explorateur_candidatures').insert({
      user_id: userId,
      nom: nom.trim(),
      instagram_url: instagram.trim() || null,
      tiktok_url: tiktok.trim() || null,
      nb_abonnes: nbAbonnes ? parseInt(nbAbonnes, 10) : null,
      message: message.trim() || null,
    });
    setSending(false);
    if (error) { Alert.alert('Erreur', "Impossible d'envoyer la candidature."); return; }
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
        {lieu.distance !== undefined ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 }}>
            <Ionicons name="navigate-outline" size={10} color={colors.textMuted} />
            <Text style={styles.smallCardDist}>
              {lieu.distance < 1
                ? `${Math.round(lieu.distance * 1000)} m`
                : `${lieu.distance.toFixed(1)} km`}
            </Text>
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

function PhotoMiniCard({
  photo, liked, likeCount, onPress, onLike,
}: {
  photo: RecentPhoto;
  liked: boolean;
  likeCount: number;
  onPress: () => void;
  onLike: () => void;
}) {
  const color = CAT_COLOR[photo.lieu.cat] || colors.textMuted;
  return (
    <TouchableOpacity style={styles.photoCard} onPress={onPress} activeOpacity={0.88}>
      <Image source={{ uri: photo.url }} style={styles.photoCardImg} resizeMode="cover" />
      <View style={styles.photoCardOverlay}>
        {photo.nomChien ? (
          <View style={styles.photoCardDogTag}>
            <Text style={styles.photoCardDogText}>🐾 {photo.nomChien}</Text>
          </View>
        ) : null}
        <View style={styles.photoCardBottom}>
          <View style={[styles.photoCardCatDot, { backgroundColor: color }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.photoCardLieu} numberOfLines={1}>{photo.lieu.nom}</Text>
            {photo.authorDisplay ? (
              <Text style={styles.photoCardAuthor} numberOfLines={1}>{photo.authorDisplay}</Text>
            ) : null}
          </View>
        </View>
      </View>
      <TouchableOpacity style={styles.photoCardLike} onPress={e => { e.stopPropagation?.(); onLike(); }}>
        <Ionicons name={liked ? 'heart' : 'heart-outline'} size={15} color={liked ? '#E05070' : 'rgba(255,255,255,0.8)'} />
        {likeCount > 0 ? <Text style={[styles.photoCardLikeCount, liked && { color: '#E05070' }]}>{likeCount}</Text> : null}
      </TouchableOpacity>
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

  const [adressesDuMoment, setAdressesDuMoment] = useState<LieuCard[]>([]);
  const [nearbyLieux, setNearbyLieux] = useState<LieuCard[]>([]);
  const [topLieux, setTopLieux] = useState<LieuCard[]>([]);
  const [featuredLieu, setFeaturedLieu] = useState<LieuCard | null>(null);
  const [loading, setLoading] = useState(true);

  const [explorateurs, setExplorateurs] = useState<Explorateur[]>([]);
  const [selectedExplorateur, setSelectedExplorateur] = useState<Explorateur | null>(null);
  const [showCandidature, setShowCandidature] = useState(false);

  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLng, setUserLng] = useState<number | null>(null);
  const [nearbyRadius, setNearbyRadius] = useState(5);

  const [recentLieux, setRecentLieux] = useState<LieuCard[]>([]);
  const [recentPhotos, setRecentPhotos] = useState<RecentPhoto[]>([]);
  const [photoLikesCount, setPhotoLikesCount] = useState<Record<string, number>>({});
  const [photoLikedByMe, setPhotoLikedByMe] = useState<Set<string>>(new Set());

  const initialLoadDone = useRef(false);

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

  // Radius chip change → only reload nearby section, not everything
  useEffect(() => {
    if (!initialLoadDone.current) return;
    loadNearby();
  }, [nearbyRadius]);

  async function loadAll() {
    setLoading(true);
    const since30days = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    let qAdresses = supabase.from('lieux').select('id,nom,cat,ville,note_moyenne,google_photo_url')
      .eq('actif', true).eq('mise_en_avant', true).order('updated_at', { ascending: false }).limit(10);
    if (activeCat) qAdresses = (qAdresses as any).eq('cat', activeCat);

    let qTop = supabase.from('lieux').select('id,nom,cat,ville,note_moyenne,google_photo_url')
      .eq('actif', true).not('note_moyenne', 'is', null).order('note_moyenne', { ascending: false }).limit(10);
    if (activeCat) qTop = (qTop as any).eq('cat', activeCat);

    let qRecent = supabase.from('lieux').select('id,nom,cat,ville,note_moyenne,google_photo_url')
      .eq('actif', true).gte('created_at', since30days).order('created_at', { ascending: false }).limit(10);
    if (activeCat) qRecent = (qRecent as any).eq('cat', activeCat);

    let qNearby = supabase.from('lieux').select('id,nom,cat,ville,lat,lng,note_moyenne,google_photo_url').eq('actif', true);
    if (activeCat) qNearby = (qNearby as any).eq('cat', activeCat);
    if (userLat && userLng) {
      const delta = (nearbyRadius / 111) * 1.3;
      qNearby = (qNearby as any)
        .gte('lat', userLat - delta).lte('lat', userLat + delta)
        .gte('lng', userLng - delta).lte('lng', userLng + delta);
    }
    qNearby = (qNearby as any).limit(60);

    // All 4 lieux queries + explorateurs + photos in parallel
    const [[rAdresses, rTop, rRecent, rNearby]] = await Promise.all([
      Promise.all([qAdresses, qTop, qRecent, qNearby]),
      loadExplorateurs(),
      loadRecentPhotos(),
    ]);

    let adressesRaw: LieuCard[] = (rAdresses.data || []) as LieuCard[];
    let topRaw: LieuCard[] = (rTop.data || []) as LieuCard[];
    let recentRaw: LieuCard[] = (rRecent.data || []) as LieuCard[];
    let nearbyRaw: LieuCard[] = (rNearby.data || []) as LieuCard[];

    if (userLat && userLng) {
      nearbyRaw = nearbyRaw
        .map((l: any) => ({ ...l, distance: haversine(userLat!, userLng!, l.lat, l.lng) }))
        .filter((l: any) => l.distance <= nearbyRadius)
        .sort((a: any, b: any) => a.distance - b.distance)
        .slice(0, 10);
    } else {
      nearbyRaw = nearbyRaw.slice(0, 10);
    }

    // ONE photo query for all sections combined
    const allIds = [...new Set([...adressesRaw, ...nearbyRaw, ...topRaw, ...recentRaw].map(l => l.id))];
    const photoMap = await fetchPhotosForLieux(allIds);
    const enrich = (l: LieuCard): LieuCard => ({ ...l, photoUrl: photoMap[l.id] || (l as any).google_photo_url || null });

    const adresses = adressesRaw.map(enrich);
    const nearby = nearbyRaw.map(enrich);
    const top = topRaw.map(enrich);
    const recent = recentRaw.map(enrich);

    setAdressesDuMoment(adresses);
    setNearbyLieux(nearby);
    setTopLieux(top);
    setRecentLieux(recent);
    setFeaturedLieu(nearby.find(l => l.photoUrl) || nearby[0] || adresses[0] || null);
    setLoading(false);
    initialLoadDone.current = true;

    // Background: fetch Google photos, deduplicated across all sections
    const seen = new Set<string>();
    [...adresses, ...nearby, ...top, ...recent]
      .filter(l => !l.photoUrl && !seen.has(l.id) && (seen.add(l.id), true))
      .forEach(l => fetchGooglePhoto(l).then(url => {
        if (!url) return;
        const patch = (list: LieuCard[]) => list.map(p => p.id === l.id ? { ...p, photoUrl: url } : p);
        setAdressesDuMoment(patch);
        setNearbyLieux(prev => { const r = patch(prev); setFeaturedLieu(fp => fp?.id === l.id ? { ...fp, photoUrl: url } : fp); return r; });
        setTopLieux(patch);
        setRecentLieux(patch);
      }));
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

  // Standalone: called when nearbyRadius chip changes (no full reload)
  async function loadNearby() {
    let q = supabase.from('lieux').select('id,nom,cat,ville,lat,lng,note_moyenne,google_photo_url').eq('actif', true);
    if (activeCat) q = (q as any).eq('cat', activeCat);
    if (userLat && userLng) {
      const delta = (nearbyRadius / 111) * 1.3;
      q = (q as any)
        .gte('lat', userLat - delta).lte('lat', userLat + delta)
        .gte('lng', userLng - delta).lte('lng', userLng + delta);
    }
    q = (q as any).limit(60);
    const { data } = await q;
    let lieux: LieuCard[] = data || [];
    if (userLat && userLng) {
      lieux = lieux
        .map((l: any) => ({ ...l, distance: haversine(userLat!, userLng!, l.lat, l.lng) }))
        .filter((l: any) => l.distance <= nearbyRadius)
        .sort((a: any, b: any) => a.distance - b.distance)
        .slice(0, 10);
    } else {
      lieux = lieux.slice(0, 10);
    }
    const photos = await fetchPhotosForLieux(lieux.map(l => l.id));
    const withPhotos = lieux.map(l => ({ ...l, photoUrl: photos[l.id] || (l as any).google_photo_url || null }));
    setNearbyLieux(withPhotos);
    setFeaturedLieu(prev => withPhotos.find(l => l.photoUrl) || withPhotos[0] || prev);
    withPhotos.filter(l => !l.photoUrl).forEach(l =>
      fetchGooglePhoto(l).then(url => {
        if (!url) return;
        setNearbyLieux(prev => prev.map(p => p.id === l.id ? { ...p, photoUrl: url } : p));
        setFeaturedLieu(fp => fp?.id === l.id ? { ...fp, photoUrl: url } : fp);
      })
    );
  }

  async function loadRecentPhotos() {
    const { data: photoData } = await supabase
      .from('photos').select('id,url,lieu_id,nom_chien,user_id')
      .eq('validee', true).order('created_at', { ascending: false }).limit(15);
    if (!photoData?.length) { setRecentPhotos([]); return; }

    const lieuIds = [...new Set((photoData as any[]).map(p => p.lieu_id).filter(Boolean))];
    const userIds = [...new Set((photoData as any[]).map(p => p.user_id).filter(Boolean))];
    const [{ data: lieuxData }, { data: profilsData }] = await Promise.all([
      lieuIds.length > 0 ? supabase.from('lieux').select('id,nom,cat,ville').in('id', lieuIds) : Promise.resolve({ data: [] }),
      userIds.length > 0 ? supabase.from('profils').select('id,username,prenom').in('id', userIds) : Promise.resolve({ data: [] }),
    ]);
    const lieuMap: Record<string, any> = {};
    (lieuxData || []).forEach((l: any) => { lieuMap[l.id] = l; });
    const authorMap: Record<string, string | null> = {};
    (profilsData || []).forEach((p: any) => { authorMap[p.id] = p.username ? `@${p.username}` : (p.prenom || null); });

    const mapped: RecentPhoto[] = (photoData as any[]).map(p => ({
      id: p.id, url: p.url,
      lieuId: p.lieu_id,
      lieu: lieuMap[p.lieu_id] || { nom: '?', cat: 'autre', ville: '' },
      nomChien: p.nom_chien || null,
      authorDisplay: authorMap[p.user_id] || null,
    }));
    setRecentPhotos(mapped);

    const photoIds = mapped.map(p => p.id);
    const [{ data: allLikes }, { data: myLikes }] = await Promise.all([
      supabase.from('photo_likes').select('photo_id').in('photo_id', photoIds),
      userId
        ? supabase.from('photo_likes').select('photo_id').in('photo_id', photoIds).eq('user_id', userId)
        : Promise.resolve({ data: [] }),
    ]);
    const countMap: Record<string, number> = {};
    (allLikes || []).forEach((l: any) => { countMap[l.photo_id] = (countMap[l.photo_id] || 0) + 1; });
    setPhotoLikesCount(countMap);
    setPhotoLikedByMe(new Set((myLikes || []).map((l: any) => l.photo_id)));
  }

  async function togglePhotoLike(photoId: string) {
    if (!userId) return;
    const isLiked = photoLikedByMe.has(photoId);
    const { error } = isLiked
      ? await supabase.from('photo_likes').delete().eq('photo_id', photoId).eq('user_id', userId)
      : await supabase.from('photo_likes').insert({ photo_id: photoId, user_id: userId });
    if (error) return;
    if (isLiked) {
      setPhotoLikedByMe(prev => { const s = new Set(prev); s.delete(photoId); return s; });
      setPhotoLikesCount(prev => ({ ...prev, [photoId]: Math.max(0, (prev[photoId] || 0) - 1) }));
    } else {
      setPhotoLikedByMe(prev => new Set([...prev, photoId]));
      setPhotoLikesCount(prev => ({ ...prev, [photoId]: (prev[photoId] || 0) + 1 }));
    }
  }

  function openLieu(lieuId: string) {
    mapNavigation.setPendingLieu(lieuId);
    navigation.navigate('Carte');
  }

  const greeting = prenom ? `Bonjour, ${prenom} 🐾` : 'Bonjour 🐾';
  const nearbyTitle = nomChien ? `Près de ${nomChien}` : 'Près de toi';

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
                <Ionicons name={c.icon as any} size={14} color={active ? colors.ivory : colors.bordeaux} />
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
            {userLat && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>{nearbyTitle}</Text>
                  <TouchableOpacity onPress={() => navigation.navigate('Carte')}>
                    <Text style={styles.seeAll}>Voir la carte →</Text>
                  </TouchableOpacity>
                </View>
                {/* Distance filter chips */}
                <ScrollView
                  horizontal showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.distChipsRow}
                >
                  {[2, 5, 10, 20].map(km => (
                    <TouchableOpacity
                      key={km}
                      style={[styles.distChip, nearbyRadius === km && styles.distChipActive]}
                      onPress={() => setNearbyRadius(km)}
                    >
                      <Ionicons
                        name="location-outline" size={11}
                        color={nearbyRadius === km ? colors.ivory : colors.bordeaux}
                      />
                      <Text style={[styles.distChipLabel, nearbyRadius === km && styles.distChipLabelActive]}>
                        {km} km
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                {nearbyLieux.length > 0 ? (
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
                ) : (
                  <View style={styles.nearbyEmpty}>
                    <Ionicons name="location-outline" size={28} color={colors.textMuted} />
                    <Text style={styles.nearbyEmptyText}>
                      Aucun lieu dans un rayon de {nearbyRadius} km.{'\n'}Essaie d'élargir la distance.
                    </Text>
                  </View>
                )}
              </View>
            )}

            {/* Adresses du moment */}
            {adressesDuMoment.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Adresses du moment</Text>
                <FlatList
                  data={adressesDuMoment}
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

            {/* Récemment ajoutés */}
            {recentLieux.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Récemment ajoutés</Text>
                  <TouchableOpacity onPress={() => navigation.navigate('Carte')}>
                    <Text style={styles.seeAll}>Voir la carte →</Text>
                  </TouchableOpacity>
                </View>
                <FlatList
                  data={recentLieux}
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

            {/* Photos de la communauté */}
            {recentPhotos.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Photos de la communauté</Text>
                <FlatList
                  data={recentPhotos}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyExtractor={p => p.id}
                  contentContainerStyle={styles.cardsRow}
                  renderItem={({ item }) => (
                    <PhotoMiniCard
                      photo={item}
                      liked={photoLikedByMe.has(item.id)}
                      likeCount={photoLikesCount[item.id] || 0}
                      onPress={() => openLieu(item.lieuId)}
                      onLike={() => togglePhotoLike(item.id)}
                    />
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

  // Photo mini cards
  photoCard: {
    width: CARD_W, height: CARD_W, borderRadius: 14,
    overflow: 'hidden', backgroundColor: colors.border,
  },
  photoCardImg: { width: CARD_W, height: CARD_W },
  photoCardOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between', padding: 8,
    backgroundColor: 'rgba(61,26,26,0.28)',
  },
  photoCardDogTag: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(61,26,26,0.55)',
    borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3,
  },
  photoCardDogText: { fontFamily: 'DMSans_500Medium', fontSize: 10, color: colors.ivory },
  photoCardBottom: { flexDirection: 'row', alignItems: 'flex-start', gap: 5 },
  photoCardCatDot: { width: 6, height: 6, borderRadius: 3, marginTop: 3 },
  photoCardLieu: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.ivory },
  photoCardAuthor: { fontFamily: 'DMSans_300Light', fontSize: 9, color: 'rgba(245,239,224,0.65)', marginTop: 1 },
  photoCardLike: {
    position: 'absolute', top: 8, right: 8,
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(61,26,26,0.45)',
    borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4,
  },
  photoCardLikeCount: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: 'rgba(255,255,255,0.8)' },

  // Distance chips
  distChipsRow: { gap: 8, paddingBottom: 14 },
  distChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: colors.white, borderRadius: 20,
    borderWidth: 1, borderColor: colors.border,
  },
  distChipActive: { backgroundColor: colors.bordeaux, borderColor: colors.bordeaux },
  distChipLabel: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.bordeaux },
  distChipLabelActive: { color: colors.ivory },

  // Nearby empty state
  nearbyEmpty: { alignItems: 'center', gap: 8, paddingVertical: 24 },
  nearbyEmptyText: {
    fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted,
    textAlign: 'center', lineHeight: 20,
  },

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
  smallCardDist: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted },
});
