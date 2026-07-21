import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, Image, Modal, FlatList, Dimensions, Share,
} from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';

const PHOTO_CELL = (Dimensions.get('window').width - 32 - 8) / 3;
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import { useSession } from '../hooks/useSession';
import AuthGate from '../components/AuthGate';
import { savePushToken, sendPushNotification } from '../lib/notifications';
import { mapNavigation } from '../lib/mapNavigation';
import { AmbassadeurBadge } from '../components/AmbassadeurBadge';

const RACES = [
  'Affenpinscher', 'Airedale Terrier', 'Akita Américain', 'Akita Inu', 'Alaskan Malamute',
  'American Staffordshire Terrier (Amstaff)', 'Barbet', 'Basenji',
  'Basset Artésien Normand', 'Basset Fauve de Bretagne', 'Basset Hound', 'Beagle',
  'Beauceron', 'Berger Allemand', 'Berger Australien', 'Berger Belge Groenendael',
  'Berger Belge Malinois', 'Berger Belge Tervueren', 'Berger Blanc Suisse',
  'Berger de Brie (Briard)', 'Berger des Pyrénées', 'Berger des Shetland (Sheltie)', 'Berger Picard',
  'Bichon Frisé', 'Bichon Havanais', 'Bloodhound (Saint-Hubert)', 'Bobtail (Old English Sheepdog)',
  'Border Collie', 'Border Terrier', 'Boston Terrier',
  'Bouledogue Américain', 'Bouledogue Anglais', 'Bouledogue Français',
  'Bouvier Bernois', 'Bouvier des Flandres', 'Boxer', 'Braque Allemand (Drathaar)',
  "Braque d'Auvergne", 'Braque de Weimar', 'Braque Français', 'Braque Hongrois (Magyar Vizsla)',
  'Briquet Griffon Vendéen', 'Bull Mastiff', 'Bull Terrier', 'Cairn Terrier', 'Cane Corso', 'Caniche',
  'Carlin (Pug)', 'Cavalier King Charles', "Chien d'Eau Portugais (Cao de Agua)",
  "Chien de la Réunion (Bourbon Créole)", "Chien de Montagne de l'Atlas (Aidi)",
  'Chien Loup Tchécoslovaque', 'Chien Loup de Saarloos',
  'Chihuahua', 'Chow Chow', 'Clumber Spaniel', 'Cockapoo', 'Cocker Américain', 'Cocker Anglais',
  'Colley (Lassie)', 'Coton de Tuléar', 'Croisé', 'Dalmatien', 'Doberman',
  'Dogue Allemand (Great Dane)', 'Dogue de Bordeaux', 'English Springer Spaniel',
  'Épagneul Breton', 'Épagneul de Pont-Audemer', 'Épagneul Français', 'Épagneul Münsterlander', 'Épagneul Papillon',
  'Eurasier', 'Flat-Coated Retriever', 'Fox Terrier', 'Galgo Espagnol', 'Golden Retriever',
  'Grand Bleu de Gascogne', 'Griffon Belge', 'Griffon Bruxellois', 'Griffon Fauve de Bretagne', 'Griffon Nivernais',
  'Husky Sibérien', 'Irish Wolfhound (Lévrier Irlandais)', 'Jack Russell Terrier', "Kangal / Berger d'Anatolie",
  'Kelpie Australien', 'Labrador Retriever', 'Lagotto Romagnolo', 'Leonberg', 'Lévrier Afghan',
  'Lévrier (Greyhound / Whippet)', 'Lhasa Apso', 'Maltais', 'Mastiff Anglais',
  'Montagne des Pyrénées', 'Pékinois', 'Petit Basset Griffon Vendéen', 'Pinscher', 'Pointer',
  'Rhodesian Ridgeback', 'Rottweiler', 'Saint-Bernard', 'Saluki', 'Samoyède',
  'Schnauzer', 'Scottish Terrier', 'Setter Anglais', 'Setter Gordon', 'Setter Irlandais', 'Shar Pei',
  'Shiba Inu', 'Shih Tzu', 'Sloughi', 'Spitz (Poméranien)', 'Staffordshire Bull Terrier',
  'Teckel', 'Terre-Neuve', 'Terrier Irlandais', 'Tosa Inu',
  'Welsh Corgi Cardigan', 'Welsh Corgi Pembroke', 'Welsh Terrier',
  'Westie (West Highland White Terrier)', 'Yorkshire Terrier', 'Autre race',
];

const NIVEAUX = [
  { nom: 'Explorateur', emoji: '🌱', min: 0,    max: 499   },
  { nom: 'Silver',      emoji: '🌿', min: 500,  max: 1999  },
  { nom: 'Gold',        emoji: '🌳', min: 2000, max: 4999  },
  { nom: 'Platinum',    emoji: '🏆', min: 5000, max: 99999 },
];

function getNiveau(pts: number) {
  const idx = NIVEAUX.findIndex((n, i) => pts >= n.min && (i === NIVEAUX.length - 1 || pts < NIVEAUX[i + 1].min));
  const n = NIVEAUX[Math.max(0, idx)];
  const next = NIVEAUX[idx + 1] || null;
  const pct = next ? Math.min(100, ((pts - n.min) / (next.min - n.min)) * 100) : 100;
  return { n, next, pct };
}

const CAT_EMOJI: Record<string, string> = {
  restaurant: '🍽️', cafe: '☕', hotel: '🏨', parc: '🌳',
  plage: '🏖️', veterinaire: '🏥', toiletteur: '✂️', boutique: '🛍️', bar: '🍺', autre: '📍',
};

type Profil = {
  id: string; prenom: string | null; username: string | null; ville: string | null;
  nom_chien: string | null; race_chien: string | null; avatar_url: string | null;
  bio: string | null; points: number; ambassadeur?: boolean | null;
  notif_follow: boolean | null; notif_lieu_nearby: boolean | null; notif_messages: boolean | null; notif_suggestion_validee: boolean | null;
  instagram_url: string | null; tiktok_url: string | null;
};

type ExplorateurData = {
  id: string; nom: string; handle: string | null; bio: string | null;
  photo_profil_url: string | null; photo_banniere_url: string | null;
  instagram_url: string | null; tiktok_url: string | null;
  youtube_url: string | null; site_web: string | null;
};

