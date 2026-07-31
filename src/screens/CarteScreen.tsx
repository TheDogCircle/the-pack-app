import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Supercluster from 'supercluster';
import {
  View, StyleSheet, Text, TouchableOpacity, ActivityIndicator,
  Animated, ScrollView, Linking, Dimensions, Modal, Keyboard,
  TextInput, KeyboardAvoidingView, Platform, Alert, FlatList, Image, Share, PanResponder,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { decode } from 'base64-arraybuffer';
import MapView, { Marker, Polyline, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase, uploadToR2 } from '../lib/supabase';
import { colors } from '../lib/theme';
import { mapNavigation } from '../lib/mapNavigation';
import { AmbassadeurBadge } from '../components/AmbassadeurBadge';
import { loadUserSignals, rankForYou, filterFriendPicks } from '../lib/recommendations';

const SCREEN_H = Dimensions.get('window').height;
const SCREEN_W = Dimensions.get('window').width;
const GOOGLE_KEY = 'AIzaSyAvVkbdbfvP3Rkp59754kDfhyDYD0xLNvA';

// Feature flag — mettre à true pour réactiver l'upload vidéo
const ENABLE_VIDEO_UPLOAD = false;

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

const CAT_CONFIG: Record<string, { icon: IoniconsName; markerIcon: IoniconsName; label: string; color: string }> = {
  restaurant:  { icon: 'restaurant-outline', markerIcon: 'restaurant',  label: 'Restaurant',   color: '#C4693A' },
  cafe:        { icon: 'cafe-outline',       markerIcon: 'cafe',         label: 'Café',          color: '#A0522D' },
  parc:        { icon: 'leaf-outline',       markerIcon: 'leaf',         label: 'Parc',          color: '#5A9E6F' },
  parc_chien:  { icon: 'paw-outline',        markerIcon: 'paw',          label: 'Espace canin',  color: '#3D1A1A' },
  plage:       { icon: 'water-outline',      markerIcon: 'water',        label: 'Plage',         color: '#7ABFCC' },
  veto:        { icon: 'medical-outline',    markerIcon: 'medkit',       label: 'Vétérinaire',   color: '#5A7FA5' },
  toiletteur:  { icon: 'cut-outline',        markerIcon: 'cut',          label: 'Toiletteur',    color: '#7B7AAA' },
  boutique:    { icon: 'bag-outline',        markerIcon: 'bag',          label: 'Boutique',      color: '#8B5A2B' },
  hotel:       { icon: 'bed-outline',        markerIcon: 'bed',          label: 'Hôtel',         color: '#4A7FA5' },
  bar:           { icon: 'wine-outline',        markerIcon: 'wine',         label: 'Bar',           color: '#8B5E3C' },
  concept_store: { icon: 'bag-handle-outline', markerIcon: 'bag-handle',   label: 'Concept Store', color: '#D4A853' },
  educateur:     { icon: 'school-outline',     markerIcon: 'school',       label: 'Éducateur',     color: '#5B8DB8' },
  autre:         { icon: 'location-outline',   markerIcon: 'location',     label: 'Autre',         color: '#7A7A7A' },
};

const CAT_BY_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(CAT_CONFIG).map(([k, v]) => [v.label, k])
);

function parseTypoLabels(description: string | null): string[] {
  if (!description) return [];
  const match = description.match(/^\[([^\]]*)\]/);
  if (!match) return [];
  for (const part of match[1].split(' | ')) {
    if (part.startsWith('Typologies:')) {
      return part.replace('Typologies:', '').trim().split(',').map(s => s.trim()).filter(Boolean);
    }
  }
  return [];
}

function stripTypoPrefix(description: string | null): string {
  if (!description) return '';
  return description.replace(/^\[[^\]]*\]\n?/, '').trim();
}

const PROPOSE_CATS = [
  'restaurant', 'cafe', 'bar', 'hotel', 'parc', 'parc_chien', 'plage',
  'boutique', 'concept_store', 'toiletteur', 'veto', 'educateur', 'autre',
];

function CatIcon({ cat, name, size, color }: { cat?: string | null; name: IoniconsName; size: number; color: string }) {
  if (cat === 'plage') return <MaterialCommunityIcons name="waves" size={size} color={color} />;
  return <Ionicons name={name} size={size} color={color} />;
}

const CATEGORIES: { key: string | null; label: string; icon: IoniconsName }[] = [
  { key: null,         label: 'Tout',           icon: 'apps-outline' },
  { key: 'parc',       label: 'Parcs',          icon: 'leaf-outline' },
  { key: 'parc_chien', label: 'Espaces canins', icon: 'paw-outline' },
  { key: 'veto',       label: 'Vétos',          icon: 'medical-outline' },
  { key: 'toiletteur', label: 'Toilettage',     icon: 'cut-outline' },
  { key: 'restaurant', label: 'Restos',         icon: 'restaurant-outline' },
  { key: 'cafe',       label: 'Cafés',          icon: 'cafe-outline' },
  { key: 'plage',      label: 'Plages',         icon: 'water-outline' },
  { key: 'boutique',   label: 'Boutiques',      icon: 'bag-outline' },
  { key: 'hotel',      label: 'Hôtels',         icon: 'bed-outline' },
  { key: 'bar',        label: 'Bars',           icon: 'wine-outline' },
];

const MAIN_CATS = CATEGORIES.slice(0, 5);  // Tout, Parcs, Espaces canins, Vétos, Toilettage
const AUTRES_CATS = CATEGORIES.slice(5);   // Restos, Cafés, Plages, Boutiques, Hôtels, Bars

type SortKey = 'proximite' | 'note';
const SORT_OPTS: { key: SortKey; label: string; icon: IoniconsName }[] = [
  { key: 'proximite', label: 'Proximité', icon: 'navigate-outline' },
  { key: 'note',      label: 'Mieux notés', icon: 'star-outline' },
];

function parseOpenStatus(horaires: string | null): 'open' | 'closed' | null {
  if (!horaires) return null;
  const h = new Date().getHours() + new Date().getMinutes() / 60;
  const pattern = /(\d{1,2})[h:H](\d{0,2})\s*[-–à]\s*(\d{1,2})[h:H](\d{0,2})/g;
  const matches = [...horaires.matchAll(pattern)];
  if (!matches.length) return null;
  for (const m of matches) {
    const open = parseInt(m[1]) + (m[2] ? parseInt(m[2]) / 60 : 0);
    const close = parseInt(m[3]) + (m[4] ? parseInt(m[4]) / 60 : 0);
    if (h >= open && h < close) return 'open';
  }
  return 'closed';
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const FAV_FILTER_OPTS: { key: string; label: string; icon: IoniconsName; color: string }[] = [
  { key: 'favori',      label: 'Favoris',    icon: 'heart',            color: '#E05070' },
  { key: 'a_tester',   label: 'À tester',   icon: 'bookmark',         color: colors.bordeaux },
  { key: 'deja_teste', label: 'Déjà testé', icon: 'checkmark-circle', color: '#5A9E6F' },
];

type Lieu = {
  id: string; nom: string; lat: number; lng: number; cat: string; ville: string; adresse: string;
  note_moyenne?: number | null; nb_avis?: number | null;
  chiens_salle?: boolean | null; chiens_terrasse?: boolean | null; espace_dedie?: boolean | null;
  eau?: boolean | null; gamelles?: boolean | null; chiens_laches?: boolean | null; chiens_laisse?: boolean | null;
  petits_chiens?: boolean | null; moyens_chiens?: boolean | null; grands_chiens?: boolean | null;
  google_photo_url?: string | null; created_at?: string | null; mise_en_avant?: boolean | null;
};
type LieuFull = Lieu & {
  departement: string | null; description: string | null; tel: string | null;
  horaires: string | null; site_web: string | null; instagram_url: string | null; tiktok_url: string | null;
  note_moyenne: number | null; nb_avis: number | null;
  chiens_salle: boolean | null; chiens_terrasse: boolean | null; espace_dedie: boolean | null;
  eau: boolean | null; gamelles: boolean | null; chiens_laches: boolean | null; chiens_laisse: boolean | null;
  petits_chiens: boolean | null; moyens_chiens: boolean | null; grands_chiens: boolean | null;
  manager_user_id: string | null; google_photo_url: string | null;
};
type PhotoFiche = { id: string; url: string; likeCount: number; likedByMe: boolean; authorUsername: string | null; nomChien: string | null; fromCommunity?: boolean };
type FicheAvisItem = { id: string; note: number; commentaire: string | null; created_at: string; prenom: string; username: string | null; reponse_pro: string | null; ambassadeur?: boolean | null };
type CityResult = { nom: string; lat: number; lng: number };
type EventMarker = {
  id: string; titre: string; date_heure: string;
  adresse: string | null; ville: string;
  lat: number; lng: number;
  max_participants: number | null; payant: boolean; prix: number | null;
  nb_inscrits: number; je_suis_inscrit: boolean;
  profils: { prenom: string | null; username: string | null } | null;
};
type Balade = {
  id: string; user_id: string; nom: string; description: string | null;
  depart_lat: number; depart_lng: number; depart_label: string | null;
  arrivee_texte: string | null; arrivee_lat: number | null; arrivee_lng: number | null;
  distance_km: number | null; created_at: string;
  ombragee: boolean; eau_chemin: boolean; fontaine_eau: boolean;
  sans_laisse: boolean; evite_routes: boolean; sol_naturel: boolean;
  profils?: { prenom: string | null } | null;
};

type BaladeFiltres = {
  ombragee: boolean; eau_chemin: boolean; fontaine_eau: boolean;
  sans_laisse: boolean; evite_routes: boolean; sol_naturel: boolean;
};
const FILTRES_VIDE: BaladeFiltres = {
  ombragee: false, eau_chemin: false, fontaine_eau: false,
  sans_laisse: false, evite_routes: false, sol_naturel: false,
};
const FILTRES_DEF: { key: keyof BaladeFiltres; label: string; icon: string }[] = [
  { key: 'ombragee',     label: 'Ombragée',          icon: 'sunny-outline' },
  { key: 'eau_chemin',   label: 'Eau sur le chemin', icon: 'water-outline' },
  { key: 'fontaine_eau', label: 'Fontaine à eau',    icon: 'nutrition-outline' },
  { key: 'sans_laisse',  label: 'Sans laisse',       icon: 'paw-outline' },
  { key: 'evite_routes', label: 'Évite les routes',  icon: 'footsteps-outline' },
  { key: 'sol_naturel',  label: 'Sol naturel',       icon: 'leaf-outline' },
];

// ── Découverte (mode Liste) ─────────────────────────────────────────────────
// Rangées curatées façon "Explorer", affichées au-dessus de la liste filtrable
// quand aucune recherche/filtre n'est active. Porté depuis l'ancien
// ExplorerScreen (retiré de la navigation le 25/07) + rangées personnalisées
// alimentées par src/lib/recommendations.ts.

const DISCOVER_CARD_W = SCREEN_W * 0.42;

type DiscoverLieu = {
  id: string; nom: string; cat: string; ville: string;
  note_moyenne?: number | null; nb_avis?: number | null;
  created_at?: string | null; mise_en_avant?: boolean | null;
  lat?: number; lng?: number;
  photoUrl?: string | null; google_photo_url?: string | null;
  distance?: number;
};

type DiscoverPhoto = {
  id: string; url: string; lieuId: string;
  lieu: { nom: string; cat: string; ville: string };
  nomChien: string | null; authorDisplay: string | null;
};

function DiscoverThumb({ lieu, style }: { lieu: DiscoverLieu; style: any }) {
  const cfg = CAT_CONFIG[lieu.cat] || CAT_CONFIG.autre;
  const photo = lieu.photoUrl || lieu.google_photo_url;
  if (photo) return <Image source={{ uri: photo }} style={style} resizeMode="cover" />;
  return (
    <View style={[style, { backgroundColor: cfg.color + '18', alignItems: 'center', justifyContent: 'center' }]}>
      <Ionicons name={cfg.icon} size={28} color={cfg.color + '77'} />
    </View>
  );
}

function DiscoverCard({ lieu, onPress }: { lieu: DiscoverLieu; onPress: () => void }) {
  const cfg = CAT_CONFIG[lieu.cat] || CAT_CONFIG.autre;
  return (
    <TouchableOpacity style={dstyles.card} onPress={onPress} activeOpacity={0.85}>
      <DiscoverThumb lieu={lieu} style={dstyles.cardPhoto} />
      <View style={dstyles.cardBody}>
        <Text style={dstyles.cardNom} numberOfLines={2}>{lieu.nom}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <View style={[dstyles.catDot, { backgroundColor: cfg.color }]} />
          <Text style={dstyles.cardCat}>{cfg.label}</Text>
        </View>
        {lieu.ville ? <Text style={dstyles.cardVille} numberOfLines={1}>{lieu.ville}</Text> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
          {lieu.note_moyenne ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Ionicons name="star" size={10} color={colors.terra} />
              <Text style={dstyles.cardMeta}>{lieu.note_moyenne.toFixed(1)}</Text>
            </View>
          ) : null}
          {lieu.distance !== undefined ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Ionicons name="navigate-outline" size={10} color={colors.textMuted} />
              <Text style={dstyles.cardMeta}>
                {lieu.distance < 1 ? `${Math.round(lieu.distance * 1000)} m` : `${lieu.distance.toFixed(1)} km`}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}

function FeaturedDiscoverCard({ lieu, onPress }: { lieu: DiscoverLieu; onPress: () => void }) {
  const cfg = CAT_CONFIG[lieu.cat] || CAT_CONFIG.autre;
  const photo = lieu.photoUrl || lieu.google_photo_url;
  return (
    <TouchableOpacity style={dstyles.featured} onPress={onPress} activeOpacity={0.88}>
      {photo ? (
        <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: cfg.color + '22', alignItems: 'center', justifyContent: 'center' }]}>
          <Ionicons name={cfg.icon} size={48} color={cfg.color + '55'} />
        </View>
      )}
      <View style={dstyles.featuredGrad}>
        <View style={[dstyles.featuredBadge, { backgroundColor: cfg.color }]}>
          <Text style={dstyles.featuredBadgeLabel}>{cfg.label}</Text>
        </View>
        <Text style={dstyles.featuredNom} numberOfLines={2}>{lieu.nom}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="location-outline" size={12} color="rgba(245,239,224,0.8)" />
          <Text style={dstyles.featuredVille}>{lieu.ville}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function PhotoDiscoverCard({
  photo, liked, likeCount, onPress, onLike,
}: { photo: DiscoverPhoto; liked: boolean; likeCount: number; onPress: () => void; onLike: () => void }) {
  const cfg = CAT_CONFIG[photo.lieu.cat] || CAT_CONFIG.autre;
  return (
    <TouchableOpacity style={dstyles.photoCard} onPress={onPress} activeOpacity={0.88}>
      <Image source={{ uri: photo.url }} style={dstyles.photoCardImg} resizeMode="cover" />
      <View style={dstyles.photoCardOverlay}>
        {photo.nomChien ? (
          <View style={dstyles.photoCardDogTag}><Text style={dstyles.photoCardDogText}>🐾 {photo.nomChien}</Text></View>
        ) : <View />}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 5 }}>
          <View style={[dstyles.catDotSmall, { backgroundColor: cfg.color }]} />
          <View style={{ flex: 1 }}>
            <Text style={dstyles.photoCardLieu} numberOfLines={1}>{photo.lieu.nom}</Text>
            {photo.authorDisplay ? <Text style={dstyles.photoCardAuthor} numberOfLines={1}>{photo.authorDisplay}</Text> : null}
          </View>
        </View>
      </View>
      <TouchableOpacity style={dstyles.photoCardLike} onPress={e => { (e as any).stopPropagation?.(); onLike(); }}>
        <Ionicons name={liked ? 'heart' : 'heart-outline'} size={15} color={liked ? '#E05070' : 'rgba(255,255,255,0.85)'} />
        {likeCount > 0 ? <Text style={[dstyles.photoCardLikeCount, liked && { color: '#E05070' }]}>{likeCount}</Text> : null}
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const dstyles = StyleSheet.create({
  section: { marginTop: 22, paddingLeft: 16 },
  sectionTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 17, color: colors.bordeaux, marginBottom: 12 },
  cardsRow: { gap: 12, paddingRight: 16 },
  divider: { height: 1, backgroundColor: colors.border, marginHorizontal: 12, marginTop: 22 },

  card: {
    width: DISCOVER_CARD_W, backgroundColor: colors.white, borderRadius: 14, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 6, elevation: 3,
  },
  cardPhoto: { width: DISCOVER_CARD_W, height: DISCOVER_CARD_W * 0.62 },
  cardBody: { padding: 10, gap: 3 },
  cardNom: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.bordeaux, lineHeight: 18 },
  catDot: { width: 7, height: 7, borderRadius: 4 },
  cardCat: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted },
  cardVille: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted },
  cardMeta: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.terra },

  featured: { width: SCREEN_W - 32, height: 190, borderRadius: 16, overflow: 'hidden', backgroundColor: colors.border },
  featuredGrad: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 14, backgroundColor: 'rgba(61,26,26,0.62)', gap: 4 },
  featuredBadge: { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 4 },
  featuredBadgeLabel: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: '#fff', textTransform: 'uppercase', letterSpacing: 0.5 },
  featuredNom: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: '#fff', lineHeight: 22 },
  featuredVille: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: 'rgba(245,239,224,0.8)' },

  photoCard: { width: DISCOVER_CARD_W, height: DISCOVER_CARD_W, borderRadius: 14, overflow: 'hidden', backgroundColor: colors.border },
  photoCardImg: { width: DISCOVER_CARD_W, height: DISCOVER_CARD_W },
  photoCardOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'space-between', padding: 8, backgroundColor: 'rgba(61,26,26,0.28)' },
  photoCardDogTag: { alignSelf: 'flex-start', backgroundColor: 'rgba(61,26,26,0.55)', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 },
  photoCardDogText: { fontFamily: 'DMSans_500Medium', fontSize: 10, color: colors.ivory },
  catDotSmall: { width: 6, height: 6, borderRadius: 3, marginTop: 3 },
  photoCardLieu: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.ivory },
  photoCardAuthor: { fontFamily: 'DMSans_300Light', fontSize: 9, color: 'rgba(245,239,224,0.65)', marginTop: 1 },
  photoCardLike: { position: 'absolute', top: 8, right: 8, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(61,26,26,0.45)', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4 },
  photoCardLikeCount: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: 'rgba(255,255,255,0.8)' },

});

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

async function fetchGooglePhotoFor(lieu: { id: string; nom: string; ville: string }): Promise<string | null> {
  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOGLE_KEY, 'X-Goog-FieldMask': 'places.photos' },
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

