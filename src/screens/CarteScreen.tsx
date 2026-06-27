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
import MapView, { Marker, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import { mapNavigation } from '../lib/mapNavigation';

const SCREEN_H = Dimensions.get('window').height;
const SCREEN_W = Dimensions.get('window').width;

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
  bar:         { icon: 'wine-outline',       markerIcon: 'wine',         label: 'Bar',           color: '#8B5E3C' },
  autre:       { icon: 'location-outline',   markerIcon: 'location',     label: 'Autre',         color: '#7A7A7A' },
};

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
};
type LieuFull = Lieu & {
  departement: string | null; description: string | null; tel: string | null;
  horaires: string | null; site_web: string | null;
  note_moyenne: number | null; nb_avis: number | null;
  chiens_salle: boolean | null; chiens_terrasse: boolean | null; espace_dedie: boolean | null;
  eau: boolean | null; gamelles: boolean | null; chiens_laches: boolean | null; chiens_laisse: boolean | null;
  petits_chiens: boolean | null; moyens_chiens: boolean | null; grands_chiens: boolean | null;
};
type PhotoFiche = { id: string; url: string; likeCount: number; likedByMe: boolean; authorUsername: string | null; nomChien: string | null };
type FicheAvisItem = { id: string; note: number; commentaire: string | null; created_at: string; prenom: string; username: string | null };
type CityResult = { nom: string; lat: number; lng: number };