function ExplorateurEditModal({ explorateur, userId, onClose, onSaved }: {
  explorateur: ExplorateurData; userId: string;
  onClose: () => void; onSaved: (e: ExplorateurData) => void;
}) {
  const [handle, setHandle] = useState(explorateur.handle || '');
  const [bio, setBio] = useState(explorateur.bio || '');
  const [instagram, setInstagram] = useState(explorateur.instagram_url || '');
  const [tiktok, setTiktok] = useState(explorateur.tiktok_url || '');
  const [youtube, setYoutube] = useState(explorateur.youtube_url || '');
  const [site, setSite] = useState(explorateur.site_web || '');
  const [profilUrl, setProfilUrl] = useState(explorateur.photo_profil_url || '');
  const [banniereUrl, setBanniereUrl] = useState(explorateur.photo_banniere_url || '');
  const [saving, setSaving] = useState(false);
  const [uploadingProfil, setUploadingProfil] = useState(false);
  const [uploadingBanniere, setUploadingBanniere] = useState(false);

  async function pickAndUpload(type: 'profil' | 'banniere') {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const aspect: [number, number] = type === 'profil' ? [1, 1] : [16, 9];
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect, quality: 0.85 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const ext = asset.uri.split('.').pop() || 'jpg';
    const path = `explorateurs/${type}_${userId}.${ext}`;
    const formData = new FormData();
    formData.append('file', { uri: asset.uri, name: `${type}.${ext}`, type: `image/${ext}` } as any);
    if (type === 'profil') setUploadingProfil(true); else setUploadingBanniere(true);
    const { error } = await supabase.storage.from('avatars').upload(path, formData, { upsert: true });
    if (error) { Alert.alert('Erreur', error.message); }
    else {
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      if (type === 'profil') setProfilUrl(data.publicUrl); else setBanniereUrl(data.publicUrl);
    }
    if (type === 'profil') setUploadingProfil(false); else setUploadingBanniere(false);
  }

  async function save() {
    setSaving(true);
    const update = {
      handle: handle.trim() || null,
      bio: bio.trim() || null,
      photo_profil_url: profilUrl || null,
      photo_banniere_url: banniereUrl || null,
      instagram_url: instagram.trim() || null,
      tiktok_url: tiktok.trim() || null,
      youtube_url: youtube.trim() || null,
      site_web: site.trim() || null,
    };
    const { error } = await supabase.from('explorateurs').update(update).eq('id', explorateur.id);
    setSaving(false);
    if (error) { Alert.alert('Erreur', error.message); return; }
    onSaved({ ...explorateur, ...update });
    onClose();
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={xStyles.container}>
        <View style={xStyles.header}>
          <Text style={xStyles.title}>Ma fiche Explorateur</Text>
          <TouchableOpacity onPress={onClose}><Ionicons name="close" size={22} color={colors.bordeaux} /></TouchableOpacity>
        </View>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 50 }}>

          {/* Bannière */}
          <Text style={xStyles.sectionLabel}>PHOTO DE BANNIÈRE</Text>
          <TouchableOpacity style={xStyles.banniereBox} onPress={() => pickAndUpload('banniere')} activeOpacity={0.85}>
            {banniereUrl
              ? <Image source={{ uri: banniereUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              : <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bordeaux }]} />}
            <View style={xStyles.banniereOverlay}>
              {uploadingBanniere
                ? <ActivityIndicator color={colors.ivory} />
                : <><Ionicons name="camera-outline" size={22} color={colors.ivory} /><Text style={xStyles.uploadLabel}>Changer la bannière</Text></>}
            </View>
          </TouchableOpacity>

          {/* Photo profil */}
          <Text style={xStyles.sectionLabel}>PHOTO DE PROFIL</Text>
          <TouchableOpacity style={xStyles.profilRow} onPress={() => pickAndUpload('profil')} activeOpacity={0.85}>
            {profilUrl
              ? <Image source={{ uri: profilUrl }} style={xStyles.profilThumb} />
              : <View style={[xStyles.profilThumb, { backgroundColor: colors.terra, alignItems: 'center', justifyContent: 'center' }]}>
                  <Ionicons name="person" size={28} color={colors.ivory} />
                </View>}
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={xStyles.profilChangeLabel}>{uploadingProfil ? 'Upload...' : 'Changer la photo de profil'}</Text>
              <Text style={xStyles.profilChangeSub}>Carré recommandé</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>

          {/* Infos */}
          <Text style={xStyles.sectionLabel}>MA FICHE</Text>
          {[
            { label: 'Handle / pseudo', value: handle, setter: setHandle, placeholder: '@moncompte', auto: 'none' as const },
            { label: 'Bio', value: bio, setter: setBio, placeholder: 'Raconte-toi en quelques lignes...', multi: true },
          ].map(f => (
            <View key={f.label} style={xStyles.fieldWrap}>
              <Text style={xStyles.fieldLabel}>{f.label}</Text>
              <TextInput
                style={[xStyles.input, f.multi && { height: 90, textAlignVertical: 'top', paddingTop: 10 }]}
                value={f.value} onChangeText={f.setter} placeholder={f.placeholder}
                placeholderTextColor={colors.textMuted} multiline={!!f.multi}
                autoCapitalize={f.auto || 'sentences'}
              />
            </View>
          ))}

          {/* Liens */}
          <Text style={xStyles.sectionLabel}>MES LIENS</Text>
          {[
            { label: 'Instagram', value: instagram, setter: setInstagram, placeholder: 'https://instagram.com/...', icon: 'logo-instagram' },
            { label: 'TikTok', value: tiktok, setter: setTiktok, placeholder: 'https://tiktok.com/@...', icon: 'musical-notes-outline' },
            { label: 'YouTube', value: youtube, setter: setYoutube, placeholder: 'https://youtube.com/...', icon: 'logo-youtube' },
            { label: 'Site web', value: site, setter: setSite, placeholder: 'https://...', icon: 'globe-outline' },
          ].map(f => (
            <View key={f.label} style={xStyles.fieldWrap}>
              <Text style={xStyles.fieldLabel}>{f.label}</Text>
              <View style={xStyles.inputRow}>
                <Ionicons name={f.icon as any} size={16} color={colors.textMuted} style={{ marginRight: 8 }} />
                <TextInput
                  style={[xStyles.input, { flex: 1 }]}
                  value={f.value} onChangeText={f.setter} placeholder={f.placeholder}
                  placeholderTextColor={colors.textMuted} autoCapitalize="none" keyboardType="url"
                />
              </View>
            </View>
          ))}

          <TouchableOpacity style={[xStyles.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
            <Text style={xStyles.saveBtnLabel}>{saving ? 'Enregistrement...' : 'Enregistrer'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

const xStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ivoryLight },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 24, paddingBottom: 12 },
  title: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 20, color: colors.bordeaux },
  sectionLabel: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.textMuted, letterSpacing: 1, paddingHorizontal: 20, marginTop: 24, marginBottom: 10 },
  banniereBox: { marginHorizontal: 20, height: 140, borderRadius: 14, overflow: 'hidden', backgroundColor: colors.bordeaux },
  banniereOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: 'rgba(61,26,26,0.35)' },
  uploadLabel: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.ivory },
  profilRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, backgroundColor: '#fff', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.border },
  profilThumb: { width: 56, height: 56, borderRadius: 28 },
  profilChangeLabel: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.bordeaux },
  profilChangeSub: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted, marginTop: 2 },
  fieldWrap: { marginHorizontal: 20, marginBottom: 4 },
  fieldLabel: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.bordeaux, marginBottom: 6 },
  input: { backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 11, fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.bordeaux },
  inputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 11 },
  saveBtn: { marginHorizontal: 20, marginTop: 28, backgroundColor: colors.bordeaux, borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  saveBtnLabel: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: colors.ivory },
});
type LieuMini = { id: string; nom: string; ville: string; cat: string };
type FavItem = { id: string; lieu_id: string; liste: string; lieux: LieuMini | null };
type AvisItem = { id: string; note: number; commentaire: string | null; created_at: string; lieu_id: string; lieux: LieuMini | null };
type PhotoItem = { id: string; url: string; validee: boolean; lieu_id: string | null };

