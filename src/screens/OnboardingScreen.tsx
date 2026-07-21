import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Keyboard, Platform, ScrollView, ActivityIndicator,
  Modal, FlatList, Image, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import { useSession } from '../hooks/useSession';

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

const GENRES = [
  { key: 'male',    label: 'Mâle',    emoji: '♂️' },
  { key: 'femelle', label: 'Femelle', emoji: '♀️' },
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

type Suggestion = {
  id: string; prenom: string; avatar_url: string | null;
  ville: string | null; nom_chien: string | null;
};

type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

export default function OnboardingScreen() {
  const navigation = useNavigation<any>();
  const { session } = useSession();

  const [step, setStep] = useState<1 | 2>(1);

  // Step 1 — owner
  const [prenom, setPrenom] = useState('');
  const [nom, setNom] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [ville, setVille] = useState('');
  const [prenomError, setPrenomError] = useState(false);
  const [nomError, setNomError] = useState(false);
  const [emailError, setEmailError] = useState(false);
  const [usernameError, setUsernameError] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle');

  // Step 2 — dog
  const [nomChien, setNomChien] = useState('');
  const [raceChien, setRaceChien] = useState('');
  const [genre, setGenre] = useState('');
  const [trancheAge, setTrancheAge] = useState('');
  const [statutAmoureux, setStatutAmoureux] = useState('');
  const [nomChienError, setNomChienError] = useState(false);
  const [raceError, setRaceError] = useState(false);
  const [genreError, setGenreError] = useState(false);
  const [trancheAgeError, setTrancheAgeError] = useState(false);

  // Race picker
  const [raceModal, setRaceModal] = useState(false);
  const [raceSearch, setRaceSearch] = useState('');
  const filteredRaces = useMemo(
    () => RACES.filter(r => r.toLowerCase().includes(raceSearch.toLowerCase())),
    [raceSearch],
  );

  // Friend suggestions
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [followed, setFollowed] = useState<Set<string>>(new Set());
  const [showSuggestions, setShowSuggestions] = useState(false);

  const [saving, setSaving] = useState(false);

  // Pre-fill email from Google/auth session
  useEffect(() => {
    if (session?.user?.email) setEmail(session.user.email);
  }, [session?.user?.email]);

  // Username availability check (debounced 500ms)
  useEffect(() => {
    if (!username) { setUsernameStatus('idle'); return; }
    if (!/^[a-z0-9_]{3,20}$/.test(username)) { setUsernameStatus('invalid'); return; }
    setUsernameStatus('checking');
    const t = setTimeout(async () => {
      const { data } = await supabase.from('profils').select('id').eq('username', username).maybeSingle();
      setUsernameStatus(data ? 'taken' : 'available');
    }, 500);
    return () => clearTimeout(t);
  }, [username]);

  function goStep2() {
    const p = !prenom.trim();
    const n = !nom.trim();
    const e = !email.trim();
    const u = !!username && (usernameStatus === 'taken' || usernameStatus === 'invalid');
    setPrenomError(p);
    setNomError(n);
    setEmailError(e);
    setUsernameError(u);
    if (p || n || e || u) return;
    setStep(2);
  }

  async function finish() {
    if (!session) return;
    const nc = !nomChien.trim();
    const rc = !raceChien;
    const g = !genre;
    const ta = !trancheAge;
    setNomChienError(nc);
    setRaceError(rc);
    setGenreError(g);
    setTrancheAgeError(ta);
    if (nc || rc || g || ta) return;

    setSaving(true);
    const { error: upsertError } = await supabase.from('profils').upsert({
      id: session.user.id,
      prenom: prenom.trim(),
      nom: nom.trim(),
      email: email.trim(),
      username: username.trim() || null,
      ville: ville.trim() || null,
      nom_chien: nomChien.trim(),
      race_chien: raceChien,
      genre_chien: genre,
      tranche_age_chien: trancheAge,
      statut_amoureux_chien: statutAmoureux || null,
    });
    setSaving(false);
    if (upsertError) { Alert.alert('Erreur', upsertError.message); return; }

    const { data } = await supabase.from('profils')
      .select('id,prenom,avatar_url,ville,nom_chien')
      .neq('id', session.user.id)
      .not('prenom', 'is', null)
      .limit(5);
    setSuggestions(data || []);
    setShowSuggestions(true);
  }

  async function followSuggestion(userId: string) {
    if (!session) return;
    await supabase.from('follows').insert({
      follower_id: session.user.id, following_id: userId, statut: 'accepte',
    });
    setFollowed(prev => new Set([...prev, userId]));
  }

  function goToApp() {
    setShowSuggestions(false);
    navigation.reset({ index: 0, routes: [{ name: 'Tabs' }] });
  }

  function UsernameHint() {
    if (!username) return null;
    if (usernameStatus === 'checking') return (
      <View style={styles.usernameHint}>
        <ActivityIndicator size="small" color={colors.textMuted} />
        <Text style={styles.usernameHintText}>Vérification…</Text>
      </View>
    );
    if (usernameStatus === 'invalid') return (
      <Text style={styles.errorText}>3 à 20 caractères, lettres minuscules, chiffres et _ uniquement</Text>
    );
    if (usernameStatus === 'taken') return (
      <Text style={styles.errorText}>Ce nom d'utilisateur est déjà pris</Text>
    );
    if (usernameStatus === 'available') return (
      <View style={styles.usernameHint}>
        <Ionicons name="checkmark-circle" size={14} color="#2E7D32" />
        <Text style={[styles.usernameHintText, { color: '#2E7D32' }]}>Disponible !</Text>
      </View>
    );
    return null;
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">

        {/* Progress */}
        <View style={styles.progress}>
          <View style={[styles.progressDot, styles.progressDotActive]} />
          <View style={styles.progressLine} />
          <View style={[styles.progressDot, step === 2 && styles.progressDotActive]} />
        </View>

        {step === 1 && (
          <>
            <Text style={styles.paw}>🐾</Text>
            <Text style={styles.title}>Bienvenue dans{'\n'}The Pack Club !</Text>
            <Text style={styles.sub}>Quelques infos pour personnaliser ton expérience.</Text>

            <View style={styles.card}>
              <Text style={styles.label}>Prénom *</Text>
              <TextInput
                style={[styles.input, prenomError && styles.inputError]}
                placeholder="Ex : Marie"
                placeholderTextColor={colors.textMuted}
                value={prenom}
                onChangeText={t => { setPrenom(t); setPrenomError(false); }}
                autoCapitalize="words"
                autoFocus
                returnKeyType="next"
              />
              {prenomError && <Text style={styles.errorText}>Le prénom est requis</Text>}

              <Text style={[styles.label, { marginTop: 16 }]}>Nom *</Text>
              <TextInput
                style={[styles.input, nomError && styles.inputError]}
                placeholder="Ex : Dupont"
                placeholderTextColor={colors.textMuted}
                value={nom}
                onChangeText={t => { setNom(t); setNomError(false); }}
                autoCapitalize="words"
                returnKeyType="next"
              />
              {nomError && <Text style={styles.errorText}>Le nom est requis</Text>}

              <Text style={[styles.label, { marginTop: 16 }]}>Adresse e-mail *</Text>
              <TextInput
                style={[styles.input, emailError && styles.inputError]}
                placeholder="Ex : marie@email.com"
                placeholderTextColor={colors.textMuted}
                value={email}
                onChangeText={t => { setEmail(t); setEmailError(false); }}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
              />
              {emailError && <Text style={styles.errorText}>L'adresse e-mail est requise</Text>}

              <Text style={[styles.label, { marginTop: 16 }]}>Nom d'utilisateur</Text>
              <View style={[styles.input, styles.usernameWrap, usernameError && styles.inputError]}>
                <Text style={styles.usernameAt}>@</Text>
                <TextInput
                  style={styles.usernameInput}
                  placeholder="ex : marie_et_rex"
                  placeholderTextColor={colors.textMuted}
                  value={username}
                  onChangeText={t => {
                    setUsername(t.toLowerCase().replace(/[^a-z0-9_]/g, ''));
                    setUsernameError(false);
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                />
              </View>
              <UsernameHint />
              {usernameError && <Text style={styles.errorText}>Ce nom d'utilisateur n'est pas disponible</Text>}

              <Text style={[styles.label, { marginTop: 16 }]}>Ta ville</Text>
              <TextInput
                style={styles.input}
                placeholder="Ex : Paris"
                placeholderTextColor={colors.textMuted}
                value={ville}
                onChangeText={setVille}
                autoCapitalize="words"
                returnKeyType="done"
                onSubmitEditing={goStep2}
              />
            </View>

            <TouchableOpacity style={styles.btn} onPress={goStep2}>
              <Text style={styles.btnText}>Suivant →</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 2 && (
          <>
            <Text style={styles.paw}>🐕</Text>
            <Text style={styles.title}>Ton chien</Text>
            <Text style={styles.sub}>Ces infos apparaîtront sur ton profil et aideront la communauté à te retrouver.</Text>

            <View style={styles.card}>
              <Text style={styles.label}>Nom du chien *</Text>
              <TextInput
                style={[styles.input, nomChienError && styles.inputError]}
                placeholder="Ex : Albus"
                placeholderTextColor={colors.textMuted}
                value={nomChien}
                onChangeText={t => { setNomChien(t); setNomChienError(false); }}
                autoCapitalize="words"
                autoFocus
              />
              {nomChienError && <Text style={styles.errorText}>Le nom du chien est requis</Text>}

              <Text style={[styles.label, { marginTop: 16 }]}>Race *</Text>
              <TouchableOpacity
                style={[styles.racePicker, raceError && styles.inputError]}
                onPress={() => { setRaceSearch(''); setRaceModal(true); }}
              >
                <Text style={[styles.racePickerText, !raceChien && { color: colors.textMuted }]}>
                  {raceChien || 'Choisir une race…'}
                </Text>
                <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
              </TouchableOpacity>
              {raceError && <Text style={styles.errorText}>La race est requise</Text>}

              <Text style={[styles.label, { marginTop: 16 }]}>Genre *</Text>
              <View style={styles.statutGrid}>
                {GENRES.map(g => {
                  const active = genre === g.key;
                  return (
                    <TouchableOpacity
                      key={g.key}
                      style={[styles.statutPill, active && styles.statutPillActive, genreError && !genre && styles.inputError]}
                      onPress={() => { setGenre(g.key); setGenreError(false); }}
                    >
                      <Text style={styles.statutEmoji}>{g.emoji}</Text>
                      <Text style={[styles.statutLabel, active && styles.statutLabelActive]}>{g.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {genreError && <Text style={styles.errorText}>Le genre est requis</Text>}

              <Text style={[styles.label, { marginTop: 16 }]}>Tranche d'âge *</Text>
              <View style={styles.statutGrid}>
                {TRANCHES_AGE.map(t => {
                  const active = trancheAge === t.key;
                  return (
                    <TouchableOpacity
                      key={t.key}
                      style={[styles.statutPill, active && styles.statutPillActive]}
                      onPress={() => { setTrancheAge(t.key); setTrancheAgeError(false); }}
                    >
                      <Text style={styles.statutEmoji}>{t.emoji}</Text>
                      <View>
                        <Text style={[styles.statutLabel, active && styles.statutLabelActive]}>{t.label}</Text>
                        <Text style={[styles.statutSub, active && styles.statutLabelActive]}>{t.sub}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {trancheAgeError && <Text style={styles.errorText}>La tranche d'âge est requise</Text>}

              <Text style={[styles.label, { marginTop: 16 }]}>Situation amoureuse</Text>
              <View style={styles.statutGrid}>
                {STATUTS_AMOUREUX.map(s => {
                  const active = statutAmoureux === s.key;
                  return (
                    <TouchableOpacity
                      key={s.key}
                      style={[styles.statutPill, active && styles.statutPillActive]}
                      onPress={() => setStatutAmoureux(active ? '' : s.key)}
                    >
                      <Text style={styles.statutEmoji}>{s.emoji}</Text>
                      <Text style={[styles.statutLabel, active && styles.statutLabelActive]}>{s.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <TouchableOpacity
              style={[styles.btn, saving && styles.btnDisabled]}
              onPress={finish}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator color={colors.ivory} />
                : <Text style={styles.btnText}>C'est parti ! 🎉</Text>}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      {/* Race picker modal */}
      <Modal visible={raceModal} animationType="slide" transparent>
        <KeyboardAvoidingView
          style={styles.raceOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.raceCard}>
            <View style={styles.raceHeader}>
              <Text style={styles.raceTitle}>Choisir une race</Text>
              <TouchableOpacity onPress={() => setRaceModal(false)}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <View style={styles.raceSearchWrap}>
              <Ionicons name="search" size={15} color={colors.textMuted} />
              <TextInput
                style={styles.raceSearchInput}
                placeholder="Rechercher une race…"
                placeholderTextColor={colors.textMuted}
                value={raceSearch}
                onChangeText={setRaceSearch}
                autoCorrect={false}
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
                  onPress={() => { Keyboard.dismiss(); setRaceChien(item); setRaceError(false); setRaceModal(false); }}
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
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Friend suggestions modal */}
      <Modal visible={showSuggestions} animationType="slide" transparent>
        <View style={styles.suggestOverlay}>
          <View style={styles.suggestCard}>
            <Text style={styles.suggestTitle}>Des membres à suivre 🐾</Text>
            <Text style={styles.suggestSub}>
              Commence à construire ta meute ! Tu peux toujours en trouver plus dans l'onglet Membres.
            </Text>

            <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
              {suggestions.map(s => (
                <View key={s.id} style={styles.suggestRow}>
                  {s.avatar_url ? (
                    <Image source={{ uri: s.avatar_url }} style={styles.suggestAvatar} />
                  ) : (
                    <View style={styles.suggestAvatarFallback}>
                      <Text style={styles.suggestAvatarLetter}>{(s.prenom || '?')[0].toUpperCase()}</Text>
                    </View>
                  )}
                  <View style={styles.suggestBody}>
                    <Text style={styles.suggestName}>{s.prenom}</Text>
                    {s.ville ? <Text style={styles.suggestSub2}>{s.ville}</Text> : null}
                    {s.nom_chien ? <Text style={styles.suggestSub2}>🐾 {s.nom_chien}</Text> : null}
                  </View>
                  <TouchableOpacity
                    style={[styles.suggestFollow, followed.has(s.id) && styles.suggestFollowDone]}
                    onPress={() => { if (!followed.has(s.id)) followSuggestion(s.id); }}
                  >
                    <Text style={[styles.suggestFollowText, followed.has(s.id) && styles.suggestFollowTextDone]}>
                      {followed.has(s.id) ? 'Suivi ✓' : 'Suivre'}
                    </Text>
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>

            <TouchableOpacity style={styles.suggestCta} onPress={goToApp}>
              <Text style={styles.suggestCtaText}>Continuer vers l'app →</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.suggestSkip} onPress={goToApp}>
              <Text style={styles.suggestSkipText}>Passer cette étape</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bordeaux },
  inner: { flexGrow: 1, padding: 28, paddingTop: 64 },

  progress: { flexDirection: 'row', alignItems: 'center', marginBottom: 40, alignSelf: 'center' },
  progressDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: 'rgba(245,239,224,0.2)' },
  progressDotActive: { backgroundColor: colors.terraPale },
  progressLine: { width: 40, height: 1, backgroundColor: 'rgba(245,239,224,0.15)', marginHorizontal: 8 },

  paw: { fontSize: 42, textAlign: 'center', marginBottom: 16 },
  title: {
    fontFamily: 'PlayfairDisplay_500Medium', fontSize: 30,
    color: colors.ivory, textAlign: 'center', marginBottom: 12, lineHeight: 38,
  },
  sub: {
    fontFamily: 'DMSans_300Light', fontSize: 15,
    color: 'rgba(245,239,224,0.6)', textAlign: 'center', lineHeight: 22, marginBottom: 32,
  },

  card: { backgroundColor: colors.ivoryPale, borderRadius: 18, padding: 20, marginBottom: 20 },
  label: {
    fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 8,
  },
  input: {
    fontFamily: 'DMSans_400Regular', fontSize: 15,
    backgroundColor: 'white', borderRadius: 10, padding: 14,
    color: colors.bordeaux, borderWidth: 1.5, borderColor: colors.border,
  },
  inputError: { borderColor: '#C43A3A' },
  errorText: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: '#C43A3A', marginTop: 6 },

  usernameWrap: { flexDirection: 'row', alignItems: 'center', paddingVertical: 0, paddingHorizontal: 14 },
  usernameAt: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: colors.textMuted, marginRight: 2 },
  usernameInput: { flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 15, color: colors.bordeaux, paddingVertical: 14 },
  usernameHint: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  usernameHintText: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.textMuted },

  racePicker: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'white', borderRadius: 10, padding: 14,
    borderWidth: 1.5, borderColor: colors.border,
  },
  racePickerText: { fontFamily: 'DMSans_400Regular', fontSize: 15, color: colors.bordeaux, flex: 1 },

  statutGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  statutPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'white', borderRadius: 20, paddingVertical: 8, paddingHorizontal: 12,
    borderWidth: 1.5, borderColor: colors.border,
  },
  statutPillActive: { backgroundColor: colors.terra, borderColor: colors.terra },
  statutEmoji: { fontSize: 14 },
  statutLabel: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.bordeaux },
  statutLabelActive: { color: colors.ivory, fontFamily: 'DMSans_500Medium' },
  statutSub: { fontFamily: 'DMSans_300Light', fontSize: 10, color: colors.textMuted },

  btn: { backgroundColor: colors.terra, borderRadius: 14, padding: 16, alignItems: 'center' },
  btnDisabled: { opacity: 0.6 },
  btnText: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: colors.ivory },

  // Race picker modal
  raceOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  raceCard: {
    backgroundColor: colors.ivoryPale, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '85%', paddingBottom: 32,
  },
  raceHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 20, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  raceTitle: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: colors.bordeaux },
  raceSearchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    margin: 12, paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: 'white', borderRadius: 10, borderWidth: 1.5, borderColor: colors.border,
  },
  raceSearchInput: { flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 14, color: colors.bordeaux, padding: 0 },
  raceItem: {
    paddingVertical: 14, paddingHorizontal: 20,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderBottomWidth: 1, borderBottomColor: colors.border + '55',
  },
  raceItemActive: { backgroundColor: colors.terra + '0D' },
  raceItemText: { fontFamily: 'DMSans_400Regular', fontSize: 15, color: colors.bordeaux },
  raceItemTextActive: { fontFamily: 'DMSans_500Medium', color: colors.terra },

  // Suggestions modal
  suggestOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end',
  },
  suggestCard: {
    backgroundColor: colors.ivoryPale, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 40,
  },
  suggestTitle: {
    fontFamily: 'PlayfairDisplay_500Medium', fontSize: 22, color: colors.bordeaux,
    marginBottom: 6, textAlign: 'center',
  },
  suggestSub: {
    fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted,
    textAlign: 'center', lineHeight: 19, marginBottom: 20,
  },
  suggestRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: 'white', borderRadius: 12, padding: 12,
    marginBottom: 10, borderWidth: 1, borderColor: colors.border,
  },
  suggestAvatar: { width: 44, height: 44, borderRadius: 22 },
  suggestAvatarFallback: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.bordeaux, alignItems: 'center', justifyContent: 'center',
  },
  suggestAvatarLetter: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 18, color: colors.ivory },
  suggestBody: { flex: 1 },
  suggestName: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: colors.bordeaux },
  suggestSub2: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: colors.textMuted, marginTop: 1 },
  suggestFollow: {
    backgroundColor: colors.bordeaux, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 7,
  },
  suggestFollowDone: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.bordeaux },
  suggestFollowText: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: colors.ivory },
  suggestFollowTextDone: { color: colors.bordeaux },
  suggestCta: {
    backgroundColor: colors.terra, borderRadius: 14, padding: 15,
    alignItems: 'center', marginTop: 16,
  },
  suggestCtaText: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: colors.ivory },
  suggestSkip: { alignItems: 'center', paddingTop: 14 },
  suggestSkipText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: colors.textMuted },
});
