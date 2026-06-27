import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Switch,
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
import { savePushToken } from '../lib/notifications';

const RACES = [
  'Akita Inu','Alaskan Malamute','Basenji','Basset Hound','Beagle','Berger Allemand',
  'Berger Australien','Berger Belge Malinois','Berger des Pyrénées','Bichon Frisé',
  'Bobtail (Old English Sheepdog)','Border Collie','Boston Terrier','Bouledogue Anglais',
  'Bouledogue Français','Boxer','Braque de Weimar','Braque Français','Bull Terrier',
  'Cairn Terrier','Caniche (Toy / Nain / Moyen / Grand)','Carlin (Pug)','Cavalier King Charles',
  'Chihuahua','Chow Chow','Cocker Américain','Cocker Anglais','Colley (Lassie)','Dalmatien',
  'Doberman','Dogue Allemand (Great Dane)','Dogue de Bordeaux','Épagneul Breton',
  'Fox Terrier','Golden Retriever','Husky Sibérien','Jack Russell Terrier',
  'Labrador Retriever','Leonberg','Lévrier (Greyhound / Whippet)','Lhasa Apso',
  'Maltais','Montagne des Pyrénées','Pékinois','Rottweiler','Saint-Bernard','Samoyède',
  'Setter Irlandais','Shiba Inu','Shih Tzu','Spitz Nain (Poméranien)','Teckel',
  'Terre-Neuve','Westie (West Highland White Terrier)','Yorkshire Terrier','Autres',
];

const NIVEAUX = [
  { nom: 'Explorateur', emoji: '🌱', min: 0,   max: 49   },
  { nom: 'Silver',      emoji: '🌿', min: 50,  max: 199  },
  { nom: 'Gold',        emoji: '🌳', min: 200, max: 499  },
  { nom: 'Platinum',    emoji: '🏆', min: 500, max: 9999 },
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
  bio: string | null; points: number;
  notif_follow: boolean | null; notif_lieu_nearby: boolean | null;
};
type LieuMini = { id: string; nom: string; ville: string; cat: string };
type FavItem = { id: string; lieu_id: string; liste: string; lieux: LieuMini | null };
type AvisItem = { id: string; note: number; commentaire: string | null; created_at: string; lieu_id: string; lieux: LieuMini | null };
type PhotoItem = { id: string; url: string; validee: boolean };

