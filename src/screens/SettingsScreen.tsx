import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, Switch,
  Modal, FlatList, KeyboardAvoidingView, Platform, Keyboard, Linking,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import { savePushToken } from '../lib/notifications';
import { normalizePhone } from '../lib/phone';
import { RACES } from '../constants/races';
import { COUNTRIES } from '../constants/countries';

const GENRES = [
  { key: 'male',    label: 'Mâle',    emoji: '♂️' },
  { key: 'femelle', label: 'Femelle', emoji: '♀️' },
];

const OWNER_GENRES = [
  { key: 'femme', label: 'Femme' },
  { key: 'homme', label: 'Homme' },
  { key: 'non_binaire', label: 'Non-binaire' },
  { key: 'neutre', label: 'Neutre' },
  { key: 'autre', label: 'Autre' },
];

const TRANCHES_AGE = [
  { key: 'chiot',  label: 'Chiot',  emoji: '🐣', sub: '0 – 1 an'  },
  { key: 'jeune',  label: 'Jeune',  emoji: '🐕', sub: '1 – 3 ans' },
  { key: 'adulte', label: 'Adulte', emoji: '🦮', sub: '3 – 8 ans' },
  { key: 'senior', label: 'Senior', emoji: '🐾', sub: '8+ ans'    },
];

const STATUTS_AMOUREUX = [
  { key: 'celibataire',   label: 'Célibataire',     emoji: '🐾' },
  { key: 'en_couple',     label: 'En couple',        emoji: '❤️' },
  { key: 'castre',        label: 'Castré(e)',        emoji: '✂️' },
  { key: 'cherche_amour', label: "Cherche l'amour", emoji: '💝' },
];