export default function ProfilScreen() {
  const navigation = useNavigation<any>();
  const { session, loading: sessionLoading } = useSession();

  const [profil, setProfil] = useState<Profil | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'contributions' | 'favoris' | 'avis' | 'photos'>('favoris');
  const [favoris, setFavoris] = useState<FavItem[]>([]);
  const [avis, setAvis] = useState<AvisItem[]>([]);
  const [myPhotos, setMyPhotos] = useState<PhotoItem[]>([]);
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [favFilter, setFavFilter] = useState<'tous' | 'favori' | 'a_tester' | 'deja_teste'>('tous');
  const [followModal, setFollowModal] = useState<'followers' | 'following' | null>(null);
  const [followList, setFollowList] = useState<{ id: string; prenom: string | null; username: string | null; avatar_url: string | null; ville: string | null }[]>([]);
  const [followListLoading, setFollowListLoading] = useState(false);
  const [pendingRequests, setPendingRequests] = useState<{ id: string; follower_id: string; prenom: string | null; username: string | null; avatar_url: string | null }[]>([]);
  const [myLieux, setMyLieux] = useState<{ id: string; nom: string; cat: string; ville: string; actif: boolean }[]>([]);
  const [lieuxOpen, setLieuxOpen] = useState(false);
  const cardRef = useRef<View>(null);

  const [explorateur, setExplorateur] = useState<ExplorateurData | null>(null);
  const [showExplorEdit, setShowExplorEdit] = useState(false);

  useEffect(() => { load(); }, [session?.user.id]);

  async function load() {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setProfil(null); setFavoris([]); setAvis([]); setMyPhotos([]);
      setFollowersCount(0); setFollowingCount(0);
      setLoading(false); return;
    }

    savePushToken(session.user.id);

    const [{ data: p }, { data: favsRaw }, { data: avisRaw }, { data: photosList }, followersRes, followingRes, { data: expData }, { data: pendingFollows }, { data: mesLieux }] = await Promise.all([
      supabase.from('profils').select('*').eq('id', session.user.id).single(),
      supabase.from('favoris').select('id,lieu_id,liste').eq('user_id', session.user.id).order('created_at', { ascending: false }).limit(50),
      supabase.from('avis').select('id,note,commentaire,created_at,lieu_id').eq('user_id', session.user.id).order('created_at', { ascending: false }).limit(30),
      supabase.from('photos').select('id,url,validee,lieu_id').eq('user_id', session.user.id).order('created_at', { ascending: false }).limit(40),
      supabase.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', session.user.id).eq('statut', 'accepte'),
      supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', session.user.id).eq('statut', 'accepte'),
      supabase.from('explorateurs').select('id,nom,handle,bio,photo_profil_url,photo_banniere_url,instagram_url,tiktok_url,youtube_url,site_web').eq('user_id', session.user.id).maybeSingle(),
      supabase.from('follows').select('id,follower_id').eq('following_id', session.user.id).eq('statut', 'en_attente'),
      supabase.from('lieux').select('id,nom,cat,ville,actif').eq('submitted_by', session.user.id).order('created_at', { ascending: false }).limit(30),
    ]);
    setExplorateur(expData || null);
    setFollowersCount(followersRes.count ?? 0);
    setFollowingCount(followingRes.count ?? 0);

    if (p) {
      setProfil(p);
    }

    const favLieuIds = [...new Set((favsRaw || []).map((f: any) => f.lieu_id).filter(Boolean))];
    const avisLieuIds = [...new Set((avisRaw || []).map((a: any) => a.lieu_id).filter(Boolean))];
    const allLieuIds = [...new Set([...favLieuIds, ...avisLieuIds])];
    const { data: lieuxData } = allLieuIds.length > 0
      ? await supabase.from('lieux').select('id,nom,ville,cat').in('id', allLieuIds)
      : { data: [] };
    const lieuxMap: Record<string, LieuMini> = Object.fromEntries((lieuxData || []).map((l: any) => [l.id, l]));

    setFavoris((favsRaw || []).map((f: any) => ({
      id: f.id, lieu_id: f.lieu_id, liste: f.liste || 'favori', lieux: lieuxMap[f.lieu_id] || null,
    })));
    setAvis((avisRaw || []).map((a: any) => ({
      id: a.id, note: a.note, commentaire: a.commentaire, created_at: a.created_at,
      lieu_id: a.lieu_id, lieux: lieuxMap[a.lieu_id] || null,
    })));
    setMyPhotos(photosList || []);
    setMyLieux((mesLieux || []) as { id: string; nom: string; cat: string; ville: string; actif: boolean }[]);

    if (pendingFollows && pendingFollows.length > 0) {
      const ids = pendingFollows.map((f: any) => f.follower_id);
      const { data: fp } = await supabase.from('profils').select('id,prenom,username,avatar_url').in('id', ids);
      const pm = Object.fromEntries((fp || []).map((p: any) => [p.id, p]));
      setPendingRequests(pendingFollows.map((f: any) => ({
        id: f.id, follower_id: f.follower_id,
        prenom: pm[f.follower_id]?.prenom || null,
        username: pm[f.follower_id]?.username || null,
        avatar_url: pm[f.follower_id]?.avatar_url || null,
      })));
    } else {
      setPendingRequests([]);
    }

    setLoading(false);
  }

  async function pickAvatar() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1,1], quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const uri = result.assets[0].uri;
    const ext = uri.split('.').pop() || 'jpg';
    const path = `avatars/${session.user.id}.${ext}`;
    const formData = new FormData();
    formData.append('file', { uri, name: path, type: `image/${ext}` } as any);
    const { error: upErr } = await supabase.storage.from('avatars').upload(path, formData, { upsert: true });
    if (upErr) { Alert.alert('Erreur upload', upErr.message); return; }
    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
    await supabase.from('profils').update({ avatar_url: urlData.publicUrl }).eq('id', session.user.id);
    load();
  }

  async function removeFavori(id: string) {
    await supabase.from('favoris').delete().eq('id', id);
    setFavoris(f => f.filter(x => x.id !== id));
  }

  async function shareProfile() {
    if (!profil?.id || !cardRef.current) return;
    try {
      const uri = await captureRef(cardRef, { format: 'png', quality: 1 });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Partager mon profil' });
      } else {
        await Share.share({ url: uri });
      }
    } catch {
      await Share.share({
        message: 'Retrouve mon profil sur The Pack 🐾',
        url: `https://thepackclub.fr/profil-public.html?id=${profil.id}`,
      });
    }
  }

  async function shareLink() {
    if (!profil?.id) return;
    const name = profil.prenom || 'moi';
    const url = `thepack://profil?id=${profil.id}`;
    const webUrl = `https://thepackclub.fr/profil-public.html?id=${profil.id}`;
    try {
      await Share.share({ message: `Suis ${name} sur The Pack 🐾\n${webUrl}`, url });
    } catch {}
  }

  async function openFollowModal(type: 'followers' | 'following') {
    setFollowModal(type);
    setFollowListLoading(true);
    setFollowList([]);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setFollowListLoading(false); return; }
    let userIds: string[] = [];
    if (type === 'followers') {
      const { data } = await supabase.from('follows').select('follower_id').eq('following_id', session.user.id).eq('statut', 'accepte');
      userIds = (data || []).map((f: any) => f.follower_id);
    } else {
      const { data } = await supabase.from('follows').select('following_id').eq('follower_id', session.user.id).eq('statut', 'accepte');
      userIds = (data || []).map((f: any) => f.following_id);
    }
    if (userIds.length > 0) {
      const { data: profils } = await supabase.from('profils').select('id,prenom,username,avatar_url,ville').in('id', userIds);
      setFollowList(profils || []);
    }
    setFollowListLoading(false);
  }

  async function acceptRequest(followId: string, followerId: string) {
    await supabase.from('follows').update({ statut: 'accepte' }).eq('id', followId);
    setPendingRequests(prev => prev.filter(r => r.id !== followId));
    setFollowersCount(c => c + 1);
    const { data: req } = await supabase.from('profils').select('push_token,notif_follow').eq('id', followerId).single();
    if (req?.push_token && req?.notif_follow !== false) {
      sendPushNotification(req.push_token, 'Demande acceptée 🐾', `${profil?.prenom || 'Quelqu\'un'} a accepté ta demande de suivi !`, { type: 'follow_accepted' });
    }
  }

  async function rejectRequest(followId: string) {
    await supabase.from('follows').delete().eq('id', followId);
    setPendingRequests(prev => prev.filter(r => r.id !== followId));
  }

  if (sessionLoading || loading) return <ActivityIndicator style={{ flex: 1 }} color={colors.terra} />;
  if (!session) return <AuthGate navigation={navigation} message="Connecte-toi pour accéder à ton profil, tes adresses et tes avis." />;

  return (
    <View style={styles.container}>
      {/* Header profil */}
      <View style={styles.header}>
        <TouchableOpacity onPress={pickAvatar}>
          <View style={styles.avatarWrap}>
            {profil?.avatar_url
              ? <Image source={{ uri: profil.avatar_url }} style={styles.avatarImg} />
              : <View style={styles.avatarFallback}><Text style={styles.avatarLetter}>{(profil?.prenom || '?')[0].toUpperCase()}</Text></View>}
            <View style={styles.avatarEditBadge}><Ionicons name="camera" size={10} color={colors.ivory} /></View>
          </View>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Text style={styles.nom}>{profil?.prenom || 'Mon profil'}</Text>
              {profil?.ambassadeur ? <AmbassadeurBadge size="md" /> : null}
            </View>
            <TouchableOpacity onPress={() => navigation.navigate('Settings')} style={styles.logoutIcon}>
              <Ionicons name="settings-outline" size={20} color="rgba(245,239,224,0.6)" />
            </TouchableOpacity>
          </View>
          {profil?.username ? <Text style={styles.username}>@{profil.username}</Text> : null}
          {profil?.ville ? <Text style={styles.ville}>{profil.ville}</Text> : null}
          {(profil?.nom_chien || profil?.race_chien) ? (
            <Text style={styles.dogInfo}>
              🐾 {[profil.nom_chien, profil.race_chien].filter(Boolean).join(' · ')}
            </Text>
          ) : null}
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statNum}>{favoris.length}</Text>
              <Text style={styles.statLabel}>Favoris</Text>
            </View>
            <TouchableOpacity style={styles.statItem} onPress={() => openFollowModal('followers')} activeOpacity={0.7}>
              <Text style={styles.statNum}>{followersCount}{pendingRequests.length > 0 ? ` +${pendingRequests.length}` : ''}</Text>
              <Text style={styles.statLabel}>Abonnés</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.statItem} onPress={() => openFollowModal('following')} activeOpacity={0.7}>
              <Text style={styles.statNum}>{followingCount}</Text>
              <Text style={styles.statLabel}>Abonnements</Text>
            </TouchableOpacity>
          </View>
          {(() => {
            const pts = profil?.points || 0;
            const { n, next, pct } = getNiveau(pts);
            return (
              <View style={styles.niveauWrap}>
                <View style={styles.niveauRow}>
                  <Text style={styles.niveauEmoji}>{n.emoji}</Text>
                  <Text style={styles.niveauLabel}>{n.nom}</Text>
                  <Text style={styles.niveauPts}>{pts} pt{pts > 1 ? 's' : ''}</Text>
                </View>
                <View style={styles.niveauBarWrap}>
                  <View style={[styles.niveauBarFill, { width: `${pct}%` as any }]} />
                </View>
                {next && (
                  <Text style={styles.niveauNext}>encore {next.min - pts} pts pour {next.nom} {next.emoji}</Text>
                )}
              </View>
            );
          })()}
        </View>
      </View>

      {/* Partager */}
      <View style={styles.shareBtnRow}>
        <TouchableOpacity style={[styles.shareBtn, { flex: 1 }]} onPress={shareProfile}>
          <Ionicons name="image-outline" size={15} color={colors.bordeaux} />
          <Text style={styles.shareBtnText}>Story / Image</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.shareBtn, { flex: 1 }]} onPress={shareLink}>
          <Ionicons name="link-outline" size={15} color={colors.bordeaux} />
          <Text style={styles.shareBtnText}>Lien de profil</Text>
        </TouchableOpacity>
      </View>

      {/* Demandes en attente */}
      {pendingRequests.length > 0 && (
        <View style={styles.pendingSection}>
          <Text style={styles.pendingTitle}>🔔 Demandes en attente ({pendingRequests.length})</Text>
          {pendingRequests.map(req => (
            <View key={req.id} style={styles.pendingRow}>
              {req.avatar_url
                ? <Image source={{ uri: req.avatar_url }} style={styles.pendingAvatar} />
                : <View style={styles.pendingAvatarFallback}><Text style={styles.pendingAvatarLetter}>{(req.prenom || '?')[0].toUpperCase()}</Text></View>}
              <View style={{ flex: 1 }}>
                <Text style={styles.pendingName}>{req.prenom || 'Utilisateur'}</Text>
                {req.username ? <Text style={styles.pendingUsername}>@{req.username}</Text> : null}
              </View>
              <TouchableOpacity style={styles.pendingAccept} onPress={() => acceptRequest(req.id, req.follower_id)}>
                <Text style={styles.pendingAcceptText}>Accepter</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.pendingReject} onPress={() => rejectRequest(req.id)}>
                <Ionicons name="close" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {/* Tabs */}
      <View style={styles.tabs}>
        {([
          { key: 'favoris',       label: 'Mes adresses' },
          { key: 'avis',          label: 'Avis' },
          { key: 'photos',        label: 'Photos' },
          { key: 'contributions', label: 'Contributions' },
        ] as const).map(t => (
          <TouchableOpacity key={t.key} style={[styles.tab, activeTab === t.key && styles.tabActive]} onPress={() => setActiveTab(t.key)}>
            <Text style={[styles.tabText, activeTab === t.key && styles.tabTextActive]} numberOfLines={1}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeTab === 'contributions' && (
        <ScrollView contentContainerStyle={styles.tabContent}>

          {/* Espace Explorateur */}
          {explorateur && (
            <TouchableOpacity style={styles.explorateurCard} onPress={() => setShowExplorEdit(true)} activeOpacity={0.88}>
              {explorateur.photo_banniere_url
                ? <Image source={{ uri: explorateur.photo_banniere_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                : <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bordeaux }]} />}
              <View style={styles.explorateurCardOverlay}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name="star" size={13} color={colors.terraPale} />
                  <Text style={styles.explorateurCardTitle}>Espace Explorateur</Text>
                </View>
                <Text style={styles.explorateurCardSub}>Gérer ma fiche →</Text>
              </View>
            </TouchableOpacity>
          )}

          {/* Mes suggestions de lieux */}
          <View style={styles.accordionWrap}>
            <TouchableOpacity style={styles.accordionHeader} onPress={() => setLieuxOpen(o => !o)} activeOpacity={0.8}>
              <Ionicons name="location-outline" size={15} color={colors.bordeaux} />
              <Text style={styles.accordionTitle}>Mes suggestions de lieux</Text>
              {myLieux.length > 0 && (
                <View style={styles.lieuxCountBadge}>
                  <Text style={styles.lieuxCountBadgeText}>{myLieux.length}</Text>
                </View>
              )}
              <Ionicons name={lieuxOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
            </TouchableOpacity>
            {lieuxOpen && (
              <View style={{ borderTopWidth: 1, borderTopColor: colors.border }}>
                {myLieux.length === 0 ? (
                  <View style={{ padding: 16 }}>
                    <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted }}>
                      Tu n'as pas encore suggéré de lieu.
                    </Text>
                  </View>
                ) : (
                  myLieux.map((l, i) => (
                    <View key={l.id} style={[styles.lieuSuggestRow, i < myLieux.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.lieuSuggestNom} numberOfLines={1}>{l.nom}</Text>
                        <Text style={styles.lieuSuggestVille}>{l.ville}</Text>
                      </View>
                      <View style={[styles.lieuSuggestStatus, { backgroundColor: l.actif ? '#edf8f1' : '#fff8ed' }]}>
                        <Text style={[styles.lieuSuggestStatusText, { color: l.actif ? '#3a9e5f' : '#c07020' }]}>
                          {l.actif ? '✓ Approuvé' : '⏳ En attente'}
                        </Text>
                      </View>
                    </View>
                  ))
                )}
              </View>
            )}
          </View>

        </ScrollView>
      )}

      {activeTab === 'favoris' && (() => {
        const FAV_FILTERS = [
          { key: 'tous',       label: 'Tous',        icon: 'list'             as const, color: colors.bordeaux },
          { key: 'favori',     label: 'Favoris',     icon: 'heart'            as const, color: '#E05070' },
          { key: 'a_tester',  label: 'À tester',    icon: 'bookmark-outline' as const, color: colors.bordeaux },
          { key: 'deja_teste', label: 'Déjà testé', icon: 'checkmark-circle' as const, color: '#5A9E6F' },
        ];
        const filtered = favFilter === 'tous' ? favoris : favoris.filter(f => f.liste === favFilter);
        const activeFilter = FAV_FILTERS.find(f => f.key === favFilter)!;
        return (
          <FlatList
            data={filtered}
            keyExtractor={item => item.id}
            contentContainerStyle={[styles.tabContent, { paddingTop: 8 }]}
            ListHeaderComponent={
              <View style={styles.favFiltersRow}>
                <View style={styles.favFiltersContent}>
                  {FAV_FILTERS.map(f => {
                    const active = favFilter === f.key;
                    const cnt = f.key === 'tous' ? favoris.length : favoris.filter(x => x.liste === f.key).length;
                    return (
                      <TouchableOpacity
                        key={f.key}
                        onPress={() => setFavFilter(f.key as any)}
                        style={[styles.favFilterPill, active && { backgroundColor: f.color, borderColor: f.color }]}
                      >
                        <Ionicons name={f.icon} size={12} color={active ? colors.ivory : f.color} />
                        <Text style={[styles.favFilterText, active && { color: colors.ivory }]}>{f.label}</Text>
                        {cnt > 0 && <Text style={[styles.favFilterBadge, active && { color: 'rgba(255,255,255,0.7)' }]}>{cnt}</Text>}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            }
            stickyHeaderIndices={[0]}
            ListEmptyComponent={
              <View style={styles.emptyTab}>
                <Text style={styles.emptyIcon}>{favFilter === 'favori' ? '🤍' : favFilter === 'a_tester' ? '🔖' : favFilter === 'deja_teste' ? '✅' : '🤍'}</Text>
                <Text style={styles.emptyText}>Aucun lieu dans cette liste.</Text>
              </View>
            }
            renderItem={({ item }) => (
              <View style={styles.favCard}>
                <View style={styles.favInfo}>
                  <Text style={styles.favEmoji}>{CAT_EMOJI[item.lieux?.cat || 'autre'] || '📍'}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.favNom} numberOfLines={1}>{item.lieux?.nom || 'Lieu supprimé'}</Text>
                    {item.lieux?.ville ? <Text style={styles.favVille}>{item.lieux.ville}</Text> : null}
                  </View>
                </View>
                <Ionicons name={activeFilter.icon} size={14} color={activeFilter.color} style={{ marginRight: 8 }} />
                <TouchableOpacity onPress={() => removeFavori(item.id)} style={styles.favDelete}>
                  <Ionicons name="trash-outline" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            )}
          />
        );
      })()}

      {activeTab === 'avis' && (
        <FlatList
          data={avis}
          keyExtractor={i => i.id}
          contentContainerStyle={styles.tabContent}
          ListEmptyComponent={
            <View style={styles.emptyTab}>
              <Text style={styles.emptyIcon}>⭐</Text>
              <Text style={styles.emptyText}>Tu n'as pas encore laissé d'avis.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.avisCard}
              activeOpacity={item.lieu_id ? 0.75 : 1}
              onPress={() => {
                if (item.lieu_id) {
                  mapNavigation.setPendingLieu(item.lieu_id);
                  navigation.navigate('Tabs', { screen: 'Carte' });
                }
              }}
            >
              <View style={styles.avisHeader}>
                <Text style={styles.avisNom} numberOfLines={1}>
                  {CAT_EMOJI[item.lieux?.cat || 'autre'] || '📍'} {item.lieux?.nom || 'Lieu inconnu'}
                </Text>
                <View style={styles.starsRow}>
                  {[1,2,3,4,5].map(i => (
                    <Ionicons key={i} name={i <= item.note ? 'star' : 'star-outline'} size={12} color={colors.terra} />
                  ))}
                </View>
              </View>
              {item.lieux?.ville ? <Text style={styles.avisVille}>{item.lieux.ville}</Text> : null}
              {item.commentaire ? <Text style={styles.avisComment} numberOfLines={3}>{item.commentaire}</Text> : null}
              <View style={styles.avisFooter}>
                <Text style={styles.avisDate}>{new Date(item.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</Text>
                {item.lieu_id && (
                  <View style={styles.avisGoRow}>
                    <Ionicons name="map-outline" size={11} color={colors.terra} />
                    <Text style={styles.avisGoText}>Voir sur la carte</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          )}
        />
      )}

      {activeTab === 'photos' && (
        myPhotos.length === 0 ? (
          <View style={styles.emptyTab}>
            <Text style={styles.emptyIcon}>📸</Text>
            <Text style={styles.emptyText}>Tu n'as pas encore partagé de photo.{'\n'}Ouvre un lieu sur la carte pour en ajouter une !</Text>
          </View>
        ) : (
          <FlatList
            data={myPhotos}
            keyExtractor={i => i.id}
            numColumns={3}
            contentContainerStyle={{ padding: 16, gap: 4 }}
            columnWrapperStyle={{ gap: 4 }}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.photoCell}
                activeOpacity={item.lieu_id ? 0.8 : 1}
                onPress={() => {
                  if (item.lieu_id) {
                    mapNavigation.setPendingLieu(item.lieu_id);
                    navigation.navigate('Tabs', { screen: 'Carte' });
                  }
                }}
              >
                <Image source={{ uri: item.url }} style={styles.photoCellImg} />
                {!item.validee && (
                  <View style={styles.photoPendingOverlay}>
                    <Text style={styles.photoPendingText}>En attente</Text>
                  </View>
                )}
              </TouchableOpacity>
            )}
          />
        )
      )}

      {/* Off-screen profile card for sharing */}
      <View ref={cardRef} collapsable={false} style={styles.shareCard}>
        <Text style={styles.shareCardBrand}>THE PACK CLUB</Text>
        <View style={styles.shareCardLine} />
        <Text style={styles.shareCardTitle}>The Pack</Text>
        <Text style={styles.shareCardSub}>Club dog-friendly</Text>
        <View style={[styles.shareCardLine, { opacity: 0.4, marginTop: 10 }]} />
        <View style={styles.shareCardAvatarRing}>
          <View style={styles.shareCardAvatar}>
            {profil?.avatar_url
              ? <Image source={{ uri: profil.avatar_url }} style={styles.shareCardAvatarImg} />
              : <Text style={styles.shareCardAvatarLetter}>{(profil?.prenom || '?')[0].toUpperCase()}</Text>}
          </View>
        </View>
        <Text style={styles.shareCardName}>{profil?.prenom || ''}</Text>
        {profil?.username ? <Text style={styles.shareCardUsername}>@{profil.username}</Text> : null}
        {(() => {
          const { n } = getNiveau(profil?.points || 0);
          return (
            <View style={styles.shareCardBadge}>
              <Text style={styles.shareCardBadgeText}>{n.emoji} {n.nom} · {profil?.points || 0} pts</Text>
            </View>
          );
        })()}
        <View style={styles.shareCardStats}>
          {[{ val: favoris.length, label: 'favoris' }, { val: followersCount, label: 'abonnés' }].map(({ val, label }) => (
            <View key={label} style={styles.shareCardStatBox}>
              <Text style={styles.shareCardStatNum}>{val}</Text>
              <Text style={styles.shareCardStatLabel}>{label}</Text>
            </View>
          ))}
        </View>
        <View style={styles.shareCardFlex} />
        <View style={[styles.shareCardLine, { opacity: 0.3, marginBottom: 18 }]} />
        <Text style={styles.shareCardCta}>Rejoins-moi sur The Pack !</Text>
        <Text style={styles.shareCardUrl}>thepackclub.fr</Text>
        {profil?.username ? <Text style={styles.shareCardUrlUser}>@{profil.username}</Text> : null}
        <View style={{ height: 36 }} />
      </View>

      {/* Follow list modal */}
      <Modal visible={!!followModal} animationType="slide" transparent>
        <View style={styles.followOverlay}>
          <View style={styles.followCard}>
            <View style={styles.followCardHeader}>
              <Text style={styles.followCardTitle}>
                {followModal === 'followers' ? 'Abonnés' : 'Abonnements'}
              </Text>
              <TouchableOpacity onPress={() => setFollowModal(null)}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            {followListLoading ? (
              <ActivityIndicator style={{ padding: 40 }} color={colors.terra} />
            ) : followList.length === 0 ? (
              <View style={styles.followEmpty}>
                <Text style={styles.followEmptyText}>
                  {followModal === 'followers' ? 'Aucun abonné pour l\'instant' : 'Tu ne suis personne encore'}
                </Text>
              </View>
            ) : (
              <FlatList
                data={followList}
                keyExtractor={item => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.followRow}
                    activeOpacity={0.7}
                    onPress={() => { setFollowModal(null); navigation.navigate('ProfilPublic', { userId: item.id }); }}
                  >
                    {item.avatar_url
                      ? <Image source={{ uri: item.avatar_url }} style={styles.followAvatar} />
                      : <View style={styles.followAvatarFallback}><Text style={styles.followAvatarLetter}>{(item.prenom || '?')[0].toUpperCase()}</Text></View>}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.followNom}>{item.prenom || 'Membre'}</Text>
                      {item.username ? <Text style={styles.followUsername}>@{item.username}</Text> : null}
                      {item.ville ? <Text style={styles.followVille}>{item.ville}</Text> : null}
                    </View>
                    <Ionicons name="chevron-forward" size={15} color={colors.textMuted} />
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        </View>
      </Modal>

      {showExplorEdit && explorateur && session && (
        <ExplorateurEditModal
          explorateur={explorateur}
          userId={session.user.id}
          onClose={() => setShowExplorEdit(false)}
          onSaved={e => setExplorateur(e)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ivoryPale },
  header: {
    backgroundColor: colors.bordeaux, flexDirection: 'row', alignItems: 'center',
    gap: 14, padding: 20, paddingTop: 16,
  },
  avatarWrap: { position: 'relative' },
  avatarImg: { width: 64, height: 64, borderRadius: 32 },
  avatarFallback: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: 'rgba(245,239,224,0.15)', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: 'rgba(245,239,224,0.2)',
  },
  avatarLetter: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 24, color: colors.ivory },
  avatarEditBadge: {
    position: 'absolute', bottom: 0, right: 0,
    backgroundColor: colors.terra, borderRadius: 10, width: 20, height: 20,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.bordeaux,
  },
  nom: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: colors.ivory },
  username: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.terraPale },
  ville: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: 'rgba(245,239,224,0.6)' },
  dogInfo: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: 'rgba(245,239,224,0.7)', marginTop: 2 },
  points: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.terraPale, marginTop: 3 },
  statsRow: { flexDirection: 'row', gap: 18, marginTop: 10, flexWrap: 'wrap' },
  statItem: { minWidth: 50 },
  statNum: { fontFamily: 'DMSans_500Medium', fontSize: 17, color: colors.terraPale },
  statLabel: { fontFamily: 'DMSans_400Regular', fontSize: 10, color: 'rgba(245,239,224,0.45)', textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 1 },
  niveauWrap: { marginTop: 10 },
  niveauRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 5 },
  niveauEmoji: { fontSize: 13 },
  niveauLabel: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: 'rgba(245,239,224,0.8)', flex: 1 },
  niveauPts: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: 'rgba(245,239,224,0.4)' },
  niveauBarWrap: { height: 3, backgroundColor: 'rgba(245,239,224,0.12)', borderRadius: 2, overflow: 'hidden' },
  niveauBarFill: { height: 3, backgroundColor: colors.terra, borderRadius: 2 },
  niveauNext: { fontFamily: 'DMSans_400Regular', fontSize: 10, color: 'rgba(245,239,224,0.4)', marginTop: 3 },
  logoutIcon: { padding: 4, marginLeft: 6 },
  lieuxCountBadge: {
    backgroundColor: colors.terraPale + '40', borderRadius: 10,
    paddingHorizontal: 7, paddingVertical: 2, marginRight: 2,
  },
  lieuxCountBadgeText: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.bordeaux },
  lieuSuggestRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10 },
  lieuSuggestNom: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.textMid },
  lieuSuggestVille: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted, marginTop: 2 },
  lieuSuggestStatus: { borderRadius: 10, paddingHorizontal: 9, paddingVertical: 4 },
  lieuSuggestStatusText: { fontFamily: 'DMSans_500Medium', fontSize: 10 },
  pendingSection: {
    backgroundColor: 'rgba(196,105,58,0.07)', borderBottomWidth: 1, borderBottomColor: 'rgba(196,105,58,0.15)',
    paddingHorizontal: 16, paddingVertical: 10,
  },
  pendingTitle: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.terra, marginBottom: 8 },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  pendingAvatar: { width: 36, height: 36, borderRadius: 18 },
  pendingAvatarFallback: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.bordeaux,
    alignItems: 'center', justifyContent: 'center',
  },
  pendingAvatarLetter: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 15, color: colors.ivory },
  pendingName: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.bordeaux },
  pendingUsername: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted },
  pendingAccept: {
    backgroundColor: colors.terra, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6,
  },
  pendingAcceptText: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.ivory },
  pendingReject: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  tabs: {
    flexDirection: 'row', backgroundColor: colors.white,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: colors.bordeaux },
  tabText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted },
  tabTextActive: { fontFamily: 'DMSans_500Medium', color: colors.bordeaux },
  tabContent: { padding: 16, gap: 12, paddingBottom: 40 },
  shareBtnRow: { flexDirection: 'row', gap: 10, marginHorizontal: 16, marginBottom: 10 },
  shareBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.white, borderRadius: 12, padding: 13,
    borderWidth: 1, borderColor: colors.border,
  },
  shareBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.bordeaux },
  explorateurCard: {
    marginHorizontal: 16, marginBottom: 16, height: 100, borderRadius: 16, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 5,
  },
  explorateurCardOverlay: {
    flex: 1, justifyContent: 'flex-end', padding: 16,
    backgroundColor: 'rgba(61,26,26,0.52)',
  },
  explorateurCardTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 15, color: colors.ivory },
  explorateurCardSub: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: 'rgba(245,239,224,0.7)', marginTop: 2 },
  accordionWrap: {
    backgroundColor: colors.white, borderRadius: 14,
    borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
  },
  accordionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16,
  },
  accordionTitle: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.bordeaux, flex: 1 },
  accordionBody: { gap: 12, padding: 16, borderTopWidth: 1, borderTopColor: colors.border },
  editBtn: { backgroundColor: colors.terra, borderRadius: 12, padding: 14, alignItems: 'center' },
  editBtnText: { fontFamily: 'DMSans_500Medium', color: colors.ivory, fontSize: 14 },
  cancelBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, alignItems: 'center' },
  cancelBtnText: { fontFamily: 'DMSans_400Regular', color: colors.textMuted, fontSize: 14 },
  section: { backgroundColor: colors.ivoryPale, borderRadius: 10, padding: 14, gap: 12, borderWidth: 1, borderColor: colors.border },
  sectionTitle: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 },
  field: { gap: 4 },
  fieldLabel: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  fieldValue: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.bordeaux },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10,
    fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.bordeaux, backgroundColor: colors.ivoryPale,
  },
  racePicker: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10,
    backgroundColor: colors.ivoryPale,
  },
  racePickerText: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.bordeaux, flex: 1 },
  favFiltersRow: {
    backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  favFiltersContent: {
    flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingVertical: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  favFilterPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, height: 34, borderRadius: 20,
    borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.white,
  },
  favFilterText: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.bordeaux },
  favFilterBadge: { fontFamily: 'DMSans_400Regular', fontSize: 10, color: colors.textMuted },
  favSectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 4, marginBottom: 8,
  },
  favSectionTitle: { fontFamily: 'DMSans_500Medium', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, flex: 1 },
  favSectionCount: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted },
  favCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.white, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: colors.border, marginBottom: 6,
  },
  favInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  favEmoji: { fontSize: 22 },
  favNom: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.bordeaux },
  favVille: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted },
  favDelete: { padding: 6 },
  avisCard: {
    backgroundColor: colors.white, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: colors.border, gap: 4,
  },
  avisHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  avisNom: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.bordeaux, flex: 1, marginRight: 8 },
  starsRow: { flexDirection: 'row', gap: 2 },
  avisVille: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted },
  avisComment: { fontFamily: 'DMSans_300Light', fontSize: 12, color: colors.textMid, lineHeight: 18, fontStyle: 'italic' },
  avisDate: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted },
  emptyTab: { alignItems: 'center', paddingVertical: 48, flex: 1, justifyContent: 'center' },
  emptyIcon: { fontSize: 36, marginBottom: 10 },
  emptyText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted, textAlign: 'center', lineHeight: 20 },
  photoCell: { width: PHOTO_CELL, height: PHOTO_CELL, position: 'relative' },
  photoCellImg: { width: PHOTO_CELL, height: PHOTO_CELL, borderRadius: 6, backgroundColor: colors.border },
  photoPendingOverlay: {
    ...StyleSheet.absoluteFillObject, borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center',
  },
  photoPendingText: { fontFamily: 'DMSans_500Medium', fontSize: 10, color: '#fff', textAlign: 'center' },
  shareCard: {
    position: 'absolute', left: -9999, top: 0,
    width: 360, height: 640,
    backgroundColor: '#3D1A1A',
    alignItems: 'center', paddingTop: 36,
  },
  shareCardBrand: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: 'rgba(232,168,130,0.85)', letterSpacing: 2.5, textTransform: 'uppercase' },
  shareCardLine: { width: 260, height: 1, backgroundColor: 'rgba(196,105,58,0.5)', marginTop: 8 },
  shareCardTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 44, color: '#F5EFE0', marginTop: 10 },
  shareCardSub: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: 'rgba(196,105,58,0.8)', marginTop: 2 },
  shareCardAvatarRing: {
    marginTop: 28, width: 112, height: 112, borderRadius: 56,
    borderWidth: 2.5, borderColor: 'rgba(196,105,58,0.5)',
    alignItems: 'center', justifyContent: 'center',
  },
  shareCardAvatar: {
    width: 100, height: 100, borderRadius: 50,
    borderWidth: 2.5, borderColor: 'rgba(196,105,58,0.85)',
    overflow: 'hidden', backgroundColor: 'rgba(196,105,58,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  shareCardAvatarImg: { width: 100, height: 100 },
  shareCardAvatarLetter: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 40, color: '#F5EFE0' },
  shareCardName: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 28, color: '#F5EFE0', marginTop: 18 },
  shareCardUsername: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: 'rgba(232,168,130,0.9)', marginTop: 3 },
  shareCardBadge: {
    marginTop: 14, paddingHorizontal: 18, paddingVertical: 7,
    backgroundColor: 'rgba(196,105,58,0.2)', borderRadius: 20,
    borderWidth: 1, borderColor: 'rgba(196,105,58,0.5)',
  },
  shareCardBadgeText: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: 'rgba(232,168,130,0.95)' },
  shareCardStats: { flexDirection: 'row', gap: 14, marginTop: 24 },
  shareCardStatBox: {
    width: 116, height: 80, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(245,239,224,0.07)', borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(245,239,224,0.1)',
  },
  shareCardStatNum: { fontFamily: 'DMSans_500Medium', fontSize: 30, color: '#F5EFE0' },
  shareCardStatLabel: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: 'rgba(245,239,224,0.45)' },
  shareCardFlex: { flex: 1 },
  shareCardCta: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: '#F5EFE0' },
  shareCardUrl: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: 'rgba(196,105,58,0.85)', marginTop: 5 },
  shareCardUrlUser: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: 'rgba(245,239,224,0.35)', marginTop: 3 },
  raceModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  raceModalCard: {
    backgroundColor: colors.ivoryPale, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '80%', paddingBottom: 32,
  },
  raceModalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 20, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  raceModalTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: colors.bordeaux },
  raceSearchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    margin: 12, paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: 'white', borderRadius: 10, borderWidth: 1.5, borderColor: colors.border,
  },
  raceSearchInput: { flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.bordeaux, padding: 0 },
  raceItem: { paddingVertical: 14, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.border + '66' },
  raceItemActive: { backgroundColor: colors.terra + '0D' },
  raceItemText: { fontFamily: 'DMSans_400Regular', fontSize: 15, color: colors.bordeaux },
  raceItemTextActive: { fontFamily: 'DMSans_500Medium', color: colors.terra },

  avisFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  avisGoRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  avisGoText: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.terra },

  followOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  followCard: {
    backgroundColor: colors.ivoryPale, borderTopLeftRadius: 22, borderTopRightRadius: 22,
    maxHeight: '75%', paddingBottom: 32,
  },
  followCardHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 20, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  followCardTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: colors.bordeaux },
  followEmpty: { alignItems: 'center', paddingVertical: 48 },
  followEmptyText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted },
  followRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, paddingHorizontal: 20,
    borderBottomWidth: 1, borderBottomColor: colors.border + '55',
  },
  followAvatar: { width: 44, height: 44, borderRadius: 22 },
  followAvatarFallback: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.bordeaux + '15', alignItems: 'center', justifyContent: 'center',
  },
  followAvatarLetter: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: colors.bordeaux },
  followNom: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.bordeaux },
  followUsername: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted },
  followVille: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted },
});
