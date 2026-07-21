import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, Switch,
  Modal, FlatList, KeyboardAvoidingView, Platform, Keyboard,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';

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

  // Profil info
  const [prenom, setPrenom] = useState('');
  const [ville, setVille] = useState('');
  const [nomChien, setNomChien] = useState('');
  const [raceChien, setRaceChien] = useState('');
  const [bio, setBio] = useState('');
  const [instagram, setInstagram] = useState('');
  const [tiktok, setTiktok] = useState('');
  const [statutAmoureux, setStatutAmoureux] = useState('');

  // Anniversaires (mode date ou âge)
  const [dateMode, setDateMode] = useState<'date' | 'age'>('date');
  const [dateNaissance, setDateNaissance] = useState('');
  const [ageVal, setAgeVal] = useState('');
  const [dateChienMode, setDateChienMode] = useState<'date' | 'age'>('date');
  const [dateNaissanceChien, setDateNaissanceChien] = useState('');
  const [ageChienVal, setAgeChienVal] = useState('');

  const [savingProfil, setSavingProfil] = useState(false);

  // Race picker
  const [raceModal, setRaceModal] = useState(false);
  const [raceCustomMode, setRaceCustomMode] = useState<'croisé' | 'autre' | null>(null);
  const [raceCustomInput, setRaceCustomInput] = useState('');
  const [raceSearch, setRaceSearch] = useState('');
  const filteredRaces = useMemo(
    () => RACES.filter(r => r.toLowerCase().includes(raceSearch.toLowerCase())),
    [raceSearch],
  );

  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => { init(); }, []);

  async function init() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setLoading(false); return; }
    setUserId(session.user.id);
    const { data } = await supabase.from('profils')
      .select('username,notif_follow,notif_lieu_nearby,notif_messages,notif_suggestion_validee,prenom,ville,nom_chien,race_chien,bio,instagram_url,tiktok_url,statut_amoureux_chien,date_naissance_humain,date_naissance_chien')
      .eq('id', session.user.id).single();
    if (data) {
      if (data.username) { setUsername(data.username); setCurrentUsername(data.username); }
      setNotifFollow(data.notif_follow ?? true);
      setNotifLieuNearby(data.notif_lieu_nearby ?? true);
      setNotifMessages(data.notif_messages ?? true);
      setNotifSuggestionValidee(data.notif_suggestion_validee ?? true);
      setPrenom(data.prenom || '');
      setVille(data.ville || '');
      setNomChien(data.nom_chien || '');
      setRaceChien(data.race_chien || '');
      setBio(data.bio || '');
      setInstagram(data.instagram_url || '');
      setTiktok(data.tiktok_url || '');
      setStatutAmoureux(data.statut_amoureux_chien || '');

      const dh = data.date_naissance_humain || '';
      if (dh) {
        const mode = detectMode(dh);
        setDateMode(mode);
        if (mode === 'date') setDateNaissance(dh);
        else setAgeVal(dh.replace(' ans', ''));
      }
      const dc = data.date_naissance_chien || '';
      if (dc) {
        const mode = detectMode(dc);
        setDateChienMode(mode);
        if (mode === 'date') setDateNaissanceChien(dc);
        else setAgeChienVal(dc.replace(' ans', ''));
      }
    }
    setLoading(false);
  }

  async function toggleNotif(key: 'notif_follow' | 'notif_lieu_nearby' | 'notif_messages' | 'notif_suggestion_validee', value: boolean) {
    if (!userId) return;
    if (key === 'notif_follow') setNotifFollow(value);
    else if (key === 'notif_lieu_nearby') setNotifLieuNearby(value);
    else if (key === 'notif_messages') setNotifMessages(value);
    else setNotifSuggestionValidee(value);
    await supabase.from('profils').update({ [key]: value }).eq('id', userId);
  }

  async function saveUsername() {
    if (!userId || !username.trim()) return;
    const clean = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
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
    const dogBirth   = dateChienMode === 'date' ? dateNaissanceChien.trim() : (ageChienVal.trim() ? `${ageChienVal.trim()} ans` : '');

    if (!humanBirth) { Alert.alert('Champ requis', 'Ajoute ton anniversaire.'); return; }
    if (!dogBirth)   { Alert.alert('Champ requis', "Ajoute l'anniversaire de ton chien."); return; }

    setSavingProfil(true);
    const { error } = await supabase.from('profils').update({
      prenom: prenom.trim() || null,
      ville: ville.trim() || null,
      nom_chien: nomChien.trim() || null,
      race_chien: raceChien.trim() || null,
      bio: bio.trim() || null,
      instagram_url: instagram.trim() || null,
      tiktok_url: tiktok.trim() || null,
      statut_amoureux_chien: statutAmoureux || null,
      date_naissance_humain: humanBirth,
      date_naissance_chien: dogBirth,
    }).eq('id', userId);
    setSavingProfil(false);
    if (error) { Alert.alert('Erreur', error.message); return; }
    Alert.alert('Enregistré', 'Tes informations ont été mises à jour.');
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
        <Text style={styles.sectionTitle}>Mon profil</Text>

        <View style={styles.field}>
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

        {/* Anniversaire humain */}
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Ton anniversaire 🎂 *</Text>
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

        <View style={styles.fieldDivider} />

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Nom du chien</Text>
          <TextInput style={styles.fieldInput} value={nomChien} onChangeText={setNomChien}
            placeholder="Ex : Albus" placeholderTextColor={colors.textMuted} />
        </View>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Race</Text>
          <TouchableOpacity style={styles.racePicker} onPress={() => setRaceModal(true)}>
            <Text style={[styles.racePickerText, !raceChien && { color: colors.textMuted }]}>
              {raceChien || 'Choisir une race…'}
            </Text>
            <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Anniversaire chien */}
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Anniversaire du chien 🎂 *</Text>
          <View style={styles.modeToggle}>
            <TouchableOpacity
              style={[styles.modeBtn, dateChienMode === 'date' && styles.modeBtnActive]}
              onPress={() => { setDateChienMode('date'); setAgeChienVal(''); }}
            >
              <Text style={[styles.modeBtnText, dateChienMode === 'date' && styles.modeBtnTextActive]}>📅 Date</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeBtn, dateChienMode === 'age' && styles.modeBtnActive]}
              onPress={() => { setDateChienMode('age'); setDateNaissanceChien(''); }}
            >
              <Text style={[styles.modeBtnText, dateChienMode === 'age' && styles.modeBtnTextActive]}>🔢 Âge</Text>
            </TouchableOpacity>
          </View>
          {dateChienMode === 'date' ? (
            <TextInput style={styles.fieldInput} value={dateNaissanceChien}
              onChangeText={t => setDateNaissanceChien(formatDate(t))}
              placeholder="JJ/MM/AAAA" placeholderTextColor={colors.textMuted}
              keyboardType="numeric" maxLength={10} />
          ) : (
            <View style={styles.ageRow}>
              <TextInput style={[styles.fieldInput, { flex: 1 }]} value={ageChienVal}
                onChangeText={setAgeChienVal} placeholder="Ex : 3"
                placeholderTextColor={colors.textMuted} keyboardType="numeric" maxLength={3} />
              <Text style={styles.ageUnit}>ans</Text>
            </View>
          )}
        </View>

        {/* Situation amoureuse */}
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Situation amoureuse du chien</Text>
          <View style={styles.pillGrid}>
            {STATUTS_AMOUREUX.map(s => {
              const active = statutAmoureux === s.key;
              return (
                <TouchableOpacity
                  key={s.key}
                  style={[styles.pill, active && styles.pillActive]}
                  onPress={() => setStatutAmoureux(active ? '' : s.key)}
                >
                  <Text style={styles.pillEmoji}>{s.emoji}</Text>
                  <Text style={[styles.pillLabel, active && styles.pillLabelActive]}>{s.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <TouchableOpacity style={styles.saveBtn} onPress={saveProfil} disabled={savingProfil}>
          {savingProfil
            ? <ActivityIndicator color={colors.ivory} size="small" />
            : <Text style={styles.saveBtnText}>Enregistrer les modifications</Text>}
        </TouchableOpacity>
      </View>

      {/* Username */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Nom d'utilisateur</Text>
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
        <Text style={styles.usernameHint}>Lettres minuscules, chiffres et _ uniquement. Min. 3 caractères.</Text>
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
        <Text style={styles.sectionTitle}>Notifications</Text>
        <View style={styles.toggleRow}>
          <View style={styles.toggleInfo}>
            <Text style={styles.toggleLabel}>Nouvel abonné</Text>
            <Text style={styles.toggleSub}>Quand quelqu'un commence à te suivre</Text>
          </View>
          <Switch value={notifFollow} onValueChange={v => toggleNotif('notif_follow', v)}
            trackColor={{ false: colors.border, true: colors.terra }} thumbColor={colors.ivory} />
        </View>
        <View style={styles.toggleRow}>
          <View style={styles.toggleInfo}>
            <Text style={styles.toggleLabel}>Nouveau lieu près de moi</Text>
            <Text style={styles.toggleSub}>Quand un lieu dog-friendly est ajouté près de chez toi</Text>
          </View>
          <Switch value={notifLieuNearby} onValueChange={v => toggleNotif('notif_lieu_nearby', v)}
            trackColor={{ false: colors.border, true: colors.terra }} thumbColor={colors.ivory} />
        </View>
        <View style={styles.toggleRow}>
          <View style={styles.toggleInfo}>
            <Text style={styles.toggleLabel}>Messages</Text>
            <Text style={styles.toggleSub}>Nouveaux messages reçus dans tes conversations</Text>
          </View>
          <Switch value={notifMessages} onValueChange={v => toggleNotif('notif_messages', v)}
            trackColor={{ false: colors.border, true: colors.terra }} thumbColor={colors.ivory} />
        </View>
        <View style={[styles.toggleRow, { borderBottomWidth: 0 }]}>
          <View style={styles.toggleInfo}>
            <Text style={styles.toggleLabel}>Lieu suggéré validé</Text>
            <Text style={styles.toggleSub}>Quand un lieu que tu as proposé est publié sur la carte</Text>
          </View>
          <Switch value={notifSuggestionValidee} onValueChange={v => toggleNotif('notif_suggestion_validee', v)}
            trackColor={{ false: colors.border, true: colors.terra }} thumbColor={colors.ivory} />
        </View>
      </View>

      {/* Compte */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Mon compte</Text>
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
        <Text style={styles.sectionTitle}>À propos</Text>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Version</Text>
          <Text style={styles.infoValue}>1.0.0</Text>
        </View>
        <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
          <Text style={styles.infoLabel}>Développé par</Text>
          <Text style={styles.infoValue}>The Pack Club</Text>
        </View>
      </View>

    </ScrollView>

    {/* Race picker modal */}
    <Modal visible={raceModal} animationType="slide" transparent onRequestClose={() => { Keyboard.dismiss(); setRaceModal(false); setRaceCustomMode(null); setRaceCustomInput(''); setRaceSearch(''); }}>
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
                  if (val) setRaceChien(raceCustomMode === 'croisé' ? `Croisé ${val}` : val);
                  setRaceModal(false); setRaceCustomMode(null); setRaceCustomInput(''); setRaceSearch('');
                }}
              />
              <TouchableOpacity
                style={{ backgroundColor: raceCustomInput.trim() ? colors.bordeaux : colors.border, borderRadius: 10, padding: 13, alignItems: 'center', marginTop: 12 }}
                onPress={() => {
                  const val = raceCustomInput.trim();
                  if (val) setRaceChien(raceCustomMode === 'croisé' ? `Croisé ${val}` : val);
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
                    style={[styles.raceItem, raceChien === item && styles.raceItemActive]}
                    onPress={() => {
                      if (item === 'Croisé') { setRaceCustomMode('croisé'); setRaceCustomInput(''); setRaceSearch(''); return; }
                      if (item === 'Autre race') { setRaceCustomMode('autre'); setRaceCustomInput(''); setRaceSearch(''); return; }
                      Keyboard.dismiss();
                      setRaceChien(item); setRaceModal(false); setRaceSearch('');
                    }}
                  >
                    <Text style={[styles.raceItemText, raceChien === item && styles.raceItemTextActive]}>{item}</Text>
                    {raceChien === item && <Ionicons name="checkmark" size={16} color={colors.terra} />}
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
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: colors.border,
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
  fieldDivider: { height: 1, backgroundColor: colors.border },
  // Mode toggle (date vs âge)
  modeToggle: {
    flexDirection: 'row', gap: 8, marginBottom: 10,
  },
  modeBtn: {
    borderRadius: 20, borderWidth: 1.5, borderColor: colors.border,
    paddingVertical: 6, paddingHorizontal: 14,
    backgroundColor: colors.ivoryPale,
  },
  modeBtnActive: { backgroundColor: colors.bordeaux, borderColor: colors.bordeaux },
  modeBtnText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted },
  modeBtnTextActive: { color: colors.ivory, fontFamily: 'DMSans_500Medium' },
  ageRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ageUnit: { fontFamily: 'DMSans_400Regular', fontSize: 15, color: colors.textMuted },
  // Statut amoureux pills
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
  // Race picker
  racePicker: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 11,
    backgroundColor: colors.ivoryPale,
  },
  racePickerText: { fontFamily: 'DMSans_400Regular', fontSize: 15, color: colors.bordeaux, flex: 1 },
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