export default function CarteScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const mapRef = useRef<MapView>(null);
  const shareLieuCardRef = useRef<View>(null);
  const [lieux, setLieux] = useState<Lieu[]>([]);
  const [loading, setLoading] = useState(true);
  const [region, setRegion] = useState<Region>({ latitude: 46.8, longitude: 2.3, latitudeDelta: 8, longitudeDelta: 8 });
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [selectedLieu, setSelectedLieu] = useState<LieuFull | null>(null);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [favListe, setFavListe] = useState<string | null>(null);
  const [favLoading, setFavLoading] = useState(false);
  const [favModal, setFavModal] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [myAvis, setMyAvis] = useState<{ note: number; commentaire: string | null } | null>(null);
  const [avisModal, setAvisModal] = useState(false);
  const [avisNote, setAvisNote] = useState(0);
  const [avisComment, setAvisComment] = useState('');
  const [avisLoading, setAvisLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Lieu[]>([]);
  const [cityResults, setCityResults] = useState<CityResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [photos, setPhotos] = useState<PhotoFiche[]>([]);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [googlePhotoUrl, setGooglePhotoUrl] = useState<string | null>(null);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [ficheAvis, setFicheAvis] = useState<FicheAvisItem[]>([]);
  const [proposeModal, setProposeModal] = useState(false);
  const [proposeNom, setProposeNom] = useState('');
  const [proposeAdresse, setProposeAdresse] = useState('');
  const [proposeVille, setProposeVille] = useState('');
  const [proposeCats, setProposeCats] = useState<string[]>([]);
  const [proposeAutreLabel, setProposeAutreLabel] = useState('');
  const [proposeTel, setProposeTel] = useState('');
  const [proposeSite, setProposeSite] = useState('');
  const [proposeDesc, setProposeDesc] = useState('');
  const [proposeLat, setProposeLat] = useState<number | null>(null);
  const [proposeLng, setProposeLng] = useState<number | null>(null);
  const [proposeGeoLoading, setProposeGeoLoading] = useState(false);
  const [proposeLoading, setProposeLoading] = useState(false);
  const [proposePhotos, setProposePhotos] = useState<string[]>([]);
  const [proposeVideo, setProposeVideo] = useState<string | null>(null);
  const [proposeAmenities, setProposeAmenities] = useState({
    chiens_salle: false, chiens_terrasse: false, espace_dedie: false,
    eau: false, gamelles: false, chiens_laches: false, chiens_laisse: false,
    petits_chiens: false, moyens_chiens: false, grands_chiens: false,
  });
  const [fichePhotoIdx, setFichePhotoIdx] = useState(0);
  const [enrichModal, setEnrichModal] = useState(false);
  const [enrichType, setEnrichType] = useState<'info_manquante' | 'erreur'>('info_manquante');
  const [enrichDesc, setEnrichDesc] = useState('');
  const [enrichTel, setEnrichTel] = useState('');
  const [enrichSite, setEnrichSite] = useState('');
  const [enrichHoraires, setEnrichHoraires] = useState('');
  const [enrichNote, setEnrichNote] = useState('');
  const [enrichLoading, setEnrichLoading] = useState(false);
  const [favFilter, setFavFilter] = useState<string | null>(null);
  const [autresOpen, setAutresOpen] = useState(false);
  const [showPointsAnim, setShowPointsAnim] = useState(false);
  const [listView, setListView] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>('proximite');
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLng, setUserLng] = useState<number | null>(null);
  const [expandedCats, setExpandedCats] = useState<string[]>([]);
  const [onboardingVisible, setOnboardingVisible] = useState(false);
  const [onboardingSlide, setOnboardingSlide] = useState(0);
  const [loginPromptVisible, setLoginPromptVisible] = useState(false);
  const [proposeSuggestions, setProposeSuggestions] = useState<{ name: string; adresse: string; ville: string; lat: number; lng: number; displayAddr: string }[]>([]);
  const [prevSelectedId, setPrevSelectedId] = useState<string | null>(null);
  const [feedbackModal, setFeedbackModal] = useState(false);
  const [feedbackType, setFeedbackType] = useState<'probleme' | 'amelioration'>('probleme');
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [myDogName, setMyDogName] = useState<string | null>(null);
  const [dogTagModal, setDogTagModal] = useState(false);
  const [dogTagInput, setDogTagInput] = useState('');
  const [pendingPhotoUris, setPendingPhotoUris] = useState<string[]>([]);
  const [pendingVideoUri, setPendingVideoUri] = useState<string | null>(null);
  const [showEvents, setShowEvents] = useState(false);
  const [showBalades, setShowBalades] = useState(false);
  const [mapEvents, setMapEvents] = useState<EventMarker[]>([]);
  const [filterModal, setFilterModal] = useState(false);
  const [filterMinNote, setFilterMinNote] = useState(0);
  const [filterEquipements, setFilterEquipements] = useState<string[]>([]);
  const [filterCat, setFilterCat] = useState<string | null>(null);
  const [filterDistance, setFilterDistance] = useState<number | null>(null);
  const filterAnim = useRef(new Animated.Value(SCREEN_H)).current;

  // ── Découverte (mode Liste, rangées curatées) ──
  const [discoverLoading, setDiscoverLoading] = useState(true);
  const [discoverLoaded, setDiscoverLoaded] = useState(false);
  const [recommendedLieux, setRecommendedLieux] = useState<DiscoverLieu[]>([]);
  const [friendPickLieux, setFriendPickLieux] = useState<DiscoverLieu[]>([]);
  const [nearbyDiscoverLieux, setNearbyDiscoverLieux] = useState<DiscoverLieu[]>([]);
  const [recentDiscoverLieux, setRecentDiscoverLieux] = useState<DiscoverLieu[]>([]);
  const [topDiscoverLieux, setTopDiscoverLieux] = useState<DiscoverLieu[]>([]);
  const [featuredDiscoverLieu, setFeaturedDiscoverLieu] = useState<DiscoverLieu | null>(null);
  const [discoverPhotos, setDiscoverPhotos] = useState<DiscoverPhoto[]>([]);
  const [discoverPhotoLikes, setDiscoverPhotoLikes] = useState<Record<string, number>>({});
  const [discoverPhotoLikedByMe, setDiscoverPhotoLikedByMe] = useState<Set<string>>(new Set());
  const [listPhotoMap, setListPhotoMap] = useState<Record<string, string>>({});
  const [selectedMapEvent, setSelectedMapEvent] = useState<EventMarker | null>(null);
  const [mapEventInscLoading, setMapEventInscLoading] = useState(false);
  const markerResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const regionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ── Balades ──
  const [balades, setBalades] = useState<Balade[]>([]);
  const [selectedBalade, setSelectedBalade] = useState<Balade | null>(null);
  const [pickingBaladeDepart, setPickingBaladeDepart] = useState(false);
  const [baladeFormVisible, setBaladeFormVisible] = useState(false);
  const [baladeDepartLat, setBaladeDepartLat] = useState<number | null>(null);
  const [baladeDepartLng, setBaladeDepartLng] = useState<number | null>(null);
  const [baladeNom, setBaladeNom] = useState('');
  const [baladeArrivee, setBaladeArrivee] = useState('');
  const [baladeDesc, setBaladeDesc] = useState('');
  const [baladeDistance, setBaladeDistance] = useState('');
  const [baladeLoading, setBaladeLoading] = useState(false);
  const [pickingBaladeArrivee, setPickingBaladeArrivee] = useState(false);
  const [baladeFinalArriveeCoords, setBaladeFinalArriveeCoords] = useState<{lat: number; lng: number} | null>(null);
  const [baladeFiltres, setBaladeFiltres] = useState<BaladeFiltres>(FILTRES_VIDE);
  const [baladePhotoUri, setBaladePhotoUri] = useState<string | null>(null);
  const [fabOpen, setFabOpen] = useState(false);
  const proposeSuggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextFetchRef = useRef(false);
  const lastFetchedRegionRef = useRef<Region | null>(null);
  const sheetAnim = useRef(new Animated.Value(SCREEN_H)).current;
  const sheetPanY = useRef(new Animated.Value(0)).current;
  const sheetPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5,
      onPanResponderMove: (_, g) => { if (g.dy > 0) sheetPanY.setValue(g.dy); },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 100 || g.vy > 0.5) {
          Animated.timing(sheetAnim, { toValue: SCREEN_H, duration: 220, useNativeDriver: true }).start(() => {
            setSelectedLieu(null); setPhotos([]); setFicheAvis([]); setFichePhotoIdx(0); setFavListe(null); setMyAvis(null); setGooglePhotoUrl(null); setLightboxIdx(null); sheetPanY.setValue(0);
          });
        } else {
          Animated.spring(sheetPanY, { toValue: 0, useNativeDriver: true, tension: 80, friction: 10 }).start();
        }
      },
      onPanResponderTerminate: () => { Animated.spring(sheetPanY, { toValue: 0, useNativeDriver: true }).start(); },
    })
  ).current;
  const pointsAnimY = useRef(new Animated.Value(0)).current;
  const pointsAnimOp = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user.id ?? null);
      if (session?.user.id) {
        supabase.from('profils').select('nom_chien').eq('id', session.user.id).single()
          .then(({ data }) => setMyDogName(data?.nom_chien ?? null));
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null);
      if (session?.user.id) {
        supabase.from('profils').select('nom_chien').eq('id', session.user.id).single()
          .then(({ data }) => setMyDogName(data?.nom_chien ?? null));
      } else {
        setMyDogName(null);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    AsyncStorage.getItem('thepack_onboarding_done').then(done => {
      if (!done) setTimeout(() => setOnboardingVisible(true), 800);
    });
  }, []);

  async function closeOnboarding() {
    await AsyncStorage.setItem('thepack_onboarding_done', '1');
    setOnboardingVisible(false);
    if (!userId) setTimeout(() => showLoginPrompt(), 400);
  }

  async function showLoginPrompt() {
    setLoginPromptVisible(true);
  }

  function requireAuth(action: () => void) {
    if (!userId) { showLoginPrompt(); return; }
    action();
  }

  useFocusEffect(useCallback(() => {
    const lieuId = mapNavigation.consume();
    if (lieuId) {
      supabase.from('lieux').select('id,nom,lat,lng,cat,ville,adresse,note_moyenne,nb_avis')
        .eq('id', lieuId).single()
        .then(({ data }) => { if (data) openFiche(data as Lieu); });
    }
    const baladeId = mapNavigation.consumeBalade();
    if (baladeId) {
      supabase.from('balades')
        .select('id, user_id, nom, description, depart_lat, depart_lng, depart_label, arrivee_texte, arrivee_lat, arrivee_lng, distance_km, ombragee, eau_chemin, fontaine_eau, sans_laisse, evite_routes, sol_naturel, created_at')
        .eq('id', baladeId)
        .single()
        .then(({ data, error }) => {
          if (data && !error) {
            setShowBalades(true);
            setSelectedBalade(data as Balade);
            mapRef.current?.animateToRegion({
              latitude: data.depart_lat,
              longitude: data.depart_lng,
              latitudeDelta: 0.05,
              longitudeDelta: 0.05,
            }, 800);
          }
        });
    }
    const proposeName = mapNavigation.consumePropose();
    if (proposeName) {
      setProposeNom(proposeName);
      setProposeModal(true);
    }
  }, []));

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({});
        setUserLat(loc.coords.latitude);
        setUserLng(loc.coords.longitude);
        const r: Region = { latitude: loc.coords.latitude, longitude: loc.coords.longitude, latitudeDelta: 0.08, longitudeDelta: 0.08 };
        setRegion(r);
        mapRef.current?.animateToRegion(r, 600);
        // fetchLieux sera déclenché par onRegionChangeComplete après l'animation
      } else {
        fetchLieux(region, null, true);
      }
    })();
  }, []);

  useEffect(() => {
    if (showEvents) loadMapEvents();
    else setMapEvents([]);
  }, [showEvents, userId]);

  useEffect(() => {
    if (showBalades) fetchBalades(region);
    else setBalades([]);
  }, [showBalades]);

  useEffect(() => {
    if (listView && lieux.length === 0) {
      fetchLieux(region, activeCat, true);
    }
  }, [listView]);

  useEffect(() => {
    if (listView && !discoverLoaded) {
      loadDiscoverySections();
    }
  }, [listView, discoverLoaded]);

  useEffect(() => {
    if (!listView || !lieux.length) return;
    const missing = lieux.filter(l => !listPhotoMap[l.id]).map(l => l.id);
    if (!missing.length) return;
    fetchPhotosForLieux(missing).then(map => {
      if (Object.keys(map).length) setListPhotoMap(prev => ({ ...prev, ...map }));
    });
  }, [listView, lieux]);

  // Rafraîchit "Près de toi" une fois la position GPS connue si déjà en liste
  useEffect(() => {
    if (listView && discoverLoaded && userLat && userLng && nearbyDiscoverLieux.length === 0) {
      loadDiscoverySections();
    }
  }, [userLat, userLng]);

  async function fetchLieux(r: Region, cat: string | null, reset = false) {
    const last = lastFetchedRegionRef.current;
    if (!reset && last) {
      const movedLat = Math.abs(r.latitude - last.latitude);
      const movedLng = Math.abs(r.longitude - last.longitude);
      const deltaChanged = Math.abs(r.latitudeDelta - last.latitudeDelta) / last.latitudeDelta;
      const threshold = Math.min(r.latitudeDelta, last.latitudeDelta) * 0.5;
      if (movedLat < threshold && movedLng < threshold && deltaChanged < 0.4 && cat === activeCat) return;
    }
    lastFetchedRegionRef.current = r;
    if (lieux.length === 0) setLoading(true);
    try {
      let query = supabase
        .from('lieux').select('id,nom,lat,lng,cat,ville,adresse,note_moyenne,nb_avis,chiens_salle,chiens_terrasse,espace_dedie,eau,gamelles,chiens_laches,chiens_laisse,petits_chiens,moyens_chiens,grands_chiens,google_photo_url,created_at,mise_en_avant').eq('actif', true)
        .gte('lat', r.latitude - r.latitudeDelta).lte('lat', r.latitude + r.latitudeDelta)
        .gte('lng', r.longitude - r.longitudeDelta).lte('lng', r.longitude + r.longitudeDelta)
        .limit(500);
      if (cat) query = (query as any).eq('cat', cat);
      const { data } = await query;
      const newPlaces = data || [];
      if (reset) {
        setLieux(newPlaces);
      } else {
        setLieux(prev => {
          const existing = new Set(prev.map(l => l.id));
          const toAdd = newPlaces.filter(l => !existing.has(l.id));
          return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
        });
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadDiscoverySections() {
    setDiscoverLoading(true);
    const since30days = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const qTop = supabase.from('lieux')
      .select('id,nom,cat,ville,note_moyenne,nb_avis,google_photo_url,created_at,mise_en_avant')
      .eq('actif', true).not('note_moyenne', 'is', null).order('note_moyenne', { ascending: false }).limit(20);

    const qRecent = supabase.from('lieux')
      .select('id,nom,cat,ville,note_moyenne,nb_avis,google_photo_url,created_at,mise_en_avant')
      .eq('actif', true).gte('created_at', since30days).order('created_at', { ascending: false }).limit(10);

    let qNearby = supabase.from('lieux')
      .select('id,nom,cat,ville,lat,lng,note_moyenne,nb_avis,google_photo_url,created_at,mise_en_avant').eq('actif', true);
    if (userLat && userLng) {
      const delta = (10 / 111) * 1.3;
      qNearby = (qNearby as any)
        .gte('lat', userLat - delta).lte('lat', userLat + delta)
        .gte('lng', userLng - delta).lte('lng', userLng + delta);
    }
    qNearby = (qNearby as any).limit(60);

    // Univers large pour le scoring "pour toi": on réutilise top+recent+nearby comme pool de candidats
    const [rTop, rRecent, rNearby, signals] = await Promise.all([
      qTop, qRecent, qNearby, loadUserSignals(userId),
    ]);

    let nearbyRaw: DiscoverLieu[] = (rNearby.data || []) as DiscoverLieu[];
    if (userLat && userLng) {
      nearbyRaw = nearbyRaw
        .map(l => ({ ...l, distance: haversine(userLat!, userLng!, l.lat!, l.lng!) }))
        .filter(l => (l.distance ?? 999) <= 10)
        .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
    }

    const top: DiscoverLieu[] = (rTop.data || []) as DiscoverLieu[];
    const recent: DiscoverLieu[] = (rRecent.data || []) as DiscoverLieu[];
    const nearby = nearbyRaw.slice(0, 15);

    // Pool de candidats pour le scoring personnalisé: top-rated + proches + récents, dédupliqués
    const candidatesMap = new Map<string, DiscoverLieu>();
    [...top, ...nearbyRaw.slice(0, 40), ...recent].forEach(l => { if (!candidatesMap.has(l.id)) candidatesMap.set(l.id, l); });
    const candidates = [...candidatesMap.values()];

    const recommended = rankForYou(candidates, signals, 10);
    const friendPicks = filterFriendPicks(candidates, signals, 10);

    // Une seule requête photo pour toutes les sections
    const allIds = [...new Set([...top, ...recent, ...nearby, ...recommended, ...friendPicks].map(l => l.id))];
    const photoMap = await fetchPhotosForLieux(allIds);
    const enrich = (l: DiscoverLieu): DiscoverLieu => ({ ...l, photoUrl: photoMap[l.id] || l.google_photo_url || null });

    const topE = top.slice(0, 10).map(enrich);
    const recentE = recent.map(enrich);
    const nearbyE = nearby.map(enrich);
    const recommendedE = recommended.map(enrich);
    const friendPicksE = friendPicks.map(enrich);

    setTopDiscoverLieux(topE);
    setRecentDiscoverLieux(recentE);
    setNearbyDiscoverLieux(nearbyE);
    setRecommendedLieux(recommendedE);
    setFriendPickLieux(friendPicksE);
    setFeaturedDiscoverLieu(nearbyE.find(l => l.photoUrl) || recommendedE.find(l => l.photoUrl) || nearbyE[0] || recommendedE[0] || null);

    await loadDiscoverPhotos();

    setDiscoverLoading(false);
    setDiscoverLoaded(true);

    // Récupération Google Photos en tâche de fond pour les lieux sans photo, dédupliquée
    const seen = new Set<string>();
    [...topE, ...recentE, ...nearbyE, ...recommendedE, ...friendPicksE]
      .filter(l => !l.photoUrl && !seen.has(l.id) && (seen.add(l.id), true))
      .forEach(l => fetchGooglePhotoFor(l).then(url => {
        if (!url) return;
        const patch = (list: DiscoverLieu[]) => list.map(p => p.id === l.id ? { ...p, photoUrl: url } : p);
        setTopDiscoverLieux(patch); setRecentDiscoverLieux(patch);
        setNearbyDiscoverLieux(patch); setRecommendedLieux(patch); setFriendPickLieux(patch);
        setFeaturedDiscoverLieu(fp => fp?.id === l.id ? { ...fp, photoUrl: url } : fp);
      }));
  }

  async function loadDiscoverPhotos() {
    const { data: photoData } = await supabase
      .from('photos').select('id,url,lieu_id,nom_chien,user_id')
      .eq('validee', true).order('created_at', { ascending: false }).limit(15);
    if (!photoData?.length) { setDiscoverPhotos([]); return; }

    const lieuIds = [...new Set((photoData as any[]).map(p => p.lieu_id).filter(Boolean))];
    const userIds = [...new Set((photoData as any[]).map(p => p.user_id).filter(Boolean))];
    const [{ data: lieuxData }, { data: profilsData }] = await Promise.all([
      lieuIds.length ? supabase.from('lieux').select('id,nom,cat,ville').in('id', lieuIds) : Promise.resolve({ data: [] }),
      userIds.length ? supabase.from('profils').select('id,username,prenom').in('id', userIds) : Promise.resolve({ data: [] }),
    ]);
    const lieuMap: Record<string, any> = {};
    (lieuxData || []).forEach((l: any) => { lieuMap[l.id] = l; });
    const authorMap: Record<string, string | null> = {};
    (profilsData || []).forEach((p: any) => { authorMap[p.id] = p.username ? `@${p.username}` : (p.prenom || null); });

    const mapped: DiscoverPhoto[] = (photoData as any[]).map(p => ({
      id: p.id, url: p.url, lieuId: p.lieu_id,
      lieu: lieuMap[p.lieu_id] || { nom: '?', cat: 'autre', ville: '' },
      nomChien: p.nom_chien || null,
      authorDisplay: authorMap[p.user_id] || null,
    }));
    setDiscoverPhotos(mapped);

    const photoIds = mapped.map(p => p.id);
    const [{ data: allLikes }, { data: myLikes }] = await Promise.all([
      supabase.from('photo_likes').select('photo_id').in('photo_id', photoIds),
      userId ? supabase.from('photo_likes').select('photo_id').in('photo_id', photoIds).eq('user_id', userId) : Promise.resolve({ data: [] }),
    ]);
    const countMap: Record<string, number> = {};
    (allLikes || []).forEach((l: any) => { countMap[l.photo_id] = (countMap[l.photo_id] || 0) + 1; });
    setDiscoverPhotoLikes(countMap);
    setDiscoverPhotoLikedByMe(new Set((myLikes || []).map((l: any) => l.photo_id)));
  }

  async function toggleDiscoverPhotoLike(photoId: string) {
    if (!userId) return;
    const isLiked = discoverPhotoLikedByMe.has(photoId);
    const { error } = isLiked
      ? await supabase.from('photo_likes').delete().eq('photo_id', photoId).eq('user_id', userId)
      : await supabase.from('photo_likes').insert({ photo_id: photoId, user_id: userId });
    if (error) return;
    if (isLiked) {
      setDiscoverPhotoLikedByMe(prev => { const s = new Set(prev); s.delete(photoId); return s; });
      setDiscoverPhotoLikes(prev => ({ ...prev, [photoId]: Math.max(0, (prev[photoId] || 0) - 1) }));
    } else {
      setDiscoverPhotoLikedByMe(prev => new Set([...prev, photoId]));
      setDiscoverPhotoLikes(prev => ({ ...prev, [photoId]: (prev[photoId] || 0) + 1 }));
    }
  }

  async function openDiscoverLieu(id: string) {
    const cached = lieux.find(l => l.id === id);
    if (cached) { setListView(false); openFiche(cached); return; }
    const { data } = await supabase.from('lieux')
      .select('id,nom,lat,lng,cat,ville,adresse,note_moyenne,nb_avis').eq('id', id).single();
    if (data) { setListView(false); openFiche(data as Lieu); }
  }

  async function fetchBalades(r: Region) {
    const latD = r.latitudeDelta * 0.6;
    const lngD = r.longitudeDelta * 0.6;
    const { data } = await supabase
      .from('balades')
      .select('id, user_id, nom, description, depart_lat, depart_lng, depart_label, arrivee_texte, arrivee_lat, arrivee_lng, distance_km, ombragee, eau_chemin, fontaine_eau, sans_laisse, evite_routes, sol_naturel, created_at')
      .eq('validee', true)
      .gte('depart_lat', r.latitude - latD).lte('depart_lat', r.latitude + latD)
      .gte('depart_lng', r.longitude - lngD).lte('depart_lng', r.longitude + lngD)
      .order('created_at', { ascending: false }).limit(50);
    if (!data || !data.length) { setBalades([]); return; }
    const userIds = [...new Set(data.map((b: any) => b.user_id))] as string[];
    const { data: profiles } = await supabase.from('profils').select('id, prenom').in('id', userIds);
    const pm = Object.fromEntries((profiles || []).map((p: any) => [p.id, p]));
    setBalades(data.map((b: any) => ({ ...b, profils: pm[b.user_id] || null })));
  }

  async function submitBalade() {
    if (!userId || !baladeDepartLat || !baladeDepartLng || !baladeNom.trim()) return;
    if (!baladeArrivee.trim() && !baladeFinalArriveeCoords) {
      Alert.alert('Point d\'arrivée manquant', 'Indique l\'arrivée par texte ou sur la carte.');
      return;
    }
    setBaladeLoading(true);

    // Auto-distance via Haversine si GPS disponible, sinon saisie manuelle
    const dist = baladeFinalArriveeCoords
      ? parseFloat(haversine(baladeDepartLat, baladeDepartLng, baladeFinalArriveeCoords.lat, baladeFinalArriveeCoords.lng).toFixed(1))
      : (baladeDistance.trim() ? parseFloat(baladeDistance.replace(',', '.')) : null);

    const { data: baladeRow, error } = await supabase.from('balades').insert({
      user_id: userId,
      nom: baladeNom.trim(),
      description: baladeDesc.trim() || null,
      depart_lat: baladeDepartLat,
      depart_lng: baladeDepartLng,
      arrivee_texte: baladeArrivee.trim() || null,
      arrivee_lat: baladeFinalArriveeCoords?.lat ?? null,
      arrivee_lng: baladeFinalArriveeCoords?.lng ?? null,
      distance_km: dist && !isNaN(dist) ? dist : null,
      validee: true,
      ...baladeFiltres,
    }).select('id').single();

    setBaladeLoading(false);
    if (error) { Alert.alert('Erreur', error.message); return; }

    // Upload photo si sélectionnée
    let photoUrl: string | null = null;
    if (baladePhotoUri) {
      try {
        const ext = baladePhotoUri.split('.').pop()?.toLowerCase() || 'jpg';
        const r2Key = `lieu-photos/community/${userId}/balade-${Date.now()}.${ext}`;
        photoUrl = await uploadToR2(baladePhotoUri, r2Key);
      } catch {}
    }

    // Publication dans le feed
    const distLabel = dist ? ` · ${dist} km` : '';
    supabase.from('community_posts').insert({
      user_id: userId,
      type: 'balade',
      image_url: photoUrl,
      caption: baladeNom.trim() + distLabel,
      auto_generated: true,
    }).then(() => {});

    // +25 points
    supabase.from('profils').select('points').eq('id', userId).single().then(({ data }) => {
      if (data) supabase.from('profils').update({ points: (data.points || 0) + 25 }).eq('id', userId);
    });

    setBaladeFormVisible(false);
    setBaladeNom(''); setBaladeArrivee(''); setBaladeDesc(''); setBaladeDistance('');
    setBaladeDepartLat(null); setBaladeDepartLng(null);
    setBaladeFinalArriveeCoords(null); setBaladeFiltres(FILTRES_VIDE);
    setBaladePhotoUri(null);
    triggerPointsAnim();
    setShowBalades(true);
  }

  function onCatPress(cat: string | null) {
    const next = (cat !== null && cat === activeCat) ? null : cat;
    setActiveCat(next);
    setFavFilter(null);
    setAutresOpen(false);
    lastFetchedRegionRef.current = null;
    fetchLieux(region, next, true);
  }

  function onAutresCatPress(cat: string) {
    const next = cat === activeCat ? null : cat;
    setActiveCat(next);
    setFavFilter(null);
    lastFetchedRegionRef.current = null;
    setAutresOpen(false);
    fetchLieux(region, next, true);
  }

  async function onFavFilterPress(liste: string) {
    setAutresOpen(false);
    if (favFilter === liste) {
      setFavFilter(null);
      fetchLieux(region, activeCat, true);
      return;
    }
    setFavFilter(liste);
    setActiveCat(null);
    if (!userId) { showLoginPrompt(); return; }
    setLoading(true);
    const { data: favs } = await supabase.from('favoris').select('lieu_id').eq('user_id', userId).eq('liste', liste);
    const lieuIds = (favs || []).map((f: any) => f.lieu_id);
    if (!lieuIds.length) { setLieux([]); setLoading(false); return; }
    const { data } = await supabase.from('lieux').select('id,nom,lat,lng,cat,ville,adresse,note_moyenne,nb_avis').in('id', lieuIds).eq('actif', true);
    setLieux(data || []);
    setLoading(false);
  }

  async function openFiche(lieu: Lieu) {
    Keyboard.dismiss();
    setLightboxIdx(null);
    setSheetLoading(true);
    setPrevSelectedId(selectedLieu?.id ?? null);
    if (markerResetTimer.current) clearTimeout(markerResetTimer.current);
    markerResetTimer.current = setTimeout(() => setPrevSelectedId(null), 600);
    setSelectedLieu(lieu as LieuFull);
    setFavListe(null);
    setMyAvis(null);
    setPhotos([]);
    setFicheAvis([]);
    setFichePhotoIdx(0);
    Animated.spring(sheetAnim, { toValue: 0, useNativeDriver: true, tension: 65, friction: 11 }).start();
    skipNextFetchRef.current = true;
    mapRef.current?.animateToRegion({ latitude: lieu.lat, longitude: lieu.lng, latitudeDelta: 0.02, longitudeDelta: 0.02 }, 600);

    let lieuData: any = null, favData: any = null, myAvisData: any = null, photosRaw: any[] = [], avisRaw: any[] = [], communityPostsRaw: any[] = [];
    try {
      const results = await Promise.all([
        supabase.from('lieux').select('*').eq('id', lieu.id).single(),
        userId ? supabase.from('favoris').select('id,liste').eq('user_id', userId).eq('lieu_id', lieu.id).maybeSingle() : Promise.resolve({ data: null }),
        userId ? supabase.from('avis').select('id,note,commentaire').eq('user_id', userId).eq('lieu_id', lieu.id).maybeSingle() : Promise.resolve({ data: null }),
        supabase.from('photos').select('id,url,user_id,nom_chien').eq('lieu_id', lieu.id).order('created_at', { ascending: true }).limit(20),
        supabase.from('avis').select('id,note,commentaire,created_at,user_id,reponse_pro').eq('lieu_id', lieu.id).order('created_at', { ascending: false }).limit(8),
        supabase.from('community_posts').select('id,image_url,user_id').eq('lieu_id', lieu.id).eq('hidden', false).not('image_url', 'is', null).order('created_at', { ascending: false }).limit(10),
      ]);
      lieuData = results[0].data;
      favData = results[1];
      myAvisData = results[2];
      photosRaw = results[3].data || [];
      avisRaw = results[4].data || [];
      communityPostsRaw = results[5].data || [];
    } catch (e) {
      setSheetLoading(false);
      return;
    }

    try {
      if (lieuData) setSelectedLieu(lieuData);
      const favRow = (favData as any)?.data;
      setFavListe(favRow ? (favRow.liste || 'favori') : null);
      const myAvisRow = (myAvisData as any)?.data;
      setMyAvis(myAvisRow ? { note: myAvisRow.note, commentaire: myAvisRow.commentaire } : null);

      // Photos avec likes + auteur + posts communauté tagués sur ce lieu
      const photoIds = (photosRaw || []).map((p: any) => p.id);
      const allPhotoUserIds = [...new Set([
        ...(photosRaw || []).map((p: any) => p.user_id),
        ...communityPostsRaw.map((p: any) => p.user_id),
      ].filter(Boolean))];
      if (photoIds.length > 0 || communityPostsRaw.length > 0) {
        const [{ data: allLikes }, { data: myLikes }, { data: photoAuthors }] = await Promise.all([
          photoIds.length > 0 ? supabase.from('photo_likes').select('photo_id').in('photo_id', photoIds) : Promise.resolve({ data: [] }),
          photoIds.length > 0 && userId ? supabase.from('photo_likes').select('photo_id').in('photo_id', photoIds).eq('user_id', userId) : Promise.resolve({ data: [] }),
          allPhotoUserIds.length > 0 ? supabase.from('profils').select('id,username,prenom').in('id', allPhotoUserIds) : Promise.resolve({ data: [] }),
        ]);
        const countMap: Record<string, number> = {};
        (allLikes || []).forEach((l: any) => { countMap[l.photo_id] = (countMap[l.photo_id] || 0) + 1; });
        const mySet = new Set((myLikes || []).map((l: any) => l.photo_id));
        const authorMap: Record<string, string | null> = {};
        (photoAuthors || []).forEach((p: any) => { authorMap[p.id] = p.username ? `@${p.username}` : (p.prenom || null); });
        const regularPhotos: PhotoFiche[] = (photosRaw || []).map((p: any) => ({
          id: p.id, url: p.url,
          likeCount: countMap[p.id] || 0,
          likedByMe: mySet.has(p.id),
          authorUsername: authorMap[p.user_id] || null,
          nomChien: p.nom_chien || null,
          fromCommunity: false,
        }));
        const communityPhotos: PhotoFiche[] = communityPostsRaw.map((p: any) => ({
          id: 'cp-' + p.id,
          url: p.image_url,
          likeCount: 0,
          likedByMe: false,
          authorUsername: authorMap[p.user_id] || null,
          nomChien: null,
          fromCommunity: true,
        }));
        setPhotos([...regularPhotos, ...communityPhotos]);
      } else {
        setPhotos([]);
        // Fallback photo Google pour les lieux sans photo communauté
        if (lieuData) {
          if (lieuData.google_photo_url) {
            setGooglePhotoUrl(lieuData.google_photo_url);
          } else {
            setGooglePhotoUrl(null);
            const lieuId = lieuData.id;
            (async () => {
              try {
                const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOGLE_KEY, 'X-Goog-FieldMask': 'places.photos' },
                  body: JSON.stringify({ textQuery: `${lieuData.nom} ${lieuData.ville} France`, languageCode: 'fr', maxResultCount: 1 }),
                });
                const json = await res.json();
                const photoName = json.places?.[0]?.photos?.[0]?.name;
                if (photoName) {
                  const url = `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=800&key=${GOOGLE_KEY}`;
                  setGooglePhotoUrl(url);
                  supabase.from('lieux').update({ google_photo_url: url }).eq('id', lieuId).then(() => {});
                }
              } catch {}
            })();
          }
        } else {
          setGooglePhotoUrl(null);
        }
      }

      if ((avisRaw || []).length > 0) {
        const avisUserIds = [...new Set(avisRaw.map((a: any) => a.user_id))];
        const { data: avisProfils } = await supabase.from('profils').select('id,prenom,username,ambassadeur').in('id', avisUserIds);
        const avisProfilMap: Record<string, any> = {};
        (avisProfils || []).forEach((p: any) => { avisProfilMap[p.id] = p; });
        setFicheAvis((avisRaw || []).map((a: any) => ({
          id: a.id, note: a.note, commentaire: a.commentaire, created_at: a.created_at,
          prenom: avisProfilMap[a.user_id]?.prenom || 'Membre',
          username: avisProfilMap[a.user_id]?.username || null,
          reponse_pro: a.reponse_pro || null,
          ambassadeur: avisProfilMap[a.user_id]?.ambassadeur || null,
        })));
      }
    } catch (_) {
      // erreur silencieuse, on affiche quand même ce qu'on a
    } finally {
      setSheetLoading(false);
    }
  }

  function closeFiche() {
    const returnCallback = mapNavigation.consumeReturn();
    setLightboxIdx(null);
    setPrevSelectedId(selectedLieu?.id ?? null);
    if (markerResetTimer.current) clearTimeout(markerResetTimer.current);
    markerResetTimer.current = setTimeout(() => setPrevSelectedId(null), 600);
    sheetPanY.setValue(0);
    Animated.timing(sheetAnim, { toValue: SCREEN_H, duration: 250, useNativeDriver: true }).start(() => {
      setSelectedLieu(null);
      setPhotos([]);
      setFicheAvis([]);
      setFichePhotoIdx(0);
      setFavListe(null);
      setMyAvis(null);
      setGooglePhotoUrl(null);
      if (returnCallback) returnCallback();
    });
  }

  async function submitEnrich() {
    if (!selectedLieu) return;
    const hasContent = enrichDesc.trim() || enrichTel.trim() || enrichSite.trim() || enrichHoraires.trim() || enrichNote.trim();
    if (!hasContent) { Alert.alert('Remplis au moins un champ'); return; }
    setEnrichLoading(true);
    const lines = [
      `Fiche : ${selectedLieu.nom} à ${selectedLieu.ville} (id: ${selectedLieu.id})`,
      `Type : ${enrichType === 'erreur' ? 'Erreur à corriger' : 'Infos manquantes'}`,
    ];
    if (enrichDesc.trim()) lines.push(`Description : ${enrichDesc.trim()}`);
    if (enrichTel.trim()) lines.push(`Téléphone : ${enrichTel.trim()}`);
    if (enrichSite.trim()) lines.push(`Site web : ${enrichSite.trim()}`);
    if (enrichHoraires.trim()) lines.push(`Horaires : ${enrichHoraires.trim()}`);
    if (enrichNote.trim()) lines.push(`Note : ${enrichNote.trim()}`);
    await supabase.from('signalements').insert({ type: 'lieu', message: lines.join('\n'), page: 'fiche' });
    setEnrichLoading(false);
    setEnrichModal(false);
    setEnrichDesc(''); setEnrichTel(''); setEnrichSite(''); setEnrichHoraires(''); setEnrichNote('');
    Alert.alert('Merci !', 'Ta contribution a bien été reçue. Notre équipe la vérifiera sous 48h.');
  }

  async function chooseFavListe(liste: string | null) {
    if (!userId || !selectedLieu) return;
    setFavModal(false);
    setFavLoading(true);
    if (liste === null) {
      await supabase.from('favoris').delete().eq('user_id', userId).eq('lieu_id', selectedLieu.id);
      setFavListe(null);
    } else {
      await supabase.from('favoris').upsert(
        { user_id: userId, lieu_id: selectedLieu.id, liste },
        { onConflict: 'user_id,lieu_id' }
      );
      setFavListe(liste);
    }
    setFavLoading(false);
  }

  async function togglePhotoLike(photoId: string) {
    if (!userId) { showLoginPrompt(); return; }
    const current = photos.find(p => p.id === photoId);
    if (!current || current.fromCommunity) return;
    const wasLiked = current.likedByMe;
    setPhotos(prev => prev.map(p => {
      if (p.id !== photoId) return p;
      return { ...p, likedByMe: !wasLiked, likeCount: wasLiked ? p.likeCount - 1 : p.likeCount + 1 };
    }));
    if (wasLiked) {
      await supabase.from('photo_likes').delete().eq('photo_id', photoId).eq('user_id', userId);
    } else {
      await supabase.from('photo_likes').insert({ photo_id: photoId, user_id: userId });
    }
  }

  async function searchLieux(query: string) {
    if (query.length < 2) { setSearchResults([]); setCityResults([]); setShowResults(false); return; }

    const [{ data: lieuData }, { data: villeData }] = await Promise.all([
      supabase.from('lieux').select('id,nom,lat,lng,cat,ville,adresse').eq('actif', true).ilike('nom', `%${query}%`).limit(6),
      supabase.from('lieux').select('ville,lat,lng').eq('actif', true).ilike('ville', `%${query}%`).limit(30),
    ]);

    // Agréger les villes uniques avec la moyenne des coordonnées
    const villeMap: Record<string, { lat: number; lng: number; count: number }> = {};
    (villeData || []).forEach((l: any) => {
      if (!l.ville || !l.lat || !l.lng || isNaN(l.lat) || isNaN(l.lng)) return;
      if (!villeMap[l.ville]) villeMap[l.ville] = { lat: l.lat, lng: l.lng, count: 1 };
      else {
        const v = villeMap[l.ville];
        v.lat = (v.lat * v.count + l.lat) / (v.count + 1);
        v.lng = (v.lng * v.count + l.lng) / (v.count + 1);
        v.count++;
      }
    });
    setCityResults(
      Object.entries(villeMap)
        .filter(([, { lat, lng }]) => lat && lng && !isNaN(lat) && !isNaN(lng))
        .slice(0, 3)
        .map(([nom, { lat, lng }]) => ({ nom, lat, lng }))
    );
    setSearchResults(lieuData || []);
    setShowResults(true);
  }

  function onSearchChange(text: string) {
    setSearchQuery(text);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => searchLieux(text), 300);
    if (text.length < 2) { setSearchResults([]); setCityResults([]); setShowResults(false); }
  }

  function onSelectLieu(lieu: Lieu) {
    setSearchQuery(''); setSearchResults([]); setCityResults([]); setShowResults(false);
    openFiche(lieu);
  }

  function onSelectCity(city: CityResult) {
    setSearchQuery(''); setSearchResults([]); setCityResults([]); setShowResults(false);
    const r: Region = { latitude: city.lat, longitude: city.lng, latitudeDelta: 0.2, longitudeDelta: 0.2 };
    setRegion(r);
    mapRef.current?.animateToRegion(r, 800);
    fetchLieux(r, activeCat, true);
  }

  async function searchProposeSuggestions(query: string) {
    if (query.length < 3) { setProposeSuggestions([]); return; }
    try {
      let url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=8&addressdetails=1&accept-language=fr`;
      if (userLat && userLng) url += `&viewbox=${userLng - 0.6},${userLat + 0.6},${userLng + 0.6},${userLat - 0.6}`;
      const r = await fetch(url, { headers: { 'User-Agent': 'ThePackApp/1.0 (thepackclub.fr)' } });
      const data = await r.json();
      const suggestions = (data || []).map((item: any) => {
        const addr = item.address || {};
        const num = addr.house_number ? `${addr.house_number} ` : '';
        const road = addr.road || addr.pedestrian || addr.path || addr.footway || addr.square || '';
        let adresse = `${num}${road}`.trim();

        // Pour les lieux sans rue (parcs, monuments…), extraire depuis display_name
        if (!adresse) {
          const parts = (item.display_name as string).split(', ');
          const filtered = parts.slice(1).filter(p =>
            !p.match(/^\d{4,5}$/) &&          // pas code postal
            !p.match(/^France$/i) &&
            !p.match(/^métropolitaine/i) &&
            p !== addr.city && p !== addr.town && p !== addr.village
          );
          if (filtered.length > 0) adresse = filtered[0];
        }

        const ville = addr.city || addr.town || addr.village || addr.municipality || addr.county || '';
        const cp = addr.postcode ? ` ${addr.postcode}` : '';
        const displayAddr = [adresse, ville ? `${ville}${cp}` : ''].filter(Boolean).join(', ');

        return {
          name: item.name || (item.display_name as string).split(',')[0],
          adresse,
          ville,
          lat: parseFloat(item.lat),
          lng: parseFloat(item.lon),
          displayAddr,
        };
      }).filter((s: any) => s.name && s.name.length > 1);
      setProposeSuggestions(suggestions.slice(0, 5));
    } catch {}
  }

  function uploadPhoto() {
    if (!userId) { showLoginPrompt(); return; }
    if (!selectedLieu) return;

    const proceed = (uris: string[], videoUri: string | null) => {
      setPendingPhotoUris(uris);
      setPendingVideoUri(videoUri);
      setDogTagInput(myDogName || '');
      setDogTagModal(true);
    };

    const handlePhotos = async (uris: string[]) => {
      if (ENABLE_VIDEO_UPLOAD) {
        Alert.alert('Ajouter une vidéo ?', 'Tu peux joindre une courte vidéo en plus (optionnel).', [
          { text: 'Non, publier', onPress: () => proceed(uris, null) },
          { text: 'Ajouter une vidéo', onPress: async () => {
            try {
              const vid = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], videoMaxDuration: 60 });
              proceed(uris, !vid.canceled && vid.assets?.[0]?.uri ? vid.assets[0].uri : null);
            } catch { proceed(uris, null); }
          }},
        ]);
      } else {
        proceed(uris, null);
      }
    };

    Alert.alert('Ajouter des photos', '', [
      {
        text: 'Prendre une photo',
        onPress: async () => {
          try {
            const perm = await ImagePicker.requestCameraPermissionsAsync();
            if (!perm.granted) {
              Alert.alert('Accès à la caméra requis', 'Autorise The Pack à accéder à ta caméra dans les Réglages.', [
                { text: 'Annuler', style: 'cancel' },
                { text: 'Ouvrir les Réglages', onPress: () => Linking.openSettings() },
              ]);
              return;
            }
            const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 });
            if (result.canceled || !result.assets?.length) return;
            await handlePhotos(result.assets.map((a: any) => a.uri));
          } catch (e: any) {
            Alert.alert('Erreur', e?.message || 'Impossible d\'ouvrir la caméra.');
          }
        },
      },
      {
        text: 'Choisir depuis la galerie',
        onPress: async () => {
          try {
            const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (!perm.granted) {
              Alert.alert('Accès aux photos requis', 'Autorise The Pack à accéder à ta galerie dans les Réglages.', [
                { text: 'Annuler', style: 'cancel' },
                { text: 'Ouvrir les Réglages', onPress: () => Linking.openSettings() },
              ]);
              return;
            }
            const result = await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ['images'], quality: 0.7, allowsMultipleSelection: true, selectionLimit: 3,
            });
            if (result.canceled || !result.assets?.length) return;
            await handlePhotos(result.assets.map((a: any) => a.uri));
          } catch (e: any) {
            Alert.alert('Erreur', e?.message || 'Impossible d\'ouvrir la galerie.');
          }
        },
      },
      { text: 'Annuler', style: 'cancel' },
    ]);
  }

  async function doUploadPhoto(nomChien: string | null) {
    if (!pendingPhotoUris.length || !userId || !selectedLieu) return;
    setDogTagModal(false);
    setPhotoUploading(true);
    const uris = pendingPhotoUris;
    const videoUri = pendingVideoUri;
    setPendingPhotoUris([]);
    setPendingVideoUri(null);
    const groupId = (uris.length > 1 || videoUri) ? `${Date.now()}-${Math.random().toString(36).slice(2)}` : null;
    try {
      for (const uri of uris) {
        const ext = uri.split('.').pop()?.toLowerCase() === 'png' ? 'png' : 'jpg';
        const r2Key = `lieu-photos/${userId}/${selectedLieu.id}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const publicUrl = await uploadToR2(uri, r2Key).catch((upErr: any) => {
          Alert.alert('Erreur upload', upErr.message); return null;
        });
        if (!publicUrl) return;
        const { error: insertErr } = await supabase.from('photos').insert({
          lieu_id: selectedLieu.id, user_id: userId, url: publicUrl,
          nom_chien: nomChien || null, validee: true,
          ...(groupId ? { group_id: groupId } : {}),
        });
        if (insertErr) { Alert.alert('Erreur', insertErr.message); return; }
      }
      if (videoUri) {
        const ext = videoUri.split('.').pop()?.toLowerCase() || 'mp4';
        const path = `${userId}/${selectedLieu.id}-${Date.now()}.${ext}`;
        const base64 = await FileSystem.readAsStringAsync(videoUri, { encoding: FileSystem.EncodingType.Base64 });
        const { error: upErr } = await supabase.storage.from('lieu-videos').upload(path, decode(base64), { contentType: 'video/' + ext });
        if (!upErr) {
          const { data: { publicUrl } } = supabase.storage.from('lieu-videos').getPublicUrl(path);
          await supabase.from('videos').insert({
            lieu_id: selectedLieu.id, user_id: userId, url: publicUrl, validee: false,
            ...(groupId ? { group_id: groupId } : {}),
          });
        }
      }
      const count = uris.length + (videoUri ? 1 : 0);
      Alert.alert('Merci !', count > 1 ? 'Tes médias seront visibles après validation par notre équipe.' : 'Ta photo sera visible après validation par notre équipe.');
    } catch (e: any) {
      Alert.alert('Erreur', e?.message || 'Impossible d\'envoyer les médias.');
    } finally {
      setPhotoUploading(false);
    }
  }

  async function submitAvis() {
    if (!userId) { showLoginPrompt(); return; }
    if (!selectedLieu || !avisNote) return;
    setAvisLoading(true);
    const { error } = await supabase.from('avis').upsert(
      { user_id: userId, lieu_id: selectedLieu.id, note: avisNote, commentaire: avisComment.trim() || null },
      { onConflict: 'user_id,lieu_id' }
    );
    setAvisLoading(false);
    if (error) { Alert.alert('Erreur', error.message); return; }
    const isNewAvis = !myAvis;
    setMyAvis({ note: avisNote, commentaire: avisComment.trim() || null });
    setAvisModal(false); setAvisNote(0); setAvisComment('');
    if (isNewAvis && userId) {
      const pointsToAdd = avisComment.trim() ? 15 : 10;
      const { data: pd } = await supabase.from('profils').select('points').eq('id', userId).single();
      if (pd) await supabase.from('profils').update({ points: (pd.points || 0) + pointsToAdd }).eq('id', userId);
    }
    const { data } = await supabase.from('lieux').select('*').eq('id', selectedLieu.id).single();
    if (data) setSelectedLieu(data);
    const { data: avisRaw } = await supabase.from('avis').select('id,note,commentaire,created_at,user_id,reponse_pro').eq('lieu_id', selectedLieu.id).order('created_at', { ascending: false }).limit(8);
    if ((avisRaw || []).length > 0) {
      const avisUserIds = [...new Set((avisRaw || []).map((a: any) => a.user_id))];
      const { data: avisProfils } = await supabase.from('profils').select('id,prenom,username,ambassadeur').in('id', avisUserIds);
      const avisProfilMap: Record<string, any> = {};
      (avisProfils || []).forEach((p: any) => { avisProfilMap[p.id] = p; });
      setFicheAvis((avisRaw || []).map((a: any) => ({ id: a.id, note: a.note, commentaire: a.commentaire, created_at: a.created_at, prenom: avisProfilMap[a.user_id]?.prenom || 'Membre', username: avisProfilMap[a.user_id]?.username || null, reponse_pro: a.reponse_pro || null, ambassadeur: avisProfilMap[a.user_id]?.ambassadeur || null })));
    }
    Alert.alert('Merci !', 'Ton avis a bien été enregistré.');
  }

  async function useMyLocation() {
    setProposeGeoLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Permission requise', "Autorise la géolocalisation dans les réglages."); setProposeGeoLoading(false); return; }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setProposeLat(loc.coords.latitude);
      setProposeLng(loc.coords.longitude);
      const r = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${loc.coords.latitude}&lon=${loc.coords.longitude}&format=json`,
        { headers: { 'User-Agent': 'ThePackApp/1.0' } }
      );
      const j = await r.json();
      if (j?.address) {
        if (!proposeAdresse && j.address.road) {
          const num = j.address.house_number ? j.address.house_number + ' ' : '';
          setProposeAdresse(`${num}${j.address.road}`);
        }
        if (!proposeVille) {
          setProposeVille(j.address.city || j.address.town || j.address.village || j.address.municipality || '');
        }
      }
    } catch (_) { Alert.alert('Erreur', "Impossible de récupérer ta position."); }
    setProposeGeoLoading(false);
  }

  async function geocodeAdresse() {
    const q = [proposeAdresse, proposeVille].filter(Boolean).join(', ');
    if (!q) return;
    setProposeGeoLoading(true);
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`,
        { headers: { 'User-Agent': 'ThePackApp/1.0' } }
      );
      const j = await r.json();
      if (j?.[0]) {
        setProposeLat(parseFloat(j[0].lat));
        setProposeLng(parseFloat(j[0].lon));
      } else {
        Alert.alert('Adresse introuvable', "Vérifie l'adresse et la ville, puis réessaie.");
      }
    } catch (_) {}
    setProposeGeoLoading(false);
  }

  async function submitFeedback() {
    if (!feedbackText.trim()) return;
    setFeedbackLoading(true);
    await supabase.from('feedbacks').insert({
      user_id: userId || null,
      type: feedbackType,
      message: feedbackText.trim(),
    });
    setFeedbackLoading(false);
    setFeedbackModal(false);
    setFeedbackText('');
    Alert.alert('Merci !', 'Ton message a bien été envoyé 🐾');
  }

  async function loadMapEvents() {
    const now = new Date().toISOString();
    const { data } = await supabase
      .from('evenements')
      .select('id,titre,date_heure,adresse,ville,lat,lng,max_participants,payant,prix,profils(prenom,username)')
      .eq('valide', true).eq('actif', true)
      .gte('date_heure', now)
      .not('lat', 'is', null)
      .not('lng', 'is', null);
    const list = (data || []) as any[];
    if (!list.length) { setMapEvents([]); return; }
    const ids = list.map((e: any) => e.id);
    const [partsRes, ...counts] = await Promise.all([
      userId
        ? supabase.from('participations').select('event_id').eq('user_id', userId).in('event_id', ids)
        : Promise.resolve({ data: null }),
      ...ids.map((id: string) =>
        supabase.from('participations').select('*', { count: 'exact', head: true }).eq('event_id', id)
      ),
    ]);
    const inscritIds = new Set(((partsRes as any).data || []).map((p: any) => p.event_id));
    setMapEvents(list.map((e: any, i: number) => ({
      ...e,
      nb_inscrits: (counts[i] as any).count || 0,
      je_suis_inscrit: inscritIds.has(e.id),
    })));
  }

  async function toggleMapEventInscription(eventId: string, join: boolean) {
    if (!userId) { showLoginPrompt(); return; }
    setMapEventInscLoading(true);
    if (join) {
      await supabase.from('participations').insert({ event_id: eventId, user_id: userId });
    } else {
      await supabase.from('participations').delete().eq('event_id', eventId).eq('user_id', userId);
    }
    setMapEventInscLoading(false);
    const update = (e: EventMarker): EventMarker => e.id !== eventId ? e : {
      ...e, je_suis_inscrit: join, nb_inscrits: e.nb_inscrits + (join ? 1 : -1),
    };
    setMapEvents(prev => prev.map(update));
    setSelectedMapEvent(prev => prev ? update(prev) : prev);
  }

  async function handleMapLongPress(e: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) {
    requireAuth(async () => {
      const { latitude, longitude } = e.nativeEvent.coordinate;
      setProposeNom(''); setProposeAdresse(''); setProposeVille('');
      setProposeCats([]); setProposeAutreLabel(''); setProposeTel(''); setProposeSite(''); setProposeDesc('');
      setProposeAmenities({ chiens_salle: false, chiens_terrasse: false, espace_dedie: false, eau: false, gamelles: false, chiens_laches: false, chiens_laisse: false, petits_chiens: false, moyens_chiens: false, grands_chiens: false });
      setProposeLat(latitude);
      setProposeLng(longitude);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&accept-language=fr`,
          { headers: { 'User-Agent': 'ThePackApp/1.0' } },
        );
        const j = await res.json();
        if (j?.address) {
          const num = j.address.house_number ? `${j.address.house_number} ` : '';
          if (j.address.road) setProposeAdresse(`${num}${j.address.road}`);
          const city = j.address.city || j.address.town || j.address.village || j.address.municipality || '';
          if (city) setProposeVille(city);
        }
      } catch {}
      setProposeModal(true);
    });
  }

  async function pickProposePhotos() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission requise', "Autorise l'accès à ta galerie dans les réglages."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], quality: 0.8,
      allowsMultipleSelection: true, selectionLimit: 5 - proposePhotos.length,
    });
    if (result.canceled) return;
    setProposePhotos(prev => [...prev, ...result.assets.map(a => a.uri)].slice(0, 5));
  }

  async function pickProposeVideo() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission requise', "Autorise l'accès à ta galerie dans les réglages."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'], videoMaxDuration: 60,
    });
    if (result.canceled) return;
    setProposeVideo(result.assets[0].uri);
  }

  async function submitPropose() {
    if (!userId) { showLoginPrompt(); return; }
    if (!proposeNom.trim() || !proposeVille.trim()) return;
    if (!proposeCats.length) { Alert.alert('Type de lieu manquant', 'Choisis au moins un type de lieu.'); return; }
    setProposeLoading(true);
    const { data: insertedLieu, error } = await supabase.from('lieux').insert({
      nom: proposeNom.trim(), adresse: proposeAdresse.trim() || null, ville: proposeVille.trim(),
      cat: proposeCats[0],
      tel: proposeTel.trim() || null, site_web: proposeSite.trim() || null,
      description: (() => {
        const extras: string[] = [];
        if (proposeCats.length > 1) extras.push(`Typologies: ${proposeCats.map(k => CAT_CONFIG[k]?.label || k).join(', ')}`);
        if (proposeCats.includes('autre') && proposeAutreLabel.trim()) extras.push(`Type: ${proposeAutreLabel.trim()}`);
        const prefix = extras.length ? `[${extras.join(' | ')}]\n` : '';
        return (prefix + proposeDesc.trim()) || null;
      })(),
      lat: proposeLat ?? region.latitude,
      lng: proposeLng ?? region.longitude,
      actif: true,
      submitted_by: userId,
      ...proposeAmenities,
    }).select('id').single();
    if (!error && userId) {
      const { data: profilData } = await supabase.from('profils').select('points').eq('id', userId).single();
      if (profilData) {
        await supabase.from('profils').update({ points: (profilData.points || 0) + 50 }).eq('id', userId);
      }
    }
    // Upload photos
    if (!error && insertedLieu?.id && proposePhotos.length) {
      for (const uri of proposePhotos) {
        try {
          const ext = uri.split('.').pop()?.toLowerCase() === 'png' ? 'png' : 'jpg';
          const r2Key = `lieu-photos/${userId}/${insertedLieu.id}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
          const publicUrl = await uploadToR2(uri, r2Key);
          await supabase.from('photos').insert({ lieu_id: insertedLieu.id, user_id: userId, url: publicUrl, validee: true });
        } catch {}
      }
    }
    // Upload vidéo
    if (!error && insertedLieu?.id && proposeVideo) {
      try {
        const ext = proposeVideo.split('.').pop()?.toLowerCase() || 'mp4';
        const path = `${userId}/${insertedLieu.id}-${Date.now()}.${ext}`;
        const b64 = await FileSystem.readAsStringAsync(proposeVideo, { encoding: FileSystem.EncodingType.Base64 });
        const { data: up } = await supabase.storage.from('lieu-videos').upload(path, decode(b64), { contentType: `video/${ext}` });
        if (up) {
          const { data: { publicUrl } } = supabase.storage.from('lieu-videos').getPublicUrl(path);
          await supabase.from('videos').insert({ lieu_id: insertedLieu.id, user_id: userId, url: publicUrl, validee: true });
        }
      } catch {}
    }
    // Créer le post communautaire
    if (!error && insertedLieu?.id && userId) {
      supabase.from('community_posts').insert({
        user_id: userId, type: 'nouveau_lieu', lieu_id: insertedLieu.id, auto_generated: true, image_url: null,
      }).then(() => {});
    }
    setProposeLoading(false);
    if (error) { Alert.alert('Erreur', error.message); return; }
    setProposeModal(false);
    setProposeNom(''); setProposeAdresse(''); setProposeVille('');
    setProposeCats([]); setProposeAutreLabel(''); setProposeTel(''); setProposeSite(''); setProposeDesc('');
    setProposeLat(null); setProposeLng(null);
    setProposeAmenities({ chiens_salle: false, chiens_terrasse: false, espace_dedie: false, eau: false, gamelles: false, chiens_laches: false, chiens_laisse: false, petits_chiens: false, moyens_chiens: false, grands_chiens: false });
    setProposePhotos([]);
    setProposeVideo(null);
    triggerPointsAnim();
  }

  function triggerPointsAnim() {
    pointsAnimY.setValue(0);
    pointsAnimOp.setValue(1);
    setShowPointsAnim(true);
    Animated.parallel([
      Animated.timing(pointsAnimY, { toValue: -70, duration: 1600, useNativeDriver: true }),
      Animated.sequence([
        Animated.delay(900),
        Animated.timing(pointsAnimOp, { toValue: 0, duration: 700, useNativeDriver: true }),
      ]),
    ]).start(() => setShowPointsAnim(false));
  }

  async function shareLieu() {
    if (!selectedLieu) return;
    try {
      if (shareLieuCardRef.current) {
        const uri = await captureRef(shareLieuCardRef, { format: 'png', quality: 1 });
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Partager ce lieu' });
          return;
        }
      }
    } catch {}
    await Share.share({
      message: `🐾 ${selectedLieu.nom} (${selectedLieu.ville}) — Lieu dog-friendly sur The Pack`,
      url: `https://thepackclub.fr/carte.html?lieu=${selectedLieu.id}`,
    });
  }

  async function shareLieuWhatsapp() {
    if (!selectedLieu) return;
    const text = `🐾 ${selectedLieu.nom} (${selectedLieu.ville}) — Lieu dog-friendly sur The Pack\nhttps://thepackclub.fr/carte.html?lieu=${selectedLieu.id}`;
    const waUrl = `whatsapp://send?text=${encodeURIComponent(text)}`;
    try {
      const supported = await Linking.canOpenURL(waUrl);
      if (supported) { await Linking.openURL(waUrl); return; }
    } catch {}
    await Share.share({ message: text });
  }

  const FICHE_HEADER_H = Math.round(SCREEN_H * 0.42);

  const FAV_LISTS: { key: string; label: string; icon: IoniconsName; color: string }[] = [
    { key: 'favori',      label: 'Mes favoris',  icon: 'heart',           color: '#E05070' },
    { key: 'a_tester',   label: 'À tester',      icon: 'bookmark',        color: colors.bordeaux },
    { key: 'deja_teste', label: 'Déjà testé',    icon: 'checkmark-circle', color: '#5A9E6F' },
  ];

  function sortLieux(items: Lieu[]): Lieu[] {
    return [...items].sort((a, b) => {
      if (sortBy === 'note') return (b.note_moyenne ?? -1) - (a.note_moyenne ?? -1);
      if (userLat !== null && userLng !== null)
        return haversine(userLat, userLng, a.lat, a.lng) - haversine(userLat, userLng, b.lat, b.lng);
      return 0;
    });
  }

  const EQUIP_MAP: Record<string, keyof Lieu> = {
    chiens_terrasse: 'chiens_terrasse',
    eau: 'eau',
    chiens_salle: 'chiens_salle',
    chiens_laches: 'chiens_laches',
    chiens_laisse: 'chiens_laisse',
    espace_dedie: 'espace_dedie',
    gamelles: 'gamelles',
    petits_chiens: 'petits_chiens',
    moyens_chiens: 'moyens_chiens',
    grands_chiens: 'grands_chiens',
  };

  const filteredLieux = useMemo(() => {
    return lieux.filter(l => {
      if (filterMinNote > 0 && (l.note_moyenne ?? 0) < filterMinNote) return false;
      if (filterCat && l.cat !== filterCat) return false;
      if (filterDistance && userLat !== null && userLng !== null && l.lat && l.lng) {
        if (haversine(userLat, userLng, l.lat, l.lng) > filterDistance) return false;
      }
      for (const eq of filterEquipements) {
        const col = EQUIP_MAP[eq];
        if (col && !l[col]) return false;
      }
      return true;
    });
  }, [lieux, filterMinNote, filterEquipements, filterCat, filterDistance, userLat, userLng]);

  const clusterIndex = useMemo(() => {
    const index = new Supercluster<{ lieu: Lieu }>({ radius: 50, maxZoom: 14 });
    index.load(filteredLieux.map(l => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [l.lng, l.lat] },
      properties: { lieu: l },
    })));
    return index;
  }, [filteredLieux]);

  const clusters = useMemo(() => {
    if (!region.latitudeDelta || !region.longitudeDelta ||
        region.latitudeDelta <= 0 || region.longitudeDelta <= 0 ||
        isNaN(region.latitude) || isNaN(region.longitude)) return [];
    const rawZoom = Math.round(Math.log(360 / region.latitudeDelta) / Math.LN2);
    const zoom = isFinite(rawZoom) ? Math.min(20, Math.max(0, rawZoom)) : 10;
    const bbox: [number, number, number, number] = [
      region.longitude - region.longitudeDelta / 2,
      region.latitude - region.latitudeDelta / 2,
      region.longitude + region.longitudeDelta / 2,
      region.latitude + region.latitudeDelta / 2,
    ];
    try {
      const all = clusterIndex.getClusters(bbox, zoom);
      return all.slice(0, 300);
    } catch {
      return [];
    }
  }, [clusterIndex, region]);

  const filterActive = filterMinNote > 0 || filterEquipements.length > 0 || filterCat !== null || filterDistance !== null;

  function openFilterModal() {
    setFilterModal(true);
    Animated.spring(filterAnim, { toValue: 0, useNativeDriver: true, tension: 65, friction: 11 }).start();
  }
  function closeFilterModal() {
    Animated.timing(filterAnim, { toValue: SCREEN_H, duration: 220, useNativeDriver: true }).start(() => setFilterModal(false));
  }
  function toggleEquip(key: string) {
    setFilterEquipements(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  }
  function resetFilters() { setFilterMinNote(0); setFilterEquipements([]); setFilterCat(null); setFilterDistance(null); }

  function renderFilterModal() {
    if (!filterModal) return null;
    const EQUIP_CHIPS: { key: string; label: string; icon: IoniconsName }[] = [
      { key: 'chiens_salle', label: 'En salle', icon: 'home-outline' },
      { key: 'chiens_terrasse', label: 'En terrasse', icon: 'sunny-outline' },
      { key: 'espace_dedie', label: 'Espace dédié', icon: 'heart-outline' },
      { key: 'eau', label: 'Eau fournie', icon: 'water-outline' },
      { key: 'gamelles', label: 'Gamelles', icon: 'restaurant-outline' },
      { key: 'chiens_laches', label: 'Lâchés autorisés', icon: 'checkmark-circle-outline' },
      { key: 'chiens_laisse', label: 'Laisse obligatoire', icon: 'alert-circle-outline' },
      { key: 'petits_chiens', label: 'Petits chiens', icon: 'paw-outline' },
      { key: 'moyens_chiens', label: 'Moyens chiens', icon: 'paw-outline' },
      { key: 'grands_chiens', label: 'Grands chiens', icon: 'paw-outline' },
    ];
    return (
      <Modal visible transparent animationType="none" onRequestClose={closeFilterModal}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={closeFilterModal} />
        <Animated.View style={[styles.filterSheet, { transform: [{ translateY: filterAnim }] }]}>
          {/* Handle */}
          <View style={styles.handleArea}>
            <View style={styles.handle} />
          </View>
          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 14 }}>
            <TouchableOpacity onPress={closeFilterModal} style={{ marginRight: 12 }}>
              <Ionicons name="close" size={22} color={colors.bordeaux} />
            </TouchableOpacity>
            <Text style={styles.filterSheetTitle}>Filtres</Text>
            <TouchableOpacity onPress={resetFilters} style={{ marginLeft: 'auto' }}>
              <Text style={styles.filterSheetReset}>Réinit.</Text>
            </TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}>
            {/* Catégorie */}
            <Text style={styles.filterSectionLabel}>CATÉGORIE</Text>
            <View style={styles.filterChipsGrid}>
              {Object.entries(CAT_CONFIG).filter(([key]) => key !== 'autre').map(([key, cfg]) => {
                const active = filterCat === key;
                return (
                  <TouchableOpacity
                    key={key}
                    style={[styles.filterEquipChip, active && styles.filterEquipChipActive]}
                    onPress={() => setFilterCat(filterCat === key ? null : key)}
                  >
                    <Ionicons name={cfg.icon} size={15} color={active ? colors.ivory : colors.bordeaux} />
                    <Text style={[styles.filterEquipLabel, active && { color: colors.ivory }]}>{cfg.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {/* Distance */}
            <Text style={[styles.filterSectionLabel, { marginTop: 20 }]}>RAYON DE RECHERCHE</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
              {[
                { label: '500 m', val: 0.5 },
                { label: '1 km',  val: 1 },
                { label: '2 km',  val: 2 },
                { label: '5 km',  val: 5 },
                { label: '10 km', val: 10 },
              ].map(d => {
                const active = filterDistance === d.val;
                return (
                  <TouchableOpacity
                    key={d.val}
                    style={[styles.filterEquipChip, active && styles.filterEquipChipActive]}
                    onPress={() => setFilterDistance(active ? null : d.val)}
                  >
                    <Text style={[styles.filterEquipLabel, active && { color: colors.ivory }]}>{d.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {/* Note minimum */}
            <Text style={styles.filterSectionLabel}>NOTE MINIMUM</Text>
            <View style={{ flexDirection: 'row', gap: 6, marginBottom: 24 }}>
              {[1,2,3,4,5].map(n => (
                <TouchableOpacity key={n} onPress={() => setFilterMinNote(filterMinNote === n ? 0 : n)}>
                  <Ionicons name={n <= filterMinNote ? 'star' : 'star-outline'} size={32} color={n <= filterMinNote ? colors.terra : colors.border} />
                </TouchableOpacity>
              ))}
            </View>
            {/* Équipements */}
            <Text style={styles.filterSectionLabel}>ÉQUIPEMENTS</Text>
            <View style={styles.filterChipsGrid}>
              {EQUIP_CHIPS.map(eq => {
                const active = filterEquipements.includes(eq.key);
                return (
                  <TouchableOpacity
                    key={eq.key}
                    style={[styles.filterEquipChip, active && styles.filterEquipChipActive]}
                    onPress={() => toggleEquip(eq.key)}
                  >
                    <Ionicons name={eq.icon} size={15} color={active ? colors.ivory : colors.bordeaux} />
                    <Text style={[styles.filterEquipLabel, active && { color: colors.ivory }]}>{eq.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
          {/* CTA */}
          <View style={{ paddingHorizontal: 20, paddingBottom: 32, paddingTop: 8 }}>
            <TouchableOpacity
              style={styles.filterCTA}
              onPress={closeFilterModal}
            >
              <Text style={styles.filterCTAText}>
                Afficher {filteredLieux.length} lieu{filteredLieux.length !== 1 ? 'x' : ''}
              </Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </Modal>
    );
  }

  function favIcon(): IoniconsName {
    if (!favListe) return 'heart-outline';
    const cfg = FAV_LISTS.find(f => f.key === favListe);
    return cfg ? cfg.icon : 'heart-outline';
  }
  function favColor(): string {
    if (!favListe) return '#fff';
    const cfg = FAV_LISTS.find(f => f.key === favListe);
    return cfg ? cfg.color : '#fff';
  }

  function renderSheet() {
    if (!selectedLieu) return null;
    const cfg = CAT_CONFIG[selectedLieu.cat] || CAT_CONFIG.autre;
    const badges = [
      { label: 'En salle',           icon: 'home-outline' as IoniconsName,             ok: !!selectedLieu.chiens_salle },
      { label: 'En terrasse',        icon: 'sunny-outline' as IoniconsName,            ok: !!selectedLieu.chiens_terrasse },
      { label: 'Espace dédié',       icon: 'heart-outline' as IoniconsName,            ok: !!selectedLieu.espace_dedie },
      { label: 'Eau fournie',        icon: 'water-outline' as IoniconsName,            ok: !!selectedLieu.eau },
      { label: 'Gamelles',           icon: 'restaurant-outline' as IoniconsName,       ok: !!selectedLieu.gamelles },
      { label: 'Lâchés OK',          icon: 'checkmark-circle-outline' as IoniconsName, ok: !!selectedLieu.chiens_laches },
      { label: 'Laisse obligatoire', icon: 'alert-circle-outline' as IoniconsName,     ok: !!selectedLieu.chiens_laisse },
      { label: 'Petits chiens',      icon: 'paw-outline' as IoniconsName,              ok: !!selectedLieu.petits_chiens },
      { label: 'Moyens chiens',      icon: 'paw-outline' as IoniconsName,              ok: !!selectedLieu.moyens_chiens },
      { label: 'Grands chiens',      icon: 'paw-outline' as IoniconsName,              ok: !!selectedLieu.grands_chiens },
    ].filter(b => b.ok);
    const currentPhoto = photos[fichePhotoIdx] || null;

    return (
      <Modal visible transparent animationType="none" onRequestClose={closeFiche} statusBarTranslucent>
        <TouchableOpacity style={styles.overlay} onPress={closeFiche} activeOpacity={1} />
        <Animated.View style={[styles.sheet, { transform: [{ translateY: Animated.add(sheetAnim, sheetPanY) }] }]}>
          <View style={styles.handleArea} {...sheetPanResponder.panHandlers}>
            <View style={styles.handle} />
          </View>

          {/* ====== HEADER PHOTO ====== */}
          <View style={[styles.ficheHeader, { height: FICHE_HEADER_H }]}>
            {photos.length > 0 ? (
              <ScrollView
                horizontal pagingEnabled
                showsHorizontalScrollIndicator={false}
                style={StyleSheet.absoluteFill}
                onMomentumScrollEnd={e => {
                  const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
                  setFichePhotoIdx(Math.max(0, Math.min(idx, photos.length - 1)));
                }}
              >
                {photos.map((ph, idx) => (
                  <TouchableOpacity key={ph.id} activeOpacity={0.9} onPress={() => setLightboxIdx(idx)} style={{ width: SCREEN_W }}>
                    <Image source={{ uri: ph.url }} style={{ width: SCREEN_W, height: FICHE_HEADER_H }} resizeMode="cover" />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            ) : googlePhotoUrl ? (
              <Image source={{ uri: googlePhotoUrl }} style={[StyleSheet.absoluteFill, { width: SCREEN_W, height: FICHE_HEADER_H }]} resizeMode="cover" />
            ) : (
              <View style={[styles.ficheHeaderPlaceholder, { backgroundColor: cfg.color }]}>
                <CatIcon cat={selectedLieu?.cat} name={cfg.icon} size={72} color="rgba(245,239,224,0.18)" />
              </View>
            )}

            {/* Compteur photos */}
            {photos.length > 1 && (
              <View style={styles.fichePhotoCounter}>
                <Text style={styles.fichePhotoCounterText}>{fichePhotoIdx + 1}/{photos.length}</Text>
              </View>
            )}

            {/* Bouton ajouter photo (haut gauche) */}
            <TouchableOpacity style={[styles.ficheBtnAddPhoto, { top: insets.top + 12 }]} onPress={uploadPhoto} disabled={photoUploading}>
              {photoUploading
                ? <ActivityIndicator size="small" color="#fff" />
                : <Ionicons name="camera" size={16} color="#fff" />
              }
            </TouchableOpacity>

            {/* Bouton fermer (haut droite) */}
            <TouchableOpacity style={[styles.ficheBtnClose, { top: insets.top + 12 }]} onPress={closeFiche}>
              <Ionicons name="close" size={18} color="#fff" />
            </TouchableOpacity>

            {/* Bouton favori (2e depuis la droite) */}
            <TouchableOpacity style={[styles.ficheBtnFav, { top: insets.top + 12 }]} onPress={() => setFavModal(v => !v)} disabled={favLoading}>
              {favLoading
                ? <ActivityIndicator size="small" color="#fff" />
                : <Ionicons name={favIcon()} size={18} color={favColor()} />
              }
            </TouchableOpacity>

            {/* Dropdown favori inline */}
            {favModal && (
              <View style={styles.favDropdown}>
                {FAV_LISTS.map((f, idx) => (
                  <TouchableOpacity
                    key={f.key}
                    style={[styles.favDropdownRow, idx < FAV_LISTS.length - 1 && styles.favDropdownBorder, favListe === f.key && { backgroundColor: f.color + '14' }]}
                    onPress={() => chooseFavListe(f.key)}
                  >
                    <Ionicons name={f.icon} size={16} color={f.color} />
                    <Text style={[styles.favDropdownLabel, favListe === f.key && { color: f.color, fontFamily: 'DMSans_500Medium' }]}>{f.label}</Text>
                    {favListe === f.key && <Ionicons name="checkmark" size={14} color={f.color} />}
                  </TouchableOpacity>
                ))}
                {favListe && (
                  <TouchableOpacity style={[styles.favDropdownRow, styles.favDropdownBorder, { borderTopColor: colors.border }]} onPress={() => chooseFavListe(null)}>
                    <Ionicons name="trash-outline" size={15} color={colors.textMuted} />
                    <Text style={[styles.favDropdownLabel, { color: colors.textMuted }]}>Retirer</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* Crédits photo (bas droite) */}
            {currentPhoto && (
              <View style={styles.fichePhotoCredits}>
                {currentPhoto.nomChien && (
                  <View style={styles.dogTagBadge}>
                    <Text style={styles.dogTagText}>🐾 {currentPhoto.nomChien}</Text>
                  </View>
                )}
                {currentPhoto.authorUsername && (
                  <Text style={styles.fichePhotoAuthor}>{currentPhoto.authorUsername}</Text>
                )}
                {!currentPhoto.fromCommunity && (
                  <TouchableOpacity style={styles.fichePhotoLikeRow} onPress={() => togglePhotoLike(currentPhoto.id)}>
                    <Ionicons
                      name={currentPhoto.likedByMe ? 'heart' : 'heart-outline'}
                      size={14}
                      color={currentPhoto.likedByMe ? '#E05070' : 'rgba(255,255,255,0.8)'}
                    />
                    {currentPhoto.likeCount > 0 && (
                      <Text style={[styles.fichePhotoLikeCount, currentPhoto.likedByMe && { color: '#E05070' }]}>
                        {currentPhoto.likeCount}
                      </Text>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>

          {/* ====== INFO BLOC ====== */}
          <View style={styles.ficheInfoBlock}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
              <View style={[styles.catBadge, { backgroundColor: cfg.color + '18' }]}>
                <Ionicons name={cfg.icon} size={11} color={cfg.color} />
                <Text style={[styles.catLabel, { color: cfg.color }]}>{cfg.label}</Text>
              </View>
              {parseTypoLabels(selectedLieu.description).filter(l => l !== cfg.label).map(label => {
                const key = CAT_BY_LABEL[label];
                const c = key ? CAT_CONFIG[key] : null;
                if (!c) return null;
                return (
                  <View key={label} style={[styles.catBadge, { backgroundColor: c.color + '18' }]}>
                    <Ionicons name={c.icon} size={11} color={c.color} />
                    <Text style={[styles.catLabel, { color: c.color }]}>{c.label}</Text>
                  </View>
                );
              })}
              {(selectedLieu as any).manager_user_id && (
                <View style={styles.certBadgeIcon}>
                  <Ionicons name="checkmark" size={10} color="#fff" />
                </View>
              )}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Text style={styles.ficheInfoNom} numberOfLines={2}>{selectedLieu.nom}</Text>
              {(selectedLieu as any).manager_user_id && (
                <View style={styles.certInlineBadge}>
                  <Ionicons name="checkmark-circle" size={11} color="#22a855" />
                  <Text style={styles.certInlineText}>Certifié The Pack</Text>
                </View>
              )}
            </View>
            {(selectedLieu.adresse || selectedLieu.ville) ? (
              <Text style={styles.ficheInfoAdresse} numberOfLines={1}>
                {[selectedLieu.adresse, selectedLieu.ville].filter(Boolean).join(' · ')}
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
              {selectedLieu.note_moyenne ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                  {[1,2,3,4,5].map(i => (
                    <Ionicons key={i} name={i <= Math.round(selectedLieu.note_moyenne!) ? 'star' : 'star-outline'} size={13} color={colors.terra} />
                  ))}
                  <Text style={styles.ficheInfoScore}>{selectedLieu.note_moyenne.toFixed(1)}</Text>
                  <Text style={styles.ficheInfoAvis}>({selectedLieu.nb_avis || 0} avis)</Text>
                </View>
              ) : null}
              {(() => {
                const status = parseOpenStatus(selectedLieu.horaires);
                if (!status) return null;
                return (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: status === 'open' ? '#3a9e5f' : '#c04040' }} />
                    <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 12, color: status === 'open' ? '#3a9e5f' : '#c04040' }}>
                      {status === 'open' ? 'Ouvert' : 'Fermé'}
                    </Text>
                  </View>
                );
              })()}
            </View>
          </View>

          {/* ====== BODY ====== */}
          <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false} onScrollBeginDrag={() => setFavModal(false)}>
            {sheetLoading ? (
              <ActivityIndicator color={colors.terra} style={{ marginVertical: 24 }} />
            ) : (
              <>
                {badges.length > 0 && (
                  <View style={styles.badgesWrap}>
                    {badges.map(b => (
                      <View key={b.label} style={styles.badge}>
                        <Ionicons name={b.icon} size={12} color={colors.terra} />
                        <Text style={styles.badgeText}>{b.label}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {(() => { const d = stripTypoPrefix(selectedLieu.description); return d ? <Text style={styles.description}>{d}</Text> : null; })()}

                {selectedLieu.tel ? (
                  <TouchableOpacity style={styles.infoRow} onPress={() => Linking.openURL(`tel:${selectedLieu.tel}`)}>
                    <Ionicons name="call-outline" size={15} color={colors.textMuted} />
                    <Text style={[styles.infoText, { color: colors.terra }]}>{selectedLieu.tel}</Text>
                  </TouchableOpacity>
                ) : null}

                {selectedLieu.horaires ? (
                  <View style={styles.infoRow}>
                    <Ionicons name="time-outline" size={15} color={colors.textMuted} />
                    <Text style={styles.infoText}>{selectedLieu.horaires}</Text>
                  </View>
                ) : null}

                {selectedLieu.site_web ? (
                  <TouchableOpacity style={styles.infoRow} onPress={() => Linking.openURL(selectedLieu.site_web!)}>
                    <Ionicons name="globe-outline" size={15} color={colors.textMuted} />
                    <Text style={[styles.infoText, { color: colors.terra }]} numberOfLines={1}>
                      {selectedLieu.site_web.replace(/^https?:\/\//, '')}
                    </Text>
                  </TouchableOpacity>
                ) : null}

                {selectedLieu.instagram_url ? (
                  <TouchableOpacity style={styles.infoRow} onPress={() => Linking.openURL(selectedLieu.instagram_url!)}>
                    <Ionicons name="logo-instagram" size={15} color={colors.textMuted} />
                    <Text style={[styles.infoText, { color: colors.terra }]} numberOfLines={1}>
                      {selectedLieu.instagram_url.replace(/^https?:\/\/(www\.)?instagram\.com\//, '@').replace(/\/$/, '')}
                    </Text>
                  </TouchableOpacity>
                ) : null}

                {selectedLieu.tiktok_url ? (
                  <TouchableOpacity style={styles.infoRow} onPress={() => Linking.openURL(selectedLieu.tiktok_url!)}>
                    <Ionicons name="logo-tiktok" size={15} color={colors.textMuted} />
                    <Text style={[styles.infoText, { color: colors.terra }]} numberOfLines={1}>
                      {selectedLieu.tiktok_url.replace(/^https?:\/\/(www\.)?tiktok\.com\//, '').replace(/\/$/, '')}
                    </Text>
                  </TouchableOpacity>
                ) : null}

                {/* Actions */}
                <View style={styles.actions}>
                  <TouchableOpacity
                    style={styles.actionPrimary}
                    onPress={() => {
                      const url = `maps://?daddr=${selectedLieu.lat},${selectedLieu.lng}`;
                      Linking.openURL(url).catch(() => Linking.openURL(`https://maps.google.com/?q=${selectedLieu.lat},${selectedLieu.lng}`));
                    }}
                  >
                    <Ionicons name="navigate" size={16} color={colors.ivory} />
                    <Text style={styles.actionPrimaryText}>Itinéraire</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionSecondary, myAvis && styles.actionSecondaryActive]}
                    onPress={() => { setAvisNote(myAvis?.note || 0); setAvisComment(myAvis?.commentaire || ''); setAvisModal(true); }}
                  >
                    <Ionicons name={myAvis ? 'star' : 'star-outline'} size={16} color={colors.ivory} />
                    <Text style={styles.actionSecondaryText}>
                      {myAvis ? 'Mon avis' : 'Avis'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.actionShare} onPress={shareLieuWhatsapp}>
                    <Ionicons name="logo-whatsapp" size={16} color="#25D366" />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.actionShare} onPress={shareLieu}>
                    <Ionicons name="share-outline" size={16} color={colors.bordeaux} />
                  </TouchableOpacity>
                </View>

                {/* Compléter la fiche */}
                <TouchableOpacity onPress={() => setEnrichModal(true)} style={{ alignItems: 'center', paddingVertical: 2 }}>
                  <Text style={styles.enrichLink}>Compléter la fiche ou signaler une erreur</Text>
                </TouchableOpacity>

                {/* Avis individuels */}
                {ficheAvis.length > 0 && (
                  <>
                    <Text style={styles.avisSectionTitle}>Avis de la communauté</Text>
                    {ficheAvis.map(a => (
                      <View key={a.id} style={styles.ficheAvisCard}>
                        <View style={styles.ficheAvisHeader}>
                          <View style={{ flex: 1, marginRight: 8 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                              <Text style={styles.ficheAvisAuthor}>{a.prenom}</Text>
                              {a.ambassadeur ? <AmbassadeurBadge /> : null}
                            </View>
                            {a.username ? <Text style={styles.ficheAvisUsername}>@{a.username}</Text> : null}
                          </View>
                          <View style={styles.ficheAvisStars}>
                            {[1,2,3,4,5].map(i => (
                              <Ionicons key={i} name={i <= a.note ? 'star' : 'star-outline'} size={11} color={colors.terra} />
                            ))}
                          </View>
                        </View>
                        {a.commentaire ? <Text style={styles.ficheAvisComment}>{a.commentaire}</Text> : null}
                        <Text style={styles.ficheAvisDate}>{new Date(a.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}</Text>
                        {a.reponse_pro ? (
                          <View style={styles.ficheAvisReponse}>
                            <Text style={styles.ficheAvisReponseLabel}>Réponse de l'établissement</Text>
                            <Text style={styles.ficheAvisReponseText}>{a.reponse_pro}</Text>
                          </View>
                        ) : null}
                      </View>
                    ))}
                  </>
                )}
              </>
            )}
          </ScrollView>
        </Animated.View>

        {enrichModal && (
          <View style={StyleSheet.absoluteFillObject}>
            <TouchableOpacity style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.5)' }]} onPress={() => setEnrichModal(false)} activeOpacity={1} />
            <View style={[styles.modalCard, { position: 'absolute', bottom: 0, left: 0, right: 0, maxHeight: SCREEN_H * 0.85, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }]}>
              <TouchableOpacity style={styles.modalCloseFixed} onPress={() => setEnrichModal(false)}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
              <Text style={[styles.modalTitle, { paddingRight: 36 }]}>Compléter ou corriger</Text>
              <Text style={styles.modalSubtitle} numberOfLines={1}>{selectedLieu?.nom}</Text>
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
                <View style={styles.proposeField}>
                  <Text style={styles.proposeLabel}>Type de contribution</Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {([['info_manquante', 'Infos manquantes'], ['erreur', 'Erreur à corriger']] as const).map(([v, l]) => (
                      <TouchableOpacity key={v} style={[styles.catPill, enrichType === v && { backgroundColor: colors.bordeaux, borderColor: colors.bordeaux }]} onPress={() => setEnrichType(v)}>
                        <Text style={[styles.catPillLabel, enrichType === v && styles.catPillLabelActive]}>{l}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
                <View style={styles.proposeField}>
                  <Text style={styles.proposeLabel}>Description du lieu</Text>
                  <TextInput style={[styles.proposeInput, { minHeight: 60, textAlignVertical: 'top' }]} value={enrichDesc} onChangeText={setEnrichDesc} placeholder="Ex : terrasse couverte, chiens admis en salle…" placeholderTextColor={colors.textMuted} multiline />
                </View>
                <View style={styles.proposeField}>
                  <Text style={styles.proposeLabel}>Téléphone</Text>
                  <TextInput style={styles.proposeInput} value={enrichTel} onChangeText={setEnrichTel} placeholder="01 23 45 67 89" placeholderTextColor={colors.textMuted} keyboardType="phone-pad" />
                </View>
                <View style={styles.proposeField}>
                  <Text style={styles.proposeLabel}>Site web</Text>
                  <TextInput style={styles.proposeInput} value={enrichSite} onChangeText={setEnrichSite} placeholder="https://…" placeholderTextColor={colors.textMuted} autoCapitalize="none" />
                </View>
                <View style={styles.proposeField}>
                  <Text style={styles.proposeLabel}>Horaires</Text>
                  <TextInput style={styles.proposeInput} value={enrichHoraires} onChangeText={setEnrichHoraires} placeholder="Ex : Lun-Ven 9h-18h, fermé dimanche" placeholderTextColor={colors.textMuted} />
                </View>
                <View style={styles.proposeField}>
                  <Text style={styles.proposeLabel}>Autre remarque</Text>
                  <TextInput style={[styles.proposeInput, { minHeight: 60, textAlignVertical: 'top' }]} value={enrichNote} onChangeText={setEnrichNote} placeholder="Toute info utile…" placeholderTextColor={colors.textMuted} multiline />
                </View>
                <TouchableOpacity style={[styles.avisSubmit, enrichLoading && styles.avisSubmitDisabled]} onPress={submitEnrich} disabled={enrichLoading}>
                  {enrichLoading ? <ActivityIndicator color={colors.ivory} /> : <Text style={styles.avisSubmitText}>Envoyer</Text>}
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        )}

        {avisModal && (
          <KeyboardAvoidingView style={StyleSheet.absoluteFillObject} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} onPress={() => setAvisModal(false)} activeOpacity={1} />
            <View style={[styles.modalCard, { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{myAvis ? 'Modifier mon avis' : 'Laisser un avis'}</Text>
                <TouchableOpacity onPress={() => setAvisModal(false)}>
                  <Ionicons name="close" size={22} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
              <Text style={styles.modalSubtitle} numberOfLines={1}>{selectedLieu?.nom}</Text>
              <View style={styles.starsRow}>
                {[1,2,3,4,5].map(i => (
                  <TouchableOpacity key={i} onPress={() => setAvisNote(i)}>
                    <Ionicons name={i <= avisNote ? 'star' : 'star-outline'} size={36} color={colors.terra} />
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput
                style={styles.avisInput}
                placeholder="Ton expérience avec ton chien… (optionnel)"
                placeholderTextColor={colors.textMuted}
                value={avisComment}
                onChangeText={setAvisComment}
                multiline numberOfLines={4} textAlignVertical="top"
              />
              <TouchableOpacity style={[styles.avisSubmit, (!avisNote || avisLoading) && styles.avisSubmitDisabled]} onPress={submitAvis} disabled={!avisNote || avisLoading}>
                {avisLoading ? <ActivityIndicator color={colors.ivory} /> : <Text style={styles.avisSubmitText}>Publier mon avis</Text>}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        )}

        {dogTagModal && (
          <KeyboardAvoidingView style={StyleSheet.absoluteFillObject} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} activeOpacity={1} onPress={() => doUploadPhoto(null)} />
            <View style={styles.dogTagCard}>
              <Text style={styles.dogTagModalTitle}>Ton chien est sur {pendingPhotoUris.length > 1 ? 'ces photos' : 'la photo'} ? 🐾</Text>
              <Text style={styles.dogTagModalSub}>Optionnel — laisse vide si ce n'est pas le cas</Text>
              <TextInput
                style={styles.dogTagInput}
                value={dogTagInput}
                onChangeText={setDogTagInput}
                placeholder="Nom du chien…"
                placeholderTextColor={colors.textMuted}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={() => doUploadPhoto(dogTagInput.trim() || null)}
              />
              <TouchableOpacity style={styles.dogTagSubmit} onPress={() => doUploadPhoto(dogTagInput.trim() || null)}>
                <Text style={styles.dogTagSubmitText}>Publier la photo</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => doUploadPhoto(null)} style={{ alignItems: 'center', paddingVertical: 8 }}>
                <Text style={styles.dogTagSkip}>Passer</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        )}

      </Modal>
    );
  }

  const totalSearchResults = cityResults.length + searchResults.length;

  return (
    <>
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={region}
        onRegionChangeComplete={r => {
          setRegion(r);
          if (regionTimer.current) clearTimeout(regionTimer.current);
          regionTimer.current = setTimeout(() => {
            if (skipNextFetchRef.current) { skipNextFetchRef.current = false; return; }
            if (!favFilter) fetchLieux(r, activeCat);
            if (showBalades) fetchBalades(r);
          }, 600);
        }}
        onLongPress={handleMapLongPress}
        onPress={(e) => {
          if (pickingBaladeDepart) {
            const { latitude, longitude } = e.nativeEvent.coordinate;
            setBaladeDepartLat(latitude);
            setBaladeDepartLng(longitude);
            setPickingBaladeDepart(false);
            setBaladeFormVisible(true);
          } else if (pickingBaladeArrivee) {
            const { latitude, longitude } = e.nativeEvent.coordinate;
            setBaladeFinalArriveeCoords({ lat: latitude, lng: longitude });
            setPickingBaladeArrivee(false);
            setBaladeFormVisible(true);
          }
        }}
        showsUserLocation
        showsMyLocationButton={false}
      >
        {!showEvents && clusters.map((cluster: any) => {
          const [lng, lat] = cluster.geometry.coordinates;
          const { cluster: isCluster, cluster_id, point_count, lieu } = cluster.properties;

          if (isCluster) {
            const size = point_count >= 10 ? 48 : 40;
            return (
              <Marker
                key={`c-${cluster_id}`}
                coordinate={{ latitude: lat, longitude: lng }}
                tracksViewChanges={false}
                anchor={{ x: 0.5, y: 0.5 }}
                onPress={() => {
                  const leaves = clusterIndex.getLeaves(cluster_id, Infinity);
                  const lats = leaves.map((f: any) => f.geometry.coordinates[1]).filter((v: number) => v && !isNaN(v));
                  const lngs = leaves.map((f: any) => f.geometry.coordinates[0]).filter((v: number) => v && !isNaN(v));
                  if (!lats.length || !lngs.length) return;
                  const minLat = lats.reduce((a: number, b: number) => Math.min(a, b), lats[0]);
                  const maxLat = lats.reduce((a: number, b: number) => Math.max(a, b), lats[0]);
                  const minLng = lngs.reduce((a: number, b: number) => Math.min(a, b), lngs[0]);
                  const maxLng = lngs.reduce((a: number, b: number) => Math.max(a, b), lngs[0]);
                  mapRef.current?.animateToRegion({
                    latitude: (minLat + maxLat) / 2,
                    longitude: (minLng + maxLng) / 2,
                    latitudeDelta: (maxLat - minLat) * 1.5 + 0.01,
                    longitudeDelta: (maxLng - minLng) * 1.5 + 0.01,
                  }, 400);
                }}
              >
                <View style={[styles.clusterBubble, { width: size, height: size, borderRadius: size / 2 }]}>
                  <View style={styles.markerShine} />
                  <Text style={styles.clusterText}>{point_count}</Text>
                </View>
              </Marker>
            );
          }

          const l: Lieu = lieu;
          const cfg = CAT_CONFIG[l.cat] || CAT_CONFIG.autre;
          const isSelected = selectedLieu?.id === l.id;
          const size = isSelected ? 44 : 34;
          const iconSize = isSelected ? 22 : 16;
          return (
            <Marker key={l.id} coordinate={{ latitude: l.lat, longitude: l.lng }} onPress={() => openFiche(l)} tracksViewChanges={isSelected || prevSelectedId === l.id} anchor={{ x: 0.5, y: 1 }}>
              <View style={styles.markerPin}>
                <View style={[styles.markerBubble, { width: size, height: size, borderRadius: size / 2, backgroundColor: cfg.color }, isSelected && styles.markerBubbleSelected]}>
                  <View style={styles.markerShine} />
                  <CatIcon cat={l.cat} name={cfg.markerIcon} size={iconSize} color="#fff" />
                </View>
                <View style={[styles.markerTail, { borderTopColor: cfg.color }, isSelected && { borderTopWidth: 9, borderLeftWidth: 6, borderRightWidth: 6 }]} />
              </View>
            </Marker>
          );
        })}
        {showEvents && mapEvents.map(e => (
          <Marker
            key={`ev-${e.id}`}
            coordinate={{ latitude: e.lat, longitude: e.lng }}
            tracksViewChanges={selectedMapEvent?.id === e.id}
            anchor={{ x: 0.5, y: 1 }}
            onPress={() => setSelectedMapEvent(e)}
          >
            <View style={styles.eventPin}>
              <View style={[styles.eventBubble, selectedMapEvent?.id === e.id && styles.eventBubbleSelected]}>
                <Ionicons name="calendar" size={14} color="#fff" />
              </View>
              <View style={styles.eventTail} />
            </View>
          </Marker>
        ))}
        {showBalades && !showEvents && balades.map(b => (
          <Marker
            key={`bal-${b.id}`}
            coordinate={{ latitude: b.depart_lat, longitude: b.depart_lng }}
            tracksViewChanges={selectedBalade?.id === b.id}
            anchor={{ x: 0.5, y: 1 }}
            onPress={() => { setFabOpen(false); setSelectedBalade(b); }}
          >
            <View style={styles.baladePin}>
              <View style={[styles.baladeBubble, selectedBalade?.id === b.id && styles.baladeBubbleSelected]}>
                <Ionicons name="walk-outline" size={16} color="#fff" />
              </View>
              <View style={[styles.baladeTail, selectedBalade?.id === b.id && { borderTopColor: '#2E7D6B' }]} />
            </View>
          </Marker>
        ))}
        {baladeDepartLat !== null && baladeDepartLng !== null && (
          <Marker
            coordinate={{ latitude: baladeDepartLat, longitude: baladeDepartLng }}
            tracksViewChanges={false}
            anchor={{ x: 0.5, y: 1 }}
          >
            <View style={styles.baladePin}>
              <View style={[styles.baladeBubble, { backgroundColor: colors.terra }]}>
                <Ionicons name="flag-outline" size={16} color="#fff" />
              </View>
              <View style={[styles.baladeTail, { borderTopColor: colors.terra }]} />
            </View>
          </Marker>
        )}
        {baladeFinalArriveeCoords !== null && (
          <Marker
            coordinate={{ latitude: baladeFinalArriveeCoords.lat, longitude: baladeFinalArriveeCoords.lng }}
            tracksViewChanges={false}
            anchor={{ x: 0.5, y: 1 }}
          >
            <View style={styles.baladePin}>
              <View style={[styles.baladeBubble, { backgroundColor: colors.sage }]}>
                <Ionicons name="flag" size={16} color="#fff" />
              </View>
              <View style={[styles.baladeTail, { borderTopColor: colors.sage }]} />
            </View>
          </Marker>
        )}
        {selectedBalade?.arrivee_lat != null && selectedBalade?.arrivee_lng != null && (
          <Polyline
            coordinates={[
              { latitude: selectedBalade.depart_lat, longitude: selectedBalade.depart_lng },
              { latitude: selectedBalade.arrivee_lat, longitude: selectedBalade.arrivee_lng },
            ]}
            strokeColor={colors.sage}
            strokeWidth={3}
            lineDashPattern={[10, 6]}
            lineCap="round"
            lineJoin="round"
          />
        )}
      </MapView>

      {/* List view */}
      {listView && (
        <View style={[styles.listViewContainer, { paddingTop: 104 }]}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>

            {(!filterActive && !searchQuery.trim()) && (
              <>
                {featuredDiscoverLieu && (
                  <View style={dstyles.section}>
                    <Text style={dstyles.sectionTitle}>À découvrir</Text>
                    <FeaturedDiscoverCard lieu={featuredDiscoverLieu} onPress={() => openDiscoverLieu(featuredDiscoverLieu.id)} />
                  </View>
                )}

                {nearbyDiscoverLieux.length > 0 && (
                  <View style={dstyles.section}>
                    <Text style={dstyles.sectionTitle}>{myDogName ? `Près de ${myDogName}` : 'Près de toi'}</Text>
                    <FlatList
                      data={nearbyDiscoverLieux} horizontal showsHorizontalScrollIndicator={false}
                      keyExtractor={i => i.id} contentContainerStyle={dstyles.cardsRow}
                      renderItem={({ item }) => <DiscoverCard lieu={item} onPress={() => openDiscoverLieu(item.id)} />}
                    />
                  </View>
                )}

                {recommendedLieux.length > 0 && (
                  <View style={dstyles.section}>
                    <Text style={dstyles.sectionTitle}>Recommandé pour toi</Text>
                    <FlatList
                      data={recommendedLieux} horizontal showsHorizontalScrollIndicator={false}
                      keyExtractor={i => i.id} contentContainerStyle={dstyles.cardsRow}
                      renderItem={({ item }) => <DiscoverCard lieu={item} onPress={() => openDiscoverLieu(item.id)} />}
                    />
                  </View>
                )}

                {friendPickLieux.length > 0 && (
                  <View style={dstyles.section}>
                    <Text style={dstyles.sectionTitle}>Les coups de cœur de tes amis</Text>
                    <FlatList
                      data={friendPickLieux} horizontal showsHorizontalScrollIndicator={false}
                      keyExtractor={i => i.id} contentContainerStyle={dstyles.cardsRow}
                      renderItem={({ item }) => <DiscoverCard lieu={item} onPress={() => openDiscoverLieu(item.id)} />}
                    />
                  </View>
                )}

                {recentDiscoverLieux.length > 0 && (
                  <View style={dstyles.section}>
                    <Text style={dstyles.sectionTitle}>Récemment ajoutés</Text>
                    <FlatList
                      data={recentDiscoverLieux} horizontal showsHorizontalScrollIndicator={false}
                      keyExtractor={i => i.id} contentContainerStyle={dstyles.cardsRow}
                      renderItem={({ item }) => <DiscoverCard lieu={item} onPress={() => openDiscoverLieu(item.id)} />}
                    />
                  </View>
                )}

                {discoverPhotos.length > 0 && (
                  <View style={dstyles.section}>
                    <Text style={dstyles.sectionTitle}>Photos de la communauté</Text>
                    <FlatList
                      data={discoverPhotos} horizontal showsHorizontalScrollIndicator={false}
                      keyExtractor={p => p.id} contentContainerStyle={dstyles.cardsRow}
                      renderItem={({ item }) => (
                        <PhotoDiscoverCard
                          photo={item}
                          liked={discoverPhotoLikedByMe.has(item.id)}
                          likeCount={discoverPhotoLikes[item.id] || 0}
                          onPress={() => openDiscoverLieu(item.lieuId)}
                          onLike={() => toggleDiscoverPhotoLike(item.id)}
                        />
                      )}
                    />
                  </View>
                )}

                {topDiscoverLieux.length > 0 && (
                  <View style={dstyles.section}>
                    <Text style={dstyles.sectionTitle}>Les mieux notés</Text>
                    <FlatList
                      data={topDiscoverLieux} horizontal showsHorizontalScrollIndicator={false}
                      keyExtractor={i => i.id} contentContainerStyle={dstyles.cardsRow}
                      renderItem={({ item }) => <DiscoverCard lieu={item} onPress={() => openDiscoverLieu(item.id)} />}
                    />
                  </View>
                )}

                {discoverLoading && !discoverLoaded && (
                  <ActivityIndicator color={colors.terra} style={{ marginTop: 20, marginBottom: 8 }} />
                )}

                <View style={dstyles.divider} />
              </>
            )}

            {/* Sort + count bar */}
            <View style={styles.sortBar}>
              {SORT_OPTS.map(s => (
                <TouchableOpacity
                  key={s.key}
                  style={[styles.sortPill, sortBy === s.key && styles.sortPillActive]}
                  onPress={() => setSortBy(s.key)}
                >
                  <Ionicons name={s.icon} size={12} color={sortBy === s.key ? '#fff' : colors.bordeaux} />
                  <Text style={[styles.sortPillLabel, sortBy === s.key && styles.sortPillLabelActive]}>{s.label}</Text>
                </TouchableOpacity>
              ))}
              <Text style={styles.listCount}>{filteredLieux.length} lieu{filteredLieux.length !== 1 ? 'x' : ''}</Text>
            </View>

            {loading ? (
              <ActivityIndicator color={colors.terra} style={{ marginTop: 48 }} />
            ) : lieux.length === 0 ? (
              <View style={styles.listEmpty}>
                <Ionicons name="location-outline" size={44} color={colors.border} />
                <Text style={styles.listEmptyText}>Aucun lieu dans cette zone</Text>
                <Text style={[styles.listEmptyText, { fontSize: 12, marginTop: -4 }]}>Déplace la carte vers une ville pour voir les lieux</Text>
              </View>
            ) : (
              <View style={{ paddingTop: 8 }}>
                {sortLieux(filteredLieux).map((item) => {
                  const cfg = CAT_CONFIG[item.cat] || CAT_CONFIG.autre;
                  const dist = (userLat !== null && userLng !== null)
                    ? haversine(userLat, userLng, item.lat, item.lng)
                    : null;
                  const photo = listPhotoMap[item.id] || item.google_photo_url;
                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={styles.listCard}
                      onPress={() => { setListView(false); openFiche(item); }}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.listCardAccent, { backgroundColor: cfg.color }]} />
                      {photo ? (
                        <Image source={{ uri: photo }} style={styles.listCardPhoto} resizeMode="cover" />
                      ) : (
                        <View style={[styles.listCardPhoto, { backgroundColor: cfg.color + '18', alignItems: 'center', justifyContent: 'center' }]}>
                          <Ionicons name={cfg.icon} size={20} color={cfg.color + '99'} />
                        </View>
                      )}
                      <View style={styles.listCardBody}>
                        <Text style={styles.listCardNom} numberOfLines={1}>{item.nom}</Text>
                        <View style={styles.listCardCatRow}>
                          <Text style={[styles.listCardCat, { color: cfg.color }]}>{cfg.label}</Text>
                          {item.ville ? <Text style={styles.listCardAddr}> · {item.ville}</Text> : null}
                        </View>
                        <View style={styles.listCardMeta}>
                          {item.note_moyenne ? (
                            <>
                              <Ionicons name="star" size={11} color={colors.terra} />
                              <Text style={styles.listCardNote}>{item.note_moyenne.toFixed(1)}</Text>
                              <Text style={styles.listCardMetaText}>({item.nb_avis})</Text>
                            </>
                          ) : (
                            <Text style={styles.listCardMetaText}>Pas encore d'avis</Text>
                          )}
                        </View>
                      </View>
                      {dist !== null && (
                        <View style={styles.listCardDistBadge}>
                          <Text style={styles.listCardDistText}>
                            {dist < 1 ? `${Math.round(dist * 1000)} m` : `${dist.toFixed(1)} km`}
                          </Text>
                        </View>
                      )}
                      <Ionicons name="chevron-forward" size={14} color={colors.textMuted} style={{ marginRight: 12 }} />
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </ScrollView>
        </View>
      )}

      {/* Search + filters overlay */}
      <View style={styles.topOverlay} pointerEvents="box-none">

        {/* Carte / Liste toggle */}
        <View style={styles.carteListeRow} pointerEvents="auto">
          <View style={styles.carteListeToggle}>
            <TouchableOpacity
              style={[styles.carteListeOption, !listView && styles.carteListeOptionActive]}
              onPress={() => setListView(false)}
              activeOpacity={0.85}
            >
              <Ionicons name="map-outline" size={13} color={!listView ? '#fff' : colors.bordeaux} />
              <Text style={[styles.carteListeLabel, !listView && styles.carteListeLabelActive]}>Carte</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.carteListeOption, listView && styles.carteListeOptionActive]}
              onPress={() => setListView(true)}
              activeOpacity={0.85}
            >
              <Ionicons name="list-outline" size={13} color={listView ? '#fff' : colors.bordeaux} />
              <Text style={[styles.carteListeLabel, listView && styles.carteListeLabelActive]}>Liste</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.searchContainer} pointerEvents="auto">
          <Ionicons name="search" size={16} color={colors.textMuted} style={{ marginLeft: 12 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Lieu, ville, quartier…"
            placeholderTextColor={colors.textMuted}
            value={searchQuery}
            onChangeText={onSearchChange}
            onFocus={() => { if (selectedLieu) closeFiche(); if (searchResults.length > 0 || cityResults.length > 0) setShowResults(true); }}
            returnKeyType="search"
          />
          {searchQuery.length > 0
            ? <TouchableOpacity onPress={() => { setSearchQuery(''); setSearchResults([]); setCityResults([]); setShowResults(false); }}>
                <Ionicons name="close-circle" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            : null
          }
          <View style={styles.searchDivider} />
          <TouchableOpacity style={styles.listToggleBtn} onPress={() => openFilterModal()}>
            <View>
              <Ionicons name="options-outline" size={18} color={filterActive ? colors.terra : colors.bordeaux} />
              {filterActive && <View style={styles.filterActiveDot} />}
            </View>
          </TouchableOpacity>
        </View>

        {!listView && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filtersContent} pointerEvents="auto">
          {MAIN_CATS.map(c => {
            const active = activeCat === c.key && !favFilter;
            const catCfg = c.key ? CAT_CONFIG[c.key] : null;
            return (
              <TouchableOpacity
                key={String(c.key)}
                style={[styles.filterPill, active && styles.filterPillActive, active && (catCfg ? { backgroundColor: catCfg.color, borderColor: catCfg.color } : { backgroundColor: colors.bordeaux, borderColor: colors.bordeaux })]}
                onPress={() => onCatPress(c.key)}
              >
                <CatIcon cat={c.key} name={c.icon} size={13} color={active ? '#fff' : (catCfg?.color || colors.bordeaux)} />
                <Text style={[styles.filterLabel, active && styles.filterLabelActive]}>{c.label}</Text>
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity
            style={[styles.filterPill, (autresOpen || AUTRES_CATS.some(c => c.key === activeCat && !favFilter)) && { backgroundColor: colors.bordeaux, borderColor: colors.bordeaux }]}
            onPress={() => setAutresOpen(v => !v)}
          >
            <Text style={[styles.filterLabel, (autresOpen || AUTRES_CATS.some(c => c.key === activeCat && !favFilter)) && styles.filterLabelActive]}>
              {AUTRES_CATS.find(c => c.key === activeCat && !favFilter)?.label || 'Autres'}
            </Text>
            <Ionicons name={autresOpen ? 'chevron-up' : 'chevron-down'} size={11} color={autresOpen || AUTRES_CATS.some(c => c.key === activeCat && !favFilter) ? '#fff' : colors.bordeaux} />
          </TouchableOpacity>
          <View style={styles.filterSep} />
          {FAV_FILTER_OPTS.map(f => {
            const active = favFilter === f.key;
            return (
              <TouchableOpacity
                key={f.key}
                style={[styles.filterPill, active && { backgroundColor: f.color, borderColor: f.color }]}
                onPress={() => onFavFilterPress(f.key)}
              >
                <Ionicons name={f.icon} size={13} color={active ? '#fff' : f.color} />
                <Text style={[styles.filterLabel, active && styles.filterLabelActive]}>{f.label}</Text>
              </TouchableOpacity>
            );
          })}
          <View style={styles.filterSep} />
          <TouchableOpacity
            style={[styles.filterPill, showEvents && { backgroundColor: '#4A7FA5', borderColor: '#4A7FA5' }]}
            onPress={() => setShowEvents(v => !v)}
          >
            <Ionicons name="calendar-outline" size={13} color={showEvents ? '#fff' : '#4A7FA5'} />
            <Text style={[styles.filterLabel, showEvents && styles.filterLabelActive]}>Événements</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterPill, showBalades && { backgroundColor: colors.sage, borderColor: colors.sage }]}
            onPress={() => setShowBalades(v => !v)}
          >
            <Ionicons name="walk-outline" size={13} color={showBalades ? '#fff' : colors.sage} />
            <Text style={[styles.filterLabel, showBalades && styles.filterLabelActive]}>Balades</Text>
          </TouchableOpacity>
        </ScrollView>}

        {!listView && autresOpen && (
          <View style={styles.autresDropdown} pointerEvents="auto">
            {AUTRES_CATS.map((c, idx) => {
              const key = c.key as string;
              const catCfg = CAT_CONFIG[key];
              const active = activeCat === key && !favFilter;
              return (
                <TouchableOpacity
                  key={key}
                  style={[styles.autresItem, idx < AUTRES_CATS.length - 1 && styles.autresItemBorder, active && { backgroundColor: catCfg.color + '12' }]}
                  onPress={() => onAutresCatPress(key)}
                >
                  <CatIcon cat={key} name={c.icon} size={16} color={active ? catCfg.color : colors.textMuted} />
                  <Text style={[styles.autresItemText, active && { color: catCfg.color, fontFamily: 'DMSans_500Medium' }]}>{c.label}</Text>
                  {active && <Ionicons name="checkmark" size={14} color={catCfg.color} />}
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {showResults && totalSearchResults > 0 && (
          <View style={styles.resultsDropdown} pointerEvents="auto">
            {cityResults.map((city, idx) => (
              <TouchableOpacity
                key={'city-' + city.nom}
                style={[styles.resultItem, (idx < cityResults.length - 1 || searchResults.length > 0) && styles.resultItemBorder]}
                onPress={() => onSelectCity(city)}
              >
                <View style={[styles.resultIconWrap, { backgroundColor: '#546E7A22' }]}>
                  <Ionicons name="map-outline" size={16} color="#546E7A" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.resultNom}>{city.nom}</Text>
                  <Text style={styles.resultVille}>Voir sur la carte</Text>
                </View>
                <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
              </TouchableOpacity>
            ))}
            {searchResults.map((r, idx) => {
              const rCfg = CAT_CONFIG[r.cat] || CAT_CONFIG.autre;
              return (
                <TouchableOpacity
                  key={r.id}
                  style={[styles.resultItem, idx < searchResults.length - 1 && styles.resultItemBorder]}
                  onPress={() => onSelectLieu(r)}
                >
                  <View style={[styles.resultIconWrap, { backgroundColor: rCfg.color + '22' }]}>
                    <Ionicons name={rCfg.icon} size={16} color={rCfg.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.resultNom} numberOfLines={1}>{r.nom}</Text>
                    <Text style={styles.resultVille}>{r.ville}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
                </TouchableOpacity>
              );
            })}
          </View>
        )}

      </View>

      {loading && (
        <View style={styles.loadingBadge}>
          <ActivityIndicator size="small" color={colors.terra} />
        </View>
      )}

      <TouchableOpacity style={styles.locBtn} onPress={async () => {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const loc = await Location.getCurrentPositionAsync({});
        const r: Region = { latitude: loc.coords.latitude, longitude: loc.coords.longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 };
        mapRef.current?.animateToRegion(r, 600);
      }}>
        <Ionicons name="locate" size={22} color={colors.bordeaux} />
      </TouchableOpacity>

      {pickingBaladeDepart && (
        <View style={styles.pickModeBanner}>
          <Ionicons name="location-outline" size={16} color={colors.ivory} />
          <Text style={styles.pickModeBannerText}>Tape sur la carte pour le départ</Text>
          <TouchableOpacity onPress={() => { setPickingBaladeDepart(false); setBaladeDepartLat(null); setBaladeDepartLng(null); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={18} color={colors.ivory} />
          </TouchableOpacity>
        </View>
      )}

      {pickingBaladeArrivee && (
        <View style={[styles.pickModeBanner, { backgroundColor: colors.sage }]}>
          <Ionicons name="flag-outline" size={16} color={colors.ivory} />
          <Text style={styles.pickModeBannerText}>Tape sur la carte pour l'arrivée</Text>
          <TouchableOpacity onPress={() => { setPickingBaladeArrivee(false); setBaladeFormVisible(true); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={18} color={colors.ivory} />
          </TouchableOpacity>
        </View>
      )}

      {fabOpen && (
        <View style={styles.fabMenu}>
          <TouchableOpacity style={styles.fabMenuItem} onPress={() => { setFabOpen(false); requireAuth(() => setProposeModal(true)); }}>
            <Text style={styles.fabMenuLabel}>Suggérer un lieu</Text>
            <View style={[styles.fabMenuIcon, { backgroundColor: colors.bordeaux }]}>
              <Ionicons name="location-outline" size={18} color="#fff" />
            </View>
          </TouchableOpacity>
          <TouchableOpacity style={styles.fabMenuItem} onPress={() => { setFabOpen(false); requireAuth(() => setPickingBaladeDepart(true)); }}>
            <Text style={styles.fabMenuLabel}>Proposer une balade</Text>
            <View style={[styles.fabMenuIcon, { backgroundColor: '#2E7D6B' }]}>
              <Ionicons name="walk-outline" size={18} color="#fff" />
            </View>
          </TouchableOpacity>
        </View>
      )}

      <TouchableOpacity style={styles.proposeBtn} onPress={() => requireAuth(() => setFabOpen(v => !v))}>
        <Ionicons name={fabOpen ? 'close' : 'add'} size={24} color={colors.ivory} />
      </TouchableOpacity>

      {showPointsAnim && (
        <Animated.View
          style={[styles.pointsPopup, { opacity: pointsAnimOp, transform: [{ translateY: pointsAnimY }] }]}
          pointerEvents="none"
        >
          <Text style={styles.pointsPopupText}>+50 pts 🐾</Text>
        </Animated.View>
      )}

      {renderSheet()}
      {renderFilterModal()}

      {/* Lightbox photo */}
      <Modal visible={lightboxIdx !== null} transparent animationType="fade">
        <View style={styles.lightboxOverlay}>
          {lightboxIdx !== null && (
            <FlatList
              data={photos}
              horizontal
              pagingEnabled
              initialScrollIndex={lightboxIdx}
              getItemLayout={(_, index) => ({ length: SCREEN_W, offset: SCREEN_W * index, index })}
              keyExtractor={p => p.id}
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={e => {
                const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
                setLightboxIdx(Math.max(0, Math.min(idx, photos.length - 1)));
              }}
              renderItem={({ item }) => (
                <TouchableOpacity activeOpacity={1} onPress={() => setLightboxIdx(null)} style={{ width: SCREEN_W, alignItems: 'center', justifyContent: 'center' }}>
                  <Image source={{ uri: item.url }} style={styles.lightboxImg} resizeMode="contain" />
                </TouchableOpacity>
              )}
            />
          )}
          <TouchableOpacity style={styles.lightboxClose} onPress={() => setLightboxIdx(null)}>
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          {photos.length > 1 && lightboxIdx !== null && (
            <View style={styles.lightboxCounter}>
              <Text style={styles.lightboxCounterText}>{lightboxIdx + 1}/{photos.length}</Text>
            </View>
          )}
        </View>
      </Modal>

      {/* Modal proposer un lieu */}
      <Modal visible={proposeModal} transparent animationType="slide">
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[styles.modalCard, { maxHeight: SCREEN_H * 0.85 }]}>
            <TouchableOpacity style={styles.modalCloseFixed} onPress={() => { setProposeModal(false); setProposeSuggestions([]); }}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { paddingRight: 36 }]}>Proposer un lieu</Text>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
              <Text style={styles.modalSubtitle}>Ton lieu sera vérifié avant publication.</Text>
              <View style={styles.proposeField}>
                <Text style={styles.proposeLabel}>Nom *</Text>
                <TextInput
                  style={styles.proposeInput}
                  value={proposeNom}
                  onChangeText={text => {
                    setProposeNom(text);
                    if (proposeSuggestTimer.current) clearTimeout(proposeSuggestTimer.current);
                    proposeSuggestTimer.current = setTimeout(() => searchProposeSuggestions(text), 400);
                  }}
                  placeholder="Ex : Le Café des Chiens"
                  placeholderTextColor={colors.textMuted}
                  autoCorrect={false}
                />
                {proposeSuggestions.length > 0 && (
                  <View style={styles.proposeSuggestList}>
                    {proposeSuggestions.map((s, i) => (
                      <TouchableOpacity
                        key={i}
                        style={[styles.proposeSuggestItem, i < proposeSuggestions.length - 1 && styles.proposeSuggestItemBorder]}
                        onPress={() => {
                          setProposeNom(s.name);
                          if (s.adresse) setProposeAdresse(s.adresse);
                          if (s.ville) setProposeVille(s.ville);
                          if (s.lat && s.lng) { setProposeLat(s.lat); setProposeLng(s.lng); }
                          setProposeSuggestions([]);
                        }}
                      >
                        <Ionicons name="location-outline" size={14} color={colors.terra} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.proposeSuggestName} numberOfLines={1}>{s.name}</Text>
                          {s.displayAddr ? (
                            <Text style={styles.proposeSuggestAddr} numberOfLines={1}>{s.displayAddr}</Text>
                          ) : null}
                        </View>
                        <Ionicons name="chevron-forward" size={13} color={colors.textMuted} />
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
              <View style={styles.proposeField}>
                <Text style={styles.proposeLabel}>Type(s) de lieu * <Text style={{ color: colors.textMuted, fontWeight: '400' }}>(plusieurs possibles)</Text></Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {PROPOSE_CATS.map(key => {
                    const catCfg = CAT_CONFIG[key];
                    if (!catCfg) return null;
                    const active = proposeCats.includes(key);
                    return (
                      <TouchableOpacity
                        key={key}
                        style={[styles.catPill, active && { backgroundColor: catCfg.color, borderColor: catCfg.color }]}
                        onPress={() => setProposeCats(prev => {
                          if (prev.includes(key)) {
                            const next = prev.filter(k => k !== key);
                            return next.length ? next : prev;
                          }
                          return [...prev, key];
                        })}
                      >
                        <CatIcon cat={key} name={catCfg.icon} size={13} color={active ? '#fff' : catCfg.color} />
                        <Text style={[styles.catPillLabel, active && styles.catPillLabelActive]}>{catCfg.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {proposeCats.includes('autre') && (
                  <TextInput
                    style={[styles.proposeInput, { marginTop: 8 }]}
                    value={proposeAutreLabel}
                    onChangeText={setProposeAutreLabel}
                    placeholder="Précise le type de lieu…"
                    placeholderTextColor={colors.textMuted}
                  />
                )}
              </View>
              <View style={styles.proposeField}>
                <Text style={styles.proposeLabel}>Ville *</Text>
                <TextInput style={styles.proposeInput} value={proposeVille} onChangeText={v => { setProposeVille(v); setProposeLat(null); setProposeLng(null); }} placeholder="Ex : Paris" placeholderTextColor={colors.textMuted} />
              </View>
              <View style={styles.proposeField}>
                <Text style={styles.proposeLabel}>Adresse</Text>
                <TextInput style={styles.proposeInput} value={proposeAdresse} onChangeText={v => { setProposeAdresse(v); setProposeLat(null); setProposeLng(null); }} placeholder="Ex : 12 rue de la Paix" placeholderTextColor={colors.textMuted} />
              </View>

              {/* Géolocalisation */}
              <View style={styles.proposeField}>
                <Text style={styles.proposeLabel}>Localisation exacte</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity style={[styles.geoBtn, { flex: 1 }]} onPress={useMyLocation} disabled={proposeGeoLoading}>
                    <Ionicons name="locate" size={14} color={colors.bordeaux} />
                    <Text style={styles.geoBtnText}>Ma position</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.geoBtn, { flex: 1 }, (!proposeAdresse && !proposeVille) && { opacity: 0.4 }]} onPress={geocodeAdresse} disabled={proposeGeoLoading || (!proposeAdresse && !proposeVille)}>
                    <Ionicons name="search" size={14} color={colors.bordeaux} />
                    <Text style={styles.geoBtnText}>Chercher l'adresse</Text>
                  </TouchableOpacity>
                </View>
                {proposeGeoLoading && <ActivityIndicator size="small" color={colors.terra} style={{ marginTop: 6 }} />}
                {proposeLat && proposeLng ? (
                  <>
                    <View style={styles.proposeMiniMapWrap}>
                      <MapView
                        style={styles.proposeMiniMap}
                        region={{ latitude: proposeLat, longitude: proposeLng, latitudeDelta: 0.006, longitudeDelta: 0.006 }}
                        onPress={e => {
                          const { latitude, longitude } = e.nativeEvent.coordinate;
                          setProposeLat(latitude); setProposeLng(longitude);
                        }}
                      >
                        <Marker
                          coordinate={{ latitude: proposeLat, longitude: proposeLng }}
                          draggable
                          onDragEnd={e => {
                            const { latitude, longitude } = e.nativeEvent.coordinate;
                            setProposeLat(latitude); setProposeLng(longitude);
                          }}
                        />
                      </MapView>
                    </View>
                    <Text style={styles.geoHint}>Déplace le repère (ou touche la carte) pour ajuster l'emplacement exact — c'est la première cause d'imprécision, prends 2 secondes pour bien le placer.</Text>
                  </>
                ) : (
                  <Text style={styles.geoHint}>Utilise ta position GPS ou cherche l'adresse pour faire apparaître la carte et placer le repère précisément.</Text>
                )}
              </View>
              <View style={styles.proposeField}>
                <Text style={styles.proposeLabel}>Téléphone</Text>
                <TextInput style={styles.proposeInput} value={proposeTel} onChangeText={setProposeTel} placeholder="Ex : 01 23 45 67 89" placeholderTextColor={colors.textMuted} keyboardType="phone-pad" />
              </View>
              <View style={styles.proposeField}>
                <Text style={styles.proposeLabel}>Site web</Text>
                <TextInput style={styles.proposeInput} value={proposeSite} onChangeText={setProposeSite} placeholder="https://…" placeholderTextColor={colors.textMuted} autoCapitalize="none" />
              </View>
              <View style={styles.proposeField}>
                <Text style={styles.proposeLabel}>Description</Text>
                <TextInput style={[styles.proposeInput, { minHeight: 80, textAlignVertical: 'top' }]} value={proposeDesc} onChangeText={setProposeDesc} placeholder="Pourquoi ce lieu est dog-friendly…" placeholderTextColor={colors.textMuted} multiline />
              </View>

              {/* Équipements & accueil chiens */}
              <View style={styles.proposeField}>
                <Text style={styles.proposeLabel}>Accueil & équipements</Text>
                <View style={styles.checkGrid}>
                  {([
                    ['chiens_salle',    'En salle',         'home-outline'],
                    ['chiens_terrasse', 'En terrasse',      'sunny-outline'],
                    ['espace_dedie',    'Espace dédié',     'heart-outline'],
                    ['eau',             'Eau fournie',      'water-outline'],
                    ['gamelles',        'Gamelles',         'restaurant-outline'],
                  ] as [keyof typeof proposeAmenities, string, IoniconsName][]).map(([key, label, icon]) => (
                    <TouchableOpacity
                      key={key}
                      style={[styles.checkRow, proposeAmenities[key] && styles.checkRowActive]}
                      onPress={() => setProposeAmenities(p => ({ ...p, [key]: !p[key] }))}
                    >
                      <Ionicons
                        name={proposeAmenities[key] ? 'checkbox' : 'square-outline'}
                        size={18}
                        color={proposeAmenities[key] ? colors.terra : colors.textMuted}
                      />
                      <Ionicons name={icon} size={13} color={proposeAmenities[key] ? colors.terra : colors.textMuted} />
                      <Text style={[styles.checkLabel, proposeAmenities[key] && styles.checkLabelActive]}>{label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.proposeField}>
                <Text style={styles.proposeLabel}>Règles</Text>
                <View style={styles.checkGrid}>
                  {([
                    ['chiens_laches',  'Lâchés autorisés',   'checkmark-circle-outline'],
                    ['chiens_laisse',  'Laisse obligatoire', 'alert-circle-outline'],
                  ] as [keyof typeof proposeAmenities, string, IoniconsName][]).map(([key, label, icon]) => (
                    <TouchableOpacity
                      key={key}
                      style={[styles.checkRow, proposeAmenities[key] && styles.checkRowActive]}
                      onPress={() => setProposeAmenities(p => ({ ...p, [key]: !p[key] }))}
                    >
                      <Ionicons
                        name={proposeAmenities[key] ? 'checkbox' : 'square-outline'}
                        size={18}
                        color={proposeAmenities[key] ? colors.terra : colors.textMuted}
                      />
                      <Ionicons name={icon} size={13} color={proposeAmenities[key] ? colors.terra : colors.textMuted} />
                      <Text style={[styles.checkLabel, proposeAmenities[key] && styles.checkLabelActive]}>{label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.proposeField}>
                <Text style={styles.proposeLabel}>Taille des chiens acceptés</Text>
                <View style={styles.checkGrid}>
                  {([
                    ['petits_chiens', 'Petits chiens',  'paw-outline'],
                    ['moyens_chiens', 'Moyens chiens',  'paw-outline'],
                    ['grands_chiens', 'Grands chiens',  'paw-outline'],
                  ] as [keyof typeof proposeAmenities, string, IoniconsName][]).map(([key, label, icon]) => (
                    <TouchableOpacity
                      key={key}
                      style={[styles.checkRow, proposeAmenities[key] && styles.checkRowActive]}
                      onPress={() => setProposeAmenities(p => ({ ...p, [key]: !p[key] }))}
                    >
                      <Ionicons
                        name={proposeAmenities[key] ? 'checkbox' : 'square-outline'}
                        size={18}
                        color={proposeAmenities[key] ? colors.terra : colors.textMuted}
                      />
                      <Ionicons name={icon} size={13} color={proposeAmenities[key] ? colors.terra : colors.textMuted} />
                      <Text style={[styles.checkLabel, proposeAmenities[key] && styles.checkLabelActive]}>{label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Photos */}
              <View style={styles.proposeField}>
                <Text style={styles.proposeLabel}>Photos (max 5)</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                  {proposePhotos.map((uri, idx) => (
                    <View key={idx} style={styles.proposeMediaThumb}>
                      <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                      <TouchableOpacity style={styles.proposeMediaRemove} onPress={() => setProposePhotos(p => p.filter((_, i) => i !== idx))}>
                        <Ionicons name="close-circle" size={20} color="#fff" />
                      </TouchableOpacity>
                    </View>
                  ))}
                  {proposePhotos.length < 5 && (
                    <TouchableOpacity style={[styles.proposeMediaThumb, styles.proposeMediaAdd]} onPress={pickProposePhotos}>
                      <Ionicons name="camera-outline" size={24} color={colors.bordeaux} />
                      <Text style={styles.proposeMediaAddLabel}>Ajouter</Text>
                    </TouchableOpacity>
                  )}
                </ScrollView>
              </View>

              {/* Vidéo — masqué via ENABLE_VIDEO_UPLOAD */}
              {ENABLE_VIDEO_UPLOAD && (
              <View style={styles.proposeField}>
                <Text style={styles.proposeLabel}>Vidéo (max 60 sec)</Text>
                {proposeVideo ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={[styles.proposeMediaThumb, { backgroundColor: colors.bordeaux, alignItems: 'center', justifyContent: 'center' }]}>
                      <Ionicons name="videocam" size={28} color={colors.terraPale} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.proposeLabel, { marginBottom: 0 }]}>Vidéo sélectionnée ✓</Text>
                      <TouchableOpacity onPress={() => setProposeVideo(null)}>
                        <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 12, color: '#c04040', marginTop: 4 }}>Supprimer</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <TouchableOpacity style={[styles.proposeMediaThumb, styles.proposeMediaAdd, { width: '100%', height: 56, flexDirection: 'row', gap: 10 }]} onPress={pickProposeVideo}>
                    <Ionicons name="videocam-outline" size={22} color={colors.bordeaux} />
                    <Text style={styles.proposeMediaAddLabel}>Choisir une vidéo</Text>
                  </TouchableOpacity>
                )}
              </View>
              )}

              <TouchableOpacity style={[styles.avisSubmit, (!proposeNom.trim() || !proposeVille.trim() || !proposeCats.length || proposeLoading) && styles.avisSubmitDisabled]} onPress={submitPropose} disabled={!proposeNom.trim() || !proposeVille.trim() || !proposeCats.length || proposeLoading}>
                {proposeLoading ? <ActivityIndicator color={colors.ivory} /> : <Text style={styles.avisSubmitText}>Soumettre le lieu</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Modal compléter la fiche */}
      {/* Onboarding modal */}
      <Modal visible={onboardingVisible} transparent animationType="fade">
        <View style={styles.onboardingOverlay}>
          <View style={styles.onboardingCard}>

            {onboardingSlide === 0 && (
              <View style={[styles.onboardingSlide, styles.onboardingSlide0]}>
                <Text style={styles.onboardingLogoText}>The Pack</Text>
                <Text style={styles.onboardingTagline}>La Meute dog-friendly</Text>
                <Ionicons name="paw" size={52} color="rgba(245,239,224,0.18)" style={{ marginVertical: 8 }} />
                <Text style={styles.onboardingSlide0Desc}>
                  La première carte collaborative dog-friendly de France. Explore, sauvegarde et partage les meilleurs spots avec ta meute.
                </Text>
              </View>
            )}

            {onboardingSlide === 1 && (
              <View style={styles.onboardingSlide}>
                <Text style={styles.onboardingTitle}>Comment ça marche ?</Text>
                <View style={{ gap: 14, width: '100%' }}>
                  {([
                    ['map-outline',   'Explore',    'Des centaines de spots dog-friendly : restos, parcs, cafés, vétérinaires...'],
                    ['heart-outline', 'Sauvegarde', 'Crée tes listes de favoris et retrouve tes spots préférés'],
                    ['star-outline',  'Partage',    'Laisse des avis et aide la communauté à trouver les meilleurs spots'],
                  ] as [IoniconsName, string, string][]).map(([icon, title, desc]) => (
                    <View key={title} style={styles.onboardingFeatureRow}>
                      <View style={styles.onboardingFeatureIcon}>
                        <Ionicons name={icon} size={20} color={colors.terra} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.onboardingFeatureTitle}>{title}</Text>
                        <Text style={styles.onboardingFeatureDesc}>{desc}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {onboardingSlide === 2 && (
              <View style={styles.onboardingSlide}>
                <View style={styles.onboardingProposeBubble}>
                  <Ionicons name="add" size={32} color={colors.ivory} />
                </View>
                <Text style={styles.onboardingTitle}>Ajoute ta patte à la carte !</Text>
                <Text style={styles.onboardingDesc}>
                  Tu connais un super spot dog-friendly dans ta ville ? Ajoute-le avec le bouton{' '}
                  <Text style={{ fontFamily: 'DMSans_500Medium', color: colors.terra }}>+</Text>{' '}
                  et gagne des points pour chaque contribution !
                </Text>
              </View>
            )}

            {onboardingSlide === 3 && (
              <View style={styles.onboardingSlide}>
                <Text style={styles.onboardingTitle}>Gagne des points !</Text>
                <View style={{ gap: 8, width: '100%' }}>
                  {([
                    ['🐾', 'Explorateur', '0 pts',    '#546E7A'],
                    ['🥈', 'Silver',      '500 pts',  '#8E8E93'],
                    ['🥇', 'Gold',        '2000 pts', '#C4693A'],
                    ['💎', 'Platinum',    '5000 pts', '#5A7FA5'],
                  ] as [string, string, string, string][]).map(([emoji, nom, pts, color]) => (
                    <View key={nom} style={styles.onboardingLevelRow}>
                      <Text style={styles.onboardingLevelEmoji}>{emoji}</Text>
                      <Text style={[styles.onboardingLevelNom, { color }]}>{nom}</Text>
                      <Text style={styles.onboardingLevelPts}>{pts}</Text>
                    </View>
                  ))}
                </View>
                <Text style={styles.onboardingDescSmall}>
                  Propose des lieux, laisse des avis, ajoute des photos pour monter de niveau !
                </Text>
              </View>
            )}

            <View style={styles.onboardingDots}>
              {[0, 1, 2, 3].map(i => (
                <View key={i} style={[styles.onboardingDot, onboardingSlide === i && styles.onboardingDotActive]} />
              ))}
            </View>

            <View style={styles.onboardingBtns}>
              {onboardingSlide < 3 ? (
                <>
                  <TouchableOpacity style={styles.onboardingNextBtn} onPress={() => setOnboardingSlide(s => s + 1)}>
                    <Text style={styles.onboardingNextText}>Suivant</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={closeOnboarding} style={styles.onboardingSkipBtn}>
                    <Text style={styles.onboardingSkipText}>Passer</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity style={styles.onboardingNextBtn} onPress={closeOnboarding}>
                  <Text style={styles.onboardingNextText}>Commencer !</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </Modal>

      {/* Login prompt */}
      <Modal visible={loginPromptVisible} transparent animationType="fade">
        <TouchableOpacity style={styles.loginPromptOverlay} activeOpacity={1} onPress={() => setLoginPromptVisible(false)}>
          <TouchableOpacity style={styles.loginPromptCard} activeOpacity={1} onPress={() => {}}>
            <Ionicons name="paw" size={44} color={colors.terra} />
            <Text style={styles.loginPromptTitle}>Rejoins la meute !</Text>
            <Text style={styles.loginPromptDesc}>
              Connecte-toi pour sauvegarder des lieux, laisser des avis et découvrir les spots de la communauté.
            </Text>
            <TouchableOpacity
              style={styles.loginPromptBtn}
              onPress={() => { setLoginPromptVisible(false); navigation.navigate('Auth'); }}
            >
              <Text style={styles.loginPromptBtnText}>Se connecter / S'inscrire →</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setLoginPromptVisible(false)}>
              <Text style={styles.loginPromptSkip}>Continuer sans compte</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Feedback strip */}
      <TouchableOpacity style={styles.feedbackStrip} onPress={() => setFeedbackModal(true)}>
        <Ionicons name="chatbubble-ellipses-outline" size={15} color={colors.ivory} />
        <Text style={styles.feedbackStripText}>Avis</Text>
      </TouchableOpacity>

      {/* Feedback modal */}
      <Modal visible={feedbackModal} transparent animationType="slide">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <TouchableOpacity style={styles.feedbackOverlay} activeOpacity={1} onPress={() => setFeedbackModal(false)}>
            <TouchableOpacity style={styles.feedbackCard} activeOpacity={1} onPress={() => {}}>
              <Text style={styles.feedbackTitle}>Ton avis compte 🐾</Text>
              <View style={styles.feedbackTypeRow}>
                {([
                  { key: 'probleme',     label: 'Signaler un problème', icon: 'bug-outline' as IoniconsName },
                  { key: 'amelioration', label: 'Suggérer une amélioration', icon: 'bulb-outline' as IoniconsName },
                ] as const).map(t => (
                  <TouchableOpacity
                    key={t.key}
                    style={[styles.feedbackTypeBtn, feedbackType === t.key && styles.feedbackTypeBtnActive]}
                    onPress={() => setFeedbackType(t.key)}
                  >
                    <Ionicons name={t.icon} size={15} color={feedbackType === t.key ? colors.ivory : colors.bordeaux} />
                    <Text style={[styles.feedbackTypeBtnText, feedbackType === t.key && { color: colors.ivory }]} numberOfLines={1}>{t.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput
                style={styles.feedbackInput}
                value={feedbackText}
                onChangeText={setFeedbackText}
                placeholder={feedbackType === 'probleme' ? 'Décris le problème rencontré…' : 'Quelle amélioration souhaites-tu ?'}
                placeholderTextColor={colors.textMuted}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
              <TouchableOpacity
                style={[styles.feedbackSubmit, (!feedbackText.trim() || feedbackLoading) && { opacity: 0.5 }]}
                onPress={submitFeedback}
                disabled={!feedbackText.trim() || feedbackLoading}
              >
                {feedbackLoading
                  ? <ActivityIndicator color={colors.ivory} size="small" />
                  : <Text style={styles.feedbackSubmitText}>Envoyer</Text>}
              </TouchableOpacity>
            </TouchableOpacity>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>

      {/* Event detail modal */}
      <Modal visible={!!selectedMapEvent} transparent animationType="slide" onRequestClose={() => setSelectedMapEvent(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setSelectedMapEvent(null)}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View style={[styles.modalCard, { gap: 14 }]}>
              {selectedMapEvent && (() => {
                const date = new Date(selectedMapEvent.date_heure);
                const isFull = !!(selectedMapEvent.max_participants && selectedMapEvent.nb_inscrits >= selectedMapEvent.max_participants && !selectedMapEvent.je_suis_inscrit);
                return (
                  <>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                      <View style={styles.eventModalIcon}>
                        <Ionicons name="calendar" size={18} color="#fff" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.eventModalTitle}>{selectedMapEvent.titre}</Text>
                      </View>
                      <TouchableOpacity onPress={() => setSelectedMapEvent(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Ionicons name="close" size={20} color={colors.textMuted} />
                      </TouchableOpacity>
                    </View>

                    <View style={styles.eventModalRow}>
                      <Ionicons name="calendar-outline" size={14} color={colors.textMuted} />
                      <Text style={styles.eventModalText}>
                        {date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} à {date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                      </Text>
                    </View>
                    <View style={styles.eventModalRow}>
                      <Ionicons name="location-outline" size={14} color={colors.textMuted} />
                      <Text style={styles.eventModalText} numberOfLines={2}>
                        {selectedMapEvent.ville}{selectedMapEvent.adresse ? ` · ${selectedMapEvent.adresse}` : ''}
                      </Text>
                    </View>
                    <View style={styles.eventModalRow}>
                      <Ionicons name="people-outline" size={14} color={colors.textMuted} />
                      <Text style={styles.eventModalText}>
                        {selectedMapEvent.nb_inscrits}{selectedMapEvent.max_participants ? `/${selectedMapEvent.max_participants}` : ''} inscrit{selectedMapEvent.nb_inscrits !== 1 ? 's' : ''}
                      </Text>
                    </View>
                    {selectedMapEvent.payant ? (
                      <View style={styles.eventModalRow}>
                        <Ionicons name="cash-outline" size={14} color={colors.textMuted} />
                        <Text style={styles.eventModalText}>{selectedMapEvent.prix ? `${selectedMapEvent.prix} €` : 'Payant'}</Text>
                      </View>
                    ) : null}
                    {selectedMapEvent.profils?.username ? (
                      <View style={styles.eventModalRow}>
                        <Ionicons name="person-outline" size={14} color={colors.textMuted} />
                        <Text style={styles.eventModalText}>@{selectedMapEvent.profils.username}</Text>
                      </View>
                    ) : null}

                    {userId ? (
                      isFull ? (
                        <View style={styles.eventModalFull}>
                          <Text style={styles.eventModalFullText}>Complet — plus de places</Text>
                        </View>
                      ) : selectedMapEvent.je_suis_inscrit ? (
                        <TouchableOpacity style={styles.eventModalCancel} disabled={mapEventInscLoading}
                          onPress={() => toggleMapEventInscription(selectedMapEvent.id, false)}>
                          {mapEventInscLoading
                            ? <ActivityIndicator size="small" color="#e65100" />
                            : <>
                                <Ionicons name="checkmark-circle" size={16} color="#e65100" />
                                <Text style={styles.eventModalCancelText}>Inscrit · Annuler</Text>
                              </>
                          }
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity style={styles.eventModalJoin} disabled={mapEventInscLoading}
                          onPress={() => toggleMapEventInscription(selectedMapEvent.id, true)}>
                          {mapEventInscLoading
                            ? <ActivityIndicator color={colors.ivory} size="small" />
                            : <Text style={styles.eventModalJoinText}>
                                S'inscrire{selectedMapEvent.payant && selectedMapEvent.prix ? ` — ${selectedMapEvent.prix} €` : ''}
                              </Text>
                          }
                        </TouchableOpacity>
                      )
                    ) : (
                      <TouchableOpacity style={styles.eventModalJoin} onPress={() => { setSelectedMapEvent(null); showLoginPrompt(); }}>
                        <Text style={styles.eventModalJoinText}>Connecte-toi pour t'inscrire</Text>
                      </TouchableOpacity>
                    )}
                  </>
                );
              })()}
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Off-screen share card for image sharing */}
      <View ref={shareLieuCardRef} collapsable={false} style={styles.shareLieuCard}>
        {photos[0]?.url ? (
          <Image source={{ uri: photos[0].url }} style={styles.shareLieuPhoto} resizeMode="cover" />
        ) : (
          <View style={[styles.shareLieuPhotoPlaceholder, { backgroundColor: (CAT_CONFIG[selectedLieu?.cat || 'autre'] || CAT_CONFIG.autre).color }]}>
            <Ionicons name={(CAT_CONFIG[selectedLieu?.cat || 'autre'] || CAT_CONFIG.autre).markerIcon} size={64} color="rgba(255,255,255,0.5)" />
          </View>
        )}
        <View style={styles.shareLieuContent}>
          <Text style={styles.shareLieuBrand}>THE PACK CLUB</Text>
          <View style={styles.shareLieuLine} />
          <Text style={styles.shareLieuNom} numberOfLines={2}>{selectedLieu?.nom || ''}</Text>
          <Text style={styles.shareLieuCat}>{(CAT_CONFIG[selectedLieu?.cat || 'autre'] || CAT_CONFIG.autre).label}</Text>
          <Text style={styles.shareLieuVille}>{selectedLieu?.ville || ''}</Text>
          {selectedLieu?.note_moyenne ? (
            <View style={styles.shareLieuStarsRow}>
              {[1,2,3,4,5].map(i => (
                <Ionicons key={i} name={i <= Math.round(selectedLieu.note_moyenne || 0) ? 'star' : 'star-outline'} size={18} color={colors.terra} />
              ))}
              <Text style={styles.shareLieuNote}>{selectedLieu.note_moyenne.toFixed(1)}</Text>
            </View>
          ) : null}
          <View style={styles.shareLieuDogBadge}>
            <Text style={styles.shareLieuDogBadgeText}>🐾 Lieu dog-friendly</Text>
          </View>
          <View style={[styles.shareLieuLine, { opacity: 0.25, marginTop: 18 }]} />
          <Text style={styles.shareLieuUrl}>thepackclub.fr</Text>
        </View>
      </View>
    </View>

    {/* ── Balade modals ── */}
    {/* ── Balade fiche ── */}
    {selectedBalade && (
      <Modal visible animationType="slide" transparent onRequestClose={() => setSelectedBalade(null)}>
        <TouchableOpacity style={styles.baladeOverlay} activeOpacity={1} onPress={() => setSelectedBalade(null)} />
        <View style={[styles.baladeSheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.baladeSheetHandle} />
          <View style={styles.baladeSheetHeader}>
            <View style={[styles.baladeBubble, { width: 40, height: 40, borderRadius: 20 }]}>
              <Ionicons name="walk-outline" size={20} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.baladeSheetNom}>{selectedBalade.nom}</Text>
              <Text style={styles.baladeSheetAuthor}>
                Par {selectedBalade.profils?.prenom || 'un membre'}
                {selectedBalade.distance_km ? ` · ${selectedBalade.distance_km} km` : ''}
              </Text>
            </View>
            <TouchableOpacity onPress={() => setSelectedBalade(null)}>
              <Ionicons name="close" size={22} color={colors.bordeaux} />
            </TouchableOpacity>
          </View>
          <View style={styles.baladeRoute}>
            <View style={styles.baladeRouteDot} />
            <Text style={styles.baladeRouteLabel} numberOfLines={2}>
              {selectedBalade.depart_label || 'Point de départ'}
            </Text>
          </View>
          <View style={styles.baladeRouteLine} />
          <View style={styles.baladeRoute}>
            <Ionicons name="flag-outline" size={14} color='#2E7D6B' />
            <Text style={styles.baladeRouteLabel} numberOfLines={2}>
              {selectedBalade.arrivee_texte || (selectedBalade.arrivee_lat ? 'Point marqué sur la carte' : '—')}
            </Text>
          </View>
          {selectedBalade.description ? (
            <Text style={styles.baladeSheetDesc}>{selectedBalade.description}</Text>
          ) : null}
          {FILTRES_DEF.filter(f => (selectedBalade as any)[f.key]).length > 0 && (
            <View style={styles.baladeFiltresBadges}>
              {FILTRES_DEF.filter(f => (selectedBalade as any)[f.key]).map(f => (
                <View key={f.key} style={styles.baladeFiltresBadge}>
                  <Ionicons name={f.icon as any} size={12} color={colors.sage} />
                  <Text style={styles.baladeFiltresBadgeText}>{f.label}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </Modal>
    )}

    {/* ── Balade formulaire ── */}
    {baladeFormVisible && (
      <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setBaladeFormVisible(false)}>
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.ivory }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.baladeForm} keyboardShouldPersistTaps="handled">
            <View style={styles.baladeFormHeader}>
              <TouchableOpacity onPress={() => { setBaladeFormVisible(false); setBaladeDepartLat(null); setBaladeDepartLng(null); }}>
                <Ionicons name="close" size={24} color={colors.bordeaux} />
              </TouchableOpacity>
              <Text style={styles.baladeFormTitle}>Proposer une balade</Text>
              <TouchableOpacity
                style={[styles.baladeFormSubmit, (!baladeNom.trim() || (!baladeArrivee.trim() && !baladeFinalArriveeCoords) || baladeLoading) && { opacity: 0.4 }]}
                onPress={submitBalade}
                disabled={!baladeNom.trim() || (!baladeArrivee.trim() && !baladeFinalArriveeCoords) || baladeLoading}
              >
                {baladeLoading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.baladeFormSubmitText}>Publier</Text>}
              </TouchableOpacity>
            </View>

            <Text style={styles.baladeFormLabel}>Nom de la balade *</Text>
            <TextInput style={styles.baladeFormInput} placeholder="Ex : Tour du Bois de Vincennes" placeholderTextColor={colors.textMuted} value={baladeNom} onChangeText={setBaladeNom} />

            <Text style={styles.baladeFormLabel}>Point d'arrivée *</Text>
            {baladeFinalArriveeCoords ? (
              <View style={styles.baladeArriveeMapRow}>
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="flag" size={16} color={colors.sage} />
                  <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.bordeaux }}>Point placé sur la carte</Text>
                </View>
                <TouchableOpacity onPress={() => setBaladeFinalArriveeCoords(null)}>
                  <Ionicons name="close-circle" size={20} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <TextInput style={styles.baladeFormInput} placeholder="Adresse ou nom du lieu d'arrivée" placeholderTextColor={colors.textMuted} value={baladeArrivee} onChangeText={setBaladeArrivee} />
                <TouchableOpacity
                  style={styles.baladeArriveeMapBtn}
                  onPress={() => { setBaladeFormVisible(false); setPickingBaladeArrivee(true); }}
                >
                  <Ionicons name="map-outline" size={15} color={colors.bordeaux} />
                  <Text style={styles.baladeArriveeMapBtnText}>Placer sur la carte</Text>
                </TouchableOpacity>
              </>
            )}

            <Text style={styles.baladeFormLabel}>Description (optionnel)</Text>
            <TextInput style={[styles.baladeFormInput, { height: 90 }]} placeholder="Décris la balade, les points d'intérêt…" placeholderTextColor={colors.textMuted} value={baladeDesc} onChangeText={setBaladeDesc} multiline />

            {baladeFinalArriveeCoords && baladeDepartLat !== null && baladeDepartLng !== null ? (
              <View style={styles.baladeDistanceInfo}>
                <Ionicons name="navigate-outline" size={14} color={colors.sage} />
                <Text style={styles.baladeDistanceInfoText}>
                  {haversine(baladeDepartLat, baladeDepartLng, baladeFinalArriveeCoords.lat, baladeFinalArriveeCoords.lng).toFixed(1)} km à vol d'oiseau
                </Text>
              </View>
            ) : (
              <>
                <Text style={styles.baladeFormLabel}>Distance en km (optionnel)</Text>
                <TextInput style={styles.baladeFormInput} placeholder="Ex : 4.5" placeholderTextColor={colors.textMuted} value={baladeDistance} onChangeText={setBaladeDistance} keyboardType="decimal-pad" />
              </>
            )}

            <Text style={styles.baladeFormLabel}>Photo (optionnel)</Text>
            {baladePhotoUri ? (
              <View style={{ position: 'relative', marginBottom: 4 }}>
                <Image source={{ uri: baladePhotoUri }} style={{ width: '100%', height: 160, borderRadius: 10 }} resizeMode="cover" />
                <TouchableOpacity
                  style={{ position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 14, padding: 4 }}
                  onPress={() => setBaladePhotoUri(null)}
                >
                  <Ionicons name="close" size={16} color="#fff" />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.baladePhotoBtn}
                onPress={async () => {
                  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
                  if (!perm.granted) { Alert.alert('Permission refusée', 'Autorise l\'accès à ta galerie dans les Réglages.'); return; }
                  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
                  if (!result.canceled && result.assets[0]) setBaladePhotoUri(result.assets[0].uri);
                }}
              >
                <Ionicons name="image-outline" size={20} color={colors.textMuted} />
                <Text style={styles.baladePhotoBtnText}>Ajouter une photo</Text>
              </TouchableOpacity>
            )}

            <Text style={styles.baladeFormLabel}>Caractéristiques (optionnel)</Text>
            <View style={styles.baladeFiltresGrid}>
              {FILTRES_DEF.map(f => {
                const active = baladeFiltres[f.key];
                return (
                  <TouchableOpacity
                    key={f.key}
                    style={[styles.baladeFiltreChip, active && styles.baladeFiltreChipActive]}
                    onPress={() => setBaladeFiltres(prev => ({ ...prev, [f.key]: !prev[f.key] }))}
                  >
                    <Ionicons name={f.icon as any} size={14} color={active ? colors.ivory : colors.bordeaux} />
                    <Text style={[styles.baladeFiltreChipText, active && { color: colors.ivory }]}>{f.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    )}
    </>
  );
}

const styles = StyleSheet.create({
  dogTagBadge: {
    backgroundColor: 'rgba(61,26,26,0.72)', borderRadius: 12,
    paddingHorizontal: 9, paddingVertical: 4,
    borderWidth: 1, borderColor: 'rgba(245,239,224,0.2)',
  },
  dogTagText: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: '#fff' },
  dogTagCard: {
    backgroundColor: colors.ivoryPale, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, paddingBottom: 36, gap: 12,
  },
  dogTagModalTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: colors.bordeaux, textAlign: 'center' },
  dogTagModalSub: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted, textAlign: 'center' },
  dogTagInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 12,
    padding: 14, fontFamily: 'DMSans_400Regular', fontSize: 15,
    color: colors.bordeaux, backgroundColor: colors.white,
  },
  dogTagSubmit: { backgroundColor: colors.bordeaux, borderRadius: 12, padding: 15, alignItems: 'center' },
  dogTagSubmitText: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: colors.ivory },
  dogTagSkip: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted },
  feedbackStrip: {
    position: 'absolute', left: 0, bottom: 180,
    backgroundColor: colors.bordeaux,
    borderTopRightRadius: 8, borderBottomRightRadius: 8,
    paddingVertical: 10, paddingHorizontal: 5,
    alignItems: 'center', gap: 5,
    shadowColor: '#000', shadowOffset: { width: 2, height: 2 }, shadowOpacity: 0.2, shadowRadius: 3, elevation: 4,
  },
  feedbackStripText: {
    fontFamily: 'DMSans_500Medium', fontSize: 9, color: colors.ivory,
    transform: [{ rotate: '90deg' }], letterSpacing: 0.5,
  },
  feedbackOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  feedbackCard: {
    backgroundColor: colors.ivoryPale, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, paddingBottom: 40, gap: 16,
  },
  feedbackTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 20, color: colors.bordeaux, textAlign: 'center' },
  feedbackTypeRow: { flexDirection: 'row', gap: 10 },
  feedbackTypeBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, paddingHorizontal: 8, borderRadius: 12,
    borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.white,
  },
  feedbackTypeBtnActive: { backgroundColor: colors.bordeaux, borderColor: colors.bordeaux },
  feedbackTypeBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.bordeaux, flexShrink: 1 },
  feedbackInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 12,
    padding: 14, minHeight: 100, fontFamily: 'DMSans_400Regular', fontSize: 14,
    color: colors.bordeaux, backgroundColor: colors.white,
  },
  feedbackSubmit: {
    backgroundColor: colors.terra, borderRadius: 12, padding: 15, alignItems: 'center',
  },
  feedbackSubmitText: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: colors.ivory },

  shareLieuCard: {
    position: 'absolute', left: -9999, top: 0,
    width: 360, backgroundColor: '#3D1A1A',
    borderRadius: 0, overflow: 'hidden',
  },
  shareLieuPhoto: { width: 360, height: 260 },
  shareLieuPhotoPlaceholder: { width: 360, height: 260, alignItems: 'center', justifyContent: 'center' },
  shareLieuContent: { paddingHorizontal: 28, paddingTop: 22, paddingBottom: 28, alignItems: 'center', gap: 6 },
  shareLieuBrand: { fontFamily: 'DMSans_400Regular', fontSize: 10, color: 'rgba(232,168,130,0.8)', letterSpacing: 3, textTransform: 'uppercase' },
  shareLieuLine: { width: 240, height: 1, backgroundColor: 'rgba(196,105,58,0.45)', marginVertical: 6 },
  shareLieuNom: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 26, color: '#F5EFE0', textAlign: 'center', lineHeight: 32 },
  shareLieuCat: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: 'rgba(196,105,58,0.85)', textTransform: 'uppercase', letterSpacing: 1 },
  shareLieuVille: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: 'rgba(245,239,224,0.55)' },
  shareLieuStarsRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  shareLieuNote: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.terra, marginLeft: 4 },
  shareLieuDogBadge: { marginTop: 10, paddingHorizontal: 20, paddingVertical: 8, backgroundColor: 'rgba(196,105,58,0.18)', borderRadius: 20, borderWidth: 1, borderColor: 'rgba(196,105,58,0.45)' },
  shareLieuDogBadgeText: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: 'rgba(232,168,130,0.9)' },
  shareLieuUrl: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: 'rgba(196,105,58,0.7)', marginTop: 4 },

  container: { flex: 1 },
  map: { flex: 1 },
  markerPin: { alignItems: 'center' },
  markerBubble: {
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.28, shadowRadius: 4, elevation: 5,
  },
  markerBubbleSelected: {
    shadowOpacity: 0.45, shadowRadius: 8, elevation: 10,
    borderWidth: 2.5, borderColor: '#fff',
  },
  markerShine: {
    position: 'absolute', top: 3, left: 4, right: 4, height: '38%',
    backgroundColor: 'rgba(255,255,255,0.22)', borderRadius: 40,
  },
  markerTail: {
    width: 0, height: 0,
    borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 7,
    borderLeftColor: 'transparent', borderRightColor: 'transparent',
    marginTop: -1,
  },
  clusterBubble: {
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    backgroundColor: colors.terra,
    borderWidth: 2.5, borderColor: '#fff',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 5, elevation: 6,
  },
  clusterText: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: '#fff', fontWeight: '700' },
  topOverlay: { position: 'absolute', top: 0, left: 0, right: 0, gap: 8, paddingTop: 10 },
  carteListeRow: { alignItems: 'center' },
  carteListeToggle: {
    flexDirection: 'row', backgroundColor: colors.white,
    borderRadius: 22, padding: 3, borderWidth: 1, borderColor: colors.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.14, shadowRadius: 6, elevation: 5,
  },
  carteListeOption: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 18, paddingVertical: 7, borderRadius: 18,
  },
  carteListeOptionActive: { backgroundColor: colors.bordeaux },
  carteListeLabel: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.bordeaux },
  carteListeLabelActive: { color: '#fff' },
  searchContainer: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.white,
    borderRadius: 14, marginHorizontal: 12, borderWidth: 1, borderColor: colors.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 6, elevation: 4,
  },
  searchInput: { flex: 1, height: 44, paddingHorizontal: 10, fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.bordeaux },
  filtersContent: { paddingHorizontal: 12, gap: 8, paddingBottom: 4 },
  filterPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.white,
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: colors.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 3, elevation: 2,
  },
  filterPillActive: { borderColor: 'transparent' },
  filterLabel: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.bordeaux },
  filterLabelActive: { color: '#fff' },
  resultsDropdown: {
    backgroundColor: colors.white, borderRadius: 14, marginHorizontal: 12,
    borderWidth: 1, borderColor: colors.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 6, elevation: 4,
    overflow: 'hidden',
  },
  resultItem: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  resultItemBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  resultIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  resultNom: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.bordeaux },
  resultVille: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted },
  loadingBadge: {
    position: 'absolute', top: 154, right: 16, backgroundColor: colors.ivory,
    borderRadius: 20, padding: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.15, shadowRadius: 4, elevation: 3,
  },
  locBtn: {
    position: 'absolute', bottom: 24, right: 16, backgroundColor: colors.ivory,
    borderRadius: 24, width: 48, height: 48, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 6, elevation: 4,
  },
  proposeBtn: {
    position: 'absolute', bottom: 24, left: 16, backgroundColor: colors.bordeaux,
    borderRadius: 24, width: 48, height: 48, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 6, elevation: 5,
  },
  fabMenu: {
    position: 'absolute', bottom: 82, left: 16, gap: 10,
  },
  fabMenuItem: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  fabMenuLabel: {
    backgroundColor: 'rgba(0,0,0,0.72)', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 5,
    fontFamily: 'DMSans_500Medium', fontSize: 13, color: '#fff',
  },
  fabMenuIcon: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 4,
  },
  pickModeBanner: {
    position: 'absolute', bottom: 90, left: 16, right: 16,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.bordeaux, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 6, elevation: 5,
  },
  pickModeBannerText: { flex: 1, fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.ivory },
  baladePin: { alignItems: 'center' },
  baladeBubble: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: '#2E7D6B',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 3, elevation: 3,
  },
  baladeBubbleSelected: { width: 42, height: 42, borderRadius: 21 },
  baladeTail: { width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 8, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#2E7D6B' },
  baladeOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.3)' },
  baladeSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: colors.ivory, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingTop: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: -3 }, shadowOpacity: 0.12, shadowRadius: 10, elevation: 12,
  },
  baladeSheetHandle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 16 },
  baladeSheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  baladeSheetNom: { fontFamily: 'DMSans_600SemiBold', fontSize: 16, color: colors.bordeaux },
  baladeSheetAuthor: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted, marginTop: 2 },
  baladeRoute: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 4 },
  baladeRouteDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#2E7D6B', marginTop: 2 },
  baladeRouteLabel: { flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.bordeaux },
  baladeRouteLine: { width: 2, height: 16, backgroundColor: colors.border, marginLeft: 4, marginVertical: 2 },
  baladeSheetDesc: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted, marginTop: 12, lineHeight: 20 },
  baladeForm: { padding: 20, paddingBottom: 60 },
  baladeFormHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 24, gap: 8 },
  baladeFormTitle: { flex: 1, fontFamily: 'DMSans_600SemiBold', fontSize: 17, color: colors.bordeaux, textAlign: 'center' },
  baladeFormSubmit: { backgroundColor: colors.bordeaux, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  baladeFormSubmitText: { fontFamily: 'DMSans_600SemiBold', fontSize: 14, color: '#fff' },
  baladeFormLabel: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.bordeaux, marginBottom: 6, marginTop: 16 },
  baladeFormInput: {
    backgroundColor: colors.white, borderRadius: 10, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 14, paddingVertical: 10, fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.bordeaux,
  },
  baladeArriveeMapRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.white, borderRadius: 10, borderWidth: 1, borderColor: colors.sage,
    paddingHorizontal: 14, paddingVertical: 10, gap: 8,
  },
  baladeArriveeMapBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 8, alignSelf: 'flex-start',
    backgroundColor: colors.ivoryPale, borderRadius: 8, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  baladeArriveeMapBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.bordeaux },
  baladeFiltresGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  baladeFiltreChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: 1, borderColor: colors.border, borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6, backgroundColor: colors.white,
  },
  baladeFiltreChipActive: { backgroundColor: colors.bordeaux, borderColor: colors.bordeaux },
  baladeFiltreChipText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.bordeaux },
  baladeFiltresBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  baladeFiltresBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(46,125,107,0.08)', borderRadius: 12,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  baladeFiltresBadgeText: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.sage },
  baladeDistanceInfo: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, marginBottom: 4,
    backgroundColor: 'rgba(46,125,107,0.08)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8,
  },
  baladeDistanceInfoText: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.sage },
  baladePhotoBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1.5, borderColor: colors.border, borderStyle: 'dashed',
    borderRadius: 10, paddingVertical: 16, marginBottom: 4,
  },
  baladePhotoBtnText: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.textMuted },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'transparent' },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0, top: 0, backgroundColor: colors.ivoryPale,
    shadowColor: '#000', shadowOffset: { width: 0, height: -3 }, shadowOpacity: 0.12, shadowRadius: 10, elevation: 12,
  },
  handleArea: { position: 'absolute', top: 0, left: (SCREEN_W - 100) / 2, width: 100, paddingTop: 10, paddingBottom: 14, alignItems: 'center', zIndex: 30 },
  handle: { width: 0, height: 0 },
  // Header photo zone
  ficheHeader: { width: '100%', overflow: 'hidden', backgroundColor: colors.bordeaux },
  ficheHeaderPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fichePhotoCredits: {
    position: 'absolute', bottom: 12, right: 12, alignItems: 'flex-end', gap: 4,
  },
  ficheInfoBlock: {
    backgroundColor: '#fff', paddingHorizontal: 18, paddingTop: 14, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  ficheInfoNom: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 20, color: colors.bordeaux, lineHeight: 26, marginBottom: 3 },
  ficheInfoAdresse: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted },
  ficheInfoScore: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.bordeaux, marginLeft: 4 },
  ficheInfoAvis: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted },
  fichePhotoAuthor: { fontFamily: 'DMSans_400Regular', fontSize: 10, color: 'rgba(255,255,255,0.7)' },
  fichePhotoLikeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  fichePhotoLikeCount: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: 'rgba(255,255,255,0.8)' },
  fichePhotoCounter: {
    position: 'absolute', top: 14, left: 58,
    backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3,
  },
  fichePhotoCounterText: { fontFamily: 'DMSans_400Regular', fontSize: 10, color: '#fff' },
  ficheBtnAddPhoto: {
    position: 'absolute', top: 12, left: 12, width: 34, height: 34,
    backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
  },
  ficheBtnClose: {
    position: 'absolute', top: 12, right: 12, width: 34, height: 34,
    backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
  },
  ficheBtnFav: {
    position: 'absolute', top: 12, right: 54, width: 34, height: 34,
    backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
  },
  catBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  catLabel: { fontSize: 12, fontFamily: 'DMSans_500Medium' },
  sheetScroll: { flex: 1 },
  sheetContent: { padding: 16, paddingTop: 12, paddingBottom: 40, gap: 10 },
  proposeMediaThumb: {
    width: 80, height: 80, borderRadius: 10, overflow: 'hidden', backgroundColor: colors.border,
  },
  proposeMediaAdd: {
    alignItems: 'center', justifyContent: 'center', gap: 4,
    borderWidth: 1.5, borderColor: colors.bordeaux, borderStyle: 'dashed',
    backgroundColor: 'transparent',
  },
  proposeMediaAddLabel: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.bordeaux },
  proposeMediaRemove: {
    position: 'absolute', top: 3, right: 3,
    backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 10,
  },
  enrichLink: {
    fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.terra,
    textDecorationLine: 'underline', textAlign: 'center',
  },
  lightboxOverlay: {
    ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center', justifyContent: 'center',
  },
  lightboxImg: { width: SCREEN_W, height: SCREEN_H * 0.7 },
  lightboxClose: { position: 'absolute', top: 54, right: 20, padding: 8 },
  lightboxCounter: { position: 'absolute', bottom: 40, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 4 },
  lightboxCounterText: { color: '#fff', fontFamily: 'DMSans_400Regular', fontSize: 13 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ratingScore: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.bordeaux, marginLeft: 4 },
  ratingCount: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  infoText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMid, flex: 1 },
  badgesWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.white,
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: colors.border,
  },
  badgeCertified: { borderColor: 'rgba(34,139,70,0.3)', backgroundColor: 'rgba(34,139,70,0.06)' },
  badgeCertifiedText: { color: '#1a6b35', fontFamily: 'DMSans_500Medium' },
  certChipIcon: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#22a855', alignItems: 'center', justifyContent: 'center' },
  certBadgeIcon: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#22a855', alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMid },
  description: { fontFamily: 'DMSans_300Light', fontSize: 13, color: colors.textMid, lineHeight: 20, fontStyle: 'italic' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 4, flexWrap: 'wrap' },
  actionPrimary: {
    flex: 1.2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.bordeaux, borderRadius: 12, paddingVertical: 12, minWidth: 100,
  },
  actionPrimaryText: { fontFamily: 'DMSans_500Medium', color: colors.ivory, fontSize: 13 },
  actionSecondary: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    borderRadius: 12, paddingVertical: 12, borderWidth: 1, borderColor: '#C4693A',
    backgroundColor: '#C4693A', minWidth: 60,
  },
  actionSecondaryActive: { borderColor: '#C4693A', backgroundColor: '#C4693A' },
  actionSecondaryText: { fontFamily: 'DMSans_500Medium', color: colors.ivory, fontSize: 12 },
  avisSectionTitle: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 4 },
  ficheAvisCard: { backgroundColor: colors.white, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.border, gap: 4 },
  ficheAvisHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  ficheAvisAuthor: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.bordeaux },
  ficheAvisUsername: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.terra },
  ficheAvisStars: { flexDirection: 'row', gap: 2 },
  ficheAvisComment: { fontFamily: 'DMSans_300Light', fontSize: 12, color: colors.textMid, lineHeight: 18, fontStyle: 'italic' },
  ficheAvisDate: { fontFamily: 'DMSans_400Regular', fontSize: 10, color: colors.textMuted },
  ficheAvisReponse: { marginTop: 6, padding: 10, backgroundColor: 'rgba(196,105,58,0.06)', borderLeftWidth: 2, borderLeftColor: colors.terra, borderRadius: 4 },
  ficheAvisReponseLabel: { fontFamily: 'DMSans_500Medium', fontSize: 10, color: colors.terra, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 },
  ficheAvisReponseText: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMid, lineHeight: 17 },
  certInlineBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(34,168,85,0.1)', borderRadius: 20, paddingHorizontal: 7, paddingVertical: 3 },
  certInlineText: { fontFamily: 'DMSans_500Medium', fontSize: 10, color: '#1a6b35' },
  favDropdown: {
    position: 'absolute', top: 52, right: 48, zIndex: 50, minWidth: 168,
    backgroundColor: colors.white, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 10, elevation: 10,
  },
  favDropdownRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 13 },
  favDropdownBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  favDropdownLabel: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.bordeaux, flex: 1 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalCard: { backgroundColor: colors.ivoryPale, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, gap: 16 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 20, color: colors.bordeaux },
  modalSubtitle: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted, marginTop: -8 },
  starsRow: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  avisInput: {
    backgroundColor: colors.white, borderRadius: 12, padding: 14,
    fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.bordeaux,
    borderWidth: 1, borderColor: colors.border, minHeight: 100,
  },
  avisSubmit: { backgroundColor: colors.terra, borderRadius: 14, padding: 16, alignItems: 'center' },
  avisSubmitDisabled: { opacity: 0.5 },
  avisSubmitText: { fontFamily: 'DMSans_500Medium', color: colors.ivory, fontSize: 15 },
  proposeField: { gap: 5 },
  proposeLabel: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  proposeInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12,
    fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.bordeaux, backgroundColor: colors.ivoryPale,
  },
  geoBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 10,
    backgroundColor: colors.white,
  },
  geoBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.bordeaux },
  geoHint: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted, marginTop: 6, lineHeight: 16 },
  proposeMiniMapWrap: { height: 180, borderRadius: 12, overflow: 'hidden', marginTop: 8, borderWidth: 1, borderColor: colors.border },
  proposeMiniMap: { width: '100%', height: '100%' },
  catPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.white,
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: colors.border,
  },
  catPillLabel: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.bordeaux },
  catPillLabelActive: { color: '#fff' },
  filterSep: { width: 1, height: 20, backgroundColor: colors.border, alignSelf: 'center', marginHorizontal: 2 },
  autresDropdown: {
    position: 'absolute', top: 100, right: 12, zIndex: 30, minWidth: 180,
    backgroundColor: colors.white, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 10, elevation: 10,
  },
  autresItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 13 },
  autresItemBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  autresItemText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.bordeaux, flex: 1 },
  actionShare: {
    width: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white,
  },
  pointsPopup: {
    position: 'absolute', bottom: 90, alignSelf: 'center', left: 0, right: 0,
    alignItems: 'center', pointerEvents: 'none',
  },
  pointsPopupText: {
    fontFamily: 'DMSans_500Medium', fontSize: 18, color: colors.terra,
    backgroundColor: colors.white, paddingHorizontal: 20, paddingVertical: 10,
    borderRadius: 24, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 8,
    borderWidth: 1, borderColor: colors.terra + '33',
  },
  modalCloseFixed: {
    position: 'absolute', top: 20, right: 20, zIndex: 10, padding: 4,
  },
  // List view
  listViewContainer: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: colors.ivoryPale,
  },
  sortBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    backgroundColor: colors.white,
  },
  sortPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: colors.ivoryPale, borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: colors.border,
  },
  sortPillActive: { backgroundColor: colors.bordeaux, borderColor: colors.bordeaux },
  sortPillLabel: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.bordeaux },
  sortPillLabelActive: { color: '#fff' },
  listCount: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted, marginLeft: 'auto' as any },
  listEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingBottom: 80, marginTop: 60 },
  listEmptyText: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.textMuted },
  // List cards
  listCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.white,
    marginHorizontal: 12, marginBottom: 8,
    borderRadius: 14, overflow: 'hidden',
    minHeight: 72,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07, shadowRadius: 4, elevation: 2,
  },
  listCardAccent: { width: 4, alignSelf: 'stretch' },
  listCardPhoto: {
    width: 64, height: 64, borderRadius: 12,
    margin: 12, marginRight: 0,
  },
  listCardBody: { flex: 1, paddingVertical: 12, paddingHorizontal: 10, gap: 2 },
  listCardNom: { fontFamily: 'DMSans_600SemiBold', fontSize: 14, color: colors.bordeaux },
  listCardCatRow: { flexDirection: 'row', alignItems: 'center' },
  listCardCat: { fontFamily: 'DMSans_500Medium', fontSize: 11 },
  listCardAddr: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted },
  listCardMeta: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  listCardNote: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.terra },
  listCardMetaText: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted },
  listCardDistBadge: {
    backgroundColor: colors.ivoryPale, borderRadius: 8,
    paddingHorizontal: 7, paddingVertical: 4, marginRight: 4,
  },
  listCardDistText: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.bordeaux },
  // Search bar additions
  searchDivider: { width: 1, height: 20, backgroundColor: colors.border, marginHorizontal: 2 },
  listToggleBtn: { paddingHorizontal: 12, paddingVertical: 12 },
  checkGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  checkRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.white, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 9,
    borderWidth: 1, borderColor: colors.border, width: '48%',
  },
  checkRowActive: { borderColor: colors.terra + '66', backgroundColor: colors.terra + '12' },
  checkLabel: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.bordeaux, flex: 1 },
  checkLabelActive: { fontFamily: 'DMSans_500Medium', color: colors.terra },
  // Onboarding
  onboardingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', padding: 20,
  },
  onboardingCard: { backgroundColor: colors.ivoryPale, borderRadius: 24, width: '100%', overflow: 'hidden' },
  onboardingSlide: { padding: 28, alignItems: 'center', gap: 14, minHeight: 270, justifyContent: 'center' },
  onboardingSlide0: { backgroundColor: colors.bordeaux },
  onboardingLogoText: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 42, color: colors.ivory, letterSpacing: 2 },
  onboardingTagline: { fontFamily: 'DMSans_300Light', fontSize: 14, color: colors.terraPale, fontStyle: 'italic' },
  onboardingSlide0Desc: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: 'rgba(245,239,224,0.8)', textAlign: 'center', lineHeight: 22 },
  onboardingTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 20, color: colors.bordeaux, textAlign: 'center' },
  onboardingDesc: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.textMid, textAlign: 'center', lineHeight: 22 },
  onboardingDescSmall: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted, textAlign: 'center', lineHeight: 18, marginTop: 4 },
  onboardingFeatureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  onboardingFeatureIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: colors.terra + '18', alignItems: 'center', justifyContent: 'center' },
  onboardingFeatureTitle: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.bordeaux, marginBottom: 2 },
  onboardingFeatureDesc: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted, lineHeight: 17 },
  onboardingProposeBubble: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.terra, alignItems: 'center', justifyContent: 'center' },
  onboardingLevelRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.white, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.border },
  onboardingLevelEmoji: { fontSize: 20 },
  onboardingLevelNom: { fontFamily: 'DMSans_500Medium', fontSize: 14, flex: 1 },
  onboardingLevelPts: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted },
  onboardingDots: { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingVertical: 12 },
  onboardingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  onboardingDotActive: { backgroundColor: colors.bordeaux, width: 20 },
  onboardingBtns: { gap: 8, paddingHorizontal: 24, paddingBottom: 24, alignItems: 'center' },
  onboardingNextBtn: { backgroundColor: colors.bordeaux, borderRadius: 14, paddingVertical: 14, alignItems: 'center', width: '100%' },
  onboardingNextText: { fontFamily: 'DMSans_500Medium', color: colors.ivory, fontSize: 15 },
  onboardingSkipBtn: { paddingVertical: 6 },
  onboardingSkipText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted },
  // Login prompt
  loginPromptOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: 28,
  },
  loginPromptCard: { backgroundColor: colors.ivoryPale, borderRadius: 24, padding: 28, alignItems: 'center', gap: 12, width: '100%' },
  loginPromptTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 22, color: colors.bordeaux },
  loginPromptDesc: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMid, textAlign: 'center', lineHeight: 20 },
  loginPromptBtn: { backgroundColor: colors.bordeaux, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 24, alignItems: 'center', width: '100%', marginTop: 4 },
  loginPromptBtnText: { fontFamily: 'DMSans_500Medium', color: colors.ivory, fontSize: 14 },
  loginPromptSkip: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted, paddingVertical: 4 },
  // Propose suggestions
  proposeSuggestList: {
    backgroundColor: colors.white, borderRadius: 10, borderWidth: 1, borderColor: colors.border,
    overflow: 'hidden', marginTop: 4,
  },
  proposeSuggestItem: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  proposeSuggestItemBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  proposeSuggestName: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.bordeaux },
  proposeSuggestAddr: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted, marginTop: 1 },
  // Event markers
  eventPin: { alignItems: 'center' },
  eventBubble: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#4A7FA5',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#fff',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.28, shadowRadius: 4, elevation: 5,
  },
  eventBubbleSelected: { width: 44, height: 44, borderRadius: 22 },
  eventTail: {
    width: 0, height: 0,
    borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 7,
    borderLeftColor: 'transparent', borderRightColor: 'transparent',
    borderTopColor: '#4A7FA5', marginTop: -1,
  },
  // Event detail modal
  eventModalIcon: {
    width: 36, height: 36, borderRadius: 10, backgroundColor: '#4A7FA5',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  eventModalTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 17, color: colors.bordeaux, lineHeight: 23 },
  eventModalRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  eventModalText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMid, flex: 1, lineHeight: 19 },
  eventModalFull: { backgroundColor: colors.ivoryPale, borderRadius: 12, padding: 12, alignItems: 'center', marginTop: 4 },
  eventModalFullText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted },
  eventModalJoin: { backgroundColor: colors.bordeaux, borderRadius: 14, padding: 14, alignItems: 'center', marginTop: 4, flexDirection: 'row', justifyContent: 'center' },
  eventModalJoinText: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.ivory },
  eventModalCancel: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#fff3e0', borderRadius: 14, padding: 13, marginTop: 4, borderWidth: 1, borderColor: '#ffcc80' },
  eventModalCancelText: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: '#e65100' },
  // Filter modal
  filterSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: colors.ivoryPale, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: SCREEN_H * 0.85,
    shadowColor: '#000', shadowOffset: { width: 0, height: -3 }, shadowOpacity: 0.12, shadowRadius: 12, elevation: 20,
  },
  filterSheetTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: colors.bordeaux, flex: 1, textAlign: 'center' },
  filterSheetReset: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.textMuted },
  filterSectionLabel: { fontFamily: 'DMSans_500Medium', fontSize: 10, letterSpacing: 0.12, color: colors.textMuted, marginBottom: 12, marginTop: 8 },
  filterChipsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
  filterEquipChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 10, paddingHorizontal: 14,
    backgroundColor: colors.white, borderRadius: 50, borderWidth: 1, borderColor: colors.border,
  },
  filterEquipChipActive: { backgroundColor: colors.bordeaux, borderColor: colors.bordeaux },
  filterEquipLabel: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.bordeaux },
  filterCTA: { backgroundColor: colors.bordeaux, borderRadius: 16, paddingVertical: 16, alignItems: 'center' },
  filterCTAText: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: colors.ivory },
  filterActiveDot: { position: 'absolute', top: -2, right: -2, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.terra },
});