export default function ProfilScreen() {
  const navigation = useNavigation<any>();
  const { session, loading: sessionLoading } = useSession();

  const [profil, setProfil] = useState<Profil | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [activeTab, setActiveTab] = useState<'profil' | 'favoris' | 'avis' | 'photos'>('favoris');
  const [favoris, setFavoris] = useState<FavItem[]>([]);
  const [avis, setAvis] = useState<AvisItem[]>([]);
  const [myPhotos, setMyPhotos] = useState<PhotoItem[]>([]);
  const [raceModal, setRaceModal] = useState(false);
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [accordionOpen, setAccordionOpen] = useState(false);
  const [notifFollow, setNotifFollow] = useState(true);
  const [notifLieuNearby, setNotifLieuNearby] = useState(true);
  const [favFilter, setFavFilter] = useState<'tous' | 'favori' | 'a_tester' | 'deja_teste'>('tous');
  const cardRef = useRef<View>(null);

  const [prenom, setPrenom] = useState('');
  const [ville, setVille] = useState('');
  const [nomChien, setNomChien] = useState('');
  const [raceChien, setRaceChien] = useState('');
  const [bio, setBio] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setLoading(false); return; }

    savePushToken(session.user.id);

    const [{ data: p }, { data: favsRaw }, { data: avisRaw }, { data: photosList }, followersRes, followingRes] = await Promise.all([
      supabase.from('profils').select('*').eq('id', session.user.id).single(),
      supabase.from('favoris').select('id,lieu_id,liste').eq('user_id', session.user.id).order('created_at', { ascending: false }).limit(50),
      supabase.from('avis').select('id,note,commentaire,created_at,lieu_id').eq('user_id', session.user.id).order('created_at', { ascending: false }).limit(30),
      supabase.from('photos').select('id,url,validee').eq('user_id', session.user.id).order('created_at', { ascending: false }).limit(40),
      supabase.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', session.user.id).eq('statut', 'accepte'),
      supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', session.user.id).eq('statut', 'accepte'),
    ]);
    setFollowersCount(followersRes.count ?? 0);
    setFollowingCount(followingRes.count ?? 0);

    if (p) {
      setProfil(p);
      setPrenom(p.prenom || '');
      setVille(p.ville || '');
      setNomChien(p.nom_chien || '');
      setRaceChien(p.race_chien || '');
      setBio(p.bio || '');
      setNotifFollow(p.notif_follow ?? true);
      setNotifLieuNearby(p.notif_lieu_nearby ?? true);
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
    setLoading(false);
  }

  async function save() {
    setSaving(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const { error } = await supabase.from('profils').upsert({
      id: session.user.id,
      prenom: prenom.trim() || null, ville: ville.trim() || null,
      nom_chien: nomChien.trim() || null, race_chien: raceChien.trim() || null,
      bio: bio.trim() || null,
    });
    setSaving(false);
    if (error) { Alert.alert('Erreur', error.message); return; }
    setEditing(false);
    load();
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

  async function toggleNotif(key: 'notif_follow' | 'notif_lieu_nearby', value: boolean) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    if (key === 'notif_follow') setNotifFollow(value);
    else setNotifLieuNearby(value);
    await supabase.from('profils').update({ [key]: value }).eq('id', session.user.id);
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
          <Text style={styles.nom}>{profil?.prenom || 'Mon profil'}</Text>
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
            <View style={styles.statItem}>
              <Text style={styles.statNum}>{followersCount}</Text>
              <Text style={styles.statLabel}>Abonnés</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statNum}>{followingCount}</Text>
              <Text style={styles.statLabel}>Abonnements</Text>
            </View>
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
        <TouchableOpacity onPress={() => navigation.navigate('Settings')} style={styles.logoutIcon}>
          <Ionicons name="settings-outline" size={22} color="rgba(245,239,224,0.6)" />
        </TouchableOpacity>
      </View>

      {/* Partager */}
      <TouchableOpacity style={styles.shareBtn} onPress={shareProfile}>
        <Ionicons name="share-outline" size={15} color={colors.bordeaux} />
        <Text style={styles.shareBtnText}>Partager mon profil</Text>
      </TouchableOpacity>

      {/* Tabs */}
      <View style={styles.tabs}>
        {([
          { key: 'favoris', label: 'Mes adresses' },
          { key: 'avis',    label: 'Avis' },
          { key: 'photos',  label: 'Photos' },
          { key: 'profil',  label: 'Profil' },
        ] as const).map(t => (
          <TouchableOpacity key={t.key} style={[styles.tab, activeTab === t.key && styles.tabActive]} onPress={() => setActiveTab(t.key)}>
            <Text style={[styles.tabText, activeTab === t.key && styles.tabTextActive]} numberOfLines={1}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeTab === 'profil' && (
        <ScrollView contentContainerStyle={styles.tabContent}>
          <View style={styles.accordionWrap}>
            <TouchableOpacity style={styles.accordionHeader} onPress={() => setAccordionOpen(o => !o)} activeOpacity={0.8}>
              <Ionicons name="person-outline" size={15} color={colors.bordeaux} />
              <Text style={styles.accordionTitle}>Mes informations</Text>
              <Ionicons name={accordionOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
            </TouchableOpacity>

            {accordionOpen && (
              <View style={styles.accordionBody}>
                <TouchableOpacity style={styles.editBtn} onPress={() => editing ? save() : setEditing(true)} disabled={saving}>
                  {saving ? <ActivityIndicator color={colors.ivory} size="small" /> : <Text style={styles.editBtnText}>{editing ? '✓ Enregistrer' : 'Modifier'}</Text>}
                </TouchableOpacity>
                {editing && (
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditing(false)}>
                    <Text style={styles.cancelBtnText}>Annuler</Text>
                  </TouchableOpacity>
                )}

                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Mes infos</Text>
                  {[
                    { label: 'Prénom', value: prenom, setter: setPrenom, placeholder: 'Ex : Marie' },
                    { label: 'Ville', value: ville, setter: setVille, placeholder: 'Ex : Paris' },
                  ].map(f => (
                    <View key={f.label} style={styles.field}>
                      <Text style={styles.fieldLabel}>{f.label}</Text>
                      {editing
                        ? <TextInput style={styles.input} value={f.value} onChangeText={f.setter} placeholder={f.placeholder} placeholderTextColor={colors.textMuted} />
                        : <Text style={styles.fieldValue}>{f.value || '—'}</Text>}
                    </View>
                  ))}
                  <View style={styles.field}>
                    <Text style={styles.fieldLabel}>Bio</Text>
                    {editing
                      ? <TextInput style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]} value={bio} onChangeText={setBio} placeholder="Quelques mots sur toi…" placeholderTextColor={colors.textMuted} multiline />
                      : <Text style={styles.fieldValue}>{bio || '—'}</Text>}
                  </View>
                </View>

                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Mon chien 🐾</Text>
                  <View style={styles.field}>
                    <Text style={styles.fieldLabel}>Nom du chien</Text>
                    {editing
                      ? <TextInput style={styles.input} value={nomChien} onChangeText={setNomChien} placeholder="Ex : Albus" placeholderTextColor={colors.textMuted} />
                      : <Text style={styles.fieldValue}>{nomChien || '—'}</Text>}
                  </View>
                  <View style={styles.field}>
                    <Text style={styles.fieldLabel}>Race</Text>
                    {editing ? (
                      <TouchableOpacity style={styles.racePicker} onPress={() => setRaceModal(true)}>
                        <Text style={[styles.racePickerText, !raceChien && { color: colors.textMuted }]}>
                          {raceChien || 'Choisir une race…'}
                        </Text>
                        <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
                      </TouchableOpacity>
                    ) : (
                      <Text style={styles.fieldValue}>{raceChien || '—'}</Text>
                    )}
                  </View>
                </View>
              </View>
            )}
          </View>

          {/* Notifications */}
          <View style={styles.notifCard}>
            <View style={styles.notifCardHeader}>
              <Ionicons name="notifications-outline" size={15} color={colors.bordeaux} />
              <Text style={styles.notifCardTitle}>Notifications</Text>
            </View>
            <View style={styles.notifRow}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.notifLabel}>Nouvel abonné</Text>
                <Text style={styles.notifSub}>Quand quelqu'un commence à te suivre</Text>
              </View>
              <Switch
                value={notifFollow}
                onValueChange={v => toggleNotif('notif_follow', v)}
                trackColor={{ false: colors.border, true: colors.terra }}
                thumbColor={colors.ivory}
              />
            </View>
            <View style={[styles.notifRow, { borderBottomWidth: 0 }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.notifLabel}>Nouveau lieu près de moi</Text>
                <Text style={styles.notifSub}>Quand un lieu dog-friendly est ajouté près de chez toi</Text>
              </View>
              <Switch
                value={notifLieuNearby}
                onValueChange={v => toggleNotif('notif_lieu_nearby', v)}
                trackColor={{ false: colors.border, true: colors.terra }}
                thumbColor={colors.ivory}
              />
            </View>
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
            <View style={styles.avisCard}>
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
              <Text style={styles.avisDate}>{new Date(item.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</Text>
            </View>
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
              <View style={styles.photoCell}>
                <Image source={{ uri: item.url }} style={styles.photoCellImg} />
                {!item.validee && (
                  <View style={styles.photoPendingOverlay}>
                    <Text style={styles.photoPendingText}>En attente</Text>
                  </View>
                )}
              </View>
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

      {/* Race picker modal */}
      <Modal visible={raceModal} animationType="slide" transparent>
        <View style={styles.raceModalOverlay}>
          <View style={styles.raceModalCard}>
            <View style={styles.raceModalHeader}>
              <Text style={styles.raceModalTitle}>Choisir une race</Text>
              <TouchableOpacity onPress={() => setRaceModal(false)}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={RACES}
              keyExtractor={r => r}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.raceItem, raceChien === item && styles.raceItemActive]}
                  onPress={() => { setRaceChien(item); setRaceModal(false); }}
                >
                  <Text style={[styles.raceItemText, raceChien === item && styles.raceItemTextActive]}>{item}</Text>
                  {raceChien === item && <Ionicons name="checkmark" size={16} color={colors.terra} />}
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>
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
  statsRow: { flexDirection: 'row', gap: 18, marginTop: 10 },
  statItem: {},
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
  logoutIcon: { padding: 4 },
  tabs: {
    flexDirection: 'row', backgroundColor: colors.white,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: colors.bordeaux },
  tabText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted },
  tabTextActive: { fontFamily: 'DMSans_500Medium', color: colors.bordeaux },
  tabContent: { padding: 16, gap: 12, paddingBottom: 40 },
  shareBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.white, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: colors.border,
  },
  shareBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.bordeaux },
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
  notifCard: {
    backgroundColor: colors.white, borderRadius: 14,
    borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
  },
  notifCardHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  notifCardTitle: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.bordeaux },
  notifRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  notifLabel: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: colors.bordeaux },
  notifSub: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted, lineHeight: 16 },

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
  raceItem: { paddingVertical: 14, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.border + '66' },
  raceItemActive: { backgroundColor: colors.terra + '0D' },
  raceItemText: { fontFamily: 'DMSans_400Regular', fontSize: 15, color: colors.bordeaux },
  raceItemTextActive: { fontFamily: 'DMSans_500Medium', color: colors.terra },
});