function formatDate(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function detectMode(value: string): 'date' | 'age' {
  return value.includes('/') ? 'date' : 'age';
}

type Dog = {
  id: string;
  nom: string;
  race: string | null;
  genre: string | null;
  tranche_age: string | null;
  statut_amoureux: string | null;
  date_naissance: string | null;
};

export default function SettingsScreen() {
  const navigation = useNavigation<any>();

  // Username
  const [username, setUsername] = useState('');
  const [currentUsername, setCurrentUsername] = useState('');
  const [savingUsername, setSavingUsername] = useState(false);

  // Notifications
  const [notifFollow, setNotifFollow] = useState(true);
  const [notifLieuNearby, setNotifLieuNearby] = useState(true);
  const [notifMessages, setNotifMessages] = useState(true);
  const [notifSuggestionValidee, setNotifSuggestionValidee] = useState(true);
  const [notifPhotoLike, setNotifPhotoLike] = useState(true);
  const [notifFriendLieu, setNotifFriendLieu] = useState(true);
  const [notifPartner, setNotifPartner] = useState(true);
  const [notifOffer, setNotifOffer] = useState(true);
  const [notifBroadcast, setNotifBroadcast] = useState(true);
  const [notifNewPost, setNotifNewPost] = useState(true);
  const [notifBirthday, setNotifBirthday] = useState(true);
  const [rayonKm, setRayonKm] = useState(20);
  const [notifPermission, setNotifPermission] = useState<'granted' | 'denied' | 'undetermined'>('undetermined');

  // Profil (human info only)
  const [prenom, setPrenom] = useState('');
  const [ville, setVille] = useState('');
  const [pays, setPays] = useState('');
  const [genre, setGenre] = useState('');
  const [telephone, setTelephone] = useState('');
  const [bio, setBio] = useState('');
  const [instagram, setInstagram] = useState('');
  const [tiktok, setTiktok] = useState('');

  // Human birthday
  const [dateMode, setDateMode] = useState<'date' | 'age'>('date');
  const [dateNaissance, setDateNaissance] = useState('');
  const [ageVal, setAgeVal] = useState('');

  const [savingProfil, setSavingProfil] = useState(false);
  const [profilOpen, setProfilOpen] = useState(false);

  // Chiens / Passeports
  const [chiens, setChiens] = useState<Dog[]>([]);
  const [dogModal, setDogModal] = useState(false);
  const [editingDog, setEditingDog] = useState<Dog | null>(null);
  const [dogNom, setDogNom] = useState('');
  const [dogRace, setDogRace] = useState('');
  const [dogGenre, setDogGenre] = useState('');
  const [dogTrancheAge, setDogTrancheAge] = useState('');
  const [dogStatut, setDogStatut] = useState('');
  const [dogDateMode, setDogDateMode] = useState<'date' | 'age'>('date');
  const [dogDateNaiss, setDogDateNaiss] = useState('');
  const [dogAge, setDogAge] = useState('');
  const [savingDog, setSavingDog] = useState(false);
  const [dogNomError, setDogNomError] = useState(false);

  // Race picker (used inside dog modal)
  const [raceModal, setRaceModal] = useState(false);
  const [raceCustomMode, setRaceCustomMode] = useState<'croisé' | 'autre' | null>(null);
  const [raceCustomInput, setRaceCustomInput] = useState('');
  const [raceSearch, setRaceSearch] = useState('');
  const filteredRaces = useMemo(
    () => RACES.filter(r => r.toLowerCase().includes(raceSearch.toLowerCase())),
    [raceSearch],
  );

  // Pays picker
  const [paysModal, setPaysModal] = useState(false);
  const [paysSearch, setPaysSearch] = useState('');
  const filteredCountries = useMemo(
    () => COUNTRIES.filter(c => c.toLowerCase().includes(paysSearch.toLowerCase())),
    [paysSearch],
  );

  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => { init(); }, []);

  async function init() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setLoading(false); return; }
    setUserId(session.user.id);

    // Check push permission status and refresh token
    Notifications.getPermissionsAsync().then(({ status }) => {
      setNotifPermission(status as 'granted' | 'denied' | 'undetermined');
    });
    savePushToken(session.user.id);

    const [{ data }, { data: chiensData }] = await Promise.all([
      supabase.from('profils')
        .select('username,notif_follow,notif_lieu_nearby,notif_messages,notif_suggestion_validee,notif_photo_like,notif_friend_lieu,notif_partner,notif_offer,notif_broadcast,notif_new_post,notif_birthday,rayon_km,prenom,ville,pays,genre,telephone,bio,instagram_url,tiktok_url,nom_chien,race_chien,genre_chien,tranche_age_chien,statut_amoureux_chien,date_naissance_humain,date_naissance_chien')
        .eq('id', session.user.id).single(),
      supabase.from('chiens')
        .select('id,nom,race,genre,tranche_age,statut_amoureux,date_naissance')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: true }),
    ]);

    if (data) {
      if (data.username) { setUsername(data.username); setCurrentUsername(data.username); }
      setNotifFollow(data.notif_follow ?? true);
      setNotifLieuNearby(data.notif_lieu_nearby ?? true);
      setNotifMessages(data.notif_messages ?? true);
      setNotifSuggestionValidee(data.notif_suggestion_validee ?? true);
      setNotifPhotoLike(data.notif_photo_like ?? true);
      setNotifFriendLieu(data.notif_friend_lieu ?? true);
      setNotifPartner(data.notif_partner ?? true);
      setNotifOffer(data.notif_offer ?? true);
      setNotifBroadcast(data.notif_broadcast ?? true);
      setNotifNewPost(data.notif_new_post ?? true);
      setNotifBirthday(data.notif_birthday ?? true);
      setRayonKm(data.rayon_km ?? 20);
      setPrenom(data.prenom || '');
      setVille(data.ville || '');
      setPays(data.pays || '');
      setGenre(data.genre || '');
      setTelephone(data.telephone || '');
      setBio(data.bio || '');
      setInstagram(data.instagram_url || '');
      setTiktok(data.tiktok_url || '');

      const dh = data.date_naissance_humain || '';
      if (dh) {
        const mode = detectMode(dh);
        setDateMode(mode);
        if (mode === 'date') setDateNaissance(dh);
        else setAgeVal(dh.replace(' ans', ''));
      }

      // Auto-migrate dog from profils to chiens if chiens table is empty
      if ((!chiensData || chiensData.length === 0) && data.nom_chien) {
        const { data: newDog } = await supabase.from('chiens').insert({
          user_id: session.user.id,
          nom: data.nom_chien,
          race: data.race_chien || null,
          genre: data.genre_chien || null,
          tranche_age: data.tranche_age_chien || null,
          statut_amoureux: data.statut_amoureux_chien || null,
          date_naissance: data.date_naissance_chien || null,
        }).select('id,nom,race,genre,tranche_age,statut_amoureux,date_naissance').single();
        if (newDog) setChiens([newDog]);
      } else {
        setChiens(chiensData || []);
      }
    }
    setLoading(false);
  }

  async function toggleNotif(key: 'notif_follow' | 'notif_lieu_nearby' | 'notif_messages' | 'notif_suggestion_validee' | 'notif_photo_like' | 'notif_friend_lieu' | 'notif_partner' | 'notif_offer' | 'notif_broadcast' | 'notif_new_post' | 'notif_birthday', value: boolean) {
    if (!userId) return;
    if (key === 'notif_follow') setNotifFollow(value);
    else if (key === 'notif_lieu_nearby') setNotifLieuNearby(value);
    else if (key === 'notif_messages') setNotifMessages(value);
    else if (key === 'notif_suggestion_validee') setNotifSuggestionValidee(value);
    else if (key === 'notif_photo_like') setNotifPhotoLike(value);
    else if (key === 'notif_friend_lieu') setNotifFriendLieu(value);
    else if (key === 'notif_partner') setNotifPartner(value);
    else if (key === 'notif_offer') setNotifOffer(value);
    else if (key === 'notif_broadcast') setNotifBroadcast(value);
    else if (key === 'notif_birthday') setNotifBirthday(value);
    else setNotifNewPost(value);
    await supabase.from('profils').update({ [key]: value }).eq('id', userId);
  }

  async function updateRayonKm(km: number) {
    if (!userId) return;
    setRayonKm(km);
    await supabase.from('profils').update({ rayon_km: km }).eq('id', userId);
  }

  async function saveUsername() {
    if (!userId || !username.trim()) return;
    const clean = username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
    if (clean.length < 3) { Alert.alert('Trop court', 'Le nom d\'utilisateur doit faire au moins 3 caractères.'); return; }
    setSavingUsername(true);
    const { error } = await supabase.from('profils').update({ username: clean }).eq('id', userId);
    setSavingUsername(false);
    if (error) {
      if (error.message.includes('unique') || error.code === '23505') {
        Alert.alert('Déjà pris', 'Ce nom d\'utilisateur est déjà utilisé.');
      } else {
        Alert.alert('Erreur', error.message);
      }
      return;
    }
    setCurrentUsername(clean);
    setUsername(clean);
    Alert.alert('Enregistré', `Ton username est maintenant @${clean}`);
  }

  async function saveProfil() {
    if (!userId) return;
    const humanBirth = dateMode === 'date' ? dateNaissance.trim() : (ageVal.trim() ? `${ageVal.trim()} ans` : '');
    if (!humanBirth) { Alert.alert('Champ requis', 'Ajoute ton anniversaire.'); return; }

    if (telephone.trim() && !normalizePhone(telephone.trim())) {
      Alert.alert('Numéro invalide', 'Vérifie ton numéro de téléphone (au moins 9 chiffres).');
      return;
    }
    setSavingProfil(true);
    const { error } = await supabase.from('profils').update({
      prenom: prenom.trim() || null,
      ville: ville.trim() || null,
      pays: pays || null,
      genre: genre || null,
      telephone: telephone.trim() || null,
      bio: bio.trim() || null,
      instagram_url: instagram.trim() || null,
      tiktok_url: tiktok.trim() || null,
      date_naissance_humain: humanBirth,
    }).eq('id', userId);
    setSavingProfil(false);
    if (error) { Alert.alert('Erreur', error.message); return; }
    setProfilOpen(false);
    Alert.alert('Enregistré', 'Tes informations ont été mises à jour.');
  }

  function openDogModal(dog: Dog | null) {
    setEditingDog(dog);
    if (dog) {
      setDogNom(dog.nom);
      setDogRace(dog.race || '');
      setDogGenre(dog.genre || '');
      setDogTrancheAge(dog.tranche_age || '');
      setDogStatut(dog.statut_amoureux || '');
      const dn = dog.date_naissance || '';
      if (dn) {
        const m = detectMode(dn);
        setDogDateMode(m);
        if (m === 'date') setDogDateNaiss(dn);
        else setDogAge(dn.replace(' ans', ''));
      } else {
        setDogDateMode('date'); setDogDateNaiss(''); setDogAge('');
      }
    } else {
      setDogNom(''); setDogRace(''); setDogGenre(''); setDogTrancheAge('');
      setDogStatut(''); setDogDateMode('date'); setDogDateNaiss(''); setDogAge('');
    }
    setDogNomError(false);
    setDogModal(true);
  }

  async function saveDog() {
    if (!userId) return;
    if (!dogNom.trim()) { setDogNomError(true); return; }
    const dn = dogDateMode === 'date' ? dogDateNaiss.trim() || null : (dogAge.trim() ? `${dogAge.trim()} ans` : null);

    setSavingDog(true);
    if (editingDog) {
      await supabase.from('chiens').update({
        nom: dogNom.trim(),
        race: dogRace || null,
        genre: dogGenre || null,
        tranche_age: dogTrancheAge || null,
        statut_amoureux: dogStatut || null,
        date_naissance: dn,
      }).eq('id', editingDog.id);
    } else {
      await supabase.from('chiens').insert({
        user_id: userId,
        nom: dogNom.trim(),
        race: dogRace || null,
        genre: dogGenre || null,
        tranche_age: dogTrancheAge || null,
        statut_amoureux: dogStatut || null,
        date_naissance: dn,
      });
    }

    const { data: updated } = await supabase.from('chiens')
      .select('id,nom,race,genre,tranche_age,statut_amoureux,date_naissance')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    const list = updated || [];
    setChiens(list);

    if (list[0]) {
      await supabase.from('profils').update({
        nom_chien: list[0].nom,
        race_chien: list[0].race || null,
        genre_chien: list[0].genre || null,
        tranche_age_chien: list[0].tranche_age || null,
        statut_amoureux_chien: list[0].statut_amoureux || null,
        date_naissance_chien: list[0].date_naissance || null,
      }).eq('id', userId);
    }

    setSavingDog(false);
    setDogModal(false);
  }

  async function deleteDog(dog: Dog) {
    if (!userId) return;
    Alert.alert(
      'Supprimer ce chien ?',
      `Le passeport de ${dog.nom} sera supprimé définitivement.`,
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Supprimer', style: 'destructive', onPress: async () => {
          await supabase.from('chiens').delete().eq('id', dog.id);
          const updated = chiens.filter(c => c.id !== dog.id);
          setChiens(updated);
          if (updated[0]) {
            await supabase.from('profils').update({
              nom_chien: updated[0].nom,
              race_chien: updated[0].race || null,
              genre_chien: updated[0].genre || null,
              tranche_age_chien: updated[0].tranche_age || null,
              statut_amoureux_chien: updated[0].statut_amoureux || null,
              date_naissance_chien: updated[0].date_naissance || null,
            }).eq('id', userId!);
          } else {
            await supabase.from('profils').update({
              nom_chien: null, race_chien: null, genre_chien: null,
              tranche_age_chien: null, statut_amoureux_chien: null, date_naissance_chien: null,
            }).eq('id', userId!);
          }
        }},
      ]
    );
  }

  async function confirmLogout() {
    Alert.alert('Déconnexion', 'Tu vas être déconnecté(e).', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Déconnecter', style: 'destructive', onPress: () => supabase.auth.signOut() },
    ]);
  }

  async function confirmDeleteAccount() {
    Alert.alert(
      'Supprimer mon compte',
      'Cette action est irréversible. Toutes tes données (avis, favoris, photos) seront supprimées.',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Supprimer', style: 'destructive', onPress: async () => {
          if (!userId) return;
          const { error } = await supabase.from('profils').delete().eq('id', userId);
          if (error) { Alert.alert('Erreur', 'Impossible de supprimer le compte. Réessaie ou contacte le support.'); return; }
          await supabase.auth.signOut();
        }},
      ]
    );
  }

  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={colors.terra} />;

  return (
    <>
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* Mon profil */}
      <View style={styles.section}>
        <TouchableOpacity
          style={[styles.sectionHeaderRow, !profilOpen && { borderBottomWidth: 0 }]}
          onPress={() => setProfilOpen(v => !v)}
          activeOpacity={0.7}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.sectionTitle}>Mon profil</Text>
            {!profilOpen && (prenom || ville) ? (
              <Text style={styles.sectionSummary} numberOfLines={1}>
                {[prenom, ville].filter(Boolean).join(' · ')}
              </Text>
            ) : null}
          </View>
          <Ionicons name={profilOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
        </TouchableOpacity>

        {profilOpen && <><View style={styles.field}>
          <Text style={styles.fieldLabel}>Prénom</Text>
          <TextInput style={styles.fieldInput} value={prenom} onChangeText={setPrenom}
            placeholder="Ex : Marie" placeholderTextColor={colors.textMuted} />
        </View>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Ville</Text>
          <TextInput style={styles.fieldInput} value={ville} onChangeText={setVille}
            placeholder="Ex : Paris" placeholderTextColor={colors.textMuted} />
        </View>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Pays</Text>
          <TouchableOpacity style={styles.fieldInput} onPress={() => { setPaysSearch(''); setPaysModal(true); }}>
            <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 14, color: pays ? colors.bordeaux : colors.textMuted }}>
              {pays || 'Choisir un pays…'}
            </Text>
          </TouchableOpacity>
        </View>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Genre</Text>
          <View style={styles.pillGrid}>
            {OWNER_GENRES.map(g => {
              const active = genre === g.key;
              return (
                <TouchableOpacity
                  key={g.key}
                  style={[styles.pill, active && styles.pillActive]}
                  onPress={() => setGenre(active ? '' : g.key)}
                >
                  <Text style={[styles.pillLabel, active && styles.pillLabelActive]}>{g.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Téléphone</Text>
          <TextInput style={styles.fieldInput} value={telephone} onChangeText={setTelephone}
            placeholder="Ex : 06 12 34 56 78" placeholderTextColor={colors.textMuted}
            keyboardType="phone-pad" />
          <Text style={styles.fieldHint}>Optionnel — sert uniquement à te retrouver via tes contacts, jamais affiché publiquement.</Text>
        </View>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Bio</Text>
          <TextInput style={[styles.fieldInput, { minHeight: 70, textAlignVertical: 'top' }]}
            value={bio} onChangeText={setBio} placeholder="Quelques mots sur toi…"
            placeholderTextColor={colors.textMuted} multiline />
        </View>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Instagram</Text>
          <TextInput style={styles.fieldInput} value={instagram} onChangeText={setInstagram}
            placeholder="https://instagram.com/ton_compte" placeholderTextColor={colors.textMuted}
            autoCapitalize="none" keyboardType="url" />
        </View>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>TikTok</Text>
          <TextInput style={styles.fieldInput} value={tiktok} onChangeText={setTiktok}
            placeholder="https://tiktok.com/@ton_compte" placeholderTextColor={colors.textMuted}
            autoCapitalize="none" keyboardType="url" />
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Ton anniversaire *</Text>
          <View style={styles.modeToggle}>
            <TouchableOpacity
              style={[styles.modeBtn, dateMode === 'date' && styles.modeBtnActive]}
              onPress={() => { setDateMode('date'); setAgeVal(''); }}
            >
              <Text style={[styles.modeBtnText, dateMode === 'date' && styles.modeBtnTextActive]}>📅 Date</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeBtn, dateMode === 'age' && styles.modeBtnActive]}
              onPress={() => { setDateMode('age'); setDateNaissance(''); }}
            >
              <Text style={[styles.modeBtnText, dateMode === 'age' && styles.modeBtnTextActive]}>🔢 Âge</Text>
            </TouchableOpacity>
          </View>
          {dateMode === 'date' ? (
            <TextInput style={styles.fieldInput} value={dateNaissance}
              onChangeText={t => setDateNaissance(formatDate(t))}
              placeholder="JJ/MM/AAAA" placeholderTextColor={colors.textMuted}
              keyboardType="numeric" maxLength={10} />
          ) : (
            <View style={styles.ageRow}>
              <TextInput style={[styles.fieldInput, { flex: 1 }]} value={ageVal}
                onChangeText={setAgeVal} placeholder="Ex : 28"
                placeholderTextColor={colors.textMuted} keyboardType="numeric" maxLength={3} />
              <Text style={styles.ageUnit}>ans</Text>
            </View>
          )}
        </View>

        <TouchableOpacity style={styles.saveBtn} onPress={saveProfil} disabled={savingProfil}>
          {savingProfil
            ? <ActivityIndicator color={colors.ivory} size="small" />
            : <Text style={styles.saveBtnText}>Enregistrer les modifications</Text>}
        </TouchableOpacity>
        </>}
      </View>

      {/* Mes chiens / Passeports */}
      <View style={styles.section}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Mes chiens — Passeports</Text>
          <TouchableOpacity onPress={() => openDogModal(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="add-circle-outline" size={22} color={colors.terra} />
          </TouchableOpacity>
        </View>

        {chiens.length === 0 ? (
          <View style={styles.dogsEmpty}>
            <Text style={styles.dogsEmptyText}>Aucun chien ajouté pour l'instant.</Text>
          </View>
        ) : (
          chiens.map((dog, idx) => (
            <View key={dog.id} style={[styles.dogCard, idx < chiens.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
              <View style={styles.dogCardLeft}>
                <View style={styles.dogCardNameRow}>
                  <Text style={styles.dogCardNom}>{dog.nom}</Text>
                  {idx === 0 && <View style={styles.dogPrimaryBadge}><Text style={styles.dogPrimaryBadgeText}>Principal</Text></View>}
                </View>
                <Text style={styles.dogCardMeta}>
                  {[dog.race, dog.genre ? GENRES.find(g => g.key === dog.genre)?.label : null, dog.tranche_age ? TRANCHES_AGE.find(t => t.key === dog.tranche_age)?.label : null].filter(Boolean).join(' · ')}
                </Text>
                {dog.date_naissance && (
                  <Text style={styles.dogCardMeta}>{dog.date_naissance.includes('/') && dog.date_naissance.length === 10 ? `Né(e) le ${dog.date_naissance}` : dog.date_naissance}</Text>
                )}
                {dog.statut_amoureux && (
                  <Text style={styles.dogCardMeta}>{STATUTS_AMOUREUX.find(s => s.key === dog.statut_amoureux)?.emoji} {STATUTS_AMOUREUX.find(s => s.key === dog.statut_amoureux)?.label}</Text>
                )}
              </View>
              <View style={styles.dogCardActions}>
                <TouchableOpacity onPress={() => openDogModal(dog)} style={styles.dogCardBtn}>
                  <Ionicons name="create-outline" size={18} color={colors.bordeaux} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => deleteDog(dog)} style={styles.dogCardBtn}>
                  <Ionicons name="trash-outline" size={18} color="#C62828" />
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}

        <TouchableOpacity style={styles.addDogBtn} onPress={() => openDogModal(null)}>
          <Ionicons name="paw-outline" size={16} color={colors.terra} />
          <Text style={styles.addDogBtnText}>Ajouter un passeport</Text>
        </TouchableOpacity>
      </View>

      {/* Username */}
      <View style={styles.section}>
        <View style={styles.sectionTitleWrap}><Text style={styles.sectionTitle}>Nom d'utilisateur</Text></View>
        <View style={styles.usernameRow}>
          <Text style={styles.atSign}>@</Text>
          <TextInput
            style={styles.usernameInput}
            value={username}
            onChangeText={setUsername}
            placeholder="mon_username"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <Text style={styles.usernameHint}>Lettres minuscules, chiffres, . _ - uniquement. Min. 3 caractères.</Text>
        {username !== currentUsername && (
          <TouchableOpacity style={styles.saveBtn} onPress={saveUsername} disabled={savingUsername}>
            {savingUsername
              ? <ActivityIndicator color={colors.ivory} size="small" />
              : <Text style={styles.saveBtnText}>Enregistrer</Text>}
          </TouchableOpacity>
        )}
      </View>

      {/* Notifications */}
      <View style={styles.section}>
        <View style={styles.sectionTitleWrap}><Text style={styles.sectionTitle}>Notifications</Text></View>
        {notifPermission === 'denied' && (
          <TouchableOpacity style={styles.notifWarning} onPress={() => Linking.openSettings()}>
            <Ionicons name="notifications-off-outline" size={16} color="#B71C1C" />
            <Text style={styles.notifWarningText}>
              Les notifications sont désactivées dans les réglages de ton téléphone. Appuie ici pour les activer.
            </Text>
          </TouchableOpacity>
        )}
        <View style={styles.toggleRow}>
          <View style={styles.toggleInfo}>
            <Text style={styles.toggleLabel}>Nouvel abonné</Text>
            <Text style={styles.toggleSub}>Quand quelqu'un commence à te suivre</Text>
          </View>
          <Switch value={notifFollow} onValueChange={v => toggleNotif('notif_follow', v)}
            trackColor={{ false: colors.border, true: colors.terra }} thumbColor={colors.ivory} />
        </View>
        <View style={notifLieuNearby ? styles.toggleRow : [styles.toggleRow, { borderBottomWidth: 0 }]}>
          <View style={styles.toggleInfo}>
            <Text style={styles.toggleLabel}>Nouveau lieu près de moi</Text>
            <Text style={styles.toggleSub}>Quand un lieu dog-friendly est ajouté près de chez toi</Text>
          </View>
          <Switch value={notifLieuNearby} onValueChange={v => toggleNotif('notif_lieu_nearby', v)}
            trackColor={{ false: colors.border, true: colors.terra }} thumbColor={colors.ivory} />
        </View>
        {notifLieuNearby && (
          <View style={[styles.toggleRow, { paddingTop: 0 }]}>
            <View style={styles.toggleInfo}>
              <Text style={styles.toggleSub}>Distance</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {[5, 10, 20, 50].map(km => (
                <TouchableOpacity
                  key={km}
                  onPress={() => updateRayonKm(km)}
                  style={{
                    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14,
                    backgroundColor: rayonKm === km ? colors.terra : 'transparent',
                    borderWidth: 1, borderColor: rayonKm === km ? colors.terra : colors.border,
                  }}
                >
                  <Text style={{ fontSize: 12, color: rayonKm === km ? colors.ivory : colors.textMuted, fontFamily: 'DMSans_500Medium' }}>
                    {km} km
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
        <View style={styles.toggleRow}>
          <View style={styles.toggleInfo}>
            <Text style={styles.toggleLabel}>Messages</Text>
            <Text style={styles.toggleSub}>Nouveaux messages reçus dans tes conversations</Text>
          </View>
          <Switch value={notifMessages} onValueChange={v => toggleNotif('notif_messages', v)}
            trackColor={{ false: colors.border, true: colors.terra }} thumbColor={colors.ivory} />
        </View>
        <View style={styles.toggleRow}>
          <View style={styles.toggleInfo}>
            <Text style={styles.toggleLabel}>Lieu suggéré validé</Text>
            <Text style={styles.toggleSub}>Quand un lieu que tu as proposé est publié sur la carte</Text>
          </View>
          <Switch value={notifSuggestionValidee} onValueChange={v => toggleNotif('notif_suggestion_validee', v)}
            trackColor={{ false: colors.border, true: colors.terra }} thumbColor={colors.ivory} />
        </View>
        <View style={styles.toggleRow}>
          <View style={styles.toggleInfo}>
            <Text style={styles.toggleLabel}>Likes</Text>
            <Text style={styles.toggleSub}>Quand quelqu'un aime une de tes photos</Text>
          </View>
          <Switch value={notifPhotoLike} onValueChange={v => toggleNotif('notif_photo_like', v)}
            trackColor={{ false: colors.border, true: colors.terra }} thumbColor={colors.ivory} />
        </View>
        <View style={styles.toggleRow}>
          <View style={styles.toggleInfo}>
            <Text style={styles.toggleLabel}>Photos de mes abonnements</Text>
            <Text style={styles.toggleSub}>Être notifié(e) quand une personne que tu suis publie une photo</Text>
          </View>
          <Switch value={notifNewPost} onValueChange={v => toggleNotif('notif_new_post', v)}
            trackColor={{ false: colors.border, true: colors.terra }} thumbColor={colors.ivory} />
        </View>
        <View style={styles.toggleRow}>
          <View style={styles.toggleInfo}>
            <Text style={styles.toggleLabel}>Lieu ajouté par un ami</Text>
            <Text style={styles.toggleSub}>Quand une personne que tu suis ajoute un lieu</Text>
          </View>
          <Switch value={notifFriendLieu} onValueChange={v => toggleNotif('notif_friend_lieu', v)}
            trackColor={{ false: colors.border, true: colors.terra }} thumbColor={colors.ivory} />
        </View>
        <View style={styles.toggleRow}>
          <View style={styles.toggleInfo}>
            <Text style={styles.toggleLabel}>Nouveau partenaire</Text>
            <Text style={styles.toggleSub}>Quand un nouvel établissement partenaire rejoint The Pack</Text>
          </View>
          <Switch value={notifPartner} onValueChange={v => toggleNotif('notif_partner', v)}
            trackColor={{ false: colors.border, true: colors.terra }} thumbColor={colors.ivory} />
        </View>
        <View style={styles.toggleRow}>
          <View style={styles.toggleInfo}>
            <Text style={styles.toggleLabel}>Nouvelle offre</Text>
            <Text style={styles.toggleSub}>Quand un partenaire ajoute ou met à jour une offre</Text>
          </View>
          <Switch value={notifOffer} onValueChange={v => toggleNotif('notif_offer', v)}
            trackColor={{ false: colors.border, true: colors.terra }} thumbColor={colors.ivory} />
        </View>
        <View style={styles.toggleRow}>
          <View style={styles.toggleInfo}>
            <Text style={styles.toggleLabel}>Actualités & annonces</Text>
            <Text style={styles.toggleSub}>Annonces générales de l'équipe The Pack La Meute</Text>
          </View>
          <Switch value={notifBroadcast} onValueChange={v => toggleNotif('notif_broadcast', v)}
            trackColor={{ false: colors.border, true: colors.terra }} thumbColor={colors.ivory} />
        </View>
        <View style={[styles.toggleRow, { borderBottomWidth: 0 }]}>
          <View style={styles.toggleInfo}>
            <Text style={styles.toggleLabel}>Anniversaires des chiens que je suis</Text>
            <Text style={styles.toggleSub}>Être notifié(e) le jour de l'anniversaire d'un chien que tu suis</Text>
          </View>
          <Switch value={notifBirthday} onValueChange={v => toggleNotif('notif_birthday', v)}
            trackColor={{ false: colors.border, true: colors.terra }} thumbColor={colors.ivory} />
        </View>
      </View>

      {/* Réservations */}
      <View style={styles.section}>
        <View style={styles.sectionTitleWrap}><Text style={styles.sectionTitle}>Réservations</Text></View>
        <TouchableOpacity style={[styles.menuRow, { borderBottomWidth: 0 }]} onPress={() => navigation.navigate('MesReservations')}>
          <Ionicons name="calendar-outline" size={20} color={colors.bordeaux} />
          <Text style={styles.menuRowText}>Mes réservations</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Compte */}
      <View style={styles.section}>
        <View style={styles.sectionTitleWrap}><Text style={styles.sectionTitle}>Mon compte</Text></View>
        <TouchableOpacity style={styles.menuRow} onPress={confirmLogout}>
          <Ionicons name="log-out-outline" size={20} color={colors.bordeaux} />
          <Text style={styles.menuRowText}>Se déconnecter</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.menuRow, { borderBottomWidth: 0 }]} onPress={confirmDeleteAccount}>
          <Ionicons name="trash-outline" size={20} color="#C62828" />
          <Text style={[styles.menuRowText, { color: '#C62828' }]}>Supprimer mon compte</Text>
          <Ionicons name="chevron-forward" size={16} color="#C62828" />
        </TouchableOpacity>
      </View>

      {/* À propos */}
      <View style={styles.section}>
        <View style={styles.sectionTitleWrap}><Text style={styles.sectionTitle}>À propos</Text></View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Version</Text>
          <Text style={styles.infoValue}>1.0.0</Text>
        </View>
        <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
          <Text style={styles.infoLabel}>Développé par</Text>
          <Text style={styles.infoValue}>The Pack La Meute</Text>
        </View>
      </View>

    </ScrollView>

    {/* Dog modal (passeport form) */}
    <Modal
      visible={dogModal}
      animationType="slide"
      transparent
      onRequestClose={() => setDogModal(false)}
    >
      <KeyboardAvoidingView style={styles.dogModalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.dogModalCard}>
          <View style={styles.dogModalHeader}>
            <Text style={styles.dogModalTitle}>{editingDog ? 'Modifier le passeport' : 'Nouveau passeport'}</Text>
            <TouchableOpacity onPress={() => setDogModal(false)}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.dogModalContent} keyboardShouldPersistTaps="handled">
            {/* Nom */}
            <View style={styles.dogField}>
              <Text style={styles.dogFieldLabel}>Nom du chien *</Text>
              <TextInput
                style={[styles.dogFieldInput, dogNomError && styles.dogFieldInputError]}
                value={dogNom}
                onChangeText={t => { setDogNom(t); setDogNomError(false); }}
                placeholder="Ex : Albus"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="words"
              />
              {dogNomError && <Text style={styles.dogFieldError}>Le nom est requis</Text>}
            </View>

            {/* Race */}
            <View style={styles.dogField}>
              <Text style={styles.dogFieldLabel}>Race</Text>
              <TouchableOpacity
                style={styles.dogRacePicker}
                onPress={() => { setRaceSearch(''); setRaceCustomMode(null); setRaceModal(true); }}
              >
                <Text style={[styles.dogRacePickerText, !dogRace && { color: colors.textMuted }]}>
                  {dogRace || 'Choisir une race…'}
                </Text>
                <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {/* Genre */}
            <View style={styles.dogField}>
              <Text style={styles.dogFieldLabel}>Genre</Text>
              <View style={styles.pillGrid}>
                {GENRES.map(g => {
                  const active = dogGenre === g.key;
                  return (
                    <TouchableOpacity
                      key={g.key}
                      style={[styles.pill, active && styles.pillActive]}
                      onPress={() => setDogGenre(active ? '' : g.key)}
                    >
                      <Text style={styles.pillEmoji}>{g.emoji}</Text>
                      <Text style={[styles.pillLabel, active && styles.pillLabelActive]}>{g.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Tranche d'âge */}
            <View style={styles.dogField}>
              <Text style={styles.dogFieldLabel}>Tranche d'âge</Text>
              <View style={styles.pillGrid}>
                {TRANCHES_AGE.map(t => {
                  const active = dogTrancheAge === t.key;
                  return (
                    <TouchableOpacity
                      key={t.key}
                      style={[styles.pill, active && styles.pillActive]}
                      onPress={() => setDogTrancheAge(active ? '' : t.key)}
                    >
                      <Text style={styles.pillEmoji}>{t.emoji}</Text>
                      <View>
                        <Text style={[styles.pillLabel, active && styles.pillLabelActive]}>{t.label}</Text>
                        <Text style={[styles.pillSub, active && styles.pillLabelActive]}>{t.sub}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Situation amoureuse */}
            <View style={styles.dogField}>
              <Text style={styles.dogFieldLabel}>Situation amoureuse du chien</Text>
              <View style={styles.pillGrid}>
                {STATUTS_AMOUREUX.map(s => {
                  const active = dogStatut === s.key;
                  return (
                    <TouchableOpacity
                      key={s.key}
                      style={[styles.pill, active && styles.pillActive]}
                      onPress={() => setDogStatut(active ? '' : s.key)}
                    >
                      <Text style={styles.pillEmoji}>{s.emoji}</Text>
                      <Text style={[styles.pillLabel, active && styles.pillLabelActive]}>{s.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Anniversaire */}
            <View style={styles.dogField}>
              <Text style={styles.dogFieldLabel}>Anniversaire</Text>
              <View style={styles.modeToggle}>
                <TouchableOpacity
                  style={[styles.modeBtn, dogDateMode === 'date' && styles.modeBtnActive]}
                  onPress={() => { setDogDateMode('date'); setDogAge(''); }}
                >
                  <Text style={[styles.modeBtnText, dogDateMode === 'date' && styles.modeBtnTextActive]}>📅 Date</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modeBtn, dogDateMode === 'age' && styles.modeBtnActive]}
                  onPress={() => { setDogDateMode('age'); setDogDateNaiss(''); }}
                >
                  <Text style={[styles.modeBtnText, dogDateMode === 'age' && styles.modeBtnTextActive]}>🔢 Âge</Text>
                </TouchableOpacity>
              </View>
              {dogDateMode === 'date' ? (
                <TextInput
                  style={styles.dogFieldInput}
                  value={dogDateNaiss}
                  onChangeText={t => setDogDateNaiss(formatDate(t))}
                  placeholder="JJ/MM/AAAA"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="numeric"
                  maxLength={10}
                />
              ) : (
                <View style={styles.ageRow}>
                  <TextInput
                    style={[styles.dogFieldInput, { flex: 1 }]}
                    value={dogAge}
                    onChangeText={t => setDogAge(t.replace(/\D/g, ''))}
                    placeholder="Ex : 3"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="numeric"
                    maxLength={3}
                  />
                  <Text style={styles.ageUnit}>ans</Text>
                </View>
              )}
            </View>

            <TouchableOpacity style={styles.saveBtn} onPress={saveDog} disabled={savingDog}>
              {savingDog
                ? <ActivityIndicator color={colors.ivory} size="small" />
                : <Text style={styles.saveBtnText}>Enregistrer le passeport</Text>}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>

      {/* Race picker — nested inside dog modal to fix Android touch issues */}
      <Modal
        visible={raceModal}
        animationType="slide"
        transparent
        onRequestClose={() => { Keyboard.dismiss(); setRaceModal(false); setRaceCustomMode(null); setRaceCustomInput(''); setRaceSearch(''); }}
      >
      <KeyboardAvoidingView style={styles.raceModalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.raceModalCard}>
          <View style={styles.raceModalHeader}>
            <Text style={styles.raceModalTitle}>{raceCustomMode ? (raceCustomMode === 'croisé' ? 'Chien croisé' : 'Autre race') : 'Choisir une race'}</Text>
            <TouchableOpacity onPress={() => { if (raceCustomMode) { setRaceCustomMode(null); setRaceCustomInput(''); } else { Keyboard.dismiss(); setRaceModal(false); setRaceSearch(''); } }}>
              <Ionicons name={raceCustomMode ? 'arrow-back' : 'close'} size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
          {raceCustomMode ? (
            <View style={{ padding: 16 }}>
              <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted, marginBottom: 10 }}>
                {raceCustomMode === 'croisé' ? 'Précise les races mélangées (ex : Labrador / Berger)' : 'Précise la race de ton chien'}
              </Text>
              <TextInput
                style={{ borderWidth: 1.5, borderColor: colors.border, borderRadius: 10, padding: 12, fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.bordeaux, backgroundColor: 'white' }}
                placeholder={raceCustomMode === 'croisé' ? 'Ex : Labrador / Berger Allemand' : 'Ex : Pomsky'}
                placeholderTextColor={colors.textMuted}
                value={raceCustomInput}
                onChangeText={setRaceCustomInput}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={() => {
                  const val = raceCustomInput.trim();
                  if (val) setDogRace(raceCustomMode === 'croisé' ? `Croisé ${val}` : val);
                  setRaceModal(false); setRaceCustomMode(null); setRaceCustomInput(''); setRaceSearch('');
                }}
              />
              <TouchableOpacity
                style={{ backgroundColor: raceCustomInput.trim() ? colors.bordeaux : colors.border, borderRadius: 10, padding: 13, alignItems: 'center', marginTop: 12 }}
                onPress={() => {
                  const val = raceCustomInput.trim();
                  if (val) setDogRace(raceCustomMode === 'croisé' ? `Croisé ${val}` : val);
                  setRaceModal(false); setRaceCustomMode(null); setRaceCustomInput(''); setRaceSearch('');
                }}
                disabled={!raceCustomInput.trim()}
              >
                <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 14, color: 'white' }}>Confirmer</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={styles.raceSearchWrap}>
                <Ionicons name="search" size={15} color={colors.textMuted} />
                <TextInput
                  style={styles.raceSearchInput}
                  placeholder="Rechercher une race…"
                  placeholderTextColor={colors.textMuted}
                  value={raceSearch}
                  onChangeText={setRaceSearch}
                  autoCorrect={false}
                  returnKeyType="search"
                />
                {raceSearch.length > 0 && (
                  <TouchableOpacity onPress={() => setRaceSearch('')}>
                    <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                  </TouchableOpacity>
                )}
              </View>
              <FlatList
                data={filteredRaces}
                extraData={raceSearch}
                keyExtractor={r => r}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[styles.raceItem, dogRace === item && styles.raceItemActive]}
                    onPress={() => {
                      if (item === 'Croisé') { setRaceCustomMode('croisé'); setRaceCustomInput(''); setRaceSearch(''); return; }
                      if (item === 'Autre race') { setRaceCustomMode('autre'); setRaceCustomInput(''); setRaceSearch(''); return; }
                      Keyboard.dismiss();
                      setDogRace(item); setRaceModal(false); setRaceSearch('');
                    }}
                  >
                    <Text style={[styles.raceItemText, dogRace === item && styles.raceItemTextActive]}>{item}</Text>
                    {dogRace === item && <Ionicons name="checkmark" size={16} color={colors.terra} />}
                  </TouchableOpacity>
                )}
                ListEmptyComponent={
                  <Text style={{ padding: 20, color: colors.textMuted, fontFamily: 'DMSans_400Regular', textAlign: 'center' }}>
                    Aucune race trouvée
                  </Text>
                }
              />
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
    </Modal>

    <Modal
      visible={paysModal}
      animationType="slide"
      transparent
      onRequestClose={() => { Keyboard.dismiss(); setPaysModal(false); setPaysSearch(''); }}
    >
      <KeyboardAvoidingView style={styles.raceModalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.raceModalCard}>
          <View style={styles.raceModalHeader}>
            <Text style={styles.raceModalTitle}>Choisir un pays</Text>
            <TouchableOpacity onPress={() => { Keyboard.dismiss(); setPaysModal(false); setPaysSearch(''); }}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
          <View style={styles.raceSearchWrap}>
            <Ionicons name="search" size={15} color={colors.textMuted} />
            <TextInput
              style={styles.raceSearchInput}
              placeholder="Rechercher un pays…"
              placeholderTextColor={colors.textMuted}
              value={paysSearch}
              onChangeText={setPaysSearch}
              autoCorrect={false}
              returnKeyType="search"
            />
            {paysSearch.length > 0 && (
              <TouchableOpacity onPress={() => setPaysSearch('')}>
                <Ionicons name="close-circle" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>
          <FlatList
            data={filteredCountries}
            extraData={paysSearch}
            keyExtractor={c => c}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.raceItem, pays === item && styles.raceItemActive]}
                onPress={() => { Keyboard.dismiss(); setPays(item); setPaysModal(false); setPaysSearch(''); }}
              >
                <Text style={[styles.raceItemText, pays === item && styles.raceItemTextActive]}>{item}</Text>
                {pays === item && <Ionicons name="checkmark" size={16} color={colors.terra} />}
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <Text style={{ padding: 20, color: colors.textMuted, fontFamily: 'DMSans_400Regular', textAlign: 'center' }}>
                Aucun pays trouvé
              </Text>
            }
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ivoryPale },
  content: { padding: 16, gap: 20, paddingBottom: 48 },
  section: {
    backgroundColor: colors.white, borderRadius: 16,
    borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
  },
  sectionTitle: {
    fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  sectionHeaderRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  sectionSummary: {
    fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.bordeaux, marginTop: 3,
  },
  sectionTitleWrap: {
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  notifWarning: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: '#FFEBEE', marginHorizontal: 16, marginTop: 10, marginBottom: 2,
    borderRadius: 10, padding: 12,
  },
  notifWarningText: {
    flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 12,
    color: '#B71C1C', lineHeight: 17,
  },
  field: {
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  fieldLabel: {
    fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.textMuted, marginBottom: 8,
  },
  fieldInput: {
    fontFamily: 'DMSans_400Regular', fontSize: 15, color: colors.bordeaux,
    borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: colors.ivoryPale,
  },
  fieldHint: {
    fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted, marginTop: 6, lineHeight: 15,
  },
  // Mode toggle
  modeToggle: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  modeBtn: {
    borderRadius: 20, borderWidth: 1.5, borderColor: colors.border,
    paddingVertical: 6, paddingHorizontal: 14, backgroundColor: colors.ivoryPale,
  },
  modeBtnActive: { backgroundColor: colors.bordeaux, borderColor: colors.bordeaux },
  modeBtnText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted },
  modeBtnTextActive: { color: colors.ivory, fontFamily: 'DMSans_500Medium' },
  ageRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ageUnit: { fontFamily: 'DMSans_400Regular', fontSize: 15, color: colors.textMuted },
  // Pills
  pillGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.ivoryPale, borderRadius: 20,
    paddingVertical: 7, paddingHorizontal: 12,
    borderWidth: 1.5, borderColor: colors.border,
  },
  pillActive: { backgroundColor: colors.terra, borderColor: colors.terra },
  pillEmoji: { fontSize: 14 },
  pillLabel: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.bordeaux },
  pillLabelActive: { color: colors.ivory, fontFamily: 'DMSans_500Medium' },
  pillSub: { fontFamily: 'DMSans_300Light', fontSize: 10, color: colors.textMuted },
  // Dog cards
  dogCard: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingHorizontal: 16, paddingVertical: 14, gap: 12,
  },
  dogCardLeft: { flex: 1 },
  dogCardNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  dogCardNom: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: colors.bordeaux },
  dogPrimaryBadge: {
    backgroundColor: colors.terra + '22', borderRadius: 8,
    paddingHorizontal: 7, paddingVertical: 2,
  },
  dogPrimaryBadgeText: { fontFamily: 'DMSans_500Medium', fontSize: 10, color: colors.terra },
  dogCardMeta: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted, marginTop: 2 },
  dogCardActions: { flexDirection: 'row', gap: 4, alignItems: 'center', marginTop: 2 },
  dogCardBtn: { padding: 6 },
  dogsEmpty: { padding: 20, alignItems: 'center' },
  dogsEmptyText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted },
  addDogBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    margin: 16, marginTop: 8, justifyContent: 'center',
    borderWidth: 1.5, borderColor: colors.terra, borderRadius: 12,
    borderStyle: 'dashed', padding: 12,
  },
  addDogBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.terra },
  // Username
  usernameRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 16, paddingTop: 12,
  },
  atSign: { fontFamily: 'DMSans_500Medium', fontSize: 16, color: colors.bordeaux },
  usernameInput: {
    flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 16, color: colors.bordeaux,
    borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 8,
  },
  usernameHint: {
    fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted,
    paddingHorizontal: 16, paddingBottom: 12, marginTop: 6,
  },
  saveBtn: {
    backgroundColor: colors.terra, margin: 16, marginTop: 12,
    borderRadius: 12, padding: 14, alignItems: 'center',
  },
  saveBtnText: { fontFamily: 'DMSans_500Medium', color: colors.ivory, fontSize: 14 },
  // Notifications
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  toggleInfo: { flex: 1, marginRight: 12 },
  toggleLabel: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.bordeaux },
  toggleSub: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted, marginTop: 1 },
  // Menu rows
  menuRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  menuRowText: { fontFamily: 'DMSans_400Regular', fontSize: 15, color: colors.bordeaux, flex: 1 },
  infoRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  infoLabel: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.textMuted },
  infoValue: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.bordeaux },
  // Dog modal
  dogModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  dogModalCard: {
    backgroundColor: colors.ivoryPale, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: '92%', overflow: 'hidden',
  },
  dogModalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    backgroundColor: colors.white,
  },
  dogModalTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: colors.bordeaux },
  dogModalContent: { padding: 16, gap: 4, paddingBottom: 32 },
  dogField: { paddingVertical: 10 },
  dogFieldLabel: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  dogFieldInput: {
    fontFamily: 'DMSans_400Regular', fontSize: 15, color: colors.bordeaux,
    borderWidth: 1.5, borderColor: colors.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 11,
    backgroundColor: colors.white,
  },
  dogFieldInputError: { borderColor: '#C43A3A' },
  dogFieldError: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: '#C43A3A', marginTop: 4 },
  dogRacePicker: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1.5, borderColor: colors.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 11, backgroundColor: colors.white,
  },
  dogRacePickerText: { fontFamily: 'DMSans_400Regular', fontSize: 15, color: colors.bordeaux, flex: 1 },
  // Race modal
  raceModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  raceModalCard: {
    backgroundColor: colors.ivoryLight, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '80%', overflow: 'hidden',
  },
  raceModalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  raceModalTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: colors.bordeaux },
  raceSearchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.white, marginHorizontal: 16, marginVertical: 12,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: colors.border,
  },
  raceSearchInput: { flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.bordeaux },
  raceItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  raceItemActive: { backgroundColor: 'rgba(185,120,80,0.06)' },
  raceItemText: { fontFamily: 'DMSans_400Regular', fontSize: 15, color: colors.bordeaux },
  raceItemTextActive: { fontFamily: 'DMSans_500Medium', color: colors.bordeaux },
});