export default function CarteScreen() {
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
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [ficheAvis, setFicheAvis] = useState<FicheAvisItem[]>([]);
  const [proposeModal, setProposeModal] = useState(false);
  const [proposeNom, setProposeNom] = useState('');
  const [proposeAdresse, setProposeAdresse] = useState('');
  const [proposeVille, setProposeVille] = useState('');
  const [proposeCat, setProposeCat] = useState('restaurant');
  const [proposeTel, setProposeTel] = useState('');
  const [proposeSite, setProposeSite] = useState('');
  const [proposeDesc, setProposeDesc] = useState('');
  const [proposeLat, setProposeLat] = useState<number | null>(null);
  const [proposeLng, setProposeLng] = useState<number | null>(null);
  const [proposeGeoLoading, setProposeGeoLoading] = useState(false);
  const [proposeLoading, setProposeLoading] = useState(false);
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
  const [pendingPhotoUri, setPendingPhotoUri] = useState<string | null>(null);
  const [aiMode, setAiMode] = useState(false);
  const [aiResults, setAiResults] = useState<{ lieu: Lieu; raison: string }[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const markerResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const proposeSuggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
            setSelectedLieu(null); setPhotos([]); setFicheAvis([]); setFichePhotoIdx(0); setFavListe(null); setMyAvis(null); sheetPanY.setValue(0);
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
  }, []));

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({});
        setUserLat(loc.coords.latitude);
        setUserLng(loc.coords.longitude);
        const r: Region = { latitude: loc.coords.latitude, longitude: loc.coords.longitude, latitudeDelta: 0.1, longitudeDelta: 0.1 };
        setRegion(r);
        mapRef.current?.animateToRegion(r, 800);
        fetchLieux(r, null);
      } else {
        fetchLieux(region, null);
      }
    })();
  }, []);

  async function fetchLieux(r: Region, cat: string | null) {
    setLoading(true);
    let query = supabase
      .from('lieux').select('id,nom,lat,lng,cat,ville,adresse,note_moyenne,nb_avis').eq('actif', true)
      .gte('lat', r.latitude - r.latitudeDelta).lte('lat', r.latitude + r.latitudeDelta)
      .gte('lng', r.longitude - r.longitudeDelta).lte('lng', r.longitude + r.longitudeDelta)
      .limit(200);
    if (cat) query = (query as any).eq('cat', cat);
    const { data } = await query;
    setLieux(data || []);
    setLoading(false);
  }

  function onCatPress(cat: string | null) {
    setActiveCat(cat);
    setFavFilter(null);
    setAutresOpen(false);
    fetchLieux(region, cat);
  }

  function onAutresCatPress(cat: string) {
    setActiveCat(cat);
    setFavFilter(null);
    setAutresOpen(false);
    fetchLieux(region, cat);
  }

  async function onFavFilterPress(liste: string) {
    setAutresOpen(false);
    if (favFilter === liste) {
      setFavFilter(null);
      fetchLieux(region, activeCat);
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
    mapRef.current?.animateToRegion({ latitude: lieu.lat, longitude: lieu.lng, latitudeDelta: 0.02, longitudeDelta: 0.02 }, 600);

    let lieuData: any = null, favData: any = null, myAvisData: any = null, photosRaw: any[] = [], avisRaw: any[] = [];
    try {
      const results = await Promise.all([
        supabase.from('lieux').select('*').eq('id', lieu.id).single(),
        userId ? supabase.from('favoris').select('id,liste').eq('user_id', userId).eq('lieu_id', lieu.id).maybeSingle() : Promise.resolve({ data: null }),
        userId ? supabase.from('avis').select('id,note,commentaire').eq('user_id', userId).eq('lieu_id', lieu.id).maybeSingle() : Promise.resolve({ data: null }),
        supabase.from('photos').select('id,url,user_id,nom_chien').eq('lieu_id', lieu.id).eq('validee', true).order('created_at', { ascending: true }).limit(20),
        supabase.from('avis').select('id,note,commentaire,created_at,user_id').eq('lieu_id', lieu.id).order('created_at', { ascending: false }).limit(8),
      ]);
      lieuData = results[0].data;
      favData = results[1];
      myAvisData = results[2];
      photosRaw = results[3].data || [];
      avisRaw = results[4].data || [];
    } catch (e) {
      setSheetLoading(false);
      return;
    }

    if (lieuData) setSelectedLieu(lieuData);
    const favRow = (favData as any)?.data;
    setFavListe(favRow ? (favRow.liste || 'favori') : null);
    const myAvisRow = (myAvisData as any)?.data;
    setMyAvis(myAvisRow ? { note: myAvisRow.note, commentaire: myAvisRow.commentaire } : null);

    // Photos avec likes + auteur
    const photoIds = (photosRaw || []).map((p: any) => p.id);
    if (photoIds.length > 0) {
      const photoUserIds = [...new Set((photosRaw || []).map((p: any) => p.user_id).filter(Boolean))];
      const [{ data: allLikes }, { data: myLikes }, { data: photoAuthors }] = await Promise.all([
        supabase.from('photo_likes').select('photo_id').in('photo_id', photoIds),
        userId ? supabase.from('photo_likes').select('photo_id').in('photo_id', photoIds).eq('user_id', userId) : Promise.resolve({ data: [] }),
        photoUserIds.length > 0 ? supabase.from('profils').select('id,username').in('id', photoUserIds) : Promise.resolve({ data: [] }),
      ]);
      const countMap: Record<string, number> = {};
      (allLikes || []).forEach((l: any) => { countMap[l.photo_id] = (countMap[l.photo_id] || 0) + 1; });
      const mySet = new Set((myLikes || []).map((l: any) => l.photo_id));
      const authorMap: Record<string, string | null> = {};
      (photoAuthors || []).forEach((p: any) => { authorMap[p.id] = p.username || null; });
      setPhotos((photosRaw || []).map((p: any) => ({
        id: p.id, url: p.url,
        likeCount: countMap[p.id] || 0,
        likedByMe: mySet.has(p.id),
        authorUsername: authorMap[p.user_id] || null,
        nomChien: p.nom_chien || null,
      })));
    } else {
      setPhotos([]);
    }

    // Avis + profils séparément (comme le site web)
    if ((avisRaw || []).length > 0) {
      const uids = [...new Set((avisRaw || []).map((a: any) => a.user_id))];
      const { data: profils } = await supabase.from('profils').select('id,prenom,username').in('id', uids);
      const profilMap: Record<string, { prenom: string; username: string | null }> = {};
      (profils || []).forEach((p: any) => { profilMap[p.id] = { prenom: p.prenom || 'Membre', username: p.username || null }; });
      setFicheAvis((avisRaw || []).map((a: any) => ({
        id: a.id, note: a.note, commentaire: a.commentaire, created_at: a.created_at,
        prenom: profilMap[a.user_id]?.prenom || 'Membre',
        username: profilMap[a.user_id]?.username || null,
      })));
    }

    setSheetLoading(false);
  }

  function closeFiche() {
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
    setPhotos(prev => prev.map(p => {
      if (p.id !== photoId) return p;
      return { ...p, likedByMe: !p.likedByMe, likeCount: p.likedByMe ? p.likeCount - 1 : p.likeCount + 1 };
    }));
    const isLiked = !photos.find(p => p.id === photoId)?.likedByMe; // read PRE-update state (toggled already above)
    if (isLiked) {
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
      if (!l.ville) return;
      if (!villeMap[l.ville]) villeMap[l.ville] = { lat: l.lat, lng: l.lng, count: 1 };
      else {
        const v = villeMap[l.ville];
        v.lat = (v.lat * v.count + l.lat) / (v.count + 1);
        v.lng = (v.lng * v.count + l.lng) / (v.count + 1);
        v.count++;
      }
    });
    setCityResults(Object.entries(villeMap).slice(0, 3).map(([nom, { lat, lng }]) => ({ nom, lat, lng })));
    setSearchResults(lieuData || []);
    setShowResults(true);
  }

  function onSearchChange(text: string) {
    setSearchQuery(text);
    setAiResults([]);
    if (aiMode) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => searchLieux(text), 300);
    if (text.length < 2) { setSearchResults([]); setCityResults([]); setShowResults(false); }
  }

  async function triggerAiSearch() {
    if (!searchQuery.trim()) return;
    Keyboard.dismiss();
    setAiLoading(true);
    setShowResults(false);
    setAiResults([]);
    try {
      const { data, error } = await supabase.functions.invoke('ai-search', {
        body: {
          query: searchQuery.trim(),
          userLat: region.latitude,
          userLng: region.longitude,
          delta: Math.max(region.latitudeDelta, 0.15),
        },
      });
      if (!error && data?.results?.length) {
        setAiResults(data.results);
      } else {
        setAiResults([]);
      }
    } catch { setAiResults([]); }
    setAiLoading(false);
  }

  function toggleAiMode() {
    const next = !aiMode;
    setAiMode(next);
    setSearchQuery('');
    setSearchResults([]);
    setCityResults([]);
    setShowResults(false);
    setAiResults([]);
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
    fetchLieux(r, activeCat);
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

  async function uploadPhoto() {
    if (!userId) { showLoginPrompt(); return; }
    if (!selectedLieu) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission requise', "Autorise l'accès à ta galerie dans les réglages."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7, allowsEditing: true, aspect: [4, 3] });
    if (result.canceled) return;
    setPendingPhotoUri(result.assets[0].uri);
    setDogTagInput(myDogName || '');
    setDogTagModal(true);
  }

  async function doUploadPhoto(nomChien: string | null) {
    if (!pendingPhotoUri || !userId || !selectedLieu) return;
    setDogTagModal(false);
    setPhotoUploading(true);
    const uri = pendingPhotoUri;
    setPendingPhotoUri(null);
    const ext = uri.split('.').pop()?.toLowerCase() === 'png' ? 'png' : 'jpg';
    const contentType = ext === 'png' ? 'image/png' : 'image/jpeg';
    const path = `${userId}/${selectedLieu.id}-${Date.now()}.${ext}`;
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    const { error: upErr } = await supabase.storage.from('lieu-photos').upload(path, decode(base64), { contentType });
    if (upErr) { setPhotoUploading(false); Alert.alert('Erreur', upErr.message); return; }
    const { data: { publicUrl } } = supabase.storage.from('lieu-photos').getPublicUrl(path);
    await supabase.from('photos').insert({ lieu_id: selectedLieu.id, user_id: userId, url: publicUrl, nom_chien: nomChien || null });
    setPhotoUploading(false);
    Alert.alert('Merci !', 'Ta photo sera visible après validation par notre équipe.');
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
    setMyAvis({ note: avisNote, commentaire: avisComment.trim() || null });
    setAvisModal(false); setAvisNote(0); setAvisComment('');
    const { data } = await supabase.from('lieux').select('*').eq('id', selectedLieu.id).single();
    if (data) setSelectedLieu(data);
    // Rafraîchir la liste des avis
    const { data: avisRaw } = await supabase.from('avis').select('id,note,commentaire,created_at,user_id').eq('lieu_id', selectedLieu.id).order('created_at', { ascending: false }).limit(8);
    if ((avisRaw || []).length > 0) {
      const uids = [...new Set((avisRaw || []).map((a: any) => a.user_id))];
      const { data: profils } = await supabase.from('profils').select('id,prenom,username').in('id', uids);
      const pm: Record<string, any> = {};
      (profils || []).forEach((p: any) => { pm[p.id] = p; });
      setFicheAvis((avisRaw || []).map((a: any) => ({ id: a.id, note: a.note, commentaire: a.commentaire, created_at: a.created_at, prenom: pm[a.user_id]?.prenom || 'Membre', username: pm[a.user_id]?.username || null })));
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

  async function handleMapLongPress(e: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) {
    requireAuth(async () => {
      const { latitude, longitude } = e.nativeEvent.coordinate;
      setProposeNom(''); setProposeAdresse(''); setProposeVille('');
      setProposeCat('restaurant'); setProposeTel(''); setProposeSite(''); setProposeDesc('');
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

  async function submitPropose() {
    if (!userId) { showLoginPrompt(); return; }
    if (!proposeNom.trim() || !proposeVille.trim()) return;
    setProposeLoading(true);
    const { error } = await supabase.from('lieux').insert({
      nom: proposeNom.trim(), adresse: proposeAdresse.trim() || null, ville: proposeVille.trim(),
      cat: proposeCat, tel: proposeTel.trim() || null, site_web: proposeSite.trim() || null,
      description: proposeDesc.trim() || null,
      lat: proposeLat ?? region.latitude,
      lng: proposeLng ?? region.longitude,
      actif: false,
      submitted_by: userId,
      ...proposeAmenities,
    });
    if (!error && userId) {
      const { data: profilData } = await supabase.from('profils').select('points').eq('id', userId).single();
      if (profilData) {
        await supabase.from('profils').update({ points: (profilData.points || 0) + 5 }).eq('id', userId);
      }
    }
    setProposeLoading(false);
    if (error) { Alert.alert('Erreur', error.message); return; }
    setProposeModal(false);
    setProposeNom(''); setProposeAdresse(''); setProposeVille('');
    setProposeCat('restaurant'); setProposeTel(''); setProposeSite(''); setProposeDesc('');
    setProposeLat(null); setProposeLng(null);
    setProposeAmenities({ chiens_salle: false, chiens_terrasse: false, espace_dedie: false, eau: false, gamelles: false, chiens_laches: false, chiens_laisse: false, petits_chiens: false, moyens_chiens: false, grands_chiens: false });
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

  const FICHE_HEADER_H = 210;

  const FAV_LISTS: { key: string; label: string; icon: IoniconsName; color: string }[] = [
    { key: 'favori',      label: 'Mes favoris',  icon: 'heart',           color: '#E05070' },
    { key: 'a_tester',   label: 'À tester',      icon: 'bookmark',        color: colors.bordeaux },
    { key: 'deja_teste', label: 'Déjà testé',    icon: 'checkmark-circle', color: '#5A9E6F' },
  ];

  const clusterIndex = useMemo(() => {
    const index = new Supercluster<{ lieu: Lieu }>({ radius: 50, maxZoom: 14 });
    index.load(lieux.map(l => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [l.lng, l.lat] },
      properties: { lieu: l },
    })));
    return index;
  }, [lieux]);

  const clusters = useMemo(() => {
    const zoom = Math.min(20, Math.max(0, Math.round(Math.log(360 / region.latitudeDelta) / Math.LN2)));
    const bbox: [number, number, number, number] = [
      region.longitude - region.longitudeDelta / 2,
      region.latitude - region.latitudeDelta / 2,
      region.longitude + region.longitudeDelta / 2,
      region.latitude + region.latitudeDelta / 2,
    ];
    return clusterIndex.getClusters(bbox, zoom);
  }, [clusterIndex, region]);

  function sortLieux(items: Lieu[]): Lieu[] {
    return [...items].sort((a, b) => {
      if (sortBy === 'note') return (b.note_moyenne ?? -1) - (a.note_moyenne ?? -1);
      if (userLat !== null && userLng !== null)
        return haversine(userLat, userLng, a.lat, a.lng) - haversine(userLat, userLng, b.lat, b.lng);
      return 0;
    });
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
      <>
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
            ) : (
              <View style={[styles.ficheHeaderPlaceholder, { backgroundColor: cfg.color }]}>
                <Ionicons name={cfg.icon} size={72} color="rgba(245,239,224,0.18)" />
              </View>
            )}

            {/* Compteur photos */}
            {photos.length > 1 && (
              <View style={styles.fichePhotoCounter}>
                <Text style={styles.fichePhotoCounterText}>{fichePhotoIdx + 1}/{photos.length}</Text>
              </View>
            )}

            {/* Bouton ajouter photo (haut gauche) */}
            <TouchableOpacity style={styles.ficheBtnAddPhoto} onPress={uploadPhoto} disabled={photoUploading}>
              {photoUploading
                ? <ActivityIndicator size="small" color="#fff" />
                : <Ionicons name="camera" size={16} color="#fff" />
              }
            </TouchableOpacity>

            {/* Bouton fermer (haut droite) */}
            <TouchableOpacity style={styles.ficheBtnClose} onPress={closeFiche}>
              <Ionicons name="close" size={18} color="#fff" />
            </TouchableOpacity>

            {/* Bouton favori (2e depuis la droite) */}
            <TouchableOpacity style={styles.ficheBtnFav} onPress={() => setFavModal(v => !v)} disabled={favLoading}>
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

            {/* Gradient bas : badge catégorie + nom + localisation | auteur + like */}
            <View style={styles.ficheHeaderGradient}>
              <View style={{ flex: 1 }}>
                <View style={[styles.catBadge, { backgroundColor: cfg.color + '55', alignSelf: 'flex-start', marginBottom: 4 }]}>
                  <Ionicons name={cfg.icon} size={11} color="#fff" />
                  <Text style={[styles.catLabel, { color: '#fff' }]}>{cfg.label}</Text>
                </View>
                <Text style={styles.ficheHeaderNom} numberOfLines={1}>{selectedLieu.nom}</Text>
                <Text style={styles.ficheHeaderLoc} numberOfLines={1}>
                  {[selectedLieu.adresse, selectedLieu.ville].filter(Boolean).join(' · ')}
                </Text>
              </View>
              {currentPhoto && (
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  {currentPhoto.nomChien && (
                    <View style={styles.dogTagBadge}>
                      <Text style={styles.dogTagText}>🐾 {currentPhoto.nomChien}</Text>
                    </View>
                  )}
                  {currentPhoto.authorUsername && (
                    <Text style={styles.fichePhotoAuthor}>@{currentPhoto.authorUsername}</Text>
                  )}
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
                </View>
              )}
            </View>
          </View>

          {/* ====== BODY ====== */}
          <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false} onScrollBeginDrag={() => setFavModal(false)}>
            {sheetLoading ? (
              <ActivityIndicator color={colors.terra} style={{ marginVertical: 24 }} />
            ) : (
              <>
                {selectedLieu.note_moyenne ? (
                  <View style={styles.ratingRow}>
                    {[1,2,3,4,5].map(i => (
                      <Ionicons key={i} name={i <= Math.round(selectedLieu.note_moyenne!) ? 'star' : 'star-outline'} size={14} color={colors.terra} />
                    ))}
                    <Text style={styles.ratingScore}>{selectedLieu.note_moyenne.toFixed(1)}</Text>
                    <Text style={styles.ratingCount}>({selectedLieu.nb_avis || 0} avis)</Text>
                  </View>
                ) : null}

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

                {selectedLieu.description ? <Text style={styles.description}>{selectedLieu.description}</Text> : null}

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
                            <Text style={styles.ficheAvisAuthor}>{a.prenom}</Text>
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
                      </View>
                    ))}
                  </>
                )}
              </>
            )}
          </ScrollView>
        </Animated.View>
      </>
    );
  }

  const totalSearchResults = cityResults.length + searchResults.length;

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={region}
        onRegionChangeComplete={r => { setRegion(r); if (!favFilter) fetchLieux(r, activeCat); }}
        onLongPress={handleMapLongPress}
        showsUserLocation
        showsMyLocationButton={false}
      >
        {clusters.map((cluster: any) => {
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
                  const lats = leaves.map((f: any) => f.geometry.coordinates[1]);
                  const lngs = leaves.map((f: any) => f.geometry.coordinates[0]);
                  const minLat = Math.min(...lats); const maxLat = Math.max(...lats);
                  const minLng = Math.min(...lngs); const maxLng = Math.max(...lngs);
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
                  <Ionicons name={cfg.markerIcon} size={iconSize} color="#fff" />
                </View>
                <View style={[styles.markerTail, { borderTopColor: cfg.color }, isSelected && { borderTopWidth: 9, borderLeftWidth: 6, borderRightWidth: 6 }]} />
              </View>
            </Marker>
          );
        })}
      </MapView>

      {/* List view */}
      {listView && (
        <View style={styles.listViewContainer}>
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
            <Text style={styles.listCount}>{lieux.length} lieu{lieux.length !== 1 ? 'x' : ''}</Text>
          </View>

          {loading ? (
            <ActivityIndicator color={colors.terra} style={{ marginTop: 48 }} />
          ) : lieux.length === 0 ? (
            <View style={styles.listEmpty}>
              <Ionicons name="paw-outline" size={44} color={colors.border} />
              <Text style={styles.listEmptyText}>Aucun lieu dans cette zone</Text>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
              {[...new Set(lieux.map(l => l.cat))]
                .sort((a, b) => (CAT_CONFIG[a]?.label || '').localeCompare(CAT_CONFIG[b]?.label || '', 'fr'))
                .map(cat => {
                  const cfg = CAT_CONFIG[cat] || CAT_CONFIG.autre;
                  const catLieux = sortLieux(lieux.filter(l => l.cat === cat));
                  const expanded = expandedCats.includes(cat);
                  return (
                    <View key={cat}>
                      <TouchableOpacity
                        style={styles.accordionHeader}
                        onPress={() => setExpandedCats(prev =>
                          expanded ? prev.filter(c => c !== cat) : [...prev, cat]
                        )}
                        activeOpacity={0.7}
                      >
                        <View style={[styles.accordionHeaderIcon, { backgroundColor: cfg.color + '22' }]}>
                          <Ionicons name={cfg.icon} size={16} color={cfg.color} />
                        </View>
                        <Text style={styles.accordionHeaderLabel}>{cfg.label}</Text>
                        <View style={[styles.accordionHeaderBadge, { backgroundColor: cfg.color + '18' }]}>
                          <Text style={[styles.accordionHeaderCount, { color: cfg.color }]}>{catLieux.length}</Text>
                        </View>
                        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} style={{ marginLeft: 'auto' }} />
                      </TouchableOpacity>
                      {expanded && catLieux.map((item, idx) => {
                        const dist = (userLat !== null && userLng !== null)
                          ? haversine(userLat, userLng, item.lat, item.lng)
                          : null;
                        return (
                          <TouchableOpacity
                            key={item.id}
                            style={[styles.listItem, idx < catLieux.length - 1 && styles.listSep]}
                            onPress={() => openFiche(item)}
                            activeOpacity={0.7}
                          >
                            <View style={{ flex: 1, gap: 2 }}>
                              <Text style={styles.listItemNom} numberOfLines={1}>{item.nom}</Text>
                              <Text style={styles.listItemVille} numberOfLines={1}>{[item.adresse, item.ville].filter(Boolean).join(' · ')}</Text>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                {item.note_moyenne ? (
                                  <>
                                    <Ionicons name="star" size={11} color={colors.terra} />
                                    <Text style={styles.listItemNote}>{item.note_moyenne.toFixed(1)}</Text>
                                    <Text style={styles.listItemMeta}>({item.nb_avis} avis)</Text>
                                  </>
                                ) : (
                                  <Text style={styles.listItemMeta}>Pas encore d'avis</Text>
                                )}
                                {dist !== null && (
                                  <Text style={styles.listItemMeta}>· {dist < 1 ? `${Math.round(dist * 1000)} m` : `${dist.toFixed(1)} km`}</Text>
                                )}
                              </View>
                            </View>
                            <Ionicons name="chevron-forward" size={15} color={colors.textMuted} />
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  );
                })}
            </ScrollView>
          )}
        </View>
      )}

      {/* Search + filters overlay */}
      <View style={styles.topOverlay} pointerEvents="box-none">
        <View style={[styles.searchContainer, aiMode && styles.searchContainerAi]} pointerEvents="auto">
          {aiMode
            ? <Ionicons name="sparkles" size={16} color={colors.terra} style={{ marginLeft: 12 }} />
            : <Ionicons name="search" size={16} color={colors.textMuted} style={{ marginLeft: 12 }} />
          }
          <TextInput
            style={styles.searchInput}
            placeholder={aiMode ? 'Décris ce que tu cherches…' : 'Lieu, ville, quartier…'}
            placeholderTextColor={aiMode ? colors.terra + '99' : colors.textMuted}
            value={searchQuery}
            onChangeText={onSearchChange}
            onFocus={() => { if (selectedLieu) closeFiche(); if (!aiMode && (searchResults.length > 0 || cityResults.length > 0)) setShowResults(true); }}
            returnKeyType="search"
            onSubmitEditing={() => { if (aiMode) triggerAiSearch(); }}
          />
          {aiLoading
            ? <ActivityIndicator size="small" color={colors.terra} style={{ marginRight: 6 }} />
            : searchQuery.length > 0
              ? <TouchableOpacity onPress={() => { setSearchQuery(''); setSearchResults([]); setCityResults([]); setShowResults(false); setAiResults([]); }}>
                  <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              : null
          }
          <TouchableOpacity
            style={[styles.aiToggleBtn, aiMode && styles.aiToggleBtnActive]}
            onPress={toggleAiMode}
          >
            <Text style={[styles.aiToggleText, aiMode && styles.aiToggleTextActive]}>✦ IA</Text>
          </TouchableOpacity>
          <View style={styles.searchDivider} />
          <TouchableOpacity style={styles.listToggleBtn} onPress={() => setListView(v => !v)}>
            <Ionicons name={listView ? 'map-outline' : 'list-outline'} size={18} color={listView ? colors.terra : colors.bordeaux} />
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
                <Ionicons name={c.icon} size={13} color={active ? '#fff' : (catCfg?.color || colors.bordeaux)} />
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
                  <Ionicons name={c.icon} size={16} color={active ? catCfg.color : colors.textMuted} />
                  <Text style={[styles.autresItemText, active && { color: catCfg.color, fontFamily: 'DMSans_500Medium' }]}>{c.label}</Text>
                  {active && <Ionicons name="checkmark" size={14} color={catCfg.color} />}
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {showResults && totalSearchResults > 0 && !aiMode && (
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

        {aiMode && aiResults.length > 0 && (
          <View style={styles.resultsDropdown} pointerEvents="auto">
            <View style={styles.aiResultsHeader}>
              <Text style={styles.aiResultsHeaderText}>✦ Suggestions IA</Text>
            </View>
            {aiResults.map((r, idx) => {
              const rCfg = CAT_CONFIG[r.lieu.cat] || CAT_CONFIG.autre;
              return (
                <TouchableOpacity
                  key={r.lieu.id}
                  style={[styles.resultItem, idx < aiResults.length - 1 && styles.resultItemBorder]}
                  onPress={() => { setAiResults([]); onSelectLieu(r.lieu); }}
                >
                  <View style={[styles.resultIconWrap, { backgroundColor: rCfg.color + '22' }]}>
                    <Ionicons name={rCfg.icon} size={16} color={rCfg.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.resultNom} numberOfLines={1}>{r.lieu.nom}</Text>
                    <Text style={styles.aiResultRaison} numberOfLines={2}>{r.raison}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {aiMode && !aiLoading && aiResults.length === 0 && searchQuery.length > 2 && (
          <View pointerEvents="auto">
            <TouchableOpacity style={styles.aiSearchHint} onPress={triggerAiSearch}>
              <Text style={styles.aiSearchHintText}>Appuyer pour rechercher avec l'IA</Text>
              <Ionicons name="arrow-forward" size={14} color={colors.terra} />
            </TouchableOpacity>
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

      <TouchableOpacity style={styles.proposeBtn} onPress={() => requireAuth(() => setProposeModal(true))}>
        <Ionicons name="add" size={24} color={colors.ivory} />
      </TouchableOpacity>

      {showPointsAnim && (
        <Animated.View
          style={[styles.pointsPopup, { opacity: pointsAnimOp, transform: [{ translateY: pointsAnimY }] }]}
          pointerEvents="none"
        >
          <Text style={styles.pointsPopupText}>+5 pts 🐾</Text>
        </Animated.View>
      )}

      {renderSheet()}

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
                <Text style={styles.proposeLabel}>Catégorie *</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {CATEGORIES.filter(c => c.key !== null).map(c => {
                    const catCfg = CAT_CONFIG[c.key!];
                    const active = proposeCat === c.key;
                    return (
                      <TouchableOpacity key={c.key!} style={[styles.catPill, active && { backgroundColor: catCfg.color, borderColor: catCfg.color }]} onPress={() => setProposeCat(c.key!)}>
                        <Ionicons name={c.icon} size={13} color={active ? '#fff' : catCfg.color} />
                        <Text style={[styles.catPillLabel, active && styles.catPillLabelActive]}>{c.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
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
                  <View style={styles.geoConfirm}>
                    <Ionicons name="checkmark-circle" size={14} color="#5A9E6F" />
                    <Text style={styles.geoConfirmText}>Position trouvée : {proposeLat.toFixed(4)}, {proposeLng.toFixed(4)}</Text>
                  </View>
                ) : (
                  <Text style={styles.geoHint}>Utilise ta position GPS ou cherche l'adresse pour un emplacement précis sur la carte.</Text>
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

              <TouchableOpacity style={[styles.avisSubmit, (!proposeNom.trim() || !proposeVille.trim() || proposeLoading) && styles.avisSubmitDisabled]} onPress={submitPropose} disabled={!proposeNom.trim() || !proposeVille.trim() || proposeLoading}>
                {proposeLoading ? <ActivityIndicator color={colors.ivory} /> : <Text style={styles.avisSubmitText}>Soumettre le lieu</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Modal compléter la fiche */}
      <Modal visible={enrichModal} transparent animationType="slide">
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[styles.modalCard, { maxHeight: SCREEN_H * 0.85 }]}>
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
        </KeyboardAvoidingView>
      </Modal>

      {/* Modal laisser un avis */}
      <Modal visible={avisModal} transparent animationType="slide">
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalCard}>
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
      </Modal>

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
                <Text style={styles.onboardingTitle}>The Pack a besoin de toi !</Text>
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
                    ['🐾', 'Explorateur', '0 pts',   '#546E7A'],
                    ['🥈', 'Silver',      '50 pts',  '#8E8E93'],
                    ['🥇', 'Gold',        '200 pts', '#C4693A'],
                    ['💎', 'Platinum',    '500 pts', '#5A7FA5'],
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

      {/* Dog tag modal */}
      <Modal visible={dogTagModal} transparent animationType="slide">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <TouchableOpacity style={styles.feedbackOverlay} activeOpacity={1} onPress={() => doUploadPhoto(null)}>
            <TouchableOpacity style={styles.dogTagCard} activeOpacity={1} onPress={() => {}}>
              <Text style={styles.dogTagModalTitle}>Ton chien est sur la photo ? 🐾</Text>
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
              <TouchableOpacity
                style={styles.dogTagSubmit}
                onPress={() => doUploadPhoto(dogTagInput.trim() || null)}
              >
                <Text style={styles.dogTagSubmitText}>Publier la photo</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => doUploadPhoto(null)} style={{ alignItems: 'center', paddingVertical: 8 }}>
                <Text style={styles.dogTagSkip}>Passer</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          </TouchableOpacity>
        </KeyboardAvoidingView>
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
  searchContainer: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.white,
    borderRadius: 14, marginHorizontal: 12, borderWidth: 1, borderColor: colors.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 6, elevation: 4,
  },
  searchContainerAi: { borderColor: colors.terra, borderWidth: 1.5 },
  searchInput: { flex: 1, height: 44, paddingHorizontal: 10, fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.bordeaux },
  aiToggleBtn: {
    marginHorizontal: 6, paddingHorizontal: 9, paddingVertical: 5,
    borderRadius: 10, borderWidth: 1.5, borderColor: colors.border,
  },
  aiToggleBtnActive: { backgroundColor: colors.terra, borderColor: colors.terra },
  aiToggleText: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.textMuted },
  aiToggleTextActive: { color: colors.ivory },
  aiResultsHeader: { paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  aiResultsHeaderText: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.terra, letterSpacing: 0.5 },
  aiResultRaison: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.terra, lineHeight: 16, marginTop: 1 },
  aiSearchHint: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.white, borderRadius: 14, marginHorizontal: 12,
    borderWidth: 1, borderColor: colors.terra + '55', paddingVertical: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 3, elevation: 2,
  },
  aiSearchHintText: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.terra },
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
    position: 'absolute', top: 118, right: 16, backgroundColor: colors.ivory,
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
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'transparent' },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: colors.ivoryPale,
    borderTopLeftRadius: 20, borderTopRightRadius: 20, minHeight: SCREEN_H * 0.45, maxHeight: SCREEN_H * 0.82,
    shadowColor: '#000', shadowOffset: { width: 0, height: -3 }, shadowOpacity: 0.12, shadowRadius: 10, elevation: 12,
  },
  handleArea: { position: 'absolute', top: 0, left: (SCREEN_W - 100) / 2, width: 100, paddingTop: 10, paddingBottom: 14, alignItems: 'center', zIndex: 30 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.55)' },
  // Header photo zone
  ficheHeader: { width: '100%', overflow: 'hidden', backgroundColor: colors.bordeaux, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  ficheHeaderPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  ficheHeaderGradient: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(20,8,8,0.50)',
    paddingHorizontal: 12, paddingVertical: 9, flexDirection: 'row', alignItems: 'flex-end', gap: 8,
  },
  ficheHeaderNom: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 17, color: '#fff', lineHeight: 22 },
  ficheHeaderLoc: { fontFamily: 'DMSans_300Light', fontSize: 11, color: 'rgba(245,239,224,0.65)', marginTop: 1 },
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
  geoConfirm: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  geoConfirmText: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: '#5A9E6F' },
  geoHint: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted, marginTop: 6, lineHeight: 16 },
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
    backgroundColor: colors.ivoryPale, paddingTop: 64,
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
  // Accordion
  accordionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  accordionHeaderIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  accordionHeaderLabel: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.bordeaux },
  accordionHeaderBadge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  accordionHeaderCount: { fontFamily: 'DMSans_500Medium', fontSize: 12 },
  listItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingVertical: 14,
    backgroundColor: colors.ivoryPale,
  },
  listItemNom: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.bordeaux },
  listItemVille: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted },
  listItemNote: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.terra },
  listItemMeta: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted },
  listSep: { borderBottomWidth: 1, borderBottomColor: colors.border },
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
});
